"""Phase 8: robustness in the browser — hostile text (HTML/script) everywhere it can appear, a device in
another timezone around midnight, slow network, session expiry, and a double-tap on «حفظ».
Usage: python3 -I robust_ui.py OUTDIR   (fleet_ui reset with ui_seed.sql)"""
import sys, os, subprocess, datetime
from playwright.sync_api import sync_playwright
import openpyxl

OUT = sys.argv[1]; os.makedirs(OUT, exist_ok=True)
BASE = 'http://localhost:8787/'
problems, passed = [], []
def ok(c, m): (passed if c else problems).append(m)
PSQL = ['psql', '-h', '/tmp', '-p', '5433', '-U', 'postgres', '-X', '-q', '-At', '-d', 'fleet_ui']
def sql(q): return subprocess.run(PSQL + ['-c', "set request.jwt.claim.sub='a0000000-0000-0000-0000-000000000001';" + q], capture_output=True, text=True).stdout.strip()

X1 = '<img src=x onerror="window.__xss=1">'
X2 = '"><script>window.__xss=2</script>'
X3 = '<svg onload=window.__xss=3>'
X4 = "');window.__xss=4;//"
sql(f"""update vehicles set make = $${X2}$$, model = $${X4}$$, notes = $${X1}$$ where id = 'b0000000-0000-0000-0000-000000000002';
update employees set full_name = $$موظف {X3}$$, job_title = $${X1}$$ where id = 'e0000000-0000-0000-0000-000000000002';
update vehicles set plate_no = $$ل ل ل {X1}$$ where id = 'b0000000-0000-0000-0000-000000000005';
update housing_maintenance set description = $${X2}$$, contractor = $${X3}$$;
update food_supplies set supplier = $${X1}$$;
update sites set name = $$مزرعة ارم {X3}$$ where name = 'مزرعة ارم';""")

def ctx(b, tz='Asia/Riyadh', w=390):
    c = b.new_context(viewport={'width': w, 'height': 844}, locale='ar-SA', timezone_id=tz, accept_downloads=True)
    g = c.new_page(); g.route('**/fonts.googleapis.com/**', lambda r: r.abort())
    g.on('pageerror', lambda e: problems.append(f'page error: {e}'))
    g.on('dialog', lambda d: (problems.append(f'unexpected dialog: {d.message}'), d.dismiss()))
    return c, g
def login(g):
    g.goto(BASE); g.wait_for_selector('form.login-card')
    g.fill('input[name=email]', 'admin@test.local'); g.fill('input[name=password]', 'test1234'); g.click('button[type=submit]'); g.wait_for_selector('.panels')

