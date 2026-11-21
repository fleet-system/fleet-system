"""v1.37/1.38: «مكتب الأسطول الذكي» (المدير + 8 موظفين ذكاء اصطناعي روبوتات، غرفة المتابعة، مكتب ثلاثي الأبعاد). بيانات وهمية فقط.
يتحقق من: الصفحة في القائمة، 8 مكاتب، اللمبة والعدد من البيانات، تفاصيل الموظف، طلب للمديرة يتوزع ويتسجل،
«موافق» للمسؤول فقط ويغير الحالة، الملخص الصباحي ومكتبة الأسبوع من office_reports، المشاهد ما يقدر يوافق،
وما فيه تمدد أفقي في الجوال.
Usage: python3 -I ui_office.py OUTDIR   (fresh fleet_ui + mock server)"""
import sys, os, subprocess, json
from playwright.sync_api import sync_playwright
OUT = sys.argv[1]; os.makedirs(OUT, exist_ok=True)
BASE = 'http://localhost:8787/'
problems, passed = [], []
def ok(c, m): (passed if c else problems).append(m)
def sql(q): return subprocess.run(['psql', '-h', '/tmp', '-p', '5433', '-U', 'postgres', '-X', '-q', '-At', '-d', 'fleet_ui', '-c', q], capture_output=True, text=True).stdout.strip()

V1 = 'b0000000-0000-0000-0000-000000000001'
sql(f"insert into cost_lines(category, source_sheet, source_row, vehicle_id, plate_text, line_date, description, amount, payment_status, supplier, is_active, synced_at) values "
    f"('maintenance','m',1,'{V1}','P1', app_today() - 5, 'قطع', 500, 'غير مدفوع', 'ورشة تجربة', true, now() - interval '10 days'),"
    f"('maintenance','m',2,'{V1}','P1', app_today() - 4, 'شغل يد', 200, 'مدفوع', 'ورشة تجربة', true, now() - interval '10 days')")
sql("insert into office_tasks(agent, title, status, needs_note) values ('docs', 'تجديد تأمين تجربة', 'needs_you', 'أوافق على تجديد التأمين؟')")
sql("insert into office_tasks(agent, title, status, result, done_at) values ('reports', 'كشف تجربة', 'done', 'تم', now())")
brief = {'summary': 'صباح الخير، ملخص تجربة', 'today': [{'agent': 'oil', 'text': 'زيت تجربة اليوم'}], 'broke': [{'agent': 'excel', 'text': 'مزامنة تجربة متوقفة'}], 'needs_you': []}
week = {'done': ['أنجزنا تجربة'], 'improve': ['نحسن تجربة'], 'levels': ['عبير وصلت Lv2']}
sql(f"insert into office_reports(kind, report_date, body) values ('daily', app_today(), '{json.dumps(brief, ensure_ascii=False)}'::jsonb), ('weekly', app_today(), '{json.dumps(week, ensure_ascii=False)}'::jsonb)")
before_costs = sql("select md5(string_agg(t::text, '|' order by t::text)) from cost_lines t")

def login(g, who):
    g.goto(BASE); g.wait_for_selector('form.login-card'); g.fill('input[name=email]', who); g.fill('input[name=password]', 'test1234'); g.click('button[type=submit]'); g.wait_for_selector('.panels')

