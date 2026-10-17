"""v1.30: phone notifications (Web Push). Settings -> «إشعارات الجوال»: turn on for this device (subscription saved
for the signed-in user only), test, turn off (archived, not deleted); iPhone outside the home-screen app gets the
install steps; the real service worker registers; sending a maintenance request for approval asks the server to
notify approvers. The push service itself is stubbed in the browser (no network). Usage: python3 -I ui_push.py OUTDIR"""
import sys, os, subprocess, json
from playwright.sync_api import sync_playwright
OUT = sys.argv[1]; os.makedirs(OUT, exist_ok=True)
BASE = 'http://localhost:8787/'
V1 = 'b0000000-0000-0000-0000-000000000001'
problems, passed = [], []
def ok(c, m): (passed if c else problems).append(m)
def sql(q): return subprocess.run(['psql', '-h', '/tmp', '-p', '5433', '-U', 'postgres', '-X', '-q', '-At', '-d', 'fleet_ui', '-c', q], capture_output=True, text=True).stdout.strip()
def as_user(email, q):
    uid = sql(f"select id from auth.users where email='{email}'")
    return subprocess.run(['psql', '-h', '/tmp', '-p', '5433', '-U', 'postgres', '-X', '-q', '-At', '-d', 'fleet_ui'],
                          input=f"begin; set local role authenticated; set local request.jwt.claim.sub = '{uid}';\n{q};\nrollback;", capture_output=True, text=True)

STUB = """
window.__sub = null; window.__keyLen = 0;
const fakeSub = { endpoint: 'https://push.example.test/dev-abc123', toJSON() { return { endpoint: this.endpoint, keys: { p256dh: 'BPtestP256dhKey', auth: 'authTestKey' } }; },
  unsubscribe: async () => { window.__sub = null; return true; } };
const pm = { getSubscription: async () => window.__sub, subscribe: async (o) => { window.__keyLen = o.applicationServerKey.length; window.__sub = fakeSub; return fakeSub; } };
const reg = { pushManager: pm };
Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { register: async () => reg, getRegistration: async () => reg, ready: Promise.resolve(reg) } });
Object.defineProperty(window, 'PushManager', { configurable: true, value: function () {} });
const N = { permission: 'default', requestPermission: async () => { N.permission = 'granted'; return 'granted'; } };
Object.defineProperty(window, 'Notification', { configurable: true, value: N });
"""
calls = []
def route_fn(route):
    body = json.loads(route.request.post_data or '{}'); calls.append(body)
    auth = route.request.headers.get('authorization', '')
    if not auth.startswith('Bearer '): return route.fulfill(status=401, content_type='application/json', body='{"error":"NOT_SIGNED_IN"}')
    a = body.get('action')
    res = {'public-key': {'key': 'B' + 'A' * 86}, 'test': {'ok': True, 'sent': 1, 'failed': 0}, 'request': {'ok': True, 'sent': 1}}.get(a, {'error': 'UNKNOWN'})
    route.fulfill(status=200, content_type='application/json', body=json.dumps(res))

def ctx(b, w=1280, ua=None, stub=True):
    kw = dict(viewport={'width': w, 'height': 900}, device_scale_factor=2, locale='ar-SA', timezone_id='Asia/Riyadh')
    if ua: kw['user_agent'] = ua
    c = b.new_context(**kw)
    g = c.new_page(); g.route('**/fonts.googleapis.com/**', lambda r: r.abort()); g.route('**/functions/v1/push', route_fn)
    g.on('pageerror', lambda e: problems.append(f'page error: {e}'))
    if stub: g.add_init_script(STUB)
    return c, g
def login(g, email='admin@test.local'):
    g.goto(BASE); g.wait_for_selector('form.login-card'); g.fill('input[name=email]', email); g.fill('input[name=password]', 'test1234'); g.click('button[type=submit]'); g.wait_for_selector('.panels')
