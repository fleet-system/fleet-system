import * as api from '../api.js';
import { html, icon } from '../ui.js';
import { errorText } from '../fmt.js';
import { startWelcome } from '../welcome3d.js';

export function renderLogin(root, onDone) {
  document.title = 'تسجيل الدخول — نظام إدارة الأسطول';
  root.innerHTML = html`
    <div class="login">
      <div class="w3d" data-w3d aria-hidden="true"><div class="w3d-fallback"></div></div>
      <div class="login-side" aria-hidden="true">
        <div class="rows"><span></span><span></span><span></span><span></span><span></span><span></span><span></span></div>
        <div class="w3d-hero">
          <span class="w3d-kicker">شركة روى الرمال الزراعية</span>
          <p class="w3d-title"><span>أسطولك</span> <span>كله</span> <span>في</span> <span>شاشة</span> <span>وحدة</span></p>
          <p class="w3d-sub">السيارات والمعدات والوثائق والصيانة في مزارع الغملاس والبركة وارم، لحظة بلحظة.</p>
          <ul class="w3d-stats"><li><b>24/7</b><span>متابعة مباشرة</span></li><li><b>3</b><span>مزارع ومشتل</span></li><li><b>PDF</b><span>تقارير جاهزة</span></li></ul>
        </div>
      </div>
      <form class="login-card" novalidate>
        <div class="login-brand"><img src="logo.png" alt="شعار شركة روى الرمال الزراعية" width="624" height="640"></div>
        <h1>نظام إدارة الأسطول<br>والمواقع الزراعية</h1>
        <p class="muted">مزارع الغملاس والبركة وارم، ومشتل الغملاس</p>
        <label class="field"><span>البريد الإلكتروني</span>
          <input name="email" type="email" inputmode="email" autocomplete="username" dir="ltr" required></label>
        <label class="field"><span>كلمة المرور</span>
          <input name="password" type="password" autocomplete="current-password" dir="ltr" required></label>
        <p class="form-error" role="alert" hidden></p>
        <button class="btn btn-primary wide btn-lg" type="submit">تسجيل الدخول</button>
        <p class="muted small">نسيت كلمة المرور؟ اطلب من مسؤول النظام إعادة تعيينها.</p>
      </form>
    </div>`;
  const f = root.querySelector('form');
  const err = f.querySelector('.form-error');
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.hidden = true;
    const email = f.email.value.trim(), password = f.password.value;
    if (!email || !password) { err.textContent = 'اكتب البريد الإلكتروني وكلمة المرور.'; err.hidden = false; return; }
    const btn = f.querySelector('button');
    btn.disabled = true; btn.textContent = 'جارٍ الدخول…';
    try {
      const user = await api.signIn(email, password);
      onDone(user);
    } catch (ex) {
      err.textContent = errorText(ex); err.hidden = false;
      btn.disabled = false; btn.textContent = 'تسجيل الدخول';
    }
  });
  f.email.focus();
  startWelcome(root.querySelector('[data-w3d]'));
}
