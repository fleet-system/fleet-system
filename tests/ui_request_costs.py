"""1.40: maintenance request <-> invoices (cost_lines from the owner's Excel). Read-only link, no database change:
the Excel column «رقم الطلب» reaches cost_lines.notes as «رقم الطلب X» (cost-rows.js), and the request page lists those
invoices plus the vehicle's invoices since the request date; the costs page links the request number to the request.
Usage: python3 -I ui_request_costs.py OUTDIR   (fleet_ui reset with ui_seed.sql)"""
import sys, os, subprocess
from playwright.sync_api import sync_playwright

OUT = sys.argv[1]; os.makedirs(OUT, exist_ok=True)
BASE = 'http://localhost:8787/'
V1 = 'b0000000-0000-0000-0000-000000000001'
problems, passed = [], []
def ok(c, m): (passed if c else problems).append(m)
PSQL = ['psql', '-h', '/tmp', '-p', '5433', '-U', 'postgres', '-X', '-q', '-At', '-d', 'fleet_ui']
def sql(q):
    r = subprocess.run(PSQL + ['-c', q], capture_output=True, text=True)
    if r.returncode or 'ERROR' in r.stderr: problems.append('sql: ' + r.stderr.strip()[:200])
    return r.stdout.strip()

# fixtures: one request for V1 dated 2026-11-01, four cost lines
rid = sql("""insert into maintenance_requests (request_no, request_date, vehicle_id, plate_no, fault, status)
 values ('MR-000901', '2026-11-01', 'b0000000-0000-0000-0000-000000000001', 'أ ب ج 1234', 'عطل تجريبي للربط', 'new') returning id""").splitlines()[-1]
sql("""insert into cost_lines (category, source_sheet, source_row, vehicle_id, plate_text, line_date, description, supplier, invoice_no, amount, notes) values
 ('maintenance', 'الصيانة', 901, 'b0000000-0000-0000-0000-000000000001', 'أ ب ج 1234', '2026-11-03', 'قطع غيار مربوطة بالطلب', 'مورد أ', 'INV-A1', 300, 'رقم الطلب MR-000901'),
 ('maintenance', 'الصيانة', 902, null, 'معدة', '2026-11-04', 'شغل يد برقم مختصر', 'ورشة ب', 'INV-B2', 150, 'رقم الطلب 901'),
 ('tires', 'الكفرات', 903, 'b0000000-0000-0000-0000-000000000001', 'أ ب ج 1234', '2026-11-10', 'كفرات بعد الطلب', 'مورد ج', 'INV-C3', 800, null),
 ('maintenance', 'الصيانة', 904, 'b0000000-0000-0000-0000-000000000001', 'أ ب ج 1234', '2026-10-01', 'فاتورة قبل الطلب', 'مورد د', 'INV-D4', 99, null),
 ('maintenance', 'الصيانة', 905, 'b0000000-0000-0000-0000-000000000001', 'أ ب ج 1234', '2026-11-12', 'لطلب آخر', 'مورد هـ', 'INV-E5', 55, 'رقم الطلب MR-009999')""")

with sync_playwright() as p:
    b = p.chromium.launch()
    c = b.new_context(viewport={'width': 1280, 'height': 900}, locale='ar-SA', timezone_id='Asia/Riyadh')
    g = c.new_page(); g.on('pageerror', lambda e: problems.append(f'page error: {e}'))
    g.goto(BASE); g.wait_for_selector('form.login-card')
    g.fill('input[name=email]', 'admin@test.local'); g.fill('input[name=password]', 'test1234'); g.click('button[type=submit]'); g.wait_for_selector('.panels')
    g.goto(BASE + f'#/requests/{rid}'); g.wait_for_selector('.mr-costs')
    sec = g.inner_text('.mr-costs')
    head, _, rest = sec.partition('فواتير السيارة منذ تاريخ الطلب')
    ok('INV-A1' in head and 'INV-B2' in head, 'request invoices: full number and short number both linked')
    ok('450' in head, f'request invoices total 450 shown')
    ok('INV-C3' in rest and 'INV-C3' not in head, 'vehicle invoice after the request date listed separately')
    ok('INV-D4' not in sec, 'invoice before the request date not listed')
    ok('INV-E5' not in sec, 'invoice tagged with another request not listed')
    g.screenshot(path=f'{OUT}/request-costs.png', full_page=True)
    g.goto(BASE + '#/costs'); g.wait_for_selector('.cost-list')
    link = g.locator('.cost-list a.tag', has_text='MR-000901')
    ok(link.count() == 2, f'costs page: both rows link to the request ({link.count()})')
    ok(g.locator('.cost-list .tag', has_text='طلب MR-009999').count() == 1, 'unknown request number shown as plain text')
    link.first.click(); g.wait_for_selector('.mr-costs')
    ok(rid in g.url, 'request link opens the request page')
    b.close()

for m in passed: print('PASS', m)
for m in problems: print('FAIL', m)
print(f'PASS {len(passed)} FAIL {len(problems)}')
sys.exit(1 if problems else 0)