def settings(g): g.goto(f'{BASE}#/settings?r={os.urandom(3).hex()}'); g.wait_for_selector('[data-push-tag]'); g.wait_for_function("document.querySelector('[data-push-tag]').textContent !== '…'")

with sync_playwright() as p:
    b = p.chromium.launch()
    # ---------- real service worker (no stub): sw.js is served and registers at the site root
    c, g = ctx(b, stub=False); login(g)
    g.wait_for_function('navigator.serviceWorker.getRegistration().then(r => !!r)', timeout=10000)
    scope = g.evaluate('navigator.serviceWorker.getRegistration().then(r => r.scope)')
    ok(scope == BASE, f'service worker registered at the site root [{scope}]')
    src = g.evaluate("fetch('sw.js').then(r => r.text())")
    ok("addEventListener('push'" in src and "addEventListener('fetch'" not in src, 'sw.js handles push and does not cache pages (no fetch handler)')
    c.close()

    # ---------- turn on / test / off (desktop)
    c, g = ctx(b); login(g); settings(g)
    ok('إشعارات الجوال' in g.inner_text('[data-push]') and g.inner_text('[data-push-tag]') == 'غير مفعّلة', 'settings shows «إشعارات الجوال», off')
    ok('06:30' in g.inner_text('[data-push]'), 'explains the daily time')
    g.click('[data-act=push-on]'); g.wait_for_function("document.querySelector('[data-push-tag]').textContent.includes('مفعّلة على')", timeout=8000)
    row = sql("select u.email, s.p256dh, s.auth_key, s.is_active, s.device_label is not null from push_subscriptions s join auth.users u on u.id = s.user_id where s.endpoint='https://push.example.test/dev-abc123'")
    ok(row == 'admin@test.local|BPtestP256dhKey|authTestKey|t|t', f'subscription saved for the signed-in user [{row}]')
    ok(g.evaluate('window.__keyLen') == 65, 'subscribed with the server public key (65 bytes)')
    acts = [x.get('action') for x in calls]
    ok(acts[:2] == ['public-key', 'test'], f'turning on fetches the key then sends a test [{acts}]')
    g.screenshot(path=f'{OUT}/1-on-desktop.png', full_page=True)
    calls.clear(); g.click('[data-act=push-test]'); g.wait_for_timeout(600)
    ok([x.get('action') for x in calls] == ['test'] and 'أُرسل إشعار تجريبي' in g.inner_text('body'), 'test button asks the server to send')
    # turning on again on the same device does not duplicate
    ok(sql("select count(*) from push_subscriptions") == '1', 'one row per device')
    g.click('[data-act=push-off]'); g.wait_for_function("document.querySelector('[data-push-tag]').textContent === 'غير مفعّلة'", timeout=8000)
    ok(sql("select is_active from push_subscriptions") == 'f' and sql("select count(*) from push_subscriptions") == '1', 'turning off archives the device (kept, not deleted)')
    g.click('[data-act=push-on]'); g.wait_for_function("document.querySelector('[data-push-tag]').textContent.includes('مفعّلة على')", timeout=8000)
    ok(sql("select is_active from push_subscriptions") == 't' and sql("select count(*) from push_subscriptions") == '1', 'turning on again re-activates the same row')

    # ---------- maintenance request sent for approval -> server asked to notify
    calls.clear()
    g.goto(f'{BASE}#/requests'); g.wait_for_selector('.list-body'); g.click('[data-list-add]'); g.wait_for_selector('.modal [name=fault]')
    g.locator('.modal [name=vehicle_id]').last.select_option(value=V1); g.wait_for_timeout(200)
    g.locator('.modal [name=fault]').last.fill('عطل تجريبي في الفرامل'); g.locator('.modal [name=send]').last.check()
    g.click('.modal [data-save]'); g.wait_for_selector('.mr-sheet'); g.wait_for_timeout(800)
    rid = sql("select id from maintenance_requests where fault like 'عطل تجريبي%'")
    req = [x for x in calls if x.get('action') == 'request']
    ok(len(req) == 1 and req[0].get('id') == rid, f'sending for approval asks the server to notify approvers [{req}]')
    calls.clear()
    g.click('[data-act=new]'); g.wait_for_selector('.modal [name=fault]')
    g.locator('.modal [name=vehicle_id]').last.select_option(value=V1); g.wait_for_timeout(200)
    g.locator('.modal [name=fault]').last.fill('طلب بدون إرسال'); g.locator('.modal [name=send]').last.uncheck()
    g.click('.modal [data-save]'); g.wait_for_selector('.mr-sheet'); g.wait_for_timeout(600)
    ok(not [x for x in calls if x.get('action') == 'request'], 'a request saved without sending does not notify')
    g.click('[data-act=send]'); g.wait_for_timeout(900)
    ok(len([x for x in calls if x.get('action') == 'request']) == 1, 'pressing «إرسال للاعتماد» later notifies')
    c.close()

    # ---------- iPhone Safari outside the home-screen app: install steps instead of the button
    IPH = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
    c, g = ctx(b, 390, IPH); login(g); settings(g)
    t = g.inner_text('[data-push]')
    ok(g.inner_text('[data-push-tag]') == 'تحتاج تثبيت التطبيق' and 'إضافة إلى الشاشة الرئيسية' in t and g.locator('[data-act=push-on]').count() == 0, 'iPhone in Safari: shows the home-screen steps')
    g.locator('[data-push]').scroll_into_view_if_needed(); g.screenshot(path=f'{OUT}/2-iphone-safari.png')
    ok(g.evaluate('document.documentElement.scrollWidth') <= 391, 'mobile: no horizontal overflow')
    c.close()
    # iPhone opened from the home screen (standalone): button available
    c, g = ctx(b, 390, IPH); g.add_init_script("Object.defineProperty(navigator, 'standalone', { value: true });"); login(g); settings(g)
    ok(g.locator('[data-act=push-on]').count() == 1 or g.locator('[data-act=push-test]').count() == 1, 'iPhone home-screen app: notifications can be turned on')
    g.locator('[data-push]').scroll_into_view_if_needed(); g.screenshot(path=f'{OUT}/3-iphone-app.png')
    c.close()
    b.close()

