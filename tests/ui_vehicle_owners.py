"""v1.12: «الشركات والمواقع» shows only the main companies and their active sites. Vehicle owners typed in the
vehicle card (field «المالك») are registered with companies.is_vehicle_owner = true and never appear on that page,
nor in the site form or the employee company list; they still appear on the card and in the owners filter.
Stopped sites are folded under «المواقع الموقوفة» (nothing deleted) and are not suggested in the card.
Usage: python3 -I ui_vehicle_owners.py OUTDIR   (fresh fleet_ui + mock server)"""
import sys, os, subprocess
from playwright.sync_api import sync_playwright
OUT = sys.argv[1]; os.makedirs(OUT, exist_ok=True)
BASE = 'http://localhost:8787/'
problems, passed = [], []
def ok(c, m): (passed if c else problems).append(m)
def sql(q): return subprocess.run(['psql', '-h', '/tmp', '-p', '5433', '-U', 'postgres', '-X', '-q', '-At', '-d', 'fleet_ui', '-c', q], capture_output=True, text=True).stdout.strip()
def new_ctx(b, w=1280):
    c = b.new_context(viewport={'width': w, 'height': 900}, locale='ar-SA', timezone_id='Asia/Riyadh', device_scale_factor=2)
    g = c.new_page(); g.route('**/fonts.googleapis.com/**', lambda r: r.abort())
    g.on('pageerror', lambda e: problems.append(f'page error: {e}'))
    return c, g
def login(g, email='admin@test.local'):
    g.goto(BASE); g.wait_for_selector('form.login-card'); g.fill('input[name=email]', email); g.fill('input[name=password]', 'test1234'); g.click('button[type=submit]'); g.wait_for_selector('.panels')
def sites_page(g): g.goto(f'{BASE}#/sites?r={os.urandom(3).hex()}'); g.wait_for_selector('.page-head'); g.wait_for_timeout(300)
def datalist(g, name): return g.evaluate(f"[...document.querySelector('.modal [name={name}]').list.options].map(o => o.value)")

OWNER = 'شركة تأجير تجريبية'
SITE_OFF = sql("select name from sites where company_id = '11111111-1111-1111-1111-111111111111' order by name limit 1")
sql("insert into companies(name, is_vehicle_owner) values ('مالك قديم تجريبي', true)")
before = sql("select md5(string_agg(t::text, '|' order by t.id)) from (select id, name, company_id, kind from sites) t")

