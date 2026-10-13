"""v1.10: authorization on the vehicle card (section 3, directly under «المستخدم الحالي»):
«حالة التفويض» (مفوضة / غير مفوضة), «تاريخ انتهاء التفويض» (calendar), «حالة انتهاء التفويض» (automatic).
Three cases (authorized + valid date, authorized + expired date, not authorized) + authorized without a date,
saving / reopening / editing other fields without losing it, alerts (vehicle page, bell, documents) and the
alert period from the settings. Usage: python3 -I ui_vehicle_auth.py OUTDIR   (fresh fleet_ui + mock server)"""
import sys, os, subprocess
import datetime as _dt, zoneinfo as _zi
from playwright.sync_api import sync_playwright
_T0 = _dt.datetime.now(_zi.ZoneInfo('Asia/Riyadh')).date()
def _d(n=0, sep='/'): return (_T0 + _dt.timedelta(days=n)).strftime(f'%Y{sep}%m{sep}%d')
OUT = sys.argv[1]; os.makedirs(OUT, exist_ok=True)
BASE = 'http://localhost:8787/'
V = {k: f'b0000000-0000-0000-0000-00000000000{n}' for k, n in [('valid', 1), ('expired', 2), ('notauth', 3), ('nodate', 4)]}
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
def open_vehicle(g, vid, tab='basic'):
    g.goto(f'{BASE}#/vehicles/{vid}?tab={tab}&r={os.urandom(3).hex()}'); g.wait_for_selector('.vhead')
def edit(g, vid):
    open_vehicle(g, vid); g.click('[data-panel=basic] [data-act=edit]'); g.wait_for_selector('.modal [name=card_auth_status]'); g.wait_for_timeout(250)
def save(g):
    g.click('.modal [data-save]'); g.wait_for_selector('.modal', state='detached', timeout=30000); g.wait_for_selector('.vhead'); g.wait_for_timeout(300)
def live(g): return g.inner_text('.modal [data-live=auth_live]')
def set_auth(g, status, date=None):
    g.select_option('.modal [name=card_auth_status]', value=status)
    g.fill('.modal [name=card_auth_expiry]', date or ''); g.locator('.modal [name=card_auth_expiry]').dispatch_event('input'); g.wait_for_timeout(200)
def db(vid): return sql(f"select concat_ws('|', coalesce(card_auth_status, '-'), coalesce(to_char(card_auth_expiry, 'YYYY/MM/DD'), '-')) from vehicles where id='{vid}'")
def docstat(vid): return sql(f"select status from v_document_status where owner_id='{vid}' and doc_type='vehicle_authorization'")
def card_state(g): return g.get_attribute('[data-panel=basic] [data-auth-state]', 'data-auth-state')

FP = lambda vid: sql(f"select md5(to_jsonb(v)::text) from (select plate_no, make, model, owner_company_id, site_id, current_user_name, current_user_mobile, insurance_expiry, custom_fields from vehicles where id='{vid}') v")
others_before = {k: FP(v) for k, v in V.items()}

