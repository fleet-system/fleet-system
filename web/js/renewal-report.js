// تقرير تجديد المركبة PDF — من ملف سيارة واحدة فقط (بالرقم الداخلي الثابت id)، عربي من اليمين لليسار، جاهز للطباعة.
// يُرسم التقرير في المتصفح (لتشكيل الحروف العربية بشكل صحيح) ثم يُحفظ ملف PDF حقيقي باسم يتضمن رقم اللوحة.
import * as api from './api.js';
import * as data from './data.js';
import { html, raw } from './ui.js';
import { date, dateTime, todayISO, num, label } from './fmt.js';
import { docState, cardStateOf } from './pages/vehicles.js';
import { customFields } from './vehicle-config.js';
import { saveBlob } from './xlsx.js';

const NR = 'غير مسجل';
// أقسام التقرير التي يختارها المستخدم قبل التنزيل (رأس التقرير ورقم اللوحة يظهران دائماً)
export const REPORT_PARTS = [['vehicle', 'بيانات المركبة'], ['owner', 'المالك'], ['reg', 'رخصة السير (الاستمارة)'], ['insp', 'الفحص الدوري'], ['ins', 'التأمين'],
  ['fines', 'المخالفات والرسوم'], ['follow', 'متابعة التجديد'], ['due', 'ملخص ما يحتاج تجديداً'], ['sign', 'خانات التوقيع']];
const ALL_PARTS = REPORT_PARTS.map(([k]) => k);
const COMPANY = 'شركة روى الرمال الزراعية';
const PAGE_W = 794, PAGE_H = 1123, SCALE = 2; // A4 عند 96 نقطة/بوصة
const STATE_TEXT = { valid: 'سارية', expiring: 'تنتهي قريباً (30 يوماً أو أقل)', expired: 'منتهية', none: NR };

