"""v1.34: «تكاليف الصيانة» (الصيانة + الزيت + الكفرات + البطاريات من Excel، جدول cost_lines).
بيانات وهمية فقط. يتحقق من: المزامنة (جديد/معدّل/مؤرشف بلا حذف/استرجاع)، الربط بالسيارة بالمعرّف، الصفحة (الإجماليات والفلاتر
تطابق قاعدة البيانات)، بطاقة السيارة (تبويب سجل التكاليف)، الصلاحيات (لا كتابة مباشرة)، وأداة قراءة ملف Excel.
Usage: python3 -I ui_costs.py OUTDIR   (fresh fleet_ui + mock server)"""
import sys, os, json, subprocess
from playwright.sync_api import sync_playwright
OUT = sys.argv[1]; os.makedirs(OUT, exist_ok=True)
BASE = 'http://localhost:8787/'
HERE = os.path.dirname(os.path.abspath(__file__))
problems, passed = [], []
def ok(c, m): (passed if c else problems).append(m)
def sql(q): return subprocess.run(['psql', '-h', '/tmp', '-p', '5433', '-U', 'postgres', '-X', '-q', '-At', '-d', 'fleet_ui', '-c', q], capture_output=True, text=True).stdout.strip()

# 1) أداة قراءة Excel على ملف وهمي
import openpyxl, datetime
wb = openpyxl.Workbook(); wb.remove(wb.active)
def sheet(name, hdr, rows):
    ws = wb.create_sheet(name); ws.append(hdr)
    for r in rows: ws.append(r)
H12 = ['رقم اللوحة', 'الحروف', 'الشركة', 'الموقع', 'الماركة', 'المستخدم', 'التاريخ', 'x8', 'x9', 'x10', 'x11', 'x12']
d = datetime.datetime
sheet('الصيانة', H12, [[1234, 'أ ب ج', 'شركة', 'موقع أ', 'تويوتا', 'م1', d(2026, 9, 3), 'INV-1', None, 'تغيير فحمات', 300],
                       [5678, 'د هـ و', 'شركة', 'موقع ب', 'ايسوزو', 'م2', d(2026, 10, 5), 'INV-2', 'R-9', 'قطع غيار', 450.5],
                       [None, None, None, None, None, None, None, None, None, None, None]])
sheet('غيار_الزيت', H12, [[1234, 'أ ب ج', 'شركة', 'موقع أ', 'تويوتا', 'م1', d(2026, 10, 1), 1000, 'زيت 5W30', 'OIL-1', 120, 'ملاحظة']])
sheet('الكفرات', H12, [[2468, 'ر س ص', 'شركة', 'موقع أ', 'هايلكس', 'م3', d(2026, 11, 2), 'كفر 265/70', 2, 'مورد كفرات', 'T-1', 800]])
sheet('البطاريات', H12, [[9999, 'X', 'شركة', 'موقع ب', '—', 'م4', d(2026, 11, 3), 'بطارية 70', 1, 'مورد بطاريات', 'B-1', 330]])
xl = os.path.join(OUT, 'fake.xlsx'); wb.save(xl)
res = json.loads(subprocess.run([sys.executable, '-I', os.path.join(HERE, '..', 'tools', 'excel_costs.py'), xl], capture_output=True, text=True).stdout)
rows, sheets = res['rows'], res['sheets']
ok(len(rows) == 5 and sorted(sheets) == sorted(['الصيانة', 'غيار_الزيت', 'الكفرات', 'البطاريات']), f'excel tool: 5 rows from 4 sheets ({len(rows)})')
ok(round(sum(r['amount'] for r in rows), 2) == 2000.5, 'excel tool: total 2000.50')
ok(all(r['date'] and len(r['date']) == 10 for r in rows), 'excel tool: every date is YYYY-MM-DD')
oil = next(r for r in rows if r['category'] == 'oil')
ok('الممشى 1000' in (oil['notes'] or '') and oil['description'] == 'زيت 5W30' and oil['invoice_no'] == 'OIL-1', 'excel tool: oil columns mapped (description, invoice, odometer note)')
tire = next(r for r in rows if r['category'] == 'tires')
ok(tire['quantity'] == 2 and tire['supplier'] == 'مورد كفرات', 'excel tool: tires quantity + supplier')