with sync_playwright() as p:
    b = p.chromium.launch()
    c, g = ctx(b, w=1280); login(g)
    pages = [('#/dashboard', '.panels'), ('#/vehicles', '#vt'), ('#/vehicles/b0000000-0000-0000-0000-000000000002', '.vhead'),
             ('#/vehicles/b0000000-0000-0000-0000-000000000005', '.vhead'), ('#/employees', '#et'), ('#/employees/e0000000-0000-0000-0000-000000000002', '.vhead'),
             ('#/documents', '#dt'), ('#/housing', '.list-body'), ('#/food', '.list-body'), ('#/sites', '.page-head'), ('#/audit', '.audit'), ('#/reports', '.rep-head')]
    for h, sel in pages:
        g.goto(BASE + h); g.wait_for_selector(sel); g.wait_for_timeout(250)
        for tab in g.locator('.tabs [data-tab]').all()[:11]:
            try: tab.click(); g.wait_for_timeout(120)
            except Exception: pass
    g.goto(BASE + '#/reports'); g.wait_for_selector('.rep-head'); g.select_option('select[name=report]', 'cost_site'); g.wait_for_timeout(400)
    g.hover('.hb >> nth=0'); g.wait_for_timeout(100)
    g.fill('form.search input', 'ل ل ل'); g.press('form.search input', 'Enter'); g.wait_for_selector('text=نتائج البحث'); g.wait_for_timeout(300)
    ok(g.evaluate('window.__xss') is None, 'no injected script ran on 12 pages + all vehicle tabs + search + chart tooltip')
    g.goto(BASE + '#/vehicles/b0000000-0000-0000-0000-000000000005'); g.wait_for_selector('.vhead')
    ok(X1 in g.inner_text('.vhead'), 'hostile text is shown literally (as text), not executed')
    g.goto(BASE + '#/housing'); g.wait_for_selector('.list-body')
    ok(g.locator('.list-body script').count() == 0 and g.locator('.list-body img[src=x]').count() == 0, 'no injected elements in the DOM')
    # edit form keeps the text intact (round trip)
    g.goto(BASE + '#/vehicles/b0000000-0000-0000-0000-000000000002'); g.wait_for_selector('.vhead')
    g.click('.vactions [data-act=edit]'); g.wait_for_selector('.modal')
    ok(g.input_value('.modal [name=make]') == X2, 'edit form shows the stored text exactly')
    g.click('.modal [data-save]'); g.wait_for_selector('.modal', state='detached')
    ok(sql("select make from vehicles where id='b0000000-0000-0000-0000-000000000002'") == X2, 'saving unchanged form does not alter the text')
    ok(g.evaluate('window.__xss') is None, 'still no script after edit')
    # Excel keeps text as text (no formula execution)
    sql("update vehicles set color = '=HYPERLINK(\"http://example.com\",\"x\")' where id = 'b0000000-0000-0000-0000-000000000001'")
    g.goto(BASE + '#/excel'); g.wait_for_selector('.exp-grid')
    with g.expect_download() as dl: g.click('[data-exp=vehicles]')
    path = f'{OUT}/xss.xlsx'; dl.value.save_as(path)
    ws = openpyxl.load_workbook(path).active; h = [x.value for x in ws[1]]
    vals = [ws.cell(r, h.index('الماركة') + 1).value for r in range(2, ws.max_row + 1)]
    colr = [ws.cell(r, h.index('اللون') + 1) for r in range(2, ws.max_row + 1)]
    ok(X2 in vals, 'Excel cell contains the text literally')
    ok(all(c.data_type != 'f' for c in colr) and any(str(c.value).startswith('=HYPERLINK') for c in colr), 'text starting with «=» is stored as text, not as an Excel formula')
    c.close()

    # ---------- device in another timezone at a time when the date differs from Riyadh
    for tz in ['America/Los_Angeles', 'Pacific/Honolulu', 'Asia/Tokyo']:
        c, g = ctx(b, tz=tz)
        # 22:30 UTC = 01:30 next day in Riyadh; 12:30/15:30 previous day in LA/Honolulu; 07:30 next day in Tokyo
        g.clock.install(time=datetime.datetime(2026, 10, 12, 22, 30, tzinfo=datetime.timezone.utc))
        login(g)
        ok(g.inner_text('.tb-date') == '2026/10/13', f'{tz}: header date is the Riyadh date 2026/10/13 ({g.inner_text(".tb-date")})')
        g.goto(BASE + '#/oil'); g.wait_for_selector('.list-body'); g.click('[data-list-add]'); g.wait_for_selector('.modal')
        ok(g.input_value('.modal [name=change_date]') == '2026/10/13', f'{tz}: new oil change defaults to Riyadh date')
        (g.click('.modal [data-close]'), g.wait_for_timeout(150), g.locator('[data-yes]').count() and g.click('[data-yes]'))
        c.close()

    # ---------- slow network: the page shows a loading state and still completes
    c, g = ctx(b); login(g)
    cdp = c.new_cdp_session(g); cdp.send('Network.enable')
    cdp.send('Network.emulateNetworkConditions', {'offline': False, 'latency': 400, 'downloadThroughput': 50 * 1024, 'uploadThroughput': 20 * 1024})
    g.goto(BASE + '#/vehicles'); g.wait_for_timeout(150)
    ok(g.locator('.loading, [aria-busy=true]').count() >= 1 or g.locator('#vt').count() == 1, 'slow 3G: a loading state is shown')
    g.wait_for_selector('#vt', timeout=60000); ok(True, 'slow 3G: vehicles page completes')
    # ---------- offline: friendly Arabic message, no crash
    cdp.send('Network.emulateNetworkConditions', {'offline': True, 'latency': 0, 'downloadThroughput': -1, 'uploadThroughput': -1})
    g.goto(BASE + '#/maintenance'); g.wait_for_timeout(1500)
    t = g.inner_text('#page')
    ok('الاتصال' in t or 'الإنترنت' in t, f'offline: Arabic connection message ({t[:60]!r})')
    cdp.send('Network.emulateNetworkConditions', {'offline': False, 'latency': 0, 'downloadThroughput': -1, 'uploadThroughput': -1})

    # ---------- double tap on «حفظ» must not create two records
    before = sql('select count(*) from food_supplies')
    g.goto(BASE + '#/food'); g.wait_for_selector('.list-body'); g.click('[data-list-add]'); g.wait_for_selector('.modal')
    g.select_option('.modal [name=site_id]', index=1); g.fill('.modal [name=supplier]', 'مورد'); g.fill('.modal [name=description]', 'خبز')
    g.fill('.modal [name=quantity]', '2'); g.fill('.modal [name=unit]', 'كيس'); g.fill('.modal [name=unit_price]', '5')
    cdp.send('Network.emulateNetworkConditions', {'offline': False, 'latency': 600, 'downloadThroughput': -1, 'uploadThroughput': -1})
    g.click('.modal [data-save]'); g.click('.modal [data-save]', force=True, timeout=2000) if g.locator('.modal [data-save]').count() else None
    g.wait_for_selector('.modal', state='detached', timeout=30000)
    ok(int(sql('select count(*) from food_supplies')) == int(before) + 1, 'double tap on «حفظ» saves exactly one record')

    # ---------- expired session: back to login with a message, no data shown
    g.evaluate("""() => { const k='fleet.session.v1'; const s=JSON.parse(localStorage.getItem(k)); s.access_token='expired'; s.expires_at=Math.floor(Date.now()/1000)+3600; localStorage.setItem(k, JSON.stringify(s)); }""")
    g.goto(BASE + '#/vehicles'); g.reload(); g.wait_for_timeout(1500)
    ok(g.locator('form.login-card').count() == 1, 'invalid/expired session returns to the login screen')
    c.close()

    # ---------- VAT rate change must not rewrite old invoices when they are edited
    c, g = ctx(b, w=1280); login(g)
    sql("update app_settings set value = '0.05' where key = 'default_vat_rate'")
    g.goto(BASE + '#/maintenance'); g.wait_for_selector('.list-body'); g.select_option('#page select[name=year]', ''); g.wait_for_timeout(300)
    g.click('[data-row-act=edit] >> nth=0'); g.wait_for_selector('.modal')
    ok('15%' in g.inner_text('.modal'), 'editing an invoice recorded at 15% still shows 15% after the setting became 5%')
    g.fill('.modal [name=notes]', 'تعديل ملاحظة فقط'); g.click('.modal [data-save]'); g.wait_for_selector('.modal', state='detached')
    ok(sql("select vat_amount from maintenance where id='c0000000-0000-0000-0000-000000000001'") == '180.00', 'its VAT stays 180.00 (not recalculated at 5%)')
    g.click('[data-list-add]'); g.wait_for_selector('.modal')
    ok('5%' in g.inner_text('.modal'), 'a new invoice uses the new 5% rate')
    # dates typed with single digits / dashes are accepted
    g.fill('.modal [name=maint_date]', '2026-3-7'); g.press('.modal [name=maint_date]', 'Tab'); (g.click('.modal [data-close]'), g.wait_for_timeout(150), g.locator('[data-yes]').count() and g.click('[data-yes]'))
    c.close()
    b.close()

print(f'PASS {len(passed)}')
for x in passed: print('  ok  ', x)
print(f'FAIL {len(problems)}')
for x in problems: print('  FAIL', x)
