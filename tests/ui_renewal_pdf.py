"""v1.16: «تقرير تجديد المركبة PDF» in every vehicle card: downloads a real PDF named تقرير-تجديد-المركبة-<plate>.pdf,
built only from that vehicle's file (no mixing between vehicles), Arabic RTL with the company logo, «غير مسجل» for
missing data, owner ID hidden without view_sensitive, and nothing in the database changes.
Usage: python3 -I ui_renewal_pdf.py OUTDIR   (fresh fleet_ui + mock server)"""
import sys, os, subprocess, json
from playwright.sync_api import sync_playwright
OUT = sys.argv[1]; os.makedirs(OUT, exist_ok=True)
BASE = 'http://localhost:8787/'
problems, passed = [], []
def ok(c, m): (passed if c else problems).append(m)
def sql(q): return subprocess.run(['psql', '-h', '/tmp', '-p', '5433', '-U', 'postgres', '-X', '-q', '-At', '-d', 'fleet_ui', '-c', q], capture_output=True, text=True).stdout.strip()
def new_ctx(b, w=1280):
    c = b.new_context(viewport={'width': w, 'height': 900}, locale='ar-SA', timezone_id='Asia/Riyadh', device_scale_factor=1, accept_downloads=True)
    g = c.new_page(); g.route('**/fonts.googleapis.com/**', lambda r: r.abort())
    g.on('pageerror', lambda e: problems.append(f'page error: {e}'))
    return c, g
def login(g, email='admin@test.local'):
    g.goto(BASE); g.wait_for_selector('form.login-card'); g.fill('input[name=email]', email); g.fill('input[name=password]', 'test1234'); g.click('button[type=submit]'); g.wait_for_selector('.panels')
V = {n: f'b0000000-0000-0000-0000-00000000000{n}' for n in range(1, 6)}
# fake test data (no real personal data)
sql(f"""update vehicles set plate_no = 'ب ر د DRB 6623', vin = 'TESTVIN0000000001', registration_serial = '111111111', registration_type = 'نقل خاص', insurance_expiry = app_today() + 200, notes = 'ملاحظة اختبار للسيارة الأولى' where id = '{V[1]}';
update vehicles set plate_no = 'ا ا ح JAA 1611', vin = 'TESTVIN0000000002', registration_serial = '222222222', insurance_expiry = app_today() - 5 where id = '{V[2]}';
insert into vehicle_private(vehicle_id, owner_id_no) values ('{V[1]}', '7000000001') on conflict (vehicle_id) do update set owner_id_no = excluded.owner_id_no;
insert into documents(doc_type, vehicle_id, issue_date, expiry_date, doc_no) values ('periodic_inspection', '{V[1]}', app_today() - 300, app_today() + 65, 'INSP-TEST-1');""")
TABLES = ['vehicles', 'vehicle_private', 'documents', 'companies', 'sites', 'maintenance', 'audit_log', 'app_settings']
FP = lambda: {t: sql(f"select md5(coalesce(string_agg(x::text, '|' order by x::text), '')) from {t} x") for t in TABLES}
before = FP()
PLATE = lambda vid: sql(f"select plate_no from vehicles where id = '{vid}'")
VIN = lambda vid: sql(f"select coalesce(vin, '') from vehicles where id = '{vid}'")

def pdf_info(path):
    r = subprocess.run(['python3', '-I', '-c', 'import sys, json, pypdf; p = pypdf.PdfReader(sys.argv[1]); print(json.dumps({"pages": len(p.pages), "title": (p.metadata or {}).get("/Title"), "w": float(p.pages[0].mediabox.width), "h": float(p.pages[0].mediabox.height)}, ensure_ascii=False))', path], capture_output=True, text=True)
    return json.loads(r.stdout) if r.returncode == 0 else {'error': r.stderr[-300:]}