# 2) المزامنة في قاعدة البيانات (بصلاحية الخادم)
def sync(rr, sh): return json.loads(sql("select sync_cost_lines('" + json.dumps(rr, ensure_ascii=False).replace("'", "''") + "'::jsonb, array[" + ','.join(f"'{s}'" for s in sh) + "]::text[])"))
r1 = sync(rows, sheets)
ok(r1['new'] == 5 and r1['archived'] == 0, f'sync #1: 5 new ({r1})')
v1 = sql("select id from vehicles where plate_no = 'أ ب ج 1234'")
ok(sql(f"select count(*) from cost_lines where vehicle_id = '{v1}'") == '2', 'linked to the vehicle by internal id (2 rows for VEH-0001)')
ok(sql("select count(*) from cost_lines where vehicle_id is null") == '1', 'unknown plate (9999) kept with plate text, no vehicle')
r2 = sync(rows, sheets)
ok(r2['new'] == 0 and r2['updated'] == 0 and r2['unchanged'] == 5, f'sync #2 same file: nothing changes ({r2})')
rows2 = [dict(r) for r in rows]; rows2[0]['amount'] = 350.0
gone = rows2.pop(1)  # صف حُذف من Excel
r3 = sync(rows2, sheets)
ok(r3['updated'] == 1 and r3['archived'] == 1, f'sync #3: edited row updated, removed row archived ({r3})')
ok(sql("select count(*) from cost_lines") == '5', 'nothing deleted (5 rows kept)')
ok(sql(f"select is_active from cost_lines where source_sheet = 'الصيانة' and source_row = {gone['source_row']}") == 'f', 'removed Excel row is archived (is_active = false)')
r4 = sync(rows2 + [gone], sheets)
ok(r4['restored'] == 1, f'sync #4: row back in Excel is restored ({r4})')
sync(rows2, sheets)  # الحالة النهائية: 4 نشطة، صف مؤرشف
n_act = int(sql("select count(*) from cost_lines where is_active")); tot = float(sql("select sum(amount) from cost_lines where is_active"))
ok(n_act == 4 and abs(tot - 1600.0) < .01, f'final: 4 active rows = 1600.00 ({n_act}, {tot})')
ok('cost_lines' in sql("select array_to_string(backup_table_list(), ',')"), 'cost_lines is in backups')

