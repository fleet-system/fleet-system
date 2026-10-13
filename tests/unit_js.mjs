// Unit tests for formatting, date parsing and the XLSX writer/reader (no browser needed).
// Usage: TZ=America/New_York node tests/unit_js.mjs   (run under several TZ values)
import * as fmt from '../web/js/fmt.js';
import * as X from '../web/js/xlsx.js';

let pass = 0; const fails = [];
const eq = (got, exp, msg) => { if (JSON.stringify(got) === JSON.stringify(exp)) pass++; else fails.push(`${msg}: got ${JSON.stringify(got)} expected ${JSON.stringify(exp)}`); };
const throws = (fn, frag, msg) => { try { fn(); fails.push(`${msg}: no error`); } catch (e) { if (!frag || e.message.includes(frag)) pass++; else fails.push(`${msg}: wrong message ${e.message}`); } };

// ---- parseDate
eq(fmt.parseDate('2026/10/12'), '2026-10-12', 'plain');
eq(fmt.parseDate('٢٠٢٦/١٠/١٢'), '2026-10-12', 'Arabic-Indic digits');
eq(fmt.parseDate('۲۰۲۶/۱۰/۱۲'), '2026-10-12', 'Persian digits');
eq(fmt.parseDate('2026-1-5'), '2026-01-05', 'dash + single digits');
eq(fmt.parseDate(' 2026.03.07 '), '2026-03-07', 'dots + spaces');
eq(fmt.parseDate('2028/02/29'), '2028-02-29', 'leap day 2028');
eq(fmt.parseDate('2000/02/29'), '2000-02-29', 'leap day 2000 (div by 400)');
eq(fmt.parseDate(''), null, 'empty -> null');
eq(fmt.parseDate(null), null, 'null -> null');
throws(() => fmt.parseDate('2026/02/31'), 'غير موجود', '31 Feb');
throws(() => fmt.parseDate('2027/02/29'), 'غير موجود', 'non-leap 29 Feb');
throws(() => fmt.parseDate('2100/02/29'), 'غير موجود', '2100 not leap');
throws(() => fmt.parseDate('2026/13/01'), 'غير موجود', 'month 13');
throws(() => fmt.parseDate('2026/04/31'), 'غير موجود', '31 April');
throws(() => fmt.parseDate('2026/00/10'), 'غير موجود', 'month 0');
throws(() => fmt.parseDate('12/10/2026'), 'YYYY/MM/DD', 'DD/MM/YYYY rejected');
throws(() => fmt.parseDate('abc'), 'YYYY/MM/DD', 'garbage');
throws(() => fmt.parseDate('0026/01/01'), 'غير موجود', 'year < 1900');

// ---- date / dateTime (always Riyadh, whatever the device timezone)
eq(fmt.date('2026-10-12'), '2026/10/12', 'date');
eq(fmt.date('2026-10-12T23:59:00+03:00'), '2026/10/12', 'date from timestamp text keeps the day');
eq(fmt.date(null), '—', 'date null');
const strip = (s) => s.replace(/[⁦⁩]/g, '');
eq(strip(fmt.dateTime('2026-10-11T21:30:00Z')), '2026/10/12 00:30', 'UTC 21:30 = Riyadh next day 00:30');
eq(strip(fmt.dateTime('2026-10-12T00:00:00+03:00')), '2026/10/12 00:00', 'midnight shows 00 not 24');
eq(strip(fmt.dateTime('2026-12-31T23:59:00+03:00')), '2026/12/31 23:59', 'year end');
eq(fmt.dateTime('garbage'), '—', 'invalid timestamp');
const riyadhToday = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
eq(fmt.todayISO(), riyadhToday, `todayISO is Riyadh date (device TZ=${process.env.TZ || 'default'})`);

// ---- numbers & money
eq(fmt.money(1234.5), '1,234.50 ر.س', 'money');
eq(fmt.money(0), '0.00 ر.س', 'money zero');
eq(fmt.money(null), '—', 'money null');
eq(fmt.money('11305'), '11,305.00 ر.س', 'money from numeric string (PostgREST numeric)');
eq(fmt.money(0.1 + 0.2), '0.30 ر.س', 'float noise hidden');
eq(fmt.num(1500000), '1,500,000', 'num thousands');
eq(fmt.km(91300), '91,300 كم', 'km');
eq(fmt.toWestern('٠١٢٣٤٥٦٧٨٩'), '0123456789', 'toWestern');

// ---- XLSX serials
eq(X.dateToSerial('1900-03-01'), 61, 'serial 1900-03-01 = 61 (Excel)');
eq(X.dateToSerial('2026-10-12'), 46307, 'serial 2026-10-12');
eq(X.serialToDate(46307), '2026-10-12', 'serial back');
eq(X.serialToDate(46307.99), '2026-10-12', 'serial with time keeps day');
for (const d of ['2000-02-29', '2024-12-31', '2028-02-29', '2050-06-15']) eq(X.serialToDate(X.dateToSerial(d)), d, `round trip ${d}`);

// ---- XLSX write -> read round trip (Arabic, escaping, numbers, dates, many rows)
const rows = Array.from({ length: 1500 }, (_, i) => ({ code: `VEH-${String(i + 1).padStart(4, '0')}`, name: i === 0 ? 'نص <b>&"خاص"</b>' : `سيارة ${i}`, odo: i * 1000, cost: i * 1.5, d: '2026-10-12' }));
const blob = X.writeXlsx([{ name: 'السيارات', columns: [
  { header: 'الرقم', type: 'text', value: (r) => r.code }, { header: 'الاسم', type: 'text', value: (r) => r.name },
  { header: 'العداد', type: 'int', value: (r) => r.odo }, { header: 'التكلفة', type: 'money', value: (r) => r.cost }, { header: 'التاريخ', type: 'date', value: (r) => r.d }], rows }]);
// reader needs DOMParser (browser) -> it is covered by ui_phase7; here the file is checked with openpyxl
const { writeFileSync, mkdtempSync } = await import('node:fs'); const { execFileSync } = await import('node:child_process');
const tmp = mkdtempSync('/tmp/unitjs-') + '/t.xlsx'; writeFileSync(tmp, Buffer.from(await blob.arrayBuffer()));
const py = `import openpyxl,json,sys; ws=openpyxl.load_workbook(sys.argv[1]).active; print(json.dumps([ws.title, ws.max_row, ws.cell(2,2).value, ws.cell(1501,1).value, ws.cell(4,4).value, str(ws.cell(2,5).value), ws.sheet_view.rightToLeft]))`;
const o = JSON.parse(execFileSync('python3', ['-I', '-c', py, tmp]).toString());
eq(o, ['السيارات', 1501, 'نص <b>&"خاص"</b>', 'VEH-1500', 3, '2026-10-12 00:00:00', true], 'xlsx 1500 rows readable by openpyxl (escaping, money, date, RTL)');

console.log(`unit_js TZ=${process.env.TZ || 'default'}: PASS ${pass}, FAIL ${fails.length}`);
for (const f of fails) console.log('  FAIL', f);
process.exit(fails.length ? 1 : 0);
