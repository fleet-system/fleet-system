// Unit tests for formatting, date parsing and the XLSX writer/reader (no browser needed).
// Usage: TZ=America/New_York node tests/unit_js.mjs   (run under several TZ values)
import * as fmt from '../web/js/fmt.js';
import * as X from '../web/js/xlsx.js';
import * as PM from '../web/js/predict.js';
import * as OF from '../web/js/office.js';

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


// ---- 1.36 الصيانة التنبؤية (منطق خالص)
{
  const T = '2026-11-20';
  eq(PM.daysBetween('2026-10-31', '2026-11-20'), 20, 'pm daysBetween');
  eq(PM.addDays('2026-12-25', 10), '2027-01-04', 'pm addDays over year end');
  eq(PM.tireKind('بنشر كفر'), 'puncture', 'pm tire puncture'); eq(PM.tireKind('رقعة ألماني داخلية'), 'puncture', 'pm tire patch');
  eq(PM.tireKind('كفرات جورني 205/70/15'), 'purchase', 'pm tire purchase'); eq(PM.tireKind('كفر تركيب مع ترصيص + كفرات مستعملة'), 'purchase', 'pm used tires = purchase');
  eq(PM.tireKind('خدمة كفرات - سيارة مستعملة'), 'service', 'pm tire service'); eq(PM.tireKind('تغيير كفر'), 'service', 'pm tire swap');
  eq(Math.round(PM.usageRate([{ date: '2026-10-01', km: 1000 }, { date: '2026-10-11', km: 3000 }])), 200, 'pm usage rate 200 km/day');
  eq(PM.usageRate([{ date: '2026-10-01', km: 1000 }, { date: '2026-10-03', km: 3000 }]), null, 'pm usage rate needs 7+ days');
  const V = [{ id: 'a', plate_no: 'A 1', oil_interval_km: 10000, odometer: 105000, odometer_updated_at: '2026-11-10' }, { id: 'b', plate_no: 'B 2', oil_interval_km: 10000, odometer: 0 }, { id: 'c', plate_no: 'C 3', oil_interval_km: 10000, odometer: 0 }];
  const r = PM.analyze({ today: T, vehicles: V,
    oil: [{ vehicle_id: 'a', change_date: '2026-10-01', odometer: 98000 }, { vehicle_id: 'b', change_date: '2026-07-01', odometer: 0 }],
    readings: [],
    costs: [
      { vehicle_id: 'a', category: 'oil', line_date: '2026-10-01', notes: 'الممشى 98000 | x', amount: 100 },
      { vehicle_id: 'b', category: 'maintenance', line_date: '2026-07-10', description: 'شغل يد إصلاح مكيف تعبئة فريون', amount: 400 },
      { vehicle_id: 'b', category: 'maintenance', line_date: '2026-07-20', description: 'قطع غيار ثلاجة مكيف', amount: 300 },
      { vehicle_id: 'b', category: 'maintenance', line_date: '2026-10-15', description: 'تعبئة فريون مكيف', amount: 200 },
      { vehicle_id: 'b', category: 'maintenance', line_date: '2026-10-16', description: 'شغل يد: ديسك وصحن وفحمة كلتش', amount: 3000 },
      { vehicle_id: 'c', category: 'tires', line_date: '2026-09-01', description: 'بنشر كفر', quantity: 1, amount: 10 },
      { vehicle_id: 'c', category: 'tires', line_date: '2026-10-01', description: 'بنشر كفر', quantity: 1, amount: 10 },
      { vehicle_id: 'c', category: 'tires', line_date: '2026-11-01', description: 'بنشر كفر', quantity: 2, amount: 10 },
      { vehicle_id: 'c', category: 'tires', line_date: '2026-11-02', description: 'كفرات جديدة 4', quantity: 4, amount: 800 },
    ] });
  const a = r.rows.find((x) => x.v.id === 'a'), b = r.rows.find((x) => x.v.id === 'b'), c = r.rows.find((x) => x.v.id === 'c');
  eq(Math.round(a.rate), 175, 'pm rate from oil km + odometer (7000 km / 40 days)');
  eq([a.oil.dueKm, a.oil.basis, a.oil.leftKm], [108000, 'km', 108000 - (105000 + 175 * 10)], 'pm oil due by km');
  eq(a.oil.level, 'warn', 'pm oil due within 14 days -> warn');
  eq(b.oil.level, 'bad', 'pm oil no km, 142 days old -> overdue');
  eq(b.faults.map((f) => [f.key, f.times]), [['ac', 2]], 'pm AC recurring twice (Jul parts+labor = 1, Oct = 1); clutch once = not recurring');
  eq(b.faults.some((f) => f.key === 'brakes'), false, 'pm clutch disc is not brakes');
  eq(b.cost.flag, 'rising', 'pm rising cost (3200 vs 700)');
  eq(c.tires.punctures, 3, 'pm punctures in 90 days');
  eq(c.alerts.some((x) => x.kind === 'puncture'), true, 'pm puncture alert');
  eq([c.tires.lastDate, c.tires.basis, c.tires.dueDate], ['2026-11-02', 'age', '2028-11-01'], 'pm tire due by age');
  eq(r.rows[0].level, 'bad', 'pm sorted: urgent first');
}
{ // 1.37: مكتب الأسطول
  eq(OF.routeAgent('السيارة 1624 تحتاج غيار زيت'), 'oil', 'office route: oil');
  eq(OF.routeAgent('جهز طلب صيانة المكيف خربان'), 'maintenance', 'office route: maintenance');
  eq(OF.routeAgent('الاستمارة تنتهي جدد التأمين'), 'docs', 'office route: docs');
  eq(OF.routeAgent('فاتورة غير مدفوعة للمورد'), 'custody', 'office route: custody');
  eq(OF.routeAgent('أضف الصف في ملف الإكسل'), 'excel', 'office route: excel');
  eq(OF.routeAgent('مرحبا كيف الحال'), 'manager', 'office route: unknown stays with the manager');
  eq([OF.levelOf(0).lv, OF.levelOf(49).lv, OF.levelOf(50).lv, OF.levelOf(3000).lv, OF.levelOf(9999).pct], [1, 1, 2, 10, 100], 'office levels');
  const o = OF.buildOffice({ now: '2026-11-20T08:00:00Z',
    requests: [{ id: 'r1', request_no: 'MR-1', status: 'approved', fault: 'مكيف' }, { id: 'r2', status: 'completed' }],
    docs: [{ owner_type: 'vehicle', owner_id: 'v1', doc_type: 'registration', status: 'expired', subject_label: 'A' }, { status: 'valid' }],
    costs: [{ category: 'maintenance', payment_status: 'غير مدفوع', amount: 100, synced_at: '2026-11-10T00:00:00Z' }, { category: 'oil', payment_status: 'مدفوع', synced_at: '2026-11-09T00:00:00Z' }],
    alerts: [{ kind: 'oil', level: 'bad', text: 'زيت', plate: 'P1', vid: 'v1' }],
    tasks: [{ id: 't1', agent: 'docs', status: 'needs_you', title: 'جدد', is_active: true }, { id: 't2', agent: 'docs', status: 'done', done_at: '2026-11-20T07:00:00Z', title: 'x' }] });
  const g = (id) => o.agents.find((a) => a.id === id);
  eq([g('maintenance').items.length, g('maintenance').state], [1, 'working'], 'office maintenance: 1 open request');
  eq([g('docs').state, g('docs').delivered, g('docs').level.xp], ['waiting', true, 5 + 20], 'office docs waiting + delivered + xp');
  eq([g('custody').items.length, g('excel').items[0].kind, o.syncAge], [1, 'sync', 10], 'office custody unpaid + stale sync');
  eq([g('oil').items.length, g('food').state], [1, 'idle'], 'office oil alert, food idle');
  const br = OF.buildBrief(o, [{ id: 't1', agent: 'docs', status: 'needs_you', title: 'جدد' }]);
  eq([br.counts.needs_you, br.broke.length >= 2], [1, true], 'office brief: needs you + broke');
}
console.log(`unit_js TZ=${process.env.TZ || 'default'}: PASS ${pass}, FAIL ${fails.length}`);
for (const f of fails) console.log('  FAIL', f);
process.exit(fails.length ? 1 : 0);