// اسم الملف: تقرير-تجديد-المركبة-<رقم اللوحة>.pdf (الحروف اللاتينية والأرقام إن وُجدت، وإلا اللوحة كما هي)
export function reportFileName(plate) {
  const p = String(plate || '').trim();
  const latin = (p.match(/[A-Za-z]+/g) || []).join('').toUpperCase(), digits = (p.match(/\d+/g) || []).join('');
  let key = latin && digits ? `${latin}-${digits}` : p.replace(/\s+/g, '-');
  key = key.replace(/[\\/:*?"<>|]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'بدون-لوحة';
  return `تقرير-تجديد-المركبة-${key}.pdf`;
}

// نوع الهوية من أول رقم: 1 هوية وطنية، 2 إقامة، 7 الرقم الموحد للمنشأة
export function idKind(no) {
  const d = String(no || '');
  if (!d) return NR;
  if (/^1\d{9}$/.test(d)) return 'هوية وطنية';
  if (/^2\d{9}$/.test(d)) return 'إقامة';
  if (/^7\d{9}$/.test(d)) return 'الرقم الموحد للمنشأة';
  return 'غير محدد';
}

// ---------------------------------------------------------------------
// جلب بيانات سيارة واحدة والتأكد أن كل سجل يخصها
// ---------------------------------------------------------------------
export async function loadRenewalData(id) {
  await data.lookups();
  const sens = api.can('view_sensitive');
  const [[ov], [row], docs, priv] = await Promise.all([
    api.get('v_vehicles_overview', { select: '*', id: `eq.${id}` }),
    api.get('vehicles', { select: '*', id: `eq.${id}` }),
    api.get('documents', { select: '*', vehicle_id: `eq.${id}`, deleted_at: 'is.null', order: 'expiry_date.desc.nullslast' }),
    sens ? api.get('vehicle_private', { select: '*', vehicle_id: `eq.${id}` }).catch(() => []) : Promise.resolve([]),
  ]);
  const v = row ? { ...row, ...(ov || {}), card_auth_status: row.card_auth_status, card_auth_expiry: row.card_auth_expiry, custom_fields: row.custom_fields } : null;
  if (!v || v.id !== id) throw new Error('السيارة غير موجودة.');
  if (docs.some((d) => d.vehicle_id !== id) || priv.some((p) => p.vehicle_id !== id)) throw new Error('بيانات غير مطابقة للسيارة — أُلغي التقرير.');
  if (!v.owner_company_name) v.owner_company_name = data.companyName(v.owner_company_id);
  if (!v.site_name && v.site_id) v.site_name = data.siteName(v.site_id);
  return { v, docs, priv: priv[0] || null, sens };
}

// الحقول الإضافية (من «إدارة بيانات السيارات») حسب الاسم
function extra(v, re, notRe) {
  const hit = customFields(true).filter((c) => re.test(c.label) && !(notRe && notRe.test(c.label)))
    .map((c) => [c.label, (v.custom_fields || {})[c.key]]).filter(([, x]) => x !== null && x !== undefined && String(x).trim() !== '');
  return hit.map(([l, x]) => [l, c2s(x)]);
}
const c2s = (x) => (/^\d{4}-\d{2}-\d{2}$/.test(String(x)) ? date(x) : String(x));

// ---------------------------------------------------------------------
// محتوى التقرير
// ---------------------------------------------------------------------
export function renewalModel({ v, docs, priv, sens }) {
  const val = (x) => (x === null || x === undefined || String(x).trim() === '' ? NR : String(x));
  const state = (iso) => { const s = docState(iso); return { text: STATE_TEXT[s.key], key: s.key, days: iso ? s.daysText : NR }; };
  const latest = (t) => docs.filter((d) => d.doc_type === t).sort((a, b) => String(b.expiry_date || '').localeCompare(String(a.expiry_date || '')))[0] || null;
  const reg = latest('registration'), insp = latest('periodic_inspection');
  const inspAll = docs.filter((d) => d.doc_type === 'periodic_inspection');
  const sensNo = (x) => (!sens ? 'مخفي (يتطلب صلاحية البيانات الحساسة)' : val(x));
  const ownerNo = sens ? priv?.owner_id_no : null;
  const op = cardStateOf(v);

  const insNo = extra(v, /تأمين|تامين|بوليص/, /انتهاء|بداية|إصدار|اصدار/).filter(([l]) => /رقم|وثيق|بوليص/.test(l));
  const insStart = extra(v, /تأمين|تامين/).filter(([l]) => /بداية|إصدار|اصدار/.test(l));
  const fines = extra(v, /مخالف|رسوم|غرام/);
  const followUp = extra(v, /مسؤول|متابع/);

  const sections = [
    ['vehicle', 'بيانات المركبة', [
      ['رقم اللوحة', val(v.plate_no)], ['الرقم الداخلي', val(v.code)], ['رقم الهيكل', val(v.vin)],
      ['الرقم التسلسلي للاستمارة', val(v.registration_serial)], ['الماركة', val(v.make)], ['طراز المركبة', val(v.model)],
      ['موديل المركبة', val(v.manufacture_year)], ['سنة الصنع', val(v.manufacture_year)], ['نوع التسجيل', val(v.registration_type)],
    ]],
    ['owner', 'المالك', [
      ['اسم المالك / الشركة المالكة', val(v.owner_company_name)],
      ['رقم هوية المالك', sens ? val(ownerNo) : sensNo(null)], ['نوع الهوية', sens ? idKind(ownerNo) : sensNo(null)],
    ]],
    ['reg', 'رخصة السير (الاستمارة)', [
      ['تاريخ انتهاء الاستمارة', reg?.expiry_date ? date(reg.expiry_date) : NR],
      ['الحالة', state(reg?.expiry_date).text], ['المتبقي', state(reg?.expiry_date).days],
      ['تاريخ الإصدار', reg?.issue_date ? date(reg.issue_date) : NR],
    ]],
    ['insp', 'الفحص الدوري', [
      ['تاريخ انتهاء الفحص', insp?.expiry_date ? date(insp.expiry_date) : NR],
      ['الحالة', state(insp?.expiry_date).text], ['المتبقي', state(insp?.expiry_date).days],
      ['تاريخ الفحص (الإصدار)', insp?.issue_date ? date(insp.issue_date) : NR], ['رقم شهادة الفحص', insp ? sensNo(insp.doc_no) : NR],
    ], inspAll.length > 1 ? inspAll.map((d) => [date(d.issue_date) || NR, date(d.expiry_date) || NR, STATE_TEXT[docState(d.expiry_date).key]]) : null],
    ['ins', 'التأمين', [
      ['رقم وثيقة التأمين', insNo.length ? insNo.map(([, x]) => x).join('، ') : NR],
      ['تاريخ بداية التأمين', insStart.length ? insStart.map(([, x]) => x).join('، ') : NR],
      ['تاريخ انتهاء التأمين', v.insurance_expiry ? date(v.insurance_expiry) : NR],
      ['الحالة', state(v.insurance_expiry).text], ['المتبقي', state(v.insurance_expiry).days],
    ]],
    ['fines', 'المخالفات والرسوم', fines.length ? fines : [['المخالفات المرورية', NR], ['الرسوم المستحقة', NR]]],
    ['follow', 'متابعة التجديد', [
      ['المسؤول عن متابعة التجديد', followUp.length ? followUp.map(([, x]) => x).join('، ') : NR],
      ['المستخدم الحالي', val(v.current_user_name)], ['المفوّض', val(v.authorized_name)],
      ['المشروع الحالي', val(v.site_name)], ['الحالة التشغيلية', val(op.text)],
      ['الملاحظات الإدارية', val(v.notes)],
    ]],
  ];
  // ما يحتاج تجديداً الآن
  const due = [['رخصة السير', reg?.expiry_date], ['الفحص الدوري', insp?.expiry_date], ['التأمين', v.insurance_expiry]]
    .map(([n, iso]) => [n, iso, docState(iso)]).filter(([, , s]) => s.key !== 'valid');
  return { v, sections, due, plate: val(v.plate_no) };
}

const CSS = `
*{box-sizing:border-box;margin:0;padding:0}
.rp{width:${PAGE_W}px;background:#fff;color:#1d2b22;direction:rtl;text-align:right;font-family:Tahoma,'Segoe UI','Geeza Pro','Al Nile',Arial,sans-serif;font-size:13px;line-height:1.55;padding:34px 40px 30px}
.hd{display:flex;align-items:center;gap:16px;border-bottom:3px solid #1f5c3a;padding-bottom:14px}
.hd img{width:74px;height:74px;object-fit:contain}
.hd .co{flex:1}.hd .co b{display:block;font-size:19px;color:#1f5c3a}.hd .co span{color:#5d6b62;font-size:12px}
.hd .meta{text-align:left;font-size:11.5px;color:#5d6b62;direction:rtl}
.ttl{display:flex;align-items:center;justify-content:space-between;margin:18px 0 6px;gap:12px}
.ttl h1{font-size:22px;color:#14321f}
.plate{border:3px solid #14321f;border-radius:10px;padding:6px 18px;font-size:26px;font-weight:700;letter-spacing:1px;background:#f6f8f6;white-space:nowrap}
.sub{color:#5d6b62;font-size:12px;margin-bottom:8px}
.rb{margin-top:14px;break-inside:avoid}
.rb h2{font-size:14.5px;background:#1f5c3a;color:#fff;padding:6px 12px;border-radius:6px 6px 0 0}
table{width:100%;border-collapse:collapse}
td,th{border:1px solid #d6ddd8;padding:6px 10px;vertical-align:top}
td.k{width:34%;background:#f3f6f4;color:#3d4a42;font-weight:700}
td.nr{color:#9a6b12}
th{background:#eef2ef;font-size:12px}
.due{border:2px solid #b3261e;border-radius:8px;padding:8px 12px;background:#fdf1f0}
.due b{color:#b3261e}
.ok{border:2px solid #2f7d4f;border-radius:8px;padding:8px 12px;background:#eff7f2;color:#1f5c3a;font-weight:700}
.sign{display:flex;gap:24px;margin-top:22px}
.sign div{flex:1;border-top:1px solid #8a938d;padding-top:6px;text-align:center;color:#5d6b62;font-size:12px}
.foot{margin-top:16px;color:#8a938d;font-size:10.5px;text-align:center}
`;

export function renewalHtml(m, { logo = '', preparedBy = '', now = new Date(), parts = ALL_PARTS } = {}) {
  const on = (k) => parts.includes(k);
  const row = ([k, x]) => html`<tr><td class="k">${k}</td><td class="${x === NR ? 'nr' : ''}">${x}</td></tr>`;
  return html`<div class="rp" xmlns="http://www.w3.org/1999/xhtml"><style>${raw(CSS)}</style>
    <div class="rb hd">${raw(logo ? html`<img src="${logo}" alt=""/>` : '')}
      <div class="co"><b>${COMPANY}</b><span>نظام إدارة الأسطول والمواقع الزراعية</span></div>
      <div class="meta">تاريخ التقرير: ${date(todayISO())}<br/>الوقت: ${dateTime(now.toISOString()).split(' ').slice(1).join(' ')}<br/>${preparedBy ? `أعدّه: ${preparedBy}` : ''}</div></div>
    <div class="rb ttl"><h1>تقرير تجديد المركبة</h1><div class="plate" data-plate="">${m.plate}</div></div>
    <div class="rb sub">الرقم الداخلي: ${m.v.code} — البيانات من ملف هذه المركبة فقط. «${NR}» تعني أن المعلومة غير موجودة في النظام.</div>
    ${raw(!on('due') ? '' : html`<div class="rb">${raw(m.due.length ? html`<div class="due"><b>يحتاج إلى تجديد/متابعة:</b> ${m.due.map(([n, iso, s]) => `${n} (${iso ? `${STATE_TEXT[s.key]} — ${date(iso)}` : NR})`).join('، ')}</div>` : '<div class="ok">جميع الوثائق المسجلة سارية لأكثر من 30 يوماً.</div>')}</div>`)}
    ${raw(m.sections.filter(([k]) => on(k)).map(([, t, rows, hist]) => html`<div class="rb"><h2>${t}</h2><table>${raw(rows.map(row).join(''))}</table>
      ${raw(hist ? html`<table><tr><th>تاريخ الفحص</th><th>تاريخ الانتهاء</th><th>الحالة</th></tr>${raw(hist.map(([a, b, c]) => html`<tr><td>${a}</td><td>${b}</td><td>${c}</td></tr>`).join(''))}</table>` : '')}</div>`).join(''))}
    ${raw(on('sign') ? '<div class="rb sign"><div>المسؤول عن التجديد</div><div>المدير المختص</div><div>الختم</div></div>' : '')}
    <div class="rb foot">${COMPANY} — تقرير تجديد المركبة ${m.plate} — صدر من النظام بتاريخ ${date(todayISO())}</div>
  </div>`;
}

// ---------------------------------------------------------------------
// HTML ← صورة (SVG foreignObject) ← صفحات A4 ← PDF
// ---------------------------------------------------------------------
export async function dataUrl(path) {
  try { const r = await fetch(path); if (!r.ok) return ''; const b = await r.blob(); return await new Promise((res) => { const f = new FileReader(); f.onload = () => res(f.result); f.onerror = () => res(''); f.readAsDataURL(b); }); } catch (_) { return ''; }
}
function loadImg(src) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('تعذر رسم التقرير')); i.src = src; }); }

