"""v1.1: «رقم جوال مستخدم السيارة»: optional, Saudi format (+966 accepted), live validation, saved, shown with
call + WhatsApp buttons, editable. Usage: python3 -I ui_mobile_field.py OUTDIR"""
import sys, os, subprocess
from playwright.sync_api import sync_playwright
OUT = sys.argv[1]; os.makedirs(OUT, exist_ok=True)
BASE = 'http://localhost:8787/'
problems, passed = [], []
def ok(c, m): (passed if c else problems).append(m)
def sql(q): return subprocess.run(['psql', '-h', '/tmp', '-p', '5433', '-U', 'postgres', '-X', '-q', '-At', '-d', 'fleet_ui', '-c', q], capture_output=True, text=True).stdout.strip()
def fill(g, vals):
    for n, v in vals.items(): g.locator(f'.modal [name="{n}"]').last.fill(v)
with sync_playwright() as p:
    b = p.chromium.launch()
    for w in (1280, 390):
        tag = 'desktop' if w > 600 else 'mobile'
        c = b.new_context(viewport={'width': w, 'height': 900}, locale='ar-SA', device_scale_factor=2); g = c.new_page(); g.route('**/fonts.googleapis.com/**', lambda r: r.abort())
        g.on('pageerror', lambda e: problems.append(f'page error: {e}'))
        g.goto(BASE); g.wait_for_selector('form.login-card'); g.fill('input[name=email]', 'admin@test.local'); g.fill('input[name=password]', 'test1234'); g.click('button[type=submit]'); g.wait_for_selector('.panels')
        plate = 'م م م 1001' if w > 600 else 'م م م 1002'; pl, pd = plate.rsplit(' ', 1)
        g.goto(BASE + '#/vehicles'); g.wait_for_selector('#vt'); g.click('[data-act=new]'); g.wait_for_selector('.modal [name=current_user_mobile]'); g.wait_for_timeout(200)
        inp = g.locator('.modal [name=current_user_mobile]')
        ok(inp.get_attribute('type') == 'tel' and inp.get_attribute('dir') == 'ltr', f'{tag}: phone input (tel keyboard, left-to-right)')
        fill(g, {'plate_letters': pl, 'plate_digits': pd, 'owner_company': 'شركة روى الرمال الزراعية', 'current_user_name': 'محمد المستخدم', 'current_user_mobile': '05012'}); g.wait_for_timeout(100)
        ok('غير صحيح' in g.inner_text('.modal [data-check=current_user_mobile]'), f'{tag}: invalid number flagged while typing')
        g.click('.modal [data-save]'); g.wait_for_timeout(300)
        ok('جوال' in g.inner_text('.modal .form-error'), f'{tag}: invalid number blocks saving with a clear message')
        fill(g, {'current_user_mobile': '٠٥٠١٢٣٤٥٦٧' if w > 600 else '+966 55 987 6543'}); g.wait_for_timeout(100)
        chk = g.inner_text('.modal [data-check=current_user_mobile]')
        ok(chk.startswith('✓') and '05' in chk, f'{tag}: valid number confirmed while typing ({chk})')
        g.screenshot(path=f'{OUT}/m-form-{tag}.png')
        g.click('.modal [data-save]'); g.wait_for_selector('.vhead', timeout=30000)
        want = '+966501234567' if w > 600 else '+966559876543'
        ok(sql(f"select current_user_mobile from vehicles where plate_no='{plate}'") == want, f'{tag}: saved in international form {want}')
        t = g.inner_text('[data-panel=basic]')
        ok(('050 123 4567' if w > 600 else '055 987 6543') in t, f'{tag}: shown in English digits with the leading zero')
        call = g.locator('[data-panel=basic] a[data-call]'); wa = g.locator('[data-panel=basic] a[data-wa]')
        ok(call.get_attribute('href') == f'tel:{want}' and wa.get_attribute('href') == f'https://wa.me/{want[1:]}', f'{tag}: call and WhatsApp buttons use the number')
        g.screenshot(path=f'{OUT}/m-file-{tag}.png', full_page=True)
        g.click('[data-panel=basic] [data-act=edit]'); g.wait_for_selector('.modal [name=current_user_mobile]')
        ok(g.locator('.modal [name=current_user_mobile]').input_value() == '0' + want[4:], f'{tag}: edit form shows the saved number with its leading zero')
        fill(g, {'current_user_mobile': '0533334444'}); g.click('.modal [data-save]'); g.wait_for_selector('.modal', state='detached'); g.wait_for_timeout(600)
        ok(sql(f"select current_user_mobile from vehicles where plate_no='{plate}'") == '+966533334444', f'{tag}: number changed and saved')
        g.click('[data-panel=basic] [data-act=edit]'); g.wait_for_selector('.modal [name=current_user_mobile]')
        fill(g, {'current_user_mobile': ''}); g.click('.modal [data-save]'); g.wait_for_selector('.modal', state='detached'); g.wait_for_timeout(600)
        ok(sql(f"select coalesce(current_user_mobile,'NULL') from vehicles where plate_no='{plate}'") == 'NULL' and '—' in g.inner_text('[data-panel=basic]'), f'{tag}: number can be cleared; vehicle still saves')
        c.close()
    b.close()
ok(sql("select count(*) from vehicles where plate_no like 'م م م%' ") == '2', 'vehicles without issues')
print(f'PASS {len(passed)}')
for x in passed: print('  ok  ', x)
print(f'FAIL {len(problems)}')
for x in problems: print('  FAIL', x)
