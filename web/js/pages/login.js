import * as api from '../api.js';
import { html, icon } from '../ui.js';
import { errorText } from '../fmt.js';

export function renderLogin(root, onDone) {
  document.title = 'تسجيل الدخول — نظام إدارة الأسطول';
  root.innerHTML = html`
    <div class="login">
      <div class="login-side" aria-hidden="true">
        <div class="rows"><span></span><span></span><span></span><span></span><span></span><span></span><span></span></div>
      </div>
      <form class="login-card" novalidate>
        <div class="login-brand">${icon('leaf', 'brand-ic')}</div>
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
}
