// المستخدمون والصلاحيات
import * as api from '../api.js';
import { html, raw, icon } from '../ui.js';
import { openForm, saved, userError } from '../form.js';
import { dateTime } from '../fmt.js';

export const PERMS = [
  ['view', 'عرض البيانات', 'رؤية السيارات والموظفين والسجلات والتقارير'],
  ['create', 'إضافة السجلات', 'إضافة سيارات وموظفين وزيت وصيانة وحوادث وغيرها، ورفع الصور'],
  ['edit', 'تعديل السجلات', 'تعديل السجلات وأرشفتها وتصحيح العداد واعتماد نماذج التسليم'],
  ['invoices', 'إدارة الفواتير', 'رؤية صور الفواتير ورفعها وتنزيلها'],
  ['view_sensitive', 'البيانات الحساسة', 'أرقام الإقامات والجوالات والرخص وصور الوثائق الشخصية'],
  ['export', 'تصدير Excel', 'تنزيل البيانات والتقارير بصيغة Excel'],
  ['import', 'استيراد Excel', 'رفع ملفات Excel لتحديث البيانات'],
  ['approve_maintenance', 'اعتماد طلبات الصيانة', 'اعتماد طلب الصيانة أو رفضه بصفة المشرف أو المعتمد'],
  ['settings', 'الإعدادات', 'تعديل الشركات والمواقع وفترات التنبيه والضريبة'],
  ['manage_users', 'إدارة المستخدمين', 'منح الصلاحيات وتعطيل الحسابات ورؤية سجل التعديلات'],
];
const PRESETS = {
  viewer: ['view'],
  clerk: ['view', 'create', 'edit'],
  accountant: ['view', 'invoices', 'export'],
  manager: ['view', 'create', 'edit', 'invoices', 'view_sensitive', 'export', 'import', 'approve_maintenance', 'settings'],
};
const PRESET_NAMES = [['viewer', 'عرض فقط'], ['clerk', 'مدخل بيانات'], ['accountant', 'محاسب'], ['manager', 'مدير تشغيل']];