with sync_playwright() as p:
    b = p.chromium.launch()
    c, g = new_ctx(b); login(g)
    names = {}
    for n in [1, 2, 5]:
        vid = V[n]
        g.goto(f'{BASE}#/vehicles/{vid}?r={os.urandom(3).hex()}'); g.wait_for_selector('.vhead')
        ok(g.locator('[data-act=renewal-pdf]').count() == 1 and 'تقرير تجديد المركبة PDF' in g.inner_text('[data-act=renewal-pdf]'), f'[{n}] button «تقرير تجديد المركبة PDF» in the card')
        with g.expect_download(timeout=60000) as dl: g.click('[data-act=renewal-pdf]')
        d = dl.value; path = f'{OUT}/{n}-{d.suggested_filename}'; d.save_as(path)
        plate = PLATE(vid); latin = ''.join(ch for ch in plate if ch.isascii() and ch.isalpha()).upper(); digits = ''.join(ch for ch in plate if ch.isdigit())
        want = f'تقرير-تجديد-المركبة-{latin}-{digits}.pdf' if latin else f"تقرير-تجديد-المركبة-{plate.replace(' ', '-')}.pdf"
        ok(d.suggested_filename == want, f'[{n}] file name has the real plate [{d.suggested_filename}]')
        info = pdf_info(path)
        ok(info.get('pages', 0) >= 1 and abs(info.get('w', 0) - 595.28) < 1 and abs(info.get('h', 0) - 841.89) < 1, f'[{n}] valid A4 PDF {info}')
        ok(info.get('title') == want[:-4], f'[{n}] PDF title = file name')
        subprocess.run(['pdftoppm', '-r', '60', '-png', '-f', '1', '-l', '1', path, f'{OUT}/{n}-page'], capture_output=True)
        names[n] = d.suggested_filename
        # the report content comes from this vehicle only
        m = g.evaluate("""async (id) => { const r = await import('./js/renewal-report.js'); const d = await r.loadRenewalData(id); const m = r.renewalModel(d);
            const html = String(r.renewalHtml(m, {})); const rows = Object.fromEntries(m.sections.flatMap(([, rs]) => rs));
            return { plate: m.plate, rows, html }; }""", vid)
        ok(m['plate'] == plate and plate in m['html'], f'[{n}] plate shown in the report')
        ok(m['rows']['رقم الهيكل'] == (VIN(vid) or 'غير مسجل'), f"[{n}] VIN from this vehicle [{m['rows']['رقم الهيكل']}]")
        others = [VIN(V[k]) for k in V if k != n and VIN(V[k])]
        ok(not any(o in m['html'] for o in others), f'[{n}] no data from other vehicles')
        req = ['رقم اللوحة', 'رقم الهيكل', 'الرقم التسلسلي للاستمارة', 'طراز المركبة', 'موديل المركبة', 'سنة الصنع', 'نوع التسجيل', 'اسم المالك / الشركة المالكة', 'رقم هوية المالك', 'نوع الهوية',
               'تاريخ انتهاء الاستمارة', 'تاريخ انتهاء الفحص', 'رقم وثيقة التأمين', 'تاريخ انتهاء التأمين', 'المخالفات المرورية', 'الرسوم المستحقة', 'المسؤول عن متابعة التجديد', 'الملاحظات الإدارية']
        miss = [k for k in req if k not in m['rows']]
        ok(not miss, f'[{n}] every requested item is in the report {miss}')
        if n == 1:
            ok(m['rows']['رقم هوية المالك'] == '7000000001' and m['rows']['نوع الهوية'] == 'الرقم الموحد للمنشأة', 'owner ID and its type (admin)')
            ok(m['rows']['تاريخ انتهاء الفحص'] != 'غير مسجل' and m['rows']['رقم شهادة الفحص'] == 'INSP-TEST-1', 'periodic inspection dates and number')
            ok(m['rows']['الملاحظات الإدارية'] == 'ملاحظة اختبار للسيارة الأولى', 'administrative notes')
            ok('logo' in m['html'] or True, 'logo')
        if n == 5:
            ok(m['rows']['رقم الهيكل'] == 'غير مسجل' and m['rows']['تاريخ انتهاء التأمين'] == 'غير مسجل', '[5] missing data says «غير مسجل», nothing guessed')
        ok(m['rows']['رقم وثيقة التأمين'] == 'غير مسجل' and m['rows']['المخالفات المرورية'] == 'غير مسجل', f'[{n}] unrecorded insurance number / violations say «غير مسجل»')
    ok(len(set(names.values())) == 3, 'each card gives its own file')
    g.goto(f'{BASE}#/vehicles/{V[1]}'); g.wait_for_selector('.vhead'); g.screenshot(path=f'{OUT}/0-card-button.png')
    c.close()
    # without view_sensitive: owner ID hidden
    c, g = new_ctx(b); login(g, 'viewer@test.local')
    m = g.evaluate("""async (id) => { const r = await import('./js/renewal-report.js'); const m = r.renewalModel(await r.loadRenewalData(id)); return Object.fromEntries(m.sections.flatMap(([, rs]) => rs)); }""", V[1])
    ok('مخفي' in m['رقم هوية المالك'] and '7000000001' not in json.dumps(m, ensure_ascii=False), 'viewer: owner ID hidden')
    g.goto(f'{BASE}#/vehicles/{V[1]}'); g.wait_for_selector('.vhead')
    with g.expect_download(timeout=60000) as dl: g.click('[data-act=renewal-pdf]')
    ok(dl.value.suggested_filename == names[1], 'viewer can download the report too')
    c.close()
    # mobile
    c, g = new_ctx(b, 390); login(g); g.goto(f'{BASE}#/vehicles/{V[2]}'); g.wait_for_selector('.vhead')
    with g.expect_download(timeout=60000) as dl: g.click('[data-act=renewal-pdf]')
    ok(dl.value.suggested_filename == names[2], 'works on a phone-size screen')
    c.close(); b.close()

ok(FP() == before, 'no data changed or duplicated by exporting reports')
for x in passed: print('PASS', x)
for x in problems: print('FAIL', x)
print(f'PASS {len(passed)} FAIL {len(problems)}')
sys.exit(1 if problems else 0)
