// الإعدادات + النسخ الاحتياطي والاستعادة
import * as api from '../api.js';
import * as data from '../data.js';
import { html, raw, icon, toast } from '../ui.js';
import { dateTime, num, errorText, toWestern } from '../fmt.js';
import { openForm, saved, userError } from '../form.js';
import { downloadBackup, restoreFileFromBackup, TABLES } from '../backup.js';
import { SUPABASE_URL } from '../config.js';
import { confirmBox } from '../form.js';

const daysSince = (iso) => (iso ? Math.floor((Date.now() - new Date(iso)) / 864e5) : null);

export async function renderSettings(el) {
  await data.lookups(true);
  const rows = await api.get('app_settings', { select: '*', order: 'key' });
  const S = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const canEdit = api.can('settings');
  const me = api.currentUser();
  const last = S.last_backup?.at;
  const ago = daysSince(last);

  el.innerHTML = html`
    <div class="page-head"><h1>الإعدادات</h1></div>
    <section class="panel">
      <div class="tab-head"><h2>التنبيهات والحسابات</h2>${raw(canEdit ? html`<button class="btn btn-sm" data-act="edit">${icon('edit')}<span>تعديل</span></button>` : '')}</div>
      <dl class="dl">
        <div><dt>التنبيه قبل انتهاء الوثائق (أيام)</dt><dd class="num">${(S.doc_alert_days || [90, 60, 30, 7]).join('، ')}</dd></div>
        <div><dt>التنبيه قبل انتهاء تفويض السيارة (أيام)</dt><dd class="num">${num(S.vehicle_auth_alert_days ?? 30)}</dd></div>
        <div><dt>فترة تغيير الزيت الافتراضية</dt><dd class="num">${num(S.oil_default_interval_km ?? 10000)} كم</dd></div>
        <div><dt>تنبيه الزيت عند بقاء</dt><dd class="num">${num(S.oil_warning_km ?? 1000)} كم أو أقل</dd></div>
        <div><dt>«تجاوز موعد التغيير» بعد تخطي الموعد بـ</dt><dd class="num">${num(S.oil_overdue_tolerance_km ?? 500)} كم</dd></div>
        <div><dt>نسبة ضريبة القيمة المضافة</dt><dd class="num">${Math.round(Number(S.default_vat_rate ?? 0.15) * 1000) / 10}%</dd></div>
        <div><dt>العملة / التوقيت / صيغة التاريخ</dt><dd class="num">ر.س · Asia/Riyadh · YYYY/MM/DD</dd></div>
      </dl>
      <p class="muted small">الشركات والمواقع تُعدَّل من صفحة <a href="#/sites">الشركات والمواقع</a>.</p>
    </section>

    <section class="panel">
      <div class="tab-head"><h2>إدارة بيانات السيارات</h2></div>
      <p>أسماء حقول بطاقة السيارة، والقوائم والخيارات، والحقول الإضافية، وسجل تعديلات هذه الإعدادات مع إمكانية التراجع.</p>
      <div class="btn-row wrap">${raw(canEdit ? html`<a class="btn btn-primary" href="#/settings/vehicle-fields">${icon('car')}<span>إدارة بيانات السيارات</span></a>` : '')}
        <a class="btn" href="#/settings/vehicles-archive">${icon('clock')}<span>سجل السيارات المحذوفة</span></a></div>
    </section>

    <section class="panel">
      <div class="tab-head"><h2>إدارة طلبات الصيانة</h2></div>
      <p>حذف طلب صيانة ينقله إلى «سجل الطلبات المحذوفة» ولا يمسحه: تبقى بياناته ومرفقاته وفاتورته محفوظة، ويُسجَّل الحذف في سجل التعديلات، ويمكن استرجاعه في أي وقت.</p>
      <div class="btn-row wrap"><a class="btn btn-primary" href="#/settings/requests">${icon('wrench')}<span>إدارة طلبات الصيانة</span></a>
        <a class="btn" href="#/settings/requests?tab=archive">${icon('clock')}<span>سجل الطلبات المحذوفة</span></a></div>
    </section>

    ${raw(me.is_admin ? excelLinkSection(S.excel_feed) : '')}

    <section class="panel backup">
      <div class="tab-head"><h2>النسخ الاحتياطي وحماية البيانات</h2></div>
      ${raw(me.is_admin ? html`
        <p class="${ago === null || ago > 7 ? 'bad-box' : 'warn-box ok-box'}">${ago === null ? 'لم تُؤخذ أي نسخة احتياطية بعد.' : html`آخر نسخة: <b class="num">${dateTime(last)}</b> (${ago === 0 ? 'اليوم' : raw(html`قبل <span class="num">${ago}</span> يوم`)}).`}</p>
        <p>إنشاء نسخة قبل تعديل الموقع، وتنزيل نسخة جميع المعلومات، واستعادتها بعد التعديل — كلها في صفحة واحدة.</p>
        <div class="btn-row"><a class="btn btn-primary" href="#/backup">${icon('shield')}<span>فتح صفحة النسخ الاحتياطي وحماية البيانات</span></a></div>` : html`<p class="muted">النسخ الاحتياطي متاح لمسؤول النظام فقط.</p>`)}
    </section>`;

  el.onclick = async (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    if (b.dataset.act === 'xl-new' || b.dataset.act === 'xl-off' || b.dataset.act === 'xl-copy') { await excelLinkAction(b, S.excel_feed, el); return; }
    const prog = el.querySelector('[data-progress]');
    if (b.dataset.act === 'backup') {
      b.disabled = true;
      try {
        const counts = await downloadBackup((m) => { if (prog) prog.textContent = m; });
        if (prog) prog.textContent = `تم: ${num(counts.vehicles)} سيارة، ${num(counts.employees)} موظف، ${num(Object.values(counts).reduce((a, c) => a + c, 0))} سجل إجمالاً.`;
        saved('تم تنزيل النسخة الاحتياطية');
      } catch (err) { toast(errorText(err), 'error'); if (prog) prog.textContent = ''; }
      b.disabled = false;
      return;
    }
    if (b.dataset.act === 'restore') {
      const inp = Object.assign(document.createElement('input'), { type: 'file', accept: 'application/json,.json' });
      inp.onchange = async () => {
        try { const c = await restoreFileFromBackup(inp.files[0]); saved(`تم إنشاء ملف الاستعادة (${num(c.vehicles || 0)} سيارة)`); }
        catch (err) { toast(err.message || errorText(err), 'error'); }
      };
      inp.click();
      return;
    }
    if (b.dataset.act === 'edit') {
      const r = await openForm({
        title: 'تعديل الإعدادات',
        fields: [
          { name: 'doc_alert_days', label: 'التنبيه قبل انتهاء الوثائق (أيام، افصل بفاصلة)', required: true, dir: 'ltr', full: true, help: 'مثال: 90, 60, 30, 7' },
          { name: 'vehicle_auth_alert_days', label: 'التنبيه قبل انتهاء تفويض السيارة (أيام)', type: 'number', required: true, min: 1, max: 365, help: 'مثال: 30 — يظهر تنبيه «اقترب الانتهاء» قبل هذه المدة' },
          { name: 'oil_default_interval_km', label: 'فترة تغيير الزيت الافتراضية للسيارات الجديدة (كم)', type: 'number', required: true, min: 500, max: 100000 },
          { name: 'oil_warning_km', label: 'تنبيه الزيت عند بقاء (كم)', type: 'number', required: true, min: 0, max: 20000 },
          { name: 'oil_overdue_tolerance_km', label: '«تجاوز الموعد» بعد تخطيه بـ (كم)', type: 'number', required: true, min: 0, max: 20000 },
          { name: 'vat_percent', label: 'نسبة ضريبة القيمة المضافة (%)', type: 'number', decimal: true, required: true, min: 0, max: 100 },
        ],
        values: {
          doc_alert_days: (S.doc_alert_days || [90, 60, 30, 7]).join(', '), vehicle_auth_alert_days: S.vehicle_auth_alert_days ?? 30, oil_default_interval_km: S.oil_default_interval_km ?? 10000,
          oil_warning_km: S.oil_warning_km ?? 1000, oil_overdue_tolerance_km: S.oil_overdue_tolerance_km ?? 500, vat_percent: Math.round(Number(S.default_vat_rate ?? 0.15) * 1000) / 10,
        },
        onSubmit: async (v) => {
          const days = toWestern(v.doc_alert_days).split(/[,،\s]+/).filter(Boolean).map(Number);
          if (!days.length || days.some((d) => !Number.isInteger(d) || d < 1 || d > 365)) throw userError('أيام التنبيه يجب أن تكون أرقاماً صحيحة بين 1 و 365.');
          const put = { doc_alert_days: [...new Set(days)].sort((a, b) => b - a), vehicle_auth_alert_days: v.vehicle_auth_alert_days, oil_default_interval_km: v.oil_default_interval_km, oil_warning_km: v.oil_warning_km, oil_overdue_tolerance_km: v.oil_overdue_tolerance_km, default_vat_rate: Math.round(v.vat_percent * 10) / 1000 };
          for (const [key, value] of Object.entries(put)) {
            const u = await api.update('app_settings', { key: `eq.${key}` }, { value });
            if (!u.length) await api.insert('app_settings', { key, value });
          }
          return true;
        },
      });
      if (r) { saved(); data.invalidate(); renderSettings(el); }
    }
  };
}