export async function renderUsers(el) {
  if (!api.can('manage_users')) {
    el.innerHTML = html`<div class="empty"><h1>المستخدمون والصلاحيات</h1><p>هذه الصفحة لمن يملك صلاحية «إدارة المستخدمين».</p></div>`;
    return;
  }
  const [profiles, perms] = await Promise.all([
    api.get('profiles', { select: '*', order: 'created_at' }),
    api.get('user_permissions', { select: 'user_id,permission' }),
  ]);
  const me = api.currentUser();
  const has = (uid) => new Set(perms.filter((p) => p.user_id === uid).map((p) => p.permission));

  el.innerHTML = html`
    <div class="page-head"><h1>المستخدمون والصلاحيات</h1></div>
    <details class="panel howto">
      <summary><b>كيف أضيف مستخدماً جديداً؟</b></summary>
      <ol>
        <li>افتح موقع <b>supabase.com</b> ← مشروعك ← <b>Authentication</b> ← <b>Users</b>.</li>
        <li>اضغط <b>Add user</b> ← <b>Create new user</b>، واكتب بريده وكلمة مرور مؤقتة، وفعّل <b>Auto Confirm User</b>.</li>
        <li>ارجع هنا وحدّث الصفحة: سيظهر المستخدم الجديد <b>بلا أي صلاحية</b>. اضغط «تعديل» وامنحه الصلاحيات المناسبة.</li>
        <li>أرسل له رابط النظام وبريده وكلمة المرور، واطلب منه تغييرها لاحقاً.</li>
      </ol>
      <p class="muted small">لا يستطيع أحد الدخول دون حساب تنشئه أنت. لإيقاف موظف ترك العمل: «تعديل» ← أزل علامة «الحساب نشط». لا يُحذف الحساب حتى يبقى اسمه في سجل التعديلات.</p>
    </details>
    <div class="users">${raw(profiles.map((u) => {
      const ps = has(u.user_id);
      return html`<article class="panel user ${u.is_active ? '' : 'inactive'}">
        <header><div><h2>${u.full_name || u.email}</h2><span class="muted small" dir="ltr">${u.email}</span></div>
          <div class="status-line">${raw(u.is_admin ? '<span class="tag t-valid">مسؤول النظام</span>' : '')}${raw(u.is_active ? '' : '<span class="tag t-expired">معطّل</span>')}${raw(u.user_id === me.id ? '<span class="tag">أنت</span>' : '')}</div></header>
        <ul class="perm-chips">${raw(u.is_admin ? '<li class="on">كل الصلاحيات</li>' : PERMS.map(([k, t]) => html`<li class="${ps.has(k) ? 'on' : ''}">${t}</li>`).join(''))}</ul>
        ${raw(!u.is_admin && !ps.size ? '<p class="warn-box small">لا يملك أي صلاحية بعد — لن يرى شيئاً حتى تمنحه صلاحية «عرض البيانات» على الأقل.</p>' : '')}
        <footer><span class="muted small num">أُنشئ ${dateTime(u.created_at)}</span><button class="btn btn-sm" data-edit="${u.user_id}">${icon('edit')}<span>تعديل</span></button></footer>
      </article>`;
    }).join(''))}</div>`;

  el.onclick = async (e) => {
    const b = e.target.closest('[data-edit]'); if (!b) return;
    const u = profiles.find((x) => x.user_id === b.dataset.edit);
    const cur = has(u.user_id);
    const fields = [
      { name: 'full_name', label: 'الاسم الظاهر في النظام', required: true, full: true },
      { name: 'is_active', label: 'الحساب نشط (يستطيع الدخول)', type: 'checkbox', full: true },
    ];
    if (me.is_admin) fields.push({ name: 'is_admin', label: 'مسؤول النظام (كل الصلاحيات)', type: 'checkbox', full: true });
    fields.push({ type: 'section', label: 'الصلاحيات' }, { name: 'preset', label: 'تعبئة سريعة', type: 'select', placeholder: '— اختر مجموعة جاهزة —', options: PRESET_NAMES, full: true });
    for (const [k, t, d] of PERMS) {
      if (k === 'manage_users' && !me.is_admin) continue;
      fields.push({ name: `p_${k}`, label: `${t} — ${d}`, type: 'checkbox', full: true });
    }
    const values = { full_name: u.full_name, is_active: u.is_active, is_admin: u.is_admin };
    for (const [k] of PERMS) values[`p_${k}`] = cur.has(k);
    const r = await openForm({
      title: `تعديل ${u.full_name || u.email}`, fields, values,
      intro: u.user_id === me.id ? 'هذا حسابك. لا يمكن تعطيل آخر مسؤول في النظام.' : '',
      onChange(ctx, name) {
        if (name === 'preset' && ctx.values.preset) {
          const set = new Set(PRESETS[ctx.values.preset]);
          for (const [k] of PERMS) { const cb = ctx.form.elements[`p_${k}`]; if (cb) cb.checked = set.has(k); }
        }
      },
      onSubmit: async (v) => {
        const patch = { full_name: v.full_name, is_active: v.is_active };
        if (me.is_admin) patch.is_admin = v.is_admin;
        await api.update('profiles', { user_id: `eq.${u.user_id}` }, patch);
        for (const [k] of PERMS) {
          const want = v[`p_${k}`];
          if (want === undefined) continue;
          if (want && !cur.has(k)) await api.insert('user_permissions', { user_id: u.user_id, permission: k });
          if (!want && cur.has(k)) await api.remove('user_permissions', { user_id: `eq.${u.user_id}`, permission: `eq.${k}` });
        }
        return true;
      },
    });
    if (r) { saved('تم حفظ الصلاحيات'); renderUsers(el); }
  };
}
