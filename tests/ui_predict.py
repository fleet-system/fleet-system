"""v1.36: «الصيانة التنبؤية» (توقع الزيت والكفرات، الأعطال المتكررة، المصاريف الزايدة) — قراءة فقط.
بيانات وهمية فقط. يتحقق من: الصفحة في القائمة، التنبيهات تطابق البيانات، الربط ببطاقة السيارة بالمعرّف،
عدد التنبيهات في لوحة التحكم، عدم الكتابة في قاعدة البيانات، والجوال بدون تمدد أفقي.
Usage: python3 -I ui_predict.py OUTDIR   (fresh fleet_ui + mock server)"""
import sys, os, subprocess
from playwright.sync_api import sync_playwright
OUT = sys.argv[1]; os.makedirs(OUT, exist_ok=True)
BASE = 'http://localhost:8787/'
problems, passed = [], []
def ok(c, m): (passed if c else problems).append(m)
def sql(q): return subprocess.run(['psql', '-h', '/tmp', '-p', '5433', '-U', 'postgres', '-X', '-q', '-At', '-d', 'fleet_ui', '-c', q], capture_output=True, text=True).stdout.strip()

V = {i: f'b0000000-0000-0000-0000-00000000000{i}' for i in range(1, 6)}
rows = [  # (vehicle, category, days ago, description, amount, qty)
    (4, 'maintenance', 100, 'شغل يد: إصلاح مكيف تعبئة فريون', 400, None),
    (4, 'maintenance', 20, 'قطع غيار ثلاجة مكيف', 900, None),
    (4, 'maintenance', 18, 'شغل يد: تركيب ثلاجة مكيف', 700, None),
    (5, 'tires', 60, 'بنشر كفر', 20, 1), (5, 'tires', 30, 'بنشر كفر', 10, 1), (5, 'tires', 5, 'بنشر كفر', 10, 2),
    (5, 'tires', 4, 'كفرات جديدة 265/70', 1600, 4),
    (1, 'maintenance', 150, 'قطع غيار', 300, None), (1, 'maintenance', 30, 'شغل يد: علبة دركسون', 2500, None),
    (1, 'batteries', 10, 'بطارية 70 أمبير', 330, 1),
]
vals = ','.join(f"('{c}','{c}-sheet',{i+1},'{V[v]}','P{v}', app_today() - {d}, '{desc}', {q if q else 'null'}, {a}, true)" for i, (v, c, d, desc, a, q) in enumerate(rows))
sql(f"insert into cost_lines(category, source_sheet, source_row, vehicle_id, plate_text, line_date, description, quantity, amount, is_active) values {vals}")
ok(sql("select count(*) from cost_lines") == str(len(rows)), f'fake cost rows inserted ({sql("select count(*) from cost_lines")})')
before = sql("select md5(string_agg(t::text, '|' order by t::text)) from (select * from cost_lines) t") + sql("select md5(string_agg(t::text, '|' order by t::text)) from (select id, odometer, updated_at from vehicles) t") + sql("select count(*) from audit_log")