// تذكير للمسؤول في لوحة التحكم إذا مر أكثر من 7 أيام على آخر نسخة
export async function backupReminder() {
  const me = api.currentUser();
  if (!me?.is_admin) return '';
  try {
    const [row] = await api.get('app_settings', { select: 'value', key: 'eq.last_backup' });
    const ago = daysSince(row?.value?.at);
    if (ago !== null && ago <= 7) return '';
    return html`<a class="bad-box backup-nudge" href="#/backup">${icon('alert')}<span>${ago === null ? 'لم تُؤخذ أي نسخة احتياطية بعد.' : `آخر نسخة احتياطية قبل ${ago} يوم.`} اضغط هنا لإنشاء نسخة الآن.</span></a>`.toString();
  } catch (_) { return ''; }
}

// ---------------- ملف Excel المربوط (للمسؤول فقط)
// المفتاح يُنشأ في المتصفح ويظهر مرة واحدة؛ تُحفظ بصمته (SHA-256) فقط في app_settings.excel_feed
const FEED = `${SUPABASE_URL}/functions/v1/excel-feed?key=`;
const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const sha256Hex = async (t) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)))].map((x) => x.toString(16).padStart(2, '0')).join('');

function excelLinkSection(cfg) {
  const on = cfg && cfg.hash && cfg.enabled !== false;
  return html`<section class="panel excel-link">
    <div class="tab-head"><h2>ملف Excel المربوط</h2><span class="tag ${on ? 't-valid' : 't-missing'}">${on ? 'مفعّل' : 'غير مفعّل'}</span></div>
    <p>ملف Excel في OneDrive يجلب آخر بيانات النظام كلما فتحته على الكمبيوتر: السيارات، الوثائق والتنبيهات، المتابعات، تغيير الزيت، الصيانة، طلبات الصيانة، الحوادث، والمصروفات.
      <b>للقراءة فقط</b>، و<b>بدون</b> أرقام الهوية أو الإقامة أو الجوالات أو أرقام الفواتير.</p>
    ${raw(on ? html`<p class="muted small">أُنشئ الرابط الحالي بتاريخ <span class="num">${dateTime(cfg.created_at)}</span>${cfg.created_by ? ` بواسطة ${cfg.created_by}` : ''}. لا يمكن عرضه مرة أخرى؛ إن فقدته أنشئ رابطاً جديداً (يتوقف القديم تلقائياً).</p>` : '')}
    <div class="btn-row wrap"><button class="btn btn-primary" data-act="xl-new">${icon('table')}<span>${on ? 'إنشاء رابط جديد' : 'إنشاء رابط ملف Excel'}</span></button>
      ${raw(on ? html`<button class="btn" data-act="xl-off">${icon('close')}<span>إيقاف الرابط</span></button>` : '')}</div>
    <div class="xl-out"></div>
    <details class="xl-steps"><summary>طريقة الربط في Excel (مرة واحدة من الكمبيوتر)</summary><ol>
      <li>افتح Excel على الكمبيوتر ← ملف جديد ← احفظه في <b>OneDrive</b> باسم «بيانات الأسطول».</li>
      <li>من تبويب <b>بيانات (Data)</b> اختر <b>من ويب (From Web)</b>، والصق الرابط ثم <b>موافق</b>. إن سألك عن طريقة الدخول اختر <b>مجهول (Anonymous)</b> ثم <b>اتصال</b>.</li>
      <li>في نافذة <b>المتصفح (Navigator)</b> ضع علامة على <b>تحديد عناصر متعددة</b>، واختر الأوراق التي تريدها، ثم <b>تحميل (Load)</b>.</li>
      <li>للتحديث التلقائي: <b>بيانات ← الاستعلامات والاتصالات</b> ← زر الفأرة الأيمن على كل استعلام ← <b>خصائص</b> ← فعّل <b>تحديث البيانات عند فتح الملف</b> و<b>التحديث كل 60 دقيقة</b>.</li>
      <li>للتحديث يدوياً في أي وقت: <b>بيانات ← تحديث الكل</b>.</li>
    </ol></details>
  </section>`;
}

