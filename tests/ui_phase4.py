"""Phase 4 browser test: oil, maintenance (multi items + VAT), accidents, handovers (+approve, print).
Requires fresh fleet_ui DB and mock server. Usage: python3 -I ui_phase4.py OUTDIR"""
import sys, os
from playwright.sync_api import sync_playwright

OUT = sys.argv[1]; os.makedirs(OUT, exist_ok=True)
BASE = 'http://localhost:8787/'
V2 = 'b0000000-0000-0000-0000-000000000002'
problems, passed = [], []
def ok(c, m): (passed if c else problems).append(m)

def login(pg, email):
    pg.goto(BASE); pg.wait_for_selector('form.login-card')
    pg.fill('input[name=email]', email); pg.fill('input[name=password]', 'test1234'); pg.click('button[type=submit]'); pg.wait_for_selector('.panels')

def fill(pg, vals):
    for n, v in vals.items():
        el = pg.locator(f'.modal [name="{n}"]').first
        if el.evaluate('e => e.tagName') == 'SELECT': el.select_option(value=v)
        elif el.get_attribute('type') == 'checkbox': el.check() if v else el.uncheck()
        else: el.fill(v)

def save_ok(pg):
    pg.click('.modal [data-save]'); pg.wait_for_selector('.modal', state='detached')