# ---------- database rules
r = as_user('admin@test.local', "select count(*) from push_private")
ok(r.returncode != 0 or 'permission denied' in r.stderr, 'signed-in users cannot read the push keys')
r = as_user('viewer@test.local', "select count(*) from push_subscriptions")
ok(r.stdout.strip().splitlines()[-1:] == ['0'] if r.stdout.strip() else False, f'another user cannot see the admin device [{r.stdout.strip()} {r.stderr.strip()[:80]}]')
r = as_user('viewer@test.local', "select push_targets(null)")
ok('permission denied' in r.stderr, 'users cannot call push_targets (server only)')
r = as_user('viewer@test.local', "insert into push_subscriptions(endpoint,p256dh,auth_key) values ('https://x','a','b')")
ok('permission denied' in r.stderr, 'users cannot insert devices directly')
r = as_user('viewer@test.local', "select save_push_subscription('http://insecure','a','b')")
ok('PUSH_BAD_SUBSCRIPTION' in r.stderr, 'non-https endpoints are refused')
r = as_user('viewer@test.local', "select disable_push_subscription('https://push.example.test/dev-abc123')")
ok(r.stdout.strip().splitlines()[-1:] == ['f'] and sql("select is_active from push_subscriptions") == 't', "a user cannot turn off someone else's device")
ok(sql("select count(*) from push_targets(null)") == '1' and sql("select count(*) from push_targets('approve_maintenance')") == '1', 'server targets: active admin device')

for m in passed: print('ok  ', m)
for m in problems: print('FAIL', m)
print(f'PASS {len(passed)} FAIL {len(problems)}')