async function excelLinkAction(b, cfg, el) {
  const act = b.dataset.act;
  if (act === 'xl-copy') {
    const url = el.querySelector('.xl-url')?.value || '';
    try { await navigator.clipboard.writeText(url); toast('تم نسخ الرابط', 'ok'); } catch (_) { el.querySelector('.xl-url')?.select(); toast('حدّد الرابط وانسخه يدوياً', 'error'); }
    return;
  }
  const on = cfg && cfg.hash && cfg.enabled !== false;
  if (act === 'xl-off') {
    if (!await confirmBox('سيتوقف ملف Excel المربوط عن جلب البيانات فوراً. يمكنك إنشاء رابط جديد لاحقاً.', { title: 'إيقاف الرابط', okText: 'إيقاف', danger: true })) return;
    await saveFeed({ ...cfg, enabled: false, disabled_at: new Date().toISOString() });
    saved('تم إيقاف الرابط'); renderSettings(el); return;
  }
  if (on && !await confirmBox('سيتوقف الرابط الحالي ويُنشأ رابط جديد. أي ملف Excel مربوط بالرابط القديم يحتاج تحديث الرابط فيه.', { title: 'رابط جديد', okText: 'إنشاء رابط جديد' })) return;
  const key = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const me = api.currentUser();
  b.disabled = true;
  try {
    await saveFeed({ hash: await sha256Hex(key), enabled: true, created_at: new Date().toISOString(), created_by: me?.full_name || '' });
    await renderSettings(el);
    const out = el.querySelector('.xl-out');
    out.innerHTML = html`<div class="warn-box xl-new"><p><b>انسخ الرابط الآن واحفظه في مكان آمن</b> — لن يظهر مرة أخرى. لا ترسله لأحد؛ من يملكه يرى بيانات الملف.</p>
      <input class="xl-url" dir="ltr" readonly value="${FEED + key}"><div class="btn-row"><button class="btn btn-primary" data-act="xl-copy">${icon('doc')}<span>نسخ الرابط</span></button></div></div>`;
    el.querySelector('.xl-steps').open = true;
    out.scrollIntoView({ block: 'center' });
  } catch (e) { toast(errorText(e), 'error'); b.disabled = false; }
}

async function saveFeed(value) {
  const u = await api.update('app_settings', { key: 'eq.excel_feed' }, { value });
  if (!u.length) await api.insert('app_settings', { key: 'excel_feed', value, description: 'linked Excel file (hash of the access key only)' });
  data.invalidate();
}
