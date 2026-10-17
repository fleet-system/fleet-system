// Unit tests for supabase/functions/push/logic.js (messages, dedupe day, key checks). Usage: node push_logic_test.mjs
import { dailyMessage, requestMessage, testMessage, riyadhDay, sameKey, isGone, isUuid } from '../supabase/functions/push/logic.js';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('ok  ', m); } else { fail++; console.log('FAIL', m); } };

ok(dailyMessage([]) === null && dailyMessage([{ doc_type: 'registration', status: 'valid', days_left: 300 }]) === null, 'nothing expired or expiring: no daily message');
const rows = [
  { doc_type: 'registration', status: 'expired', days_left: -400, subject_label: 'ب ح د 1624' },
  { doc_type: 'registration', status: 'expired', days_left: -10, subject_label: 'x' },
  { doc_type: 'periodic_inspection', status: 'expired', days_left: -5, subject_label: 'y' },
  { doc_type: 'insurance', status: 'expiring', days_left: 25, subject_label: 'ح ك و 2377' },
  { doc_type: 'periodic_inspection', status: 'expiring', days_left: 13, subject_label: 'ح ك و UKJ 2377' },
  { doc_type: 'delegate_license', status: 'expired', days_left: -3, subject_label: 'z' },
];
const m = dailyMessage(rows);
ok(m && m.title === 'تنبيهات وثائق السيارات' && m.url === '#/dashboard', 'daily message title and link');
ok(m.body.includes('منتهية: 3') && m.body.includes('استمارة 2') && m.body.includes('فحص 1'), `expired counted by type, delegate licences left out [${m.body}]`);
ok(m.body.includes('تنتهي قريباً: 2') && m.body.includes('فحص ح ك و UKJ 2377 بعد 13 يوم'), 'nearest expiring document named');
ok(!dailyMessage(rows.filter((r) => r.status === 'expiring')).body.includes('منتهية'), 'only expiring: no expired line');

ok(requestMessage({ id: 'a', status: 'new' }) === null && requestMessage(null) === null, 'request not pending: no message');
const r = requestMessage({ id: 'abc', status: 'pending_supervisor', request_no: 'MR-000004', plate_no: 'ب ح د 1624', fault: 'صوت في المحرك '.repeat(10) });
ok(r.title === 'طلب صيانة بانتظار اعتمادك' && r.url === '#/requests/abc' && r.body.startsWith('MR-000004 • ب ح د 1624 • ') && r.body.length < 130, `request message [${r.body}]`);
ok(testMessage().title.includes('تفعيل'), 'test message');

ok(riyadhDay(new Date('2026-10-17T21:30:00Z')) === '2026-10-18' && riyadhDay(new Date('2026-10-17T20:59:00Z')) === '2026-10-17', 'day key uses Riyadh time');
ok(sameKey('abc123', 'abc123') && !sameKey('abc123', 'abc124') && !sameKey('', '') && !sameKey('a', 'ab'), 'cron key comparison');
ok(isGone(404) && isGone(410) && !isGone(500) && !isGone(429), 'only 404/410 archive a device');
ok(isUuid('b0000000-0000-0000-0000-000000000001') && !isUuid("x' or 1=1") && !isUuid(''), 'request id must be a uuid');

console.log(`PASS ${pass} FAIL ${fail}`);
process.exit(fail ? 1 : 0);
