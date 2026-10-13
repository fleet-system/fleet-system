// اختبار ملف Excel المربوط (supabase/functions/excel-feed) على قاعدة الاختبار المحلية fleet_ui.
// Usage: node tests/excel_feed_test.mjs OUTDIR
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { DATASETS, keyAllowed, sha256Hex, buildWorkbook, authStateText } from '../supabase/functions/excel-feed/feed.js';

const OUT = process.argv[2] || '/tmp/excel-feed'; mkdirSync(OUT, { recursive: true });
const passed = [], problems = [];
const ok = (c, m) => (c ? passed : problems).push(m);
const q = (sql) => JSON.parse(execFileSync('psql', ['-h', '/tmp', '-p', '5433', '-U', 'postgres', '-X', '-q', '-At', '-d', 'fleet_ui', '-c', `select coalesce(json_agg(t), '[]') from (${sql}) t`]).toString() || '[]');

// نفس استعلامات DATASETS بلغة SQL (المستخدم postgres يتجاوز RLS مثل مفتاح الخدمة)
const pr = (path) => {
  const [table, qs] = path.split('?'); const p = new URLSearchParams(qs);
  const where = []; let order = '';
  for (const [k, v] of p) {
    if (k === 'select') continue;
    if (k === 'order') { order = ' order by ' + v.split(',').map((o) => { const [c, ...m] = o.split('.'); return `${c}${m.includes('desc') ? ' desc' : ''}${m.includes('nullslast') ? ' nulls last' : ''}`; }).join(', '); continue; }
    if (v === 'is.null') where.push(`${k} is null`);
    else if (v.startsWith('in.(')) where.push(`${k} in (${v.slice(4, -1).split(',').map((x) => `'${x}'`).join(',')})`);
    else if (v.startsWith('eq.')) where.push(`${k} = '${v.slice(3)}'`);
  }
  return q(`select ${p.get('select')} from ${table}${where.length ? ' where ' + where.join(' and ') : ''}${order}`);
};

// المفتاح والبصمة
const key = 'k'.repeat(10) + 'A7f3Q9zP2mL8xV4bN6cR1tY5wE0uI3oK';
const hash = await sha256Hex(key);
ok(await keyAllowed(key, [{ key: 'excel_feed', value: { hash, enabled: true } }]), 'correct key allowed');
ok(!(await keyAllowed(key + 'x', [{ key: 'excel_feed', value: { hash, enabled: true } }])), 'wrong key refused');
ok(!(await keyAllowed('', [{ key: 'excel_feed', value: { hash, enabled: true } }])), 'empty key refused');
ok(!(await keyAllowed(key, [{ key: 'excel_feed', value: { hash, enabled: false } }])), 'disabled link refused');
ok(!(await keyAllowed(key, [])), 'no link configured -> refused');
ok(!(await keyAllowed(key.slice(0, 20), [{ key: 'excel_feed', value: { hash: await sha256Hex(key.slice(0, 20)), enabled: true } }])), 'short keys refused');

// حالة التفويض
const T = '2026-10-13';
ok(authStateText('authorized', '2026-12-30', 30, T) === 'غير منتهٍ', 'auth valid');
ok(authStateText('authorized', '2026-10-20', 30, T) === 'غير منتهٍ (اقترب الانتهاء)', 'auth expiring');
ok(authStateText('authorized', '2026-10-01', 30, T) === 'منتهٍ', 'auth expired');
ok(authStateText('authorized', null, 30, T) === 'غير محدد التاريخ', 'auth no date');
ok(authStateText('not_authorized', '2026-10-01', 30, T) === 'غير مفوضة', 'not authorized never expired');

// بيانات حقيقية من قاعدة الاختبار
const d = {}; for (const [n, path] of Object.entries(DATASETS)) d[n] = pr(path);
const blob = buildWorkbook(d);
const file = `${OUT}/fleet-data.xlsx`;
writeFileSync(file, Buffer.from(await blob.arrayBuffer()));
const check = execFileSync('python3', ['-I', '-c', `
import json, sys, openpyxl, re
wb = openpyxl.load_workbook(sys.argv[1])
out = {'sheets': wb.sheetnames, 'rows': {}, 'headers': {}, 'bad': []}
for ws in wb.worksheets:
    rows = list(ws.iter_rows(values_only=True))
    out['headers'][ws.title] = [h for h in rows[0]]
    out['rows'][ws.title] = len(rows) - 1
    for r in rows[1:]:
        for v in r:
            s = '' if v is None else str(v)
            if re.search(r'(\\+?966|\\b0)5\\d{8}\\b', s) or re.fullmatch(r'[12]\\d{9}', s): out['bad'].append(s)
    out.setdefault('rtl', {})[ws.title] = ws.sheet_view.rightToLeft
print(json.dumps(out, ensure_ascii=False, default=str))
`, file]).toString();
const r = JSON.parse(check);
ok(JSON.stringify(r.sheets) === JSON.stringify(['السيارات', 'الوثائق والتنبيهات', 'المتابعات', 'تغيير الزيت', 'الصيانة', 'طلبات الصيانة', 'الحوادث', 'المصروفات', 'معلومات']), `sheets ${r.sheets}`);
ok(r.rows['السيارات'] === d.vehicles.length && d.vehicles.length > 0, `vehicles rows ${r.rows['السيارات']}`);
ok(r.rows['تغيير الزيت'] === d.oil.length && r.rows['الصيانة'] === d.maint.length && r.rows['الحوادث'] === d.accidents.length && r.rows['المصروفات'] === d.expenses.length, 'row counts match the database');
ok(r.rows['المتابعات'] === d.followups.length, 'follow-ups count');
const allHeaders = Object.values(r.headers).flat().join(' | ');
ok(!/هوية|إقامة رقم|جوال|هاتف|فاتورة|رقم الوثيقة/.test(allHeaders), `no sensitive columns [${allHeaders.match(/هوية|جوال|هاتف|فاتورة/g) || ''}]`);
ok(r.bad.length === 0, `no ID or mobile numbers in any cell [${r.bad.slice(0, 3)}]`);
ok(Object.values(r.rtl).every(Boolean), 'all sheets right-to-left');
ok(r.headers['السيارات'].includes('حالة انتهاء التفويض') && r.headers['السيارات'].includes('انتهاء التأمين'), 'vehicle sheet has insurance and authorization');
// الجدول الحساس لا يُقرأ أصلاً
ok(!Object.values(DATASETS).some((p) => /private|attachments|profiles|user_permissions|audit/.test(p)), 'sensitive tables never queried');
ok(Object.values(DATASETS).every((p) => !/invoice_no|mobile|id_no|iqama|doc_no/.test(p)), 'sensitive columns never selected');

for (const x of passed) console.log('PASS', x);
for (const x of problems) console.log('FAIL', x);
console.log(`PASS ${passed.length} FAIL ${problems.length}`);
process.exit(problems.length ? 1 : 0);
