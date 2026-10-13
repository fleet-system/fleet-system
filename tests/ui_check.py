"""Headless browser check of the web UI against the local test server.
Usage: python3 -I ui_check.py OUTDIR"""
import sys, os
from playwright.sync_api import sync_playwright
import datetime as _dt, zoneinfo as _zi
_T0 = _dt.datetime.now(_zi.ZoneInfo('Asia/Riyadh')).date()
def _d(n=0, sep='/'): return (_T0 + _dt.timedelta(days=n)).strftime(f'%Y{sep}%m{sep}%d')

OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)
BASE = 'http://localhost:8787/'
problems = []

def watch(page, tag):
    page.on('console', lambda m: m.type in ('error', 'warning') and 'ERR_FAILED' not in m.text and not (tag and '400' in m.text) and problems.append(f'[{tag}] console {m.type}: {m.text}'))
    page.on('pageerror', lambda e: problems.append(f'[{tag}] page error: {e}'))

with sync_playwright() as p:
    b = p.chromium.launch()
    for tag, vp in [('mobile', {'width': 390, 'height': 844}), ('desktop', {'width': 1360, 'height': 900})]:
        ctx = b.new_context(viewport=vp, device_scale_factor=2 if tag == 'mobile' else 1, locale='ar-SA', timezone_id='Asia/Riyadh')
        pg = ctx.new_page(); watch(pg, tag)
        pg.route('**/fonts.googleapis.com/**', lambda r: r.abort())
        pg.goto(BASE)
        pg.wait_for_selector('form.login-card')
        pg.screenshot(path=f'{OUT}/{tag}-1-login.png')
        # wrong password
        pg.fill('input[name=email]', 'admin@test.local'); pg.fill('input[name=password]', 'wrong')
        pg.click('button[type=submit]'); pg.wait_for_selector('.form-error:not([hidden])')
        err = pg.inner_text('.form-error')
        if 'غير صحيحة' not in err: problems.append(f'[{tag}] wrong-password message: {err}')
        # right password
        pg.fill('input[name=password]', 'test1234'); pg.click('button[type=submit]')
        pg.wait_for_selector('.panels'); pg.wait_for_selector('.bell .badge:not([hidden])')
        pg.screenshot(path=f'{OUT}/{tag}-2-dashboard.png', full_page=True)
        txt = pg.inner_text('#page')
        for must in ['لوحة التحكم', 'المهام التي تحتاج إلى متابعة', 'تجاوز' if False else 'متجاوز بـ 400 كم', 'منتهية منذ 4 يوم', _d(6)]:
            if must not in txt: problems.append(f'[{tag}] dashboard missing: {must}')
        if pg.inner_text('.tb-date') != _d(): problems.append(f"[{tag}] date shows {pg.inner_text('.tb-date')}")
        # bell
        pg.click('[data-act=bell]'); pg.wait_for_selector('.pop-bell:not([hidden]) .alert-item')
        pg.screenshot(path=f'{OUT}/{tag}-3-bell.png')
        pg.keyboard.press('Escape')
        # filter: nursery company only
        pg.select_option('select[name=company]', label='شركة عبد الرحمن الفهاد')
        pg.wait_for_function("document.querySelector('.big .num') && document.querySelector('.big .num').textContent.trim() === '1'")
        if 'مشتل الغملاس' not in pg.inner_text('select[name=site]'): problems.append(f'[{tag}] site filter not narrowed')
        pg.select_option('select[name=company]', value='')
        # year is open: step back to 2025 and type 2031
        pg.click('.step[data-step="-1"]'); pg.wait_for_selector('text=2025/10')
        pg.fill('input[name=year]', '2031'); pg.press('input[name=year]', 'Enter'); pg.wait_for_selector('text=2031/10')
        pg.fill('input[name=year]', '2026'); pg.press('input[name=year]', 'Enter'); pg.wait_for_selector('text=2026/10')
        # search
        pg.fill('form.search input', '5678'); pg.press('form.search input', 'Enter')
        pg.wait_for_selector('text=نتائج البحث'); pg.wait_for_selector('td.plate')
        pg.screenshot(path=f'{OUT}/{tag}-4-search.png', full_page=True)
        if tag == 'mobile':
            pg.click('[data-act=more]'); pg.wait_for_selector('.sheet:not([hidden])')
            pg.screenshot(path=f'{OUT}/{tag}-5-more.png')
            pg.click('.sheet-link[data-nav=reports]'); pg.wait_for_selector('.rep-head')
        else:
            pg.click('.sidebar [data-nav=excel]'); pg.wait_for_selector('.exp-grid')
        pg.screenshot(path=f'{OUT}/{tag}-6-nav.png')
        # reload keeps the session
        pg.goto(BASE + '#/dashboard'); pg.wait_for_selector('.panels')
        # sign out
        if tag == 'desktop':
            pg.click('.sidebar [data-act=signout]')
        else:
            pg.click('[data-act=more]'); pg.click('.sheet [data-act=signout]')
        pg.wait_for_selector('form.login-card')
        ctx.close()
    # viewer account sees data but no admin features (same page works)
    ctx = b.new_context(viewport={'width': 390, 'height': 844}); pg = ctx.new_page(); watch(pg, 'viewer')
    pg.route('**/fonts.googleapis.com/**', lambda r: r.abort())
    pg.goto(BASE); pg.fill('input[name=email]', 'viewer@test.local'); pg.fill('input[name=password]', 'test1234')
    pg.click('button[type=submit]'); pg.wait_for_selector('.panels')
    if 'مستخدم للعرض' not in pg.inner_text('.tb-user'): problems.append('[viewer] name not shown')
    b.close()

print('\n'.join(problems) if problems else 'ALL UI CHECKS PASSED')