with sync_playwright() as p:
    b = p.chromium.launch()
    c, g = new_ctx(b); login(g)

    # ---------- the form: placement, choices, calendar, live status
    g.goto(BASE + '#/vehicles'); g.wait_for_selector('#vt'); g.click('[data-act=new]'); g.wait_for_selector('.modal [name=card_auth_status]'); g.wait_for_timeout(200)
    names = g.evaluate("[...document.querySelectorAll('.modal form [name]')].filter(e => !e.classList.contains('native') && e.type !== 'file').map(e => e.name)")
    i = names.index('current_user_name')
    ok(names[i + 1:i + 3] == ['card_auth_status', 'card_auth_expiry'], f'new fields directly under «المستخدم الحالي» {names[i:i + 4]}')
    sec3 = g.evaluate("(() => { const f = document.querySelector('.modal [name=card_auth_status]').closest('.field'); let e = f; while (e && !e.classList.contains('form-sec')) e = e.previousElementSibling; return e ? e.textContent : '' })()")
    ok('ثالثاً' in sec3, f'inside section 3 «المسؤولية والمالكون» [{sec3}]')
    opts = g.evaluate("[...document.querySelector('.modal [name=card_auth_status]').options].filter(o => o.value).map(o => o.textContent)")
    ok(opts == ['مفوضة', 'غير مفوضة'], f'status choices {opts}')
    ok(g.locator('.modal [name=card_auth_expiry]').locator('xpath=..').locator('button.cal').count() == 1, 'date field has a calendar button')
    set_auth(g, 'authorized', _d(40)); t = live(g); ok('غير منتهٍ' in t, f'live: authorized + future date -> غير منتهٍ [{t}]')
    set_auth(g, 'authorized', _d(-3)); t = live(g); ok('منتهٍ' in t and 'غير منتهٍ' not in t, f'live: past date -> منتهٍ [{t}]')
    set_auth(g, 'authorized', ''); t = live(g); ok('غير محدد التاريخ' in t and 'يرجى تحديد تاريخ انتهاء التفويض' in t, f'live: no date -> message [{t}]')
    set_auth(g, 'not_authorized', _d(-3)); t = live(g); ok('غير مفوضة' in t and 'منتهٍ' not in t, f'live: not authorized is not expired [{t}]')
    g.screenshot(path=f'{OUT}/1-form.png')
    g.click('.modal [data-close].btn'); g.wait_for_timeout(300)
    if g.locator('.modal [data-yes]').count(): g.click('.modal [data-yes]')
    g.wait_for_selector('.modal', state='detached')

    # ---------- case 1: authorized, valid date
    edit(g, V['valid']); set_auth(g, 'authorized', _d(60)); save(g)
    ok(db(V['valid']) == f'authorized|{_d(60)}', f'case 1 saved [{db(V["valid"])}]')
    ok(card_state(g) == 'valid' and 'غير منتهٍ' in g.inner_text('[data-panel=basic]'), 'case 1 card shows «غير منتهٍ»')
    ok(g.locator('.auth-alert').count() == 0, 'case 1 no alert banner')
    ok(docstat(V['valid']) == 'valid', 'case 1 documents status valid')
    # reopen the edit form: values come back
    edit(g, V['valid'])
    ok(g.input_value('.modal [name=card_auth_status]') == 'authorized' and g.input_value('.modal [name=card_auth_expiry]') == _d(60), 'case 1 values shown when editing')
    ok('غير منتهٍ' in live(g), 'case 1 live status on opening the edit form')
    # edit another field: authorization kept
    g.fill('.modal [name=notes]', 'ملاحظة بعد التفويض'); save(g)
    ok(db(V['valid']) == f'authorized|{_d(60)}', 'editing another field keeps status and date')

    # ---------- case 2: authorized, expired date
    edit(g, V['expired']); set_auth(g, 'authorized', _d(-5)); save(g)
    ok(db(V['expired']) == f'authorized|{_d(-5)}', 'case 2 saved')
    ok(card_state(g) == 'expired', 'case 2 card shows «منتهٍ»')
    ok(g.locator('.auth-alert.bad-box').count() == 1 and 'انتهى تفويض السيارة' in g.inner_text('.auth-alert'), 'case 2 clear alert on the vehicle page')
    g.screenshot(path=f'{OUT}/2-expired.png', full_page=True)
    ok(docstat(V['expired']) == 'expired', 'case 2 documents status expired')
    sev = sql(f"select severity from v_followups where subject_id='{V['expired']}' and alert_type='vehicle_authorization'")
    ok(sev == '1', f'case 2 urgent alert in the follow-ups [{sev}]')
    g.goto(BASE + '#/dashboard'); g.wait_for_selector('.panels'); g.wait_for_timeout(500)
    g.wait_for_timeout(500)
    ok('انتهاء تفويض السيارة' in g.inner_text('#page'), 'case 2 shows in the dashboard alerts list')
    g.reload(); g.wait_for_selector('.bell .badge:not([hidden])'); g.wait_for_timeout(500)
    badge = int(g.inner_text('.bell .badge') or 0)
    ok(badge == int(sql("select count(*) from v_followups where severity = 1")), f'bell count includes it [{badge}]')

    # ---------- case 3: not authorized (with an old date): never an alert
    edit(g, V['notauth']); set_auth(g, 'not_authorized', _d(-30)); save(g)
    ok(db(V['notauth']) == f'not_authorized|{_d(-30)}', 'case 3 saved (date kept)')
    ok(card_state(g) == 'not_authorized' and 'غير مفوضة' in g.inner_text('[data-panel=basic]'), 'case 3 card shows «غير مفوضة»')
    ok(g.locator('.auth-alert').count() == 0, 'case 3 no alert banner')
    ok(docstat(V['notauth']) == '', 'case 3 not in documents / alerts')

    # ---------- authorized without a date
    edit(g, V['nodate']); set_auth(g, 'authorized', ''); save(g)
    ok(db(V['nodate']) == 'authorized|-', 'no-date saved')
    ok(card_state(g) == 'no_date' and 'يرجى تحديد تاريخ انتهاء التفويض' in g.inner_text('[data-panel=basic]'), 'no-date card message')
    ok(g.locator('.auth-alert.warn-box').count() == 1, 'no-date warning banner')
    ok(docstat(V['nodate']) == 'no_date', 'no-date in documents')

    # ---------- expiring soon + alert period from the settings
    edit(g, V['valid']); set_auth(g, 'authorized', _d(10)); save(g)
    ok(card_state(g) == 'expiring' and g.locator('.auth-alert.warn-box').count() == 1, 'expiring within 30 days -> warning')
    ok(docstat(V['valid']) == 'expiring', 'expiring in documents (default 30 days)')
    g.goto(BASE + '#/settings'); g.wait_for_selector('[data-act=edit]')
    ok('التنبيه قبل انتهاء تفويض السيارة' in g.inner_text('#page'), 'settings shows the alert period')
    g.click('[data-act=edit]'); g.wait_for_selector('.modal [name=vehicle_auth_alert_days]')
    ok(g.input_value('.modal [name=vehicle_auth_alert_days]') == '30', 'default alert period 30')
    g.fill('.modal [name=vehicle_auth_alert_days]', '5'); g.click('.modal [data-save]'); g.wait_for_selector('.modal', state='detached')
    ok(sql("select value from app_settings where key='vehicle_auth_alert_days'") == '5', 'alert period saved')
    ok(docstat(V['valid']) == 'valid', '10 days left is not an alert with a 5-day period')
    open_vehicle(g, V['valid']); ok(card_state(g) == 'valid' and g.locator('.auth-alert').count() == 0, 'vehicle page follows the setting')

    # ---------- list column, change history, documents page
    g.goto(BASE + '#/vehicles'); g.wait_for_selector('#vt'); g.wait_for_timeout(500)
    ok('مفوضة · منتهٍ' in g.inner_text('#vt') and 'غير مفوضة' in g.inner_text('#vt'), 'vehicles list shows the card authorization')
    open_vehicle(g, V['expired'], 'log'); g.wait_for_timeout(500)
    ok('حالة التفويض' in g.inner_text('#page') and 'مفوضة' in g.inner_text('#page'), 'change history shows the authorization fields')
    g.goto(BASE + '#/documents'); g.wait_for_timeout(1200)
    ok('تفويض السيارة' in g.inner_text('#page'), 'documents page lists the vehicle authorization')
    c.close()

    # mobile form
    c, g = new_ctx(b, 390); login(g)
    edit(g, V['expired']); g.locator('.modal [name=card_auth_status]').scroll_into_view_if_needed(); g.wait_for_timeout(200)
    g.screenshot(path=f'{OUT}/3-mobile-form.png')
    ok(g.evaluate('document.documentElement.scrollWidth') <= 391, 'mobile: no horizontal overflow')
    c.close(); b.close()

ok(all(FP(v) == others_before[k] or k == 'valid' for k, v in V.items()), 'other vehicle data untouched (except the edited note)')
ok(sql('select count(*) from vehicles') == '5', 'no vehicle added or removed')

for x in passed: print('PASS', x)
for x in problems: print('FAIL', x)
print(f'PASS {len(passed)} FAIL {len(problems)}')
sys.exit(1 if problems else 0)