export async function renderPages(markup) {
  const host = document.createElement('div');
  host.style.cssText = `position:fixed;left:-20000px;top:0;width:${PAGE_W}px;pointer-events:none;`;
  // القياس داخل Shadow DOM حتى لا تؤثر أنماط الموقع على تقسيم الصفحات (الرسم النهائي لا يرى أنماط الموقع)
  const root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
  root.innerHTML = markup; document.body.appendChild(host);
  try {
    if (document.fonts?.ready) await document.fonts.ready;
    await Promise.all([...root.querySelectorAll('img')].map((i) => (i.complete ? null : new Promise((r) => { i.onload = r; i.onerror = r; }))));
    const rp = root.querySelector('.rp'); const total = Math.ceil(rp.getBoundingClientRect().height);
    // فواصل الصفحات بين الأقسام (لا يُقطع قسم في منتصفه إلا إذا كان أطول من صفحة)
    const top0 = rp.getBoundingClientRect().top, pad = 34, foot = 40;
    const blocks = [...rp.querySelectorAll(':scope > .rb')].map((b) => { const r = b.getBoundingClientRect(); return [r.top - top0, r.bottom - top0]; });
    const cuts = [0]; let start = 0;
    for (const [t, b] of blocks) {
      const room = PAGE_H - foot - (cuts.length > 1 ? pad : 0);
      if (b - start > room && t - 8 > start) { start = t - 8; cuts.push(start); }
      while (b - start > PAGE_H - foot - pad) { start += PAGE_H - foot - pad; cuts.push(start); } // قسم أطول من صفحة
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${PAGE_W}" height="${total}"><foreignObject x="0" y="0" width="100%" height="100%">${new XMLSerializer().serializeToString(rp)}</foreignObject></svg>`;
    const img = await loadImg(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
    const pages = [];
    for (let i = 0; i < cuts.length; i++) {
      const y0 = cuts[i], y1 = i + 1 < cuts.length ? cuts[i + 1] : total;
      const c = document.createElement('canvas'); c.width = PAGE_W * SCALE; c.height = PAGE_H * SCALE;
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.scale(SCALE, SCALE);
      const dy = i ? pad : 0;
      g.drawImage(img, 0, y0, PAGE_W, y1 - y0, 0, dy, PAGE_W, y1 - y0);
      g.fillStyle = '#8a938d'; g.font = '11px Tahoma, sans-serif'; g.textAlign = 'center'; g.direction = 'rtl';
      g.fillText(`صفحة ${i + 1} من ${cuts.length}`, PAGE_W / 2, PAGE_H - 14);
      const jpg = c.toDataURL('image/jpeg', 0.92); // يرمي خطأ إذا منع المتصفح القراءة (نستخدم الطباعة بديلاً)
      pages.push({ bytes: Uint8Array.from(atob(jpg.split(',')[1]), (ch) => ch.charCodeAt(0)), w: c.width, h: c.height });
    }
    return pages;
  } finally { host.remove(); }
}

// ملف PDF بصفحات صور JPEG (A4)
export function pdfFromJpegs(pages, title = '') {
  const enc = new TextEncoder(); const chunks = []; const offs = []; let len = 0;
  const push = (x) => { const b = typeof x === 'string' ? enc.encode(x) : x; chunks.push(b); len += b.length; };
  const hex16 = (s) => { let h = 'FEFF'; for (const ch of s) { const cp = ch.codePointAt(0); const u = cp > 0xffff ? [0xd800 + ((cp - 0x10000) >> 10), 0xdc00 + ((cp - 0x10000) & 0x3ff)] : [cp]; for (const x of u) h += x.toString(16).padStart(4, '0').toUpperCase(); } return `<${h}>`; };
  const n = pages.length; const obj = (i) => { offs[i] = len; };
  push(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])); // %PDF-1.4
  obj(1); push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  obj(2); push(`2 0 obj\n<< /Type /Pages /Kids [${pages.map((_, i) => `${4 + i * 3} 0 R`).join(' ')}] /Count ${n} >>\nendobj\n`);
  obj(3); push(`3 0 obj\n<< /Title ${hex16(title)} /Producer (fleet-system) /CreationDate (D:${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}) >>\nendobj\n`);
  pages.forEach((p, i) => {
    const pg = 4 + i * 3, ct = pg + 1, im = pg + 2; const W = 595.28, H = 841.89;
    obj(pg); push(`${pg} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im${i} ${im} 0 R >> >> /Contents ${ct} 0 R >>\nendobj\n`);
    const s = `q ${W} 0 0 ${H} 0 0 cm /Im${i} Do Q`;
    obj(ct); push(`${ct} 0 obj\n<< /Length ${s.length} >>\nstream\n${s}\nendstream\nendobj\n`);
    obj(im); push(`${im} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${p.w} /Height ${p.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.bytes.length} >>\nstream\n`); push(p.bytes); push('\nendstream\nendobj\n');
  });
  const total = 4 + n * 3; const xref = len;
  push(`xref\n0 ${total}\n0000000000 65535 f \n${Array.from({ length: total - 1 }, (_, k) => `${String(offs[k + 1]).padStart(10, '0')} 00000 n \n`).join('')}`);
  push(`trailer\n<< /Size ${total} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(chunks, { type: 'application/pdf' });
}

// بديل عند منع المتصفح لرسم التقرير: نافذة طباعة بنفس التقرير (احفظه PDF من الطباعة)
export function printFallback(markup, name) {
  const w = window.open('', '_blank'); if (!w) throw new Error('اسمح بالنوافذ المنبثقة لعرض التقرير.');
  w.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${name.replace(/\.pdf$/, '')}</title><style>@page{size:A4;margin:0}body{margin:0}</style></head><body>${markup}</body></html>`);
  w.document.close(); setTimeout(() => w.print(), 400);
}

// الزر: تقرير تجديد المركبة PDF
export async function renewalReport(id, parts = ALL_PARTS) {
  parts = parts.filter((k) => ALL_PARTS.includes(k));
  if (!parts.length) throw new Error('اختر قسماً واحداً على الأقل.');
  const d = await loadRenewalData(id);
  const m = renewalModel(d);
  const name = reportFileName(d.v.plate_no);
  const markup = String(renewalHtml(m, { logo: await dataUrl('logo-mark.png') || await dataUrl('logo.png'), preparedBy: api.currentUser()?.full_name || '', parts }));
  let pages;
  try { pages = await renderPages(markup); } catch (e) { printFallback(markup, name); return { name, fallback: true }; }
  const blob = pdfFromJpegs(pages, name.replace(/\.pdf$/, ''));
  saveBlob(blob, name);
  return { name, pages: pages.length, size: blob.size, plate: d.v.plate_no };
}
export { CSS as REPORT_CSS };