def open_vehicle(pg, tab='basic'):
    pg.goto(f'{BASE}#/vehicles/{V2}?tab={tab}&r={os.urandom(3).hex()}'); pg.wait_for_selector('.vhead')

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, locale='ar-SA', timezone_id='Asia/Riyadh')
    pg = ctx.new_page()
    pg.on('pageerror', lambda e: problems.append(f'page error: {e}'))
    pg.on('console', lambda m: m.type == 'error' and 'ERR_FAILED' not in m.text and '400' not in m.text and problems.append(f'console: {m.text}'))
    pg.route('**/fonts.googleapis.com/**', lambda r: r.abort())
    login(pg, 'admin@test.local')

    # ---------------- oil change from vehicle file ----------------
    open_vehicle(pg)
    pg.click('.vactions [data-act=oil]'); pg.wait_for_selector('.modal')
    ok(pg.input_value('.modal [name=odometer]') == '61400', 'oil form prefilled with current odometer')
    ok(pg.input_value('.modal [name=interval_km]') == '10000', 'oil interval default 10,000')
    fill(pg, {'workshop': 'ورشة تجريبية', 'oil_type': '5W-30', 'filter_type': 'أصلي', 'oil_cost': '150', 'filter_cost': '40', 'extra_cost': '10.5'})
    pg.wait_for_timeout(150); t = pg.inner_text('.modal [data-live=calc]')
    ok('71,400' in t and '200.50' in t, 'live preview: next 71,400 and total 200.50')
    pg.screenshot(path=f'{OUT}/p4-oil-form.png')
    save_ok(pg); pg.wait_for_selector('.vhead')
    ok('71,400' in pg.inner_text('.vfacts') and 'لم يحن' in pg.inner_text('.vfacts'), 'header shows next oil 71,400 and status not due')
    open_vehicle(pg, 'oil'); t = pg.inner_text('.tab-panel.on')
    ok('OIL-' in t and '200.50' in t and '10,000' in t, 'oil tab lists record and remaining 10,000')

    # ---------------- maintenance with multiple items + VAT ----------------
    pg.click('.tabbtn[data-tab=maint]'); pg.click('[data-panel=maint] [data-act=maint]'); pg.wait_for_selector('.modal')
    fill(pg, {'maint_type': 'فرامل', 'workshop': 'ورشة تجريبية', 'fault_description': 'صوت في الفرامل'})
    rows = pg.locator('.modal .item-row')
    rows.nth(0).locator('[name=it_desc]').fill('فحمات'); rows.nth(0).locator('[name=it_qty]').fill('2'); rows.nth(0).locator('[name=it_price]').fill('150')
    pg.click('.modal [data-add-item]'); r2 = pg.locator('.modal .item-row').nth(1)
    r2.locator('[name=it_kind]').select_option('labor'); r2.locator('[name=it_desc]').fill('أجور تركيب'); r2.locator('[name=it_price]').fill('100')
    fill(pg, {'with_vat': True, 'status_after': 'working', 'apply_status': True})
    pg.wait_for_timeout(150); t = pg.inner_text('.modal [data-live=calc]')
    ok('300.00' in t and '100.00' in t and '60.00' in t and '460.00' in t, 'maintenance live: parts 300 + labor 100 + VAT 60 = 460')
    pg.screenshot(path=f'{OUT}/p4-maint-form.png')
    save_ok(pg); open_vehicle(pg, 'maint'); t = pg.inner_text('.tab-panel.on')
    ok('MNT-' in t and '460.00' in t and '400.00' in t and '60.00' in t, 'maintenance saved with subtotal 400, VAT 60, total 460')
    # edit: change items -> totals recalculated
    pg.click('.tab-panel.on [data-act=maint-edit]'); pg.wait_for_selector('.modal')
    ok(pg.locator('.modal .item-row').count() == 2, 'edit loads existing 2 items')
    pg.locator('.modal .item-row').nth(0).locator('[name=it_qty]').fill('3'); fill(pg, {'with_vat': False})
    save_ok(pg); open_vehicle(pg, 'maint'); t = pg.inner_text('.tab-panel.on')
    ok('550.00' in t, 'edited maintenance recalculated: 3×150 + 100 = 550, no VAT')

    # ---------------- accident ----------------
    pg.click('.vactions [data-act=acc]'); pg.wait_for_selector('.modal')
    fill(pg, {'occurred_at__t': '2599'}); fill(pg, {'description': 'اصطدام تجريبي'})
    pg.click('.modal [data-save]'); pg.wait_for_selector('.modal .form-error:not([hidden])')
    ok('HH:mm' in pg.inner_text('.modal .form-error'), 'invalid time rejected')
    fill(pg, {'occurred_at': '2026/10/11', 'occurred_at__t': '0930', 'parts_cost': '1000', 'labor_cost': '500', 'damages': 'الصدام الأمامي'})
    ok(pg.input_value('.modal [name=occurred_at__t]') == '09:30', 'time auto-formats 0930 -> 09:30')
    ok(pg.input_value('.modal [name=vehicle_status]') == 'accident_damaged', 'new accident proposes vehicle status متضررة بحادث')
    save_ok(pg); pg.wait_for_selector('.vhead')
    ok('متضررة بحادث' in pg.inner_text('.vhead'), 'vehicle status changed to accident damaged')
    open_vehicle(pg, 'acc'); t = pg.inner_text('.tab-panel.on')
    ok('2026/10/11 09:30' in t and '1,500.00' in t, 'accident saved with Riyadh time 09:30 and total 1,500')
    pg.click('.tab-panel.on [data-act=acc-edit]'); pg.wait_for_selector('.modal')
    fill(pg, {'status': 'completed'}); pg.wait_for_timeout(100)
    ok(pg.input_value('.modal [name=vehicle_status]') == 'working', 'completing accident proposes vehicle status تعمل')
    fill(pg, {'repair_start_date': '2026/10/12', 'repair_end_date': '2026/10/11'})
    pg.click('.modal [data-save]'); pg.wait_for_selector('.modal .form-error:not([hidden])')
    ok('قبل تاريخ بدئه' in pg.inner_text('.modal .form-error'), 'repair end before start rejected')
    fill(pg, {'repair_end_date': '2026/10/12', 'back_to_work_date': '2026/10/12'}); save_ok(pg); pg.wait_for_selector('.vhead')
    ok('تعمل' in pg.inner_text('.vhead .vhead-main'), 'vehicle back to working; accident kept')
    open_vehicle(pg, 'acc'); ok('مكتمل' in pg.inner_text('.tab-panel.on'), 'accident status completed kept in history')

    # ---------------- handover deliver + approve ----------------
    pg.click('.vactions [data-act=hand]'); pg.wait_for_selector('.modal')
    ok(pg.input_value('.modal [name=from_employee_id]') == 'e0000000-0000-0000-0000-000000000002', 'handover from = current driver')
    fill(pg, {'to_employee_id': 'e0000000-0000-0000-0000-000000000005', 'odometer': '61500', 'fuel_level': 'half', 'body_condition': 'سليم', 'tires_condition': 'جيدة', 'approve': True})
    pg.screenshot(path=f'{OUT}/p4-hand-form.png')
    save_ok(pg); pg.wait_for_selector('.vhead')
    vf = pg.inner_text('.vfacts')
    ok('مشرف تجريبي' in vf and '61,500' in vf, 'approved handover moved driver and updated odometer')
    open_vehicle(pg, 'driver'); t = pg.inner_text('.tab-panel.on')
    ok('سائق تجريبي 2' in t and 'HO-' in t, 'previous driver kept in history linked to form')

    # draft then approve from list
    pg.goto(BASE + '#/dashboard'); pg.wait_for_selector('.panels')
    pg.click('[data-act=add]'); pg.click('.pop-add a[href="#/handovers?new=1"]'); pg.wait_for_selector('.modal')
    fill(pg, {'vehicle_id': 'b0000000-0000-0000-0000-000000000005', 'kind': 'deliver', 'to_employee_id': 'e0000000-0000-0000-0000-000000000003', 'approve': False})
    save_ok(pg); pg.wait_for_selector('.list-body')
    ok('مسودة' in pg.inner_text('.list-body'), 'draft handover listed')
    pg.locator('[data-row-act=approve]').first.click(); pg.click('.modal [data-yes]'); pg.wait_for_timeout(600)
    pg.wait_for_selector('.list-body'); ok(pg.locator('[data-row-act=approve]').count() == 0, 'draft approved from list')
    pg.goto(BASE + '#/vehicles/b0000000-0000-0000-0000-000000000005'); pg.wait_for_selector('.vhead')
    ok('سائق تجريبي 3' in pg.inner_text('.vfacts'), 'approval assigned the new driver')
    pg.goto(BASE + '#/handovers'); pg.wait_for_selector('.list-body')
    pg.locator('[data-row-act=print]').first.click(); pg.wait_for_selector('.official')
    t = pg.inner_text('.official')
    ok('نموذج تسليم سيارة' in t and 'HO-' in t and 'شركة روى الرمال الزراعية' in t and 'غير معتمد' not in t, 'official print form shows company, number, approved')
    pg.screenshot(path=f'{OUT}/p4-print.png', full_page=True)

    # ---------------- list pages ----------------
    pg.goto(BASE + '#/oil'); pg.wait_for_selector('.list-body')
    ok(pg.locator('.list-body tbody tr').count() == 4, 'oil list: 3 seed + 1 new')
    pg.select_option('#page select[name=extra]', 'soon'); pg.wait_for_timeout(150)
    ok(pg.locator('.list-body tbody tr').count() == 1, 'oil status filter (soon = VEH-0001, 700 km left) works')
    pg.select_option('#page select[name=extra]', '')
    pg.goto(BASE + '#/maintenance'); pg.wait_for_selector('.list-total')
    ok('1,930.00' in pg.inner_text('.list-total'), 'maintenance list total 1,380 + 550 = 1,930')
    pg.screenshot(path=f'{OUT}/p4-maint-list.png')
    pg.goto(BASE + '#/accidents'); pg.wait_for_selector('.list-body')
    pg.select_option('#page select[name=extra]', 'completed'); pg.wait_for_timeout(150)
    ok(pg.locator('.list-body tbody tr').count() == 1, 'accident status filter works')

    # dashboard reflects new costs this month
    pg.goto(BASE + '#/dashboard'); pg.wait_for_selector('.panels')
    t = pg.inner_text('.costs')
    ok('1,930.00' in t and '480.50' in t, 'dashboard month costs updated (maintenance 1,930, oil 280+200.50)')
    ctx.close()

    # viewer cannot add
    ctx = b.new_context(viewport={'width': 390, 'height': 844}); pg = ctx.new_page(); pg.route('**/fonts.googleapis.com/**', lambda r: r.abort())
    login(pg, 'viewer@test.local')
    pg.goto(BASE + '#/oil'); pg.wait_for_selector('.list-body')
    ok(pg.locator('[data-list-add]').count() == 0 and pg.locator('[data-row-act=edit]').count() == 0, 'viewer: no add/edit on oil list')
    pg.goto(f'{BASE}#/vehicles/{V2}'); pg.wait_for_selector('.vhead')
    ok(pg.locator('.vactions [data-act=oil]').count() == 0, 'viewer: no add buttons in vehicle file')
    b.close()

print(f'PASSED {len(passed)}')
for m in problems: print('FAIL:', m)
print('ALL PHASE 4 CHECKS PASSED' if not problems else f'{len(problems)} problem(s)')