with sync_playwright() as p:
    b = p.chromium.launch()
    for w in (1360, 390):
        c = b.new_context(viewport={'width': w, 'height': 900}, locale='ar-SA', timezone_id='Asia/Riyadh')
        g = c.new_page(); g.route('**/fonts.googleapis.com/**', lambda r: r.abort())
        g.on('pageerror', lambda e: problems.append(f'page error: {e}'))
        g.goto(BASE); g.wait_for_selector('form.login-card'); g.fill('input[name=email]', 'admin@test.local'); g.fill('input[name=password]', 'test1234'); g.click('button[type=submit]'); g.wait_for_selector('.panels')
        if w > 1000: ok(g.locator('.sidebar [data-nav=predict]').count() == 1, 'menu: «الصيانة التنبؤية» in the side menu')
        else:
            g.click('[data-act=more]'); ok(g.locator('.sheet [data-nav=predict]').count() == 1, 'mobile: «الصيانة التنبؤية» in «المزيد»'); g.keyboard.press('Escape')
        # لوحة التحكم: عدد السيارات التي عليها تنبيه
        g.wait_for_function("() => { const b = document.querySelector('[data-pm-dash] b'); return b && b.textContent !== '…'; }", timeout=15000)
        n_dash = g.inner_text('[data-pm-dash] b')
        g.goto(f'{BASE}#/predict'); g.wait_for_selector('[data-pm-kpis]')
        txt = g.inner_text('.view')
        oil2 = g.locator(f'[data-pm-oil-row="{V[2]}"]')
        ok(oil2.count() == 1 and 'متأخر' in oil2.inner_text() and 'pm-row-bad' in (oil2.get_attribute('class') or ''), f'[{w}] VEH-0002 oil overdue (61,400 km vs due 61,000)')
        ok('61,000' in oil2.inner_text(), f'[{w}] VEH-0002 next oil at 61,000 km')
        f4 = g.locator(f'[data-pm-fault-row="{V[4]}"]')
        ok(f4.count() == 1 and 'المكيف' in f4.inner_text() and '2' in f4.inner_text(), f'[{w}] VEH-0004 AC recurring 2 times (parts + install 2 days apart = one)')
        t5 = g.locator(f'[data-pm-tire-row="{V[5]}"]')
        ok(t5.count() == 1 and '4 كفرات' in t5.inner_text(), f'[{w}] VEH-0005 last tire purchase: 4 tires')
        ok(g.locator(f'[data-pm-alerts] li[data-pm-alert=puncture]').count() == 1, f'[{w}] puncture alert (3 times in 90 days)')
        c1 = g.locator(f'[data-pm-cost-row="{V[1]}"]')
        ok(c1.count() == 1 and 'زادت' in c1.inner_text(), f'[{w}] VEH-0001 rising cost (2,830 vs 300)')
        ok('بطارية' in txt or 'آخر تغيير' in g.inner_text('[data-pm-tires]'), f'[{w}] battery shown')
        cars = len({x for x in g.eval_on_selector_all('[data-pm-alerts] li a.plate', 'els => els.map(e => e.getAttribute("href"))')})
        ok(n_dash == str(cars), f'[{w}] dashboard count = vehicles with alerts ({n_dash} / {cars})')
        ok(g.evaluate('document.documentElement.scrollWidth') <= w, f'[{w}] no horizontal overflow')
        ok(all(len(x) == 10 for x in g.eval_on_selector_all('[data-pm-oil] td .num', 'els => els.map(e => e.textContent).filter(t => /\\d{4}\\/\\d/.test(t))')), f'[{w}] dates YYYY/MM/DD')
        g.screenshot(path=f'{OUT}/predict-{w}.png', full_page=True)
        g.locator(f'[data-pm-oil-row="{V[2]}"] a.plate').click(); g.wait_for_timeout(1500)
        ok(V[2] in g.url, f'[{w}] plate opens the vehicle card by internal id')
        c.close()
    # مستخدم للعرض فقط يرى الصفحة
    c = b.new_context(); g = c.new_page(); g.goto(BASE); g.wait_for_selector('form.login-card')
    g.fill('input[name=email]', 'viewer@test.local'); g.fill('input[name=password]', 'test1234'); g.click('button[type=submit]'); g.wait_for_selector('.panels')
    g.goto(f'{BASE}#/predict'); g.wait_for_selector('[data-pm-kpis]', timeout=15000)
    ok(g.locator('[data-pm-oil-row]').count() >= 3, 'viewer sees predictions')
    c.close(); b.close()
after = sql("select md5(string_agg(t::text, '|' order by t::text)) from (select * from cost_lines) t") + sql("select md5(string_agg(t::text, '|' order by t::text)) from (select id, odometer, updated_at from vehicles) t") + sql("select count(*) from audit_log")
ok(before == after, 'read only: nothing written to the database')

for m in passed: print('ok  ', m)
for m in problems: print('FAIL', m)
print(f'PASS {len(passed)} FAIL {len(problems)}')