with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
    for w in (390, 1360):
        c = b.new_context(viewport={'width': w, 'height': 900}, locale='ar-SA', timezone_id='Asia/Riyadh')
        g = c.new_page(); g.route('**/fonts.googleapis.com/**', lambda r: r.abort())
        g.on('pageerror', lambda e: problems.append(f'page error: {e}'))
        login(g, 'admin@test.local')
        if w > 1000: ok(g.locator('.sidebar [data-nav=office]').count() == 1, 'menu: «مكتب الأسطول» in the side menu')
        else:
            g.click('[data-act=more]'); ok(g.locator('.sheet [data-nav=office]').count() == 1, 'mobile: «مكتب الأسطول» in «المزيد»'); g.keyboard.press('Escape')
        g.goto(f'{BASE}#/office'); g.wait_for_selector('[data-office]')
        ok(g.locator('.of-room').count() == 9, f'[{w}] manager + 8 AI employees')
        ok([g.locator(f'.of-room[data-agent={a}]').count() for a in ('fleet', 'maintenance', 'oil', 'docs', 'accidents', 'expenses', 'reports', 'purchasing')] == [1] * 8, f'[{w}] the 8 new roles')
        cu = g.locator('.of-room[data-agent=expenses]')
        ok('of-working' in (cu.get_attribute('class') or '') and int(cu.locator('[data-busy]').inner_text()) >= 2, f'[{w}] expenses: unpaid invoice + stale sync')
        ok(g.locator('[data-ops] .ops-ag').count() == 8 and g.locator('.ops-net [data-node]').count() == 9 and g.locator('.ops-pix').count() == 1, f'[{w}] ops room: 8 panels, 9 network nodes, pixel floor')
        ok(g.locator('[data-feed] li').count() >= 2 and 'يراجع' in g.inner_text('[data-feed]') and 'مزامنة' in g.inner_text('[data-feed]'), f'[{w}] live feed lists real findings')
        ok(g.inner_text('[data-kpi=waiting]').strip() == '1', f'[{w}] KPI: 1 waiting for approval')
        ok(g.locator('[data-cap] tbody tr').count() == 8, f'[{w}] implemented vs needs-development table')
        ok('of-waiting' in (g.locator('.of-room[data-agent=docs]').get_attribute('class') or ''), f'[{w}] docs waiting for approval')
        ok('of-deliver' in (g.locator('.of-room[data-agent=reports]').get_attribute('class') or ''), f'[{w}] reports delivered today (walks to the manager)')
        ok('of-idle' in (g.locator('.of-room[data-agent=purchasing]').get_attribute('class') or ''), f'[{w}] purchasing idle')
        ok('مزامنة' in g.inner_text('[data-feed]') + g.inner_text('[data-brief]'), f'[{w}] stale Excel sync flagged')
        ok('ملخص تجربة' in g.inner_text('[data-brief]') and 'مزامنة تجربة متوقفة' in g.inner_text('[data-brief]'), f'[{w}] morning brief from office_reports')
        ok('نحسن تجربة' in g.inner_text('[data-weekly]'), f'[{w}] weekly library shown')
        ok(g.locator('[data-needs] [data-task]').count() == 1, f'[{w}] one task needs you')
        ok(g.evaluate('document.documentElement.scrollWidth') <= w, f'[{w}] no horizontal overflow')
        g.screenshot(path=f'{OUT}/office-{w}.png', full_page=False)
        g.locator('.of-room[data-agent=expenses]').click(); g.wait_for_selector('[data-detail=expenses]')
        ok('ورشة تجربة' in g.inner_text('[data-detail=expenses]'), f'[{w}] expenses detail lists the unpaid invoice')
        g.screenshot(path=f'{OUT}/office-detail-{w}.png', full_page=True)
        g.click('[data-detail] [data-close]'); ok(g.locator('[data-detail]').count() == 0, f'[{w}] detail closes')
        if w > 1000:
            # طلب للمديرة: يتوزع تلقائياً حسب الكلمات
            g.fill('.of-form textarea', 'السيارة P1 تحتاج غيار زيت وكفرات')
            ok(g.input_value('.of-form select[name=agent]') == 'oil', 'manager routes the request to oil')
            g.click('.of-form button[type=submit]'); g.wait_for_timeout(1500); g.wait_for_selector('[data-office]')
            ok(sql("select agent||'|'||status from office_tasks where title like 'السيارة P1%'") == 'oil|new', 'task saved: oil, new')
            # موافق
            g.fill('[data-needs] .of-note', 'تمام')
            g.click('[data-needs] [data-decide=approved]'); g.wait_for_timeout(1500)
            ok(sql("select status||'|'||decision||'|'||decision_note from office_tasks where title = 'تجديد تأمين تجربة'") == 'working|approved|تمام', 'approve -> working, approved, note saved')
            ok(g.locator('[data-needs] [data-task]').count() == 0, 'needs-you list empty after approval')
        c.close()
    # المشاهد: يشوف المكتب بدون أزرار موافقة، وما يقدر يوافق من الخادم
    sql("insert into office_tasks(agent, title, status) values ('docs', 'مهمة للمشاهد', 'needs_you')")
    c = b.new_context(viewport={'width': 1360, 'height': 900}, locale='ar-SA'); g = c.new_page()
    login(g, 'viewer@test.local'); g.goto(f'{BASE}#/office'); g.wait_for_selector('[data-office]')
    ok(g.locator('[data-needs] [data-decide]').count() == 0, 'viewer: no approve buttons')
    tid = sql("select id from office_tasks where title = 'مهمة للمشاهد'")
    r = g.evaluate("""async (id) => { const m = await import('./js/api.js'); try { await m.rpc('office_decide', { p_id: id, p_decision: 'approved' }); return 'ok'; } catch (e) { return 'denied'; } }""", tid)
    ok(r == 'denied' and sql(f"select status from office_tasks where id = '{tid}'") == 'needs_you', 'viewer: office_decide denied by the server')
    c.close()
    # المكتب الثلاثي الأبعاد (الاختبارات الآلية تتخطاه افتراضياً؛ هنا نفعّله ونتأكد أنه يشتغل بدون أخطاء)
    c = b.new_context(viewport={'width': 1360, 'height': 900}, locale='ar-SA'); g = c.new_page(); g.route('**/fonts.googleapis.com/**', lambda r: r.abort())
    errs = []; g.on('pageerror', lambda e: errs.append(str(e)))
    g.add_init_script('window.__office3d = true')
    login(g, 'admin@test.local'); g.goto(f'{BASE}#/office'); g.wait_for_selector('[data-office]')
    try: g.wait_for_selector('.o3-chip', timeout=60000)
    except Exception: pass
    ok(g.locator('.o3-chip').count() == 9 and g.locator('#o3 canvas').count() >= 1, '3D office: canvas + 9 name chips')
    ok(g.locator('.of-room img.of-pic').count() == 9, '3D office: robot portraits on the 9 cards')
    g.evaluate("document.querySelector('.o3-chip[data-chip=docs]').click()"); g.wait_for_timeout(800)
    ok(g.locator('[data-detail=docs]').count() == 1, '3D office: clicking a chip opens the employee file')
    ok(not errs, f'3D office: no page errors {errs[:2]}')
    g.wait_for_timeout(1500); g.screenshot(path=f'{OUT}/office-3d.png')
    c.close(); b.close()

ok(sql("select md5(string_agg(t::text, '|' order by t::text)) from cost_lines t") == before_costs, 'office never writes to cost_lines')
for m in passed: print('ok  ', m)
for m in problems: print('FAIL', m)
print(f'PASS {len(passed)} FAIL {len(problems)}')
