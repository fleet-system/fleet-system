// النسخ الاحتياطي وحماية البيانات: نسخة قبل تعديل الموقع، تنزيل، فحص، واستعادة (دمج أو كاملة)
// كل العمليات تُنفَّذ في قاعدة البيانات نفسها (دوال create_backup / check_backup / restore_backup) داخل معاملة واحدة.
import * as api from '../api.js';
import * as data from '../data.js';
import { html, raw, icon, toast } from '../ui.js';
import { dateTime, num, errorText, todayISO } from '../fmt.js';
import { confirmBox, saved } from '../form.js';
import { zipStore, unzip, saveBlob } from '../xlsx.js';
import { downloadBackup, restoreFileFromBackup } from '../backup.js';
import { VERSION } from '../app.js';

const TNAME = {
  companies: 'الشركات والمالكون', sites: 'المشاريع والمواقع', site_history: 'سجل المواقع', app_settings: 'الإعدادات', profiles: 'الحسابات', user_permissions: 'الصلاحيات',
  employees: 'الموظفون والمستخدمون', employee_private: 'بيانات الموظفين الحساسة', vehicles: 'السيارات', vehicle_private: 'هويات السيارات', odometer_readings: 'قراءات العداد',
  vehicle_field_history: 'سجل تغييرات السيارات', authorizations: 'التفويضات', documents: 'المستندات', oil_changes: 'تغيير الزيت', maintenance: 'فواتير الصيانة',
  maintenance_items: 'بنود الصيانة', maintenance_requests: 'طلبات الصيانة', accidents: 'الحوادث', handovers: 'الاستلام والتسليم', vehicle_assignments: 'فترات السائقين',
  housing_maintenance: 'مصاريف صيانة السكن', food_supplies: 'مصاريف توريد الطعام', attachments: 'المرفقات (سجلاتها)', import_batches: 'دفعات الاستيراد', audit_log: 'سجل التعديلات',
};
const MAIN = ['vehicles', 'sites', 'companies', 'employees', 'documents', 'oil_changes', 'maintenance', 'maintenance_requests', 'accidents', 'handovers', 'housing_maintenance', 'food_supplies', 'attachments'];
const KIND = { manual: 'تنزيل يدوي', pre_update: 'قبل تعديل الموقع', pre_restore: 'تلقائية قبل استعادة', uploaded: 'ملف مرفوع من جهاز' };
const ACTION = { create: 'إنشاء نسخة', download: 'تنزيل', upload: 'رفع ملف', check: 'فحص', restore_merge: 'استعادة (دمج)', restore_full: 'استعادة كاملة' };
const REASON = { '23503': 'السجل الذي يتبعه غير موجود', '23505': 'تعارض مع سجل حالي', unique: 'تعارض مع سجل حالي بنفس القيمة الفريدة (لوحة، رقم هيكل، رقم…)', '23514': 'قيمة غير مقبولة في النظام الحالي', '23502': 'حقل مطلوب فارغ' };
const total = (c) => Object.values(c || {}).reduce((a, x) => a + Number(x || 0), 0);
const size = (b) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} م.ب` : `${Math.max(1, Math.round(b / 1024))} ك.ب`);
const tname = (t) => TNAME[t] || t;

// ملفات مرفقة داخل نسخة مضغوطة (zip) رُفعت من الجهاز — تُعاد إلى التخزين بعد الاستعادة
const zipFiles = new Map(); // backup id -> Map(path -> Uint8Array)

export async function renderProtect(el) {
  const me = api.currentUser();
  if (!me?.is_admin) { el.innerHTML = html`<div class="empty"><h1>النسخ الاحتياطي وحماية البيانات</h1><p>هذه الصفحة متاحة لمسؤول النظام فقط.</p></div>`; return; }
  let backups = [], log = [], left = [], ready = true;
  try {
    [backups, log, left] = await Promise.all([
      api.get('system_backups', { select: 'id,backup_no,kind,note,created_at,source_created_at,app_version,schema_version,counts,checksum,size_bytes,verified', order: 'created_at.desc', limit: 60 }),
      api.get('system_backup_log', { select: '*', order: 'id.desc', limit: 30 }),
      api.get('restore_leftovers', { select: '*', reviewed: 'is.false', order: 'id.desc', limit: 100 }),
    ]);
  } catch (e) { ready = false; }
  const opt = (b) => html`<option value="${b.id}">${b.backup_no} — ${KIND[b.kind] || b.kind} — ${dateTime(b.source_created_at || b.created_at)} — ${num(total(b.counts))} سجل</option>`;

  el.innerHTML = html`
    <div class="page-head"><h1>النسخ الاحتياطي وحماية البيانات</h1>
      <p class="muted">قبل أي تعديل على الموقع أنشئ نسخة، وبعد التعديل استعد معلوماتك إلى أماكنها بضغطة واحدة. كل نسخة يُتحقَّق من سلامتها قبل اعتبارها ناجحة.</p></div>
    ${raw(ready ? '' : html`<p class="bad-box">${icon('alert')}<span>هذه الميزة تحتاج تحديث قاعدة البيانات أولاً: نفّذ ملف التحديث في Supabase (SQL Editor) ثم أعد فتح الصفحة.</span></p>`)}

    <section class="panel prot">
      <div class="tab-head"><h2><span class="step-no">1</span> قبل تعديل الموقع</h2></div>
      <p>تُحفظ نسخة كاملة من كل أقسام النظام داخل قاعدة البيانات (مكان مستقل عن ملفات الموقع)، ثم يُتحقَّق من سلامتها.</p>
      <label class="field"><span>ملاحظة (اختياري)</span><input name="pre_note" type="text" placeholder="مثل: قبل تحديث بطاقة السيارة" autocomplete="off"></label>
      <div class="btn-row"><button class="btn btn-primary" data-act="pre" ${raw(ready ? '' : 'disabled')}>${icon('shield')}<span>إنشاء نسخة قبل تعديل الموقع</span></button></div>
      <div data-out="pre" aria-live="polite"></div>
    </section>

    <section class="panel prot">
      <div class="tab-head"><h2><span class="step-no">2</span> تنزيل نسخة جميع المعلومات</h2></div>
      <p>ملف واحد تحتفظ به على جهازك أو في iCloud، يمكن رفعه هنا لاحقاً واستعادته. يحتوي البيانات والعلاقات والمعرّفات وسجلات المرفقات.</p>
      <label class="check"><input type="checkbox" name="withfiles"><span>تضمين صور الفواتير والمرفقات نفسها داخل الملف (ملف ZIP أكبر)</span></label>
      <div class="btn-row"><button class="btn" data-act="download" ${raw(ready ? '' : 'disabled')}>${icon('upload')}<span>تنزيل نسخة جميع المعلومات</span></button></div>
      <div data-out="dl" aria-live="polite"></div>
    </section>

    <section class="panel prot">
      <div class="tab-head"><h2><span class="step-no">3</span> استعادة المعلومات بعد تعديل الموقع</h2></div>
      <ol class="steps"><li>اختر النسخة من القائمة أو أرفق ملفها من جهازك.</li><li>اضغط «فحص النسخة».</li><li>بعد نجاح الفحص اختر طريقة الاستعادة واضغط «استعادة المعلومات».</li></ol>
      <label class="field"><span>النسخة</span><select name="bk">${raw(backups.length ? backups.map(opt).join('') : '<option value="">لا توجد نسخ محفوظة بعد</option>')}</select></label>
      <div class="btn-row">
        <button class="btn" data-act="attach" ${raw(ready ? '' : 'disabled')}>${icon('upload')}<span>إرفاق ملف نسخة من جهازي</span></button>
        <button class="btn btn-primary" data-act="check" ${raw(ready && backups.length ? '' : 'disabled')}>${icon('shield')}<span>فحص النسخة</span></button>
      </div>
      <div data-out="attach" aria-live="polite"></div>
      <div data-out="check" aria-live="polite"></div>
      <div data-out="restore" aria-live="polite"></div>
    </section>

    ${raw(left.length ? html`<section class="panel prot">
      <div class="tab-head"><h2>معلومات للمراجعة (${num(left.length)})</h2><button class="btn btn-sm" data-act="reviewed">تمت المراجعة</button></div>
      <p class="muted small">قيم من نسخة قديمة لم يعد لها حقل مكافئ في الإصدار الحالي. لم تُحذف؛ احتُفظ بها هنا حتى تراجعها.</p>
      <div class="table-wrap"><table class="rtable"><thead><tr><th>القسم</th><th>السجل</th><th>المعلومة</th><th>من النسخة</th></tr></thead><tbody>
      ${raw(left.map((x) => html`<tr><td data-l="القسم">${tname(x.table_name)}</td><td data-l="السجل" class="num">${x.record_id || '—'}</td>
        <td data-l="المعلومة">${Object.entries(x.data || {}).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · ')}</td><td data-l="من النسخة" class="num">${x.backup_label || ''}</td></tr>`).join(''))}
      </tbody></table></div></section>` : '')}

    <section class="panel prot">
      <div class="tab-head"><h2>النسخ المحفوظة</h2></div>
      ${raw(backups.length ? html`<div class="table-wrap"><table class="rtable"><thead><tr><th>رقم النسخة</th><th>النوع</th><th>التاريخ</th><th>السجلات</th><th>الحجم</th><th>السلامة</th><th></th></tr></thead><tbody>
        ${raw(backups.map((b) => html`<tr><td data-l="رقم النسخة" class="code">${b.backup_no}</td><td data-l="النوع">${KIND[b.kind] || b.kind}${raw(b.note ? html`<small class="muted">${b.note}</small>` : '')}</td>
          <td data-l="التاريخ" class="num">${dateTime(b.source_created_at || b.created_at)}</td><td data-l="السجلات" class="num">${num(total(b.counts))}</td><td data-l="الحجم" class="num">${size(b.size_bytes)}</td>
          <td data-l="السلامة"><span class="tag t-${b.verified ? 'valid' : 'expired'}">${b.verified ? 'تم التحقق' : 'غير متحقق'}</span></td>
          <td class="act"><button class="btn btn-sm" data-dl="${b.id}">تنزيل</button></td></tr>`).join(''))}</tbody></table></div>`
        : html`<p class="muted pad">لا توجد نسخ محفوظة بعد.</p>`)}
    </section>

    <section class="panel prot">
      <div class="tab-head"><h2>سجل العمليات</h2></div>
      ${raw(log.length ? html`<div class="table-wrap"><table class="rtable"><thead><tr><th>الوقت</th><th>العملية</th><th>النسخة</th><th>النتيجة</th></tr></thead><tbody>
        ${raw(log.map((l) => html`<tr><td data-l="الوقت" class="num">${dateTime(l.at)}</td><td data-l="العملية">${ACTION[l.action] || l.action}</td><td data-l="النسخة" class="num">${l.backup_no || '—'}</td>
          <td data-l="النتيجة"><span class="tag t-${l.ok ? 'valid' : 'expired'}">${l.ok ? 'نجحت' : 'فشلت'}</span>${raw(!l.ok && l.details?.error ? html`<small class="muted">${errorText(l.details.error)}</small>` : '')}</td></tr>`).join(''))}</tbody></table></div>`
        : html`<p class="muted pad">لا توجد عمليات بعد.</p>`)}
    </section>

    <details class="panel howto"><summary><b>متقدم: النقل إلى مشروع Supabase جديد</b></summary>
      <p class="muted small">إذا تعطّل مشروع Supabase بالكامل: أنشئ مشروعاً جديداً وشغّل فيه setup_clean.sql، ثم أنشئ هنا ملف استعادة SQL من نسخة منزّلة والصقه في SQL Editor في المشروع الجديد.</p>
      <div class="btn-row"><button class="btn" data-act="legacy-dl">تنزيل نسخة بالصيغة السابقة</button><button class="btn" data-act="legacy-sql">إنشاء ملف استعادة SQL من نسخة</button></div>
    </details>`;

  const out = (k, markup) => { const box = el.querySelector(`[data-out="${k}"]`); if (box) box.innerHTML = String(markup || ''); };
  const busy = (b, on, text) => {
    b.disabled = on;
    if (on && text) { b.dataset.t = b.dataset.t || b.innerHTML; b.innerHTML = html`<span>${text}</span>`.toString(); }
    else if (!on && b.dataset.t) { b.innerHTML = b.dataset.t; delete b.dataset.t; }
  };
  const selected = () => el.querySelector('[name=bk]').value;

  async function downloadById(id, withFiles, report) {
    const d = await api.rpc('backup_download', { p_id: id });
    // النص كما خزّنه الخادم تماماً (حتى تبقى بصمة السلامة صحيحة)
    const fileText = `{"integrity":{"md5":"${d.checksum}","backup_no":"${d.backup_no}","app":"fleet"},"backup":${d.text}}`;
    const base = `fleet-backup-${d.backup_no}-${todayISO()}`;
    if (!withFiles) { saveBlob(new Blob([fileText], { type: 'application/json' }), `${base}.json`); return { files: 0 }; }
    const atts = await api.get('attachments', { select: 'id,storage_path,file_name' });
    const entries = [['fleet-backup.json', fileText]]; let n = 0, miss = 0;
    for (const [i, a] of atts.entries()) {
      report(`جارٍ تجهيز المرفقات ${num(i + 1)} من ${num(atts.length)}…`);
      try {
        const r = await fetch(await api.signedUrl(a.storage_path));
        if (!r.ok) throw new Error(String(r.status));
        entries.push([`files/${a.storage_path}`, new Uint8Array(await r.arrayBuffer())]); n++;
      } catch (_) { miss++; }
    }
    saveBlob(zipStore(entries, 'application/zip'), `${base}.zip`);
    return { files: n, missing: miss };
  }

  function checkHtml(c) {
    const P = { checksum: 'الملف تالف أو عُدِّل بعد إنشائه.', format: 'الملف ليس نسخة من هذا النظام.', newer_schema: 'النسخة من إصدار أحدث من الموقع الحالي.', merge_error: 'تعذر تجربة الدمج.', full_error: 'تعذر تجربة الاستعادة الكاملة.' };
    if (!c.ok) return html`<div class="bad-box">${icon('alert')}<div><b>فشل فحص النسخة ${c.backup_no || ''} — لن تُستخدم.</b><br>${(c.problems || []).map((p) => P[p] || p).join(' ')}
      ${raw(c.merge?.error ? html`<br><small>${errorText(c.merge.error)}</small>` : '')}</div></div>`;
    const m = c.merge, f = c.full;
    const remList = Object.entries(f.tables || {}).filter(([, v]) => v.removed_not_in_backup > 0).map(([t, v]) => `${tname(t)}: ${num(v.removed_not_in_backup)}`);
    const confList = (m.conflicts || []).slice(0, 30);
    return html`<div class="check-box ok-box">
      <p><b>${icon('shield')} نجح فحص النسخة ${c.backup_no}</b> — السلامة مؤكدة${c.same_system ? '' : ' (تنبيه: النسخة من نظام آخر)'}.</p>
      <dl class="dl"><div><dt>تاريخ النسخة</dt><dd class="num">${dateTime(c.created_at)}</dd></div><div><dt>نوعها</dt><dd>${KIND[c.kind] || c.kind}</dd></div>
        <div><dt>إصدار البيانات في النسخة / الحالي</dt><dd class="num">${c.schema_version || 'قديم'} / ${c.current_schema_version}</dd></div><div><dt>إجمالي السجلات</dt><dd class="num">${num(total(c.counts))}</dd></div></dl>
      <div class="table-wrap"><table class="rtable compact"><thead><tr><th>القسم</th><th>في النسخة</th><th>مفقود حالياً ويُضاف بالدمج</th><th>موجود ويبقى</th></tr></thead><tbody>
        ${raw(MAIN.filter((t) => c.counts?.[t] != null).map((t) => html`<tr><td data-l="القسم">${tname(t)}</td><td data-l="في النسخة" class="num">${num(c.counts[t])}</td>
          <td data-l="يُضاف بالدمج" class="num">${num(m.tables?.[t]?.restored || 0)}</td><td data-l="موجود ويبقى" class="num">${num(m.tables?.[t]?.kept_existing || 0)}</td></tr>`).join(''))}
      </tbody></table></div>
      ${raw(m.conflicts_count || m.failed_count ? html`<div class="warn-box"><b>حالات تحتاج مراجعة (لن تُدمج تلقائياً): ${num(m.conflicts_count + m.failed_count)}</b>
        <ul>${raw([...confList, ...(m.failed || []).slice(0, 20)].map((x) => html`<li>${tname(x.table)}: <b>${x.label || x.id}</b> — ${REASON[x.reason] || x.detail || x.reason}</li>`).join(''))}</ul></div>` : '')}
      ${raw(m.leftovers ? html`<p class="muted small">${num(m.leftovers)} معلومة من النسخة ليس لها حقل مكافئ حالياً؛ ستُحفظ في «معلومات للمراجعة» ولن تُحذف.</p>` : '')}
      <fieldset class="modes"><legend>طريقة الاستعادة</legend>
        <label class="mode"><input type="radio" name="mode" value="merge" checked><span><b>دمج البيانات (موصى به)</b><br>
          تُضاف السجلات المفقودة بمعرّفاتها الأصلية، وتبقى السجلات الموجودة حالياً والجديدة كما هي، ولا يتكرر أي سجل.</span></label>
        <label class="mode"><input type="radio" name="mode" value="full"><span><b>استعادة كاملة</b><br>
          تعود بيانات النظام كما كانت في النسخة تماماً.${raw(remList.length ? html` <b class="bad">ستُزال سجلات أُضيفت بعد النسخة: ${remList.join('، ')}.</b>` : ' لا توجد سجلات أُضيفت بعد النسخة.')}</span></label>
      </fieldset>
      <label class="field confirm-full" hidden><span>للتأكيد اكتب كلمة: <b>استبدال</b></span><input name="confirm_full" type="text" autocomplete="off"></label>
      <p class="muted small">قبل الاستعادة تُنشأ تلقائياً نسخة من الوضع الحالي حتى تستطيع التراجع. الحسابات وكلمات المرور والصلاحيات لا تتغير.</p>
      <div class="btn-row"><button class="btn btn-primary" data-act="restore" data-id="${c.id}">${icon('shield')}<span>استعادة المعلومات</span></button></div>
    </div>`;
  }

  function resultHtml(r) {
    if (!r.ok) return html`<div class="bad-box">${icon('alert')}<div><b>لم تُنفَّذ الاستعادة، وبياناتك الحالية بقيت كما هي.</b><br>${errorText(r.error)}
      ${raw(r.pre_restore ? html`<br><small>نسخة الوضع الحالي محفوظة برقم ${r.pre_restore.backup_no}.</small>` : '')}</div></div>`;
    const probs = [...(r.conflicts || []), ...(r.failed || [])];
    return html`<div class="ok-box check-box"><p><b>${icon('shield')} تمت استعادة المعلومات من النسخة ${r.backup_no} بنجاح</b> (${r.mode === 'full' ? 'استعادة كاملة' : 'دمج'}).</p>
      <dl class="dl"><div><dt>سجلات استُعيدت</dt><dd class="num">${num(r.restored)}</dd></div><div><dt>سجلات موجودة بقيت كما هي</dt><dd class="num">${num(r.kept_existing)}</dd></div>
        ${raw(r.mode === 'full' ? html`<div><dt>سجلات أُزيلت (أُضيفت بعد النسخة)</dt><dd class="num">${num(r.removed_not_in_backup)}</dd></div>` : '')}
        <div><dt>تعذرت استعادتها</dt><dd class="num">${num(r.conflicts_count + r.failed_count)}</dd></div><div><dt>معلومات للمراجعة</dt><dd class="num">${num(r.leftovers)}</dd></div>
        <div><dt>نسخة الوضع السابق (للتراجع)</dt><dd class="code">${r.pre_restore?.backup_no || '—'}</dd></div></dl>
      ${raw(probs.length ? html`<div class="warn-box"><b>سجلات لم تُستعد وسبب ذلك:</b><ul>${raw(probs.slice(0, 50).map((x) => html`<li>${tname(x.table)}: <b>${x.label || x.id}</b> — ${REASON[x.reason] || x.detail || x.reason}</li>`).join(''))}</ul></div>` : '')}
      <div class="table-wrap"><table class="rtable compact"><thead><tr><th>القسم</th><th>في النسخة</th><th>استُعيد</th><th>كان موجوداً</th></tr></thead><tbody>
        ${raw(MAIN.filter((t) => r.tables?.[t]?.in_backup != null).map((t) => html`<tr><td data-l="القسم">${tname(t)}</td><td data-l="في النسخة" class="num">${num(r.tables[t].in_backup)}</td>
          <td data-l="استُعيد" class="num">${num(r.tables[t].restored)}</td><td data-l="كان موجوداً" class="num">${num(r.tables[t].kept_existing)}</td></tr>`).join(''))}</tbody></table></div>
      <p class="muted small">للتراجع عن هذه الاستعادة: اختر النسخة ${r.pre_restore?.backup_no || ''} من القائمة واستعدها «استعادة كاملة».</p></div>`;
  }

  el.onchange = (e) => {
    if (e.target.name === 'mode') el.querySelector('.confirm-full').hidden = e.target.value !== 'full';
    if (e.target.name === 'bk') { out('check', ''); out('restore', ''); }
  };

  el.onclick = async (e) => {
    const dlb = e.target.closest('[data-dl]');
    if (dlb) {
      busy(dlb, true, 'جارٍ التنزيل…');
      try { await downloadById(dlb.dataset.dl, el.querySelector('[name=withfiles]').checked, (m) => toast(m, 'ok')); saved('تم تنزيل النسخة'); }
      catch (err) { toast(errorText(err), 'error'); }
      busy(dlb, false); return;
    }
    const b = e.target.closest('[data-act]'); if (!b) return;
    const act = b.dataset.act;

    if (act === 'pre') {
      busy(b, true, 'جارٍ إنشاء النسخة والتحقق منها…'); out('pre', '');
      try {
        const r = await api.rpc('create_backup', { p_kind: 'pre_update', p_note: el.querySelector('[name=pre_note]').value.trim() || null, p_app_version: VERSION });
        const msg = html`<div class="ok-box check-box"><b>${icon('shield')} تم إنشاء النسخة بنجاح وتم التحقق من سلامتها</b>
          <dl class="dl"><div><dt>رقم النسخة (المعرّف)</dt><dd class="code">${r.backup_no}</dd></div><div><dt>التاريخ والوقت</dt><dd class="num">${dateTime(r.created_at)}</dd></div>
          <div><dt>السجلات</dt><dd class="num">${num(total(r.counts))}</dd></div><div><dt>السيارات</dt><dd class="num">${num(r.counts.vehicles || 0)}</dd></div></dl>
          <p class="muted small">يمكنك الآن تعديل الموقع. ويُفضَّل أيضاً تنزيل نسخة إلى جهازك من الخطوة 2.</p></div>`;
        saved(`تم إنشاء النسخة ${r.backup_no}`);
        await renderProtect(el); out('pre', msg); return;
      } catch (err) { out('pre', html`<div class="bad-box">${icon('alert')}<span><b>لم تُنشأ النسخة.</b> ${errorText(err)} لا تبدأ تعديل الموقع قبل نجاح النسخة.</span></div>`); }
      busy(b, false); return;
    }

    if (act === 'download') {
      busy(b, true, 'جارٍ إنشاء النسخة…'); out('dl', '');
      try {
        const r = await api.rpc('create_backup', { p_kind: 'manual', p_note: 'تنزيل', p_app_version: VERSION });
        const res = await downloadById(r.id, el.querySelector('[name=withfiles]').checked, (m) => out('dl', html`<p class="muted small">${m}</p>`));
        out('dl', html`<div class="ok-box check-box"><b>${icon('shield')} تم تنزيل نسخة جميع المعلومات (${r.backup_no})</b> — ${num(total(r.counts))} سجل، تم التحقق من سلامتها.
          ${raw(res.files ? html`<br>مع ${num(res.files)} ملف مرفق.` : '')}${raw(res.missing ? html`<br><small>تعذر تنزيل ${num(res.missing)} ملف.</small>` : '')}
          <p class="muted small">احفظ الملف في «الملفات» أو iCloud. لا تعدّل محتواه؛ أي تعديل يجعل النظام يرفضه عند الاستعادة.</p></div>`);
      } catch (err) { out('dl', html`<div class="bad-box">${icon('alert')}<span><b>لم يتم التنزيل.</b> ${errorText(err)}</span></div>`); }
      busy(b, false); return;
    }

    if (act === 'attach') {
      const inp = Object.assign(document.createElement('input'), { type: 'file', accept: '.json,.zip,application/json,application/zip' });
      inp.onchange = async () => {
        const f = inp.files[0]; if (!f) return;
        out('attach', html`<p class="muted small">جارٍ فحص الملف ورفعه…</p>`); out('check', ''); out('restore', '');
        try {
          let text, files = null;
          if (/\.zip$/i.test(f.name) || f.type === 'application/zip') {
            const z = await unzip(await f.arrayBuffer(), 'الملف ليس نسخة احتياطية صالحة.');
            if (!z['fleet-backup.json']) throw new Error('BACKUP_INVALID');
            text = new TextDecoder().decode(z['fleet-backup.json']);
            files = new Map(Object.entries(z).filter(([k]) => k.startsWith('files/')).map(([k, v]) => [k.slice(6), v]));
          } else text = await f.text();
          try { JSON.parse(text); } catch (_) { throw new Error('BACKUP_INVALID'); }
          const r = await api.rpc('import_backup', { p_text: text, p_file_name: f.name });
          if (files && files.size) zipFiles.set(r.id, files);
          await renderProtect(el);
          el.querySelector('[name=bk]').value = r.id;
          out('attach', html`<div class="ok-box check-box"><b>تم رفع الملف كنسخة ${r.backup_no}</b> — ${num(total(r.counts))} سجل.
            ${raw(r.integrity_checked ? ' بصمة السلامة مطابقة.' : ' (ملف من الإصدار السابق بلا بصمة سلامة.)')}${raw(r.same_system ? '' : ' <b>تنبيه: النسخة من نظام آخر.</b>')}
            ${raw(files && files.size ? html`<br>يحتوي ${num(files.size)} ملف مرفق؛ تُعاد إلى أماكنها بعد الاستعادة.` : '')} اضغط الآن «فحص النسخة».</div>`);
        } catch (err) { out('attach', html`<div class="bad-box">${icon('alert')}<span><b>لم يُقبل الملف.</b> ${err.message && !/^BACKUP/.test(err.message) ? err.message : errorText(err)}</span></div>`); }
      };
      inp.click(); return;
    }

    if (act === 'check') {
      const id = selected(); if (!id) return;
      busy(b, true, 'جارٍ الفحص…'); out('check', ''); out('restore', '');
      try { const c = await api.rpc('check_backup', { p_id: id }); out('check', checkHtml(c)); }
      catch (err) { out('check', html`<div class="bad-box">${icon('alert')}<span>${errorText(err)}</span></div>`); }
      busy(b, false); return;
    }

    if (act === 'restore') {
      const id = b.dataset.id; const mode = el.querySelector('[name=mode]:checked')?.value || 'merge';
      if (mode === 'full' && el.querySelector('[name=confirm_full]').value.trim() !== 'استبدال') {
        out('restore', html`<p class="bad-box">للاستعادة الكاملة اكتب كلمة «استبدال» في خانة التأكيد.</p>`); return;
      }
      const okGo = await confirmBox(mode === 'full'
        ? 'ستُستبدل بيانات النظام الحالية ببيانات النسخة، وتُزال السجلات التي أُضيفت بعدها. تُحفظ نسخة من الوضع الحالي تلقائياً قبل البدء. هل تريد المتابعة؟'
        : 'ستُضاف السجلات المفقودة من النسخة، وتبقى السجلات الحالية كما هي. تُحفظ نسخة من الوضع الحالي تلقائياً قبل البدء. هل تريد المتابعة؟',
      { title: 'استعادة المعلومات', okText: 'استعادة المعلومات', danger: mode === 'full' });
      if (!okGo) return;
      busy(b, true, 'جارٍ الاستعادة…');
      try {
        const r = await api.rpc('restore_backup', { p_id: id, p_mode: mode, p_confirm: mode === 'full' ? 'REPLACE' : null });
        out('check', ''); out('restore', resultHtml(r));
        if (r.ok) {
          data.invalidate();
          const files = zipFiles.get(id);
          if (files && files.size) {
            let up = 0, had = 0, bad = 0;
            for (const [path, bytes] of files) {
              try { await api.uploadFile(path, new Blob([bytes]), 'application/octet-stream'); up++; }
              catch (err2) { if (err2.status === 409 || err2.status === 400 || /exist|Duplicate/i.test(err2.message)) had++; else bad++; }
            }
            el.querySelector('[data-out="restore"]').insertAdjacentHTML('beforeend', String(html`<p class="ok-box">المرفقات: أُعيد ${num(up)} ملف، و${num(had)} ملف كان موجوداً${bad ? html`، وتعذر ${num(bad)}` : ''}.</p>`));
          }
          saved('تمت استعادة المعلومات');
        }
      } catch (err) { out('restore', html`<div class="bad-box">${icon('alert')}<span><b>لم تُنفَّذ الاستعادة، وبياناتك الحالية بقيت كما هي.</b> ${errorText(err)}</span></div>`); }
      busy(b, false); return;
    }

    if (act === 'reviewed') {
      try { await api.rpc('mark_leftovers_reviewed', { p_ids: left.map((x) => x.id) }); saved(); renderProtect(el); } catch (err) { toast(errorText(err), 'error'); }
      return;
    }
    if (act === 'legacy-dl') {
      busy(b, true); try { await downloadBackup(); saved('تم التنزيل'); } catch (err) { toast(errorText(err), 'error'); } busy(b, false); return;
    }
    if (act === 'legacy-sql') {
      const inp = Object.assign(document.createElement('input'), { type: 'file', accept: 'application/json,.json' });
      inp.onchange = async () => {
        try {
          const f = inp.files[0]; let j = JSON.parse(await f.text());
          if (j.backup) j = j.backup;
          await restoreFileFromBackup(new File([JSON.stringify(j)], f.name)); saved('تم إنشاء ملف الاستعادة');
        } catch (err) { toast(err.message || errorText(err), 'error'); }
      };
      inp.click();
    }
  };
}