with sync_playwright() as p:
    b = p.chromium.launch()
    c, g = new_ctx(b); login(g)

    # ---------- a new vehicle with a new owner name
    g.goto(BASE + '#/vehicles'); g.wait_for_selector('#vt'); g.click('[data-act=new]'); g.wait_for_selector('.modal [name=owner_company]'); g.wait_for_timeout(200)
    g.fill('.modal [name=plate_letters]', 'ت س ت'); g.fill('.modal [name=plate_digits]', '4321'); g.fill('.modal [name=owner_company]', OWNER)
    g.click('.modal [data-save]'); g.wait_for_selector('.modal', state='detached', timeout=30000); g.wait_for_timeout(500)
    row = sql(f"select c.is_vehicle_owner from vehicles v join companies c on c.id = v.owner_company_id where v.plate_no = 'ت س ت 4321'")
    ok(row == 't', f'new owner typed in the card is saved as a vehicle owner [{row}]')

    # ---------- companies and sites page
    sites_page(g); txt = g.inner_text('#page')
    ok('شركة روى الرمال الزراعية' in txt and 'شركة عبد الرحمن الفهاد' in txt, 'main companies shown')
    ok(OWNER not in txt and 'مالك قديم تجريبي' not in txt, 'vehicle owners are not shown on the companies page')
    ok(g.locator('section.company').count() == 2, f'only the two main companies [{g.locator("section.company").count()}]')
    g.screenshot(path=f'{OUT}/1-sites.png', full_page=True)

    # site form: company list = main companies only
    g.click('[data-act=add-site]'); g.wait_for_selector('.modal [name=company_id]')
    opts = g.evaluate("[...document.querySelector('.modal [name=company_id]').options].filter(o => o.value).map(o => o.textContent)")
    ok(sorted(opts) == sorted(['شركة روى الرمال الزراعية', 'شركة عبد الرحمن الفهاد']), f'site form lists only main companies {opts}')
    g.click('.modal [data-close].btn'); g.wait_for_timeout(300)

    # ---------- stop a site: folded under «المواقع الموقوفة», nothing deleted
    sites_page(g)
    g.locator('section.company li', has_text=SITE_OFF).locator('[data-act=edit-site]').click(); g.wait_for_selector('.modal [name=is_active]')
    g.uncheck('.modal [name=is_active]'); g.click('.modal [data-save]'); g.wait_for_selector('.modal', state='detached'); g.wait_for_timeout(600)
    sites_page(g)
    in_company = g.locator('section.company', has_text=SITE_OFF).count()
    ok(in_company == 0, 'stopped site is no longer listed under its company')
    ok(g.locator('details.stopped-sites').count() == 1 and SITE_OFF in g.text_content('details.stopped-sites'), 'stopped site is listed under «المواقع الموقوفة»')
    ok(g.locator('details.stopped-sites').get_attribute('open') is None, 'stopped sites are folded by default')
    ok(sql(f"select count(*) from sites where name = '{SITE_OFF}'") == '1', 'stopped site still exists (not deleted)')
    g.screenshot(path=f'{OUT}/2-stopped.png', full_page=True)

    # ---------- the vehicle card: owner list keeps owners, site list hides stopped sites
    g.goto(BASE + '#/vehicles'); g.wait_for_selector('#vt'); g.click('[data-act=new]'); g.wait_for_selector('.modal [name=owner_company]'); g.wait_for_timeout(200)
    owners = datalist(g, 'owner_company'); sites = datalist(g, 'site_name')
    ok(OWNER in owners and 'مالك قديم تجريبي' in owners, 'card «المالك» still suggests the vehicle owners')
    ok(SITE_OFF not in sites and len(sites) >= 1, f'card «المشروع الحالي» does not suggest stopped sites {sites}')
    g.click('.modal [data-close].btn'); g.wait_for_timeout(300)
    flt = g.evaluate("[...document.querySelector('[name=owner]').options].map(o => o.textContent)")
    ok(OWNER in flt, 'vehicles filter «الشركة المالكة» includes the owners')
    ok(OWNER in g.inner_text('#vt'), 'vehicle list shows the owner name')

    # ---------- employee form: company list = main companies only
    g.goto(BASE + '#/employees'); g.wait_for_selector('.page-head'); g.click('[data-act=new]'); g.wait_for_selector('.modal [name=company_name]')
    emp = datalist(g, 'company_name')
    ok(OWNER not in emp and 'شركة روى الرمال الزراعية' in emp, f'employee company list has main companies only {emp}')
    g.click('.modal [data-close].btn'); g.wait_for_timeout(300)

    # mobile
    c.close(); c, g = new_ctx(b, 390); login(g); sites_page(g)
    ok(g.evaluate('document.documentElement.scrollWidth') <= 391, 'mobile: no horizontal overflow')
    g.screenshot(path=f'{OUT}/3-mobile.png', full_page=True)
    c.close(); b.close()

after = sql("select md5(string_agg(t::text, '|' order by t.id)) from (select id, name, company_id, kind from sites) t")
ok(before == after, 'no site renamed, moved or deleted (only switched off)')
ok(sql("select count(*) from companies where name in ('شركة روى الرمال الزراعية', 'شركة عبد الرحمن الفهاد') and not is_vehicle_owner") == '2', 'main companies untouched')

for x in passed: print('PASS', x)
for x in problems: print('FAIL', x)
print(f'PASS {len(passed)} FAIL {len(problems)}')
sys.exit(1 if problems else 0)
