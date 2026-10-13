"""v1.0.1: «الموظفون» hidden from the side menu, the mobile «المزيد» sheet and the bottom bar only.
Employee pages, data and links from the vehicle file keep working. Usage: python3 -I ui_nav.py OUTDIR"""
import sys, os, subprocess
from playwright.sync_api import sync_playwright
OUT = sys.argv[1]; os.makedirs(OUT, exist_ok=True)
BASE = 'http://localhost:8787/'
problems, passed = [], []
def ok(c, m): (passed if c else problems).append(m)
def sql(q): return subprocess.run(['psql', '-h', '/tmp', '-p', '5433', '-U', 'postgres', '-X', '-q', '-At', '-d', 'fleet_ui', '-c', q], capture_output=True, text=True).stdout.strip()
n_emp = sql('select count(*) from employees')
with sync_playwright() as p:
    b = p.chromium.launch()
    for w in (1280, 390):
        c = b.new_context(viewport={'width': w, 'height': 900}, locale='ar-SA'); g = c.new_page(); g.route('**/fonts.googleapis.com/**', lambda r: r.abort())
        g.on('pageerror', lambda e: problems.append(f'page error: {e}'))
        g.goto(BASE); g.wait_for_selector('form.login-card'); g.fill('input[name=email]', 'admin@test.local'); g.fill('input[name=password]', 'test1234'); g.click('button[type=submit]'); g.wait_for_selector('.panels')
        tag = 'desktop' if w > 600 else 'mobile'
        ok(g.locator('.sidebar [data-nav=employees], .tabbar [data-nav=employees], .sheet [data-nav=employees]').count() == 0, f'{tag}: no «الموظفون» in side menu, bottom bar or «المزيد»')
        others = ['dashboard', 'sites', 'vehicles', 'documents', 'oil', 'requests', 'accidents', 'handovers', 'housing', 'food', 'attachments', 'reports', 'excel', 'users', 'audit', 'settings']
        ok(all(g.locator(f'.sidebar [data-nav={x}], .sheet [data-nav={x}]').count() >= 1 for x in others), f'{tag}: every other section still in the menu ({len(others)})')
        if w > 600:
            for x in others:
                g.click(f'.sidebar [data-nav={x}]'); g.wait_for_timeout(700)
                ok(g.locator('#page .empty.error').count() == 0 and g.locator('#page h1, #page .panels, #page .rep-head').count() >= 1, f'section «{x}» opens normally')
            g.screenshot(path=f'{OUT}/nav-desktop.png')
        else:
            g.click('[data-act=more]'); g.wait_for_selector('.sheet:not([hidden])'); g.screenshot(path=f'{OUT}/nav-mobile-more.png')
            ok('طلب صيانة' in g.inner_text('.tabbar'), 'mobile bottom bar shows «طلب صيانة» in place of «الموظفون»')
        g.goto(BASE + '#/vehicles/b0000000-0000-0000-0000-000000000001?tab=driver'); g.wait_for_selector('.vhead')
        g.click('[data-panel=driver] a[href^="#/employees/"]'); g.wait_for_selector('.vhead')
        ok('سائق تجريبي 1' in g.inner_text('.vhead'), f'{tag}: employee file still opens from the vehicle file')
        g.goto(BASE + '#/employees'); g.wait_for_selector('#et')
        ok(g.locator('#et tbody tr').count() == int(n_emp), f'{tag}: employees page and all {n_emp} records still exist (direct link)')
        c.close()
    b.close()
ok(sql('select count(*) from employees') == n_emp, 'no employee data removed')
print(f'PASS {len(passed)}')
for x in passed: print('  ok  ', x)
print(f'FAIL {len(problems)}')
for x in problems: print('  FAIL', x)
