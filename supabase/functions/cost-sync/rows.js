// 1.35: تحويل أوراق التكاليف في ملف Excel المالك إلى صفوف cost_lines — مشترك بين الموقع (زر «تحديث من ملف Excel»)
// ودالة المزامنة اللحظية supabase/functions/cost-sync (نسخة مطابقة هناك: rows.js). بدون أي import حتى يعمل في الاثنين.
const EPOCH = Date.UTC(1899, 11, 30);
const serialToDate = (n) => new Date(EPOCH + Math.round(n * 864e5)).toISOString().slice(0, 10);

// قراءة أوراق التكاليف من ملف Excel المالك (نفس تحويل tools/excel_costs.py). المفتاح الثابت = اسم الورقة + رقم الصف.
export const XL_SHEETS = {
  'الصيانة': ['maintenance', { plate: 1, letters: 2, company: 3, site: 4, brand: 5, user_name: 6, date: 7, invoice_no: 8, order_no: 9, description: 10, amount: 11, payment_status: 14, payment_method: 15, payer: 16, doc_type: 17, attachment_url: 19 }],
  'غيار_الزيت': ['oil', { plate: 1, letters: 2, company: 3, site: 4, brand: 5, user_name: 6, date: 7, odometer: 8, description: 9, invoice_no: 10, amount: 11, notes: 12, payment_status: 13, payment_method: 14, payer: 15, doc_type: 16, attachment_url: 17 }],
  'الكفرات': ['tires', { plate: 1, letters: 2, company: 3, site: 4, brand: 5, user_name: 6, date: 7, description: 8, quantity: 9, supplier: 10, invoice_no: 11, amount: 12, payment_status: 13, payment_method: 14, payer: 15, doc_type: 16, attachment_url: 17, notes: 19 }],
  'البطاريات': ['batteries', { plate: 1, letters: 2, company: 3, site: 4, brand: 5, user_name: 6, date: 7, description: 8, quantity: 9, supplier: 10, invoice_no: 11, amount: 12, payment_status: 13, payment_method: 14, payer: 15, doc_type: 16, attachment_url: 17, notes: 19 }],
};
const txt = (v) => { if (v == null || typeof v === 'boolean') return null; if (typeof v === 'object') v = v.serial; const s = String(v).trim(); return s || null; };
const isoOf = (v) => {
  if (v && typeof v === 'object' && Number.isFinite(v.serial)) return serialToDate(v.serial);
  if (typeof v === 'number' && v > 20000 && v < 80000) return serialToDate(v); // رقم تاريخ Excel بدون تنسيق (القارئ الخفيف)
  const s = txt(v); if (!s) return null;
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/); if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/); if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
};
export function costRowsFromSheets(sheets) {
  const rows = [], read = [];
  for (const [name, [cat, cols]] of Object.entries(XL_SHEETS)) {
    const sh = sheets.find((x) => x.name === name); if (!sh) continue; read.push(name);
    sh.rows.forEach((arr, i) => {
      if (i === 0) return;
      const g = Object.fromEntries(Object.entries(cols).map(([k, c]) => [k, arr[c - 1] ?? null]));
      if (typeof g.amount !== 'number') return; // صف فارغ أو بدون مبلغ
      const plate = [txt(g.letters), txt(g.plate)].filter(Boolean).join(' ') || null;
      let notes = txt(g.notes);
      if (g.odometer) notes = [`الممشى ${txt(g.odometer)}`, notes].filter(Boolean).join(' | ');
      if (g.order_no) notes = [`رقم الطلب ${txt(g.order_no)}`, notes].filter(Boolean).join(' | ');
      const att = txt(g.attachment_url);
      rows.push({ category: cat, source_sheet: name, source_row: i + 1, plate, company: txt(g.company), site: txt(g.site), brand: txt(g.brand),
        user_name: txt(g.user_name), date: isoOf(g.date), description: txt(g.description), quantity: typeof g.quantity === 'number' ? g.quantity : null,
        supplier: txt(g.supplier), invoice_no: txt(g.invoice_no), amount: Math.round(g.amount * 100) / 100, payment_status: txt(g.payment_status),
        payment_method: txt(g.payment_method), payer: txt(g.payer), doc_type: txt(g.doc_type), attachment_url: att && att.startsWith('http') ? att : null, notes });
    });
  }
  return { rows, sheets: read };
}

// قارئ xlsx خفيف بدون DOMParser (لدالة Supabase): z = ملفات zip مفكوكة {name: Uint8Array}. يعيد [{ name, rows }] بنفس شكل readXlsx
// (الأرقام أرقام والنصوص نصوص؛ التواريخ تبقى أرقاماً ويحوّلها isoOf).
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unesc = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1)) : (ENT[e] ?? m));
const attrs = (tag) => Object.fromEntries([...tag.matchAll(/([\w:]+)="([^"]*)"/g)].map((m) => [m[1], unesc(m[2])]));
const texts = (x) => [...x.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => unesc(m[1])).join('');
export function sheetsFromZip(z) {
  const dec = new TextDecoder(); const text = (n) => (z[n] ? dec.decode(z[n]) : '');
  const strings = [...text('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => texts(m[1].replace(/<rPh[\s\S]*?<\/rPh>/g, '')));
  const rel = new Map([...text('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\s[^>]*>/g)].map((m) => { const a = attrs(m[0]); return [a.Id, a.Target]; }));
  const out = [];
  for (const m of text('xl/workbook.xml').matchAll(/<sheet\s[^>]*>/g)) {
    const a = attrs(m[0]); let t = rel.get(a['r:id']) || ''; t = t.startsWith('/') ? t.slice(1) : `xl/${t}`;
    const rows = [];
    for (const rm of text(t).matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const r = +attrs(rm[1]).r - 1; const arr = rows[r] = []; let ci = 0;
      for (const cm of (rm[2] || '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ca = attrs(cm[1]); const body = cm[2] || '';
        if (ca.r) ci = [...ca.r.replace(/\d+/g, '')].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
        const vm = body.match(/<v>([\s\S]*?)<\/v>/); const v = vm ? unesc(vm[1]) : null; let val = null;
        if (ca.t === 's') val = strings[+v] ?? '';
        else if (ca.t === 'inlineStr') val = texts(body);
        else if (ca.t === 'str') val = v ?? '';
        else if (ca.t === 'b') val = v === '1';
        else if (ca.t === 'e') val = null;
        else if (v !== null) val = Number(v);
        arr[ci] = val; ci++;
      }
    }
    out.push({ name: a.name, rows: Array.from(rows, (r) => r || []) });
  }
  return out;
}