with sync_playwright() as p:
    b = p.chromium.launch()
    for w in (1360, 390):
        c = b.new_context(viewport={'width': w, 'height': 900}, locale='ar-SA', timezone_id='Asia/Riyadh')
        g = c.new_page(); g.route('**/fonts.googleapis.com/**', lambda r: r.abort())
        g.on('pageerror', lambda e: problems.append(f'page error: {e}'))
        g.goto(BASE); g.wait_for_selector('form.login-card'); g.fill('input[name=email]', 'admin@test.local'); g.fill('input[name=password]', 'test1234'); g.click('button[type=submit]'); g.wait_for_selector('.panels')
        if w > 1000: ok(g.locator('.sidebar [data-nav=costs]').count() == 1, 'menu: «تكاليف الصيانة» in the side menu')
        else:
            g.click('[data-act=more]'); ok(g.locator('.sheet [data-nav=costs]').count() == 1, 'mobile: «تكاليف الصيانة» in «المزيد»'); g.keyboard.press('Escape')
        g.goto(f'{BASE}#/costs'); g.wait_for_selector('[data-cost-kpis]')
        ok(g.inner_text('[data-cost-total]').replace(',', '') == '1600.00', f'[{w}] page total = database (1600.00)')
        ok(g.locator('[data-cost-row]').count() == 4, f'[{w}] 4 invoices listed (archived row hidden)')
        for cat, v in [('maintenance', '350.00'), ('oil', '120.00'), ('tires', '800.00'), ('batteries', '330.00')]:
            ok(g.inner_text(f'[data-cost-cat={cat}]').replace(',', '') == v, f'[{w}] {cat} total {v}')
        g.click('[data-cost-kpis] [data-cat=tires]'); g.wait_for_timeout(200)
        ok(g.locator('[data-cost-row]').count() == 1 and g.inner_text('[data-cost-total]').replace(',', '') == '800.00', f'[{w}] filter by type (tires)')
        g.click('[data-cost-kpis] [data-cat=tires]'); g.wait_for_timeout(200)
        g.select_option('select[name=vehicle]', v1); g.wait_for_timeout(200)
        ok(g.locator('[data-cost-row]').count() == 2 and g.inner_text('[data-cost-total]').replace(',', '') == '470.00', f'[{w}] filter by vehicle (VEH-0001: 470.00)')
        ok('2026/09/03' in g.inner_text('.cost-list'), f'[{w}] dates shown as YYYY/MM/DD')
        ok(g.evaluate('document.documentElement.scrollWidth') <= w, f'[{w}] no horizontal overflow')
        g.screenshot(path=f'{OUT}/costs-{w}.png', full_page=True)
        # من القائمة إلى بطاقة السيارة (تبويب التكاليف)
        g.locator('.cost-list a.plate').first.click(); g.wait_for_selector('[data-xcost]')
        ok('470.00' in g.inner_text('[data-xcost]') and 'تغيير فحمات' in g.inner_text('.view'), f'[{w}] vehicle card shows its Excel costs (470.00)')
        g.goto(f'{BASE}#/costs?vehicle='); g.wait_for_selector('[data-cost-kpis]')
        g.select_option('select[name=vehicle]', ''); c.close()
    # التحديث من ملف Excel داخل الصفحة (نفس الملف الوهمي + صف كفرات جديد)
    import openpyxl as _ox
    wb2 = _ox.load_workbook(xl); wb2['الكفرات'].append([1357, 'ط ع ق', 'شركة', 'موقع ب', 'نيسان', 'م5', datetime.datetime(2026, 11, 10), 'كفر 205', 4, 'مورد', 'T-2', 900])
    xl2 = os.path.join(OUT, 'fake2.xlsx'); wb2.save(xl2)
    c = b.new_context(viewport={'width': 1360, 'height': 900}); g = c.new_page(); g.goto(BASE); g.wait_for_selector('form.login-card')
    g.fill('input[name=email]', 'admin@test.local'); g.fill('input[name=password]', 'test1234'); g.click('button[type=submit]'); g.wait_for_selector('.panels')
    g.goto(f'{BASE}#/costs'); g.wait_for_selector('[data-cost-file]', state='attached')
    g.set_input_files('[data-cost-file]', xl2); g.wait_for_timeout(2500)
    ok('جديد 1' in g.inner_text('body') or sql("select count(*) from cost_lines where source_sheet = 'الكفرات'") == '2', 'upload in page: new tires row added')
    ok(sql("select count(*) from cost_lines where is_active") == '6' and sql("select is_active from cost_lines where source_sheet = 'الصيانة' and source_row = 3") == 't',
       'upload in page: full file -> 6 active (row back in Excel restored), nothing deleted')
    ok(sql("select line_date from cost_lines where invoice_no = 'T-2'") == '2026-11-10', 'upload in page: date read correctly (2026-11-10)')
    g.wait_for_selector('[data-cost-total]'); ok(g.inner_text('[data-cost-total]').replace(',', '') == '2900.50', f"page total after upload = 2900.50 ({g.inner_text('[data-cost-total]')})")
    c.close()
    # الكتابة المباشرة من المتصفح ممنوعة
    c = b.new_context(); g = c.new_page(); g.goto(BASE); g.wait_for_selector('form.login-card')
    g.fill('input[name=email]', 'admin@test.local'); g.fill('input[name=password]', 'test1234'); g.click('button[type=submit]'); g.wait_for_selector('.panels')
    st = g.evaluate("""async () => { const m = await import('./js/api.js'); try { await m.insert('cost_lines', [{ category: 'oil', source_sheet: 'x', source_row: 1, amount: 1 }]); return 'inserted'; } catch (e) { return 'blocked'; } }""")
    ok(st == 'blocked', 'browser cannot insert into cost_lines directly')
    c.close(); b.close()
ok(sql("select count(*) from cost_lines") == '6', 'rows after UI tests: 6 (nothing deleted)')

for m in passed: print('ok  ', m)
for m in problems: print('FAIL', m)
print(f'PASS {len(passed)} FAIL {len(problems)}')
