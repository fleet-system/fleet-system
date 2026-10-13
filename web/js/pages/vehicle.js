// ملف شامل ومستقل لكل سيارة: الملخص، الأزرار، والتبويبات الإحدى عشرة
import * as api from '../api.js';
import * as data from '../data.js';
import { html, raw, icon, toast, $ } from '../ui.js';
import { label, km, num, money, date, dateTime, todayISO, saMobileLocal } from '../fmt.js';
import { openForm, saved, userError, localParts } from '../form.js';
import { saveDriverDocs, vehicleCardForm, opStateOf, opChip, docState, costSummary, cfText } from './vehicles.js';
import { fieldLabel as L, customFields, SECTIONS } from '../vehicle-config.js';
import { FIELDS, VALUE_LABELS } from './audit.js';
import { confirmBox } from '../form.js';
import { employeeLabels, employeeLabel, resolveEmployee } from '../resolve.js';
import { oilForm, maintForm, accidentForm } from './ops.js';
import { handoverForm, approveHandover } from './handovers.js';
import { requestForm, mrTag } from './requests.js';
import { mountAttachments } from '../attachments.js';

export const TABS = [
  ['basic', 'البيانات الأساسية'], ['driver', 'السائق ووثائقه'], ['auth', 'الملكية والتفويض'], ['docs', 'الوثائق'],
  ['oil', 'تغيير الزيت'], ['maint', 'طلبات الصيانة'], ['acc', 'الحوادث'], ['hand', 'استلام وتسليم'],
  ['files', 'الفواتير والمرفقات'], ['costs', 'سجل التكاليف'], ['log', 'سجل التعديلات'],
];

const docStatus = (d) => {
  if (!d) return 'missing';
  if (!d.expiry_date) return 'no_date';
  if (d.expiry_date < todayISO()) return 'expired';
  const days = Math.round((new Date(d.expiry_date) - new Date(todayISO())) / 864e5);
  return days <= 90 ? 'expiring' : 'valid';
};
const daysLeft = (iso) => (iso ? Math.round((new Date(iso) - new Date(todayISO())) / 864e5) : null);
const edBtn = (kind, id, t = 'تعديل') => (api.can('edit') ? raw(html`<button class="btn btn-sm" data-act="${kind}-edit" data-id="${id}">${t}</button>`) : '');
const later = (phase) => html`<p class="later">${icon('clock')}<span>إضافة سجلات جديدة من هنا تُفعَّل في المرحلة ${phase}. السجلات المحفوظة تظهر في هذا التبويب دائماً.</span></p>`;

export async function renderVehicle(el, id, params) {
  await data.lookups();
  const q = (t, extra = {}) => api.get(t, { select: '*', vehicle_id: `eq.${id}`, ...extra });
  let [[v], docs, auths, assigns, hist, odo, oil, maint, acc, hand, costs, reqs, hx] = await Promise.all([
    api.get('v_vehicles_overview', { select: '*', id: `eq.${id}` }),
    q('documents', { deleted_at: 'is.null', order: 'expiry_date.desc.nullslast' }),
    q('authorizations', { deleted_at: 'is.null', order: 'expiry_date.desc.nullslast' }),
    q('vehicle_assignments', { order: 'start_at.desc' }),
    q('vehicle_field_history', { order: 'changed_at.desc', limit: 200 }),
    q('odometer_readings', { order: 'read_at.desc', limit: 100 }),
    q('oil_changes', { deleted_at: 'is.null', order: 'change_date.desc' }),
    q('maintenance', { deleted_at: 'is.null', order: 'maint_date.desc' }),
    q('accidents', { deleted_at: 'is.null', order: 'occurred_at.desc' }),
    q('handovers', { deleted_at: 'is.null', order: 'occurred_at.desc' }),
    q('v_expenses', { order: 'expense_date.desc' }),
    q('maintenance_requests', { deleted_at: 'is.null', order: 'request_date.desc,request_no.desc' }).catch(() => null),
    api.rpc('vehicle_history', { p_id: id }).catch(() => null),
  ]);
  // بطاقة في سجل السيارات المحذوفة: تُعرض كاملة للاطلاع والاسترداد (بدون تعديل)
  let archived = false;
  if (!v) { const [a] = await api.get('v_vehicles_archive', { select: '*', id: `eq.${id}` }).catch(() => []); if (a) { v = a; archived = !!a.deleted_at; } }
  const sensOk = api.can('view_sensitive');
  const [dDocs, dPriv] = v?.current_driver_id ? await Promise.all([
    api.get('v_document_status', { select: 'doc_type,expiry_date,days_left,status,record_id', owner_type: 'eq.employee', owner_id: `eq.${v.current_driver_id}` }),
    sensOk ? api.get('employee_private', { select: 'iqama_no', employee_id: `eq.${v.current_driver_id}` }) : Promise.resolve([]),
  ]) : [[], []];
  const vPriv = v && sensOk ? (await api.get('vehicle_private', { select: '*', vehicle_id: `eq.${id}` }).catch(() => []))[0] || {} : {};
  if (!v) { el.innerHTML = html`<div class="empty"><h1>السيارة غير موجودة</h1><a class="btn btn-primary" href="#/vehicles">قائمة السيارات</a></div>`; return; }
  document.title = `${v.code} ${v.plate_no} — نظام إدارة الأسطول`;
  const tab = TABS.some(([k]) => k === params.get('tab')) ? params.get('tab') : 'basic';
  const canEdit = api.can('edit') && !archived, canAdd = api.can('create') && !archived, canRestore = api.can('edit') && archived;
  const cur = (type) => docs.find((d) => d.doc_type === type);
  const authNow = auths.find((a) => a.employee_id === v.current_driver_id);
  const authBad = v.current_driver_id && v.authorization_status !== 'valid';

  const kv = (pairs) => html`<dl class="dl">${raw(pairs.map(([k, val]) => html`<div><dt>${k}</dt><dd>${val ?? '—'}</dd></div>`).join(''))}</dl>`;
  const table = (heads, rows, empty) => rows.length
    ? html`<div class="table-wrap"><table class="rtable"><thead><tr>${raw(heads.map((h) => html`<th>${h}</th>`).join(''))}</tr></thead><tbody>${raw(rows.map((cells) => html`<tr>${raw(cells.map((c, i) => html`<td data-l="${heads[i]}">${c ?? '—'}</td>`).join(''))}</tr>`).join(''))}</tbody></table></div>`
    : html`<p class="muted pad">${empty}</p>`;
  const docCard = (type) => {
    const d = cur(type); const s = docStatus(d);
    return html`<div class="doc-card s-${s}">
      <div><b>${label('doc_type', type)}</b><span class="tag t-${s}">${label('doc_status', s)}</span></div>
      <div class="num">${d?.expiry_date ? html`ينتهي ${date(d.expiry_date)} · ${daysLeft(d.expiry_date) < 0 ? `منتهٍ منذ ${-daysLeft(d.expiry_date)} يوم` : `باقي ${daysLeft(d.expiry_date)} يوم`}` : 'لا يوجد تاريخ انتهاء مسجل'}</div>
      ${raw(d?.doc_no ? html`<small class="muted">رقم الوثيقة: <span class="num">${d.doc_no}</span></small>` : '')}
      <div class="btn-row">${raw(canAdd ? html`<button class="btn btn-sm" data-act="doc" data-type="${type}">${d ? 'تجديد' : 'إضافة'}</button>` : '')}${raw(d && canEdit ? html`<button class="btn btn-sm" data-act="doc-edit" data-type="${type}">تعديل</button>` : '')}</div>
    </div>`;
  };

  // جوال مستخدم السيارة: يُعرض بالأرقام الإنجليزية مع زر اتصال وزر واتساب
  const mobileCell = () => (v.current_user_mobile ? raw(html`<span class="mobile-cell"><bdi class="num" dir="ltr">${saMobileLocal(v.current_user_mobile)}</bdi>
      <a class="btn btn-sm" href="tel:${v.current_user_mobile}" data-call>${icon('phone')}<span>اتصال</span></a>
      <a class="btn btn-sm btn-wa" href="https://wa.me/${v.current_user_mobile.slice(1)}" target="_blank" rel="noopener" data-wa>${icon('chat')}<span>واتساب</span></a></span>`) : '—');
  const dDoc = (t) => dDocs.find((d) => d.doc_type === t);
  const driverDocsHtml = () => html`<section class="driver-docs">
    <div class="tab-head"><h3>وثائق السائق: ${v.driver_name}</h3>${raw(canAdd ? html`<button class="btn btn-sm" data-act="ddocs">تحديث وثائق السائق</button>` : '')}</div>
    <div class="table-wrap"><table class="rtable"><thead><tr><th>الوثيقة</th><th>الرقم</th><th>تاريخ الانتهاء</th><th>المتبقي</th><th>الحالة</th></tr></thead><tbody>
      ${raw([['iqama', 'الإقامة'], ['driving_license', 'رخصة القيادة']].map(([t, n]) => { const d = dDoc(t); const st = d?.status || 'missing'; return html`<tr>
        <td data-l="الوثيقة"><b>${n}</b></td>
        <td data-l="الرقم" class="num">${t === 'iqama' ? (sensOk ? dPriv[0]?.iqama_no || '—' : 'مخفي') : '—'}</td>
        <td data-l="تاريخ الانتهاء" class="num">${date(d?.expiry_date)}</td>
        <td data-l="المتبقي">${d?.days_left == null ? '—' : d.days_left < 0 ? `منتهية منذ ${num(-d.days_left)} يوم` : `باقي ${num(d.days_left)} يوم`}</td>
        <td data-l="الحالة"><span class="tag t-${st}">${label('doc_status', st)}</span></td></tr>`; }).join(''))}
    </tbody></table></div>
    <p class="muted small">التنبيه يظهر قبل الانتهاء حسب فترات التنبيه في الإعدادات. التواريخ السابقة تبقى في ملف الموظف عند التجديد أو تغيير السائق.</p>
  </section>`;

  // ---------------- سجل التعديلات الكامل (من سجل التدقيق)
  const ACT = { INSERT: 'إضافة', UPDATE: 'تعديل', ARCHIVE: 'حذف البطاقة إلى السجل', RESTORE: 'استرداد البطاقة', IMPORT: 'استيراد', DELETE: 'حذف' };
  const TBL = { vehicles: 'بطاقة السيارة', vehicle_private: 'أرقام الهوية', documents: 'المستندات' };
  const SKIP = new Set(['updated_at', 'created_at', 'odometer_updated_at', 'change_note', 'deleted_by', 'restored_by', 'restored_at', 'id']);
  const NO_RESTORE = new Set([...SKIP, 'code', 'deleted_at', 'delete_reason', 'odometer']);
  const cfDefs = customFields(true);
  const fname = (k) => (k.startsWith('cf:') ? (cfDefs.find((x) => x.key === k.slice(3))?.label || 'حقل إضافي')
    : { owner_company_id: L('owner_company', 'المالك'), site_id: L('site_name', 'المشروع الحالي'), make: L('make', 'ماركة السيارة'), model: L('model', 'طراز المركبة'),
        manufacture_year: L('manufacture_year', 'الموديل'), vin: L('vin', 'رقم الهيكل'), registration_type: L('registration_type', 'نوع التسجيل'), wheels_count: L('wheels_count', 'عدد العجلات'),
        op_state: L('op_state', 'الحالة التشغيلية'), op_state_text: 'وصف الحالة التشغيلية', notes: L('notes', 'ملاحظة'), current_user_name: L('current_user_name', 'المستخدم الحالي'),
        current_user_mobile: L('current_user_mobile', 'رقم هاتف السائق'), registration_serial: L('registration_serial', 'الرقم التسلسلي للاستمارة'), insurance_expiry: L('insurance_expiry', 'تاريخ انتهاء تأمين السيارة'),
        cost_oil: L('cost_oil', 'تكلفة تغيير الزيت'), cost_maint: L('cost_maint', 'تكلفة الصيانة'), cost_maint_total: L('cost_maint_total', 'إجمالي تكلفة الصيانة'), plate_no: 'رقم اللوحة', code: 'الرقم الداخلي', odometer: 'قراءة العداد' }[k] || FIELDS[k] || k);
  const vtext = (k, x) => {
    if (x == null || x === '') return '—';
    if (k.startsWith('cf:')) { const d = cfDefs.find((y) => y.key === k.slice(3)); return d ? cfText(d, x) : String(x); }
    if (VALUE_LABELS[k] && VALUE_LABELS[k][x]) return VALUE_LABELS[k][x];
    if (k === 'owner_company_id') return data.companyName(x);
    if (k === 'site_id') return data.siteName(x);
    if (k === 'current_driver_id') return data.employeeName(x);
    if (typeof x === 'boolean') return x ? 'نعم' : 'لا';
    if (typeof x === 'object') return JSON.stringify(x);
    if (/^\d{4}-\d{2}-\d{2}T/.test(x)) return dateTime(x);
    if (/^\d{4}-\d{2}-\d{2}$/.test(x)) return date(x);
    return String(x);
  };
  // قائمة [الحقل، القديم، الجديد] لعملية واحدة (الحقول الإضافية تُعرض كل حقل على حدة)
  const diffRows = (e) => {
    const out = [];
    const ch = e.changes || {};
    if (e.table === 'vehicle_private') return [['أرقام الهوية', 'مخفية', 'تم التغيير']];
    if (e.table === 'documents') { const d = e.new || e.old || {}; return [[label('doc_type', d.doc_type), vtext('expiry_date', e.old?.expiry_date), vtext('expiry_date', e.new?.expiry_date)]]; }
    if (e.action === 'INSERT') return [['البطاقة', '—', `أُضيفت (${e.new?.code || ''} ${e.new?.plate_no || ''})`]];
    for (const [k, d] of Object.entries(ch)) {
      if (SKIP.has(k)) continue;
      if (k === 'custom_fields') {
        const o = d.old || {}, n = d.new || {};
        for (const key of new Set([...Object.keys(o), ...Object.keys(n)])) if (JSON.stringify(o[key] ?? null) !== JSON.stringify(n[key] ?? null)) out.push([fname(`cf:${key}`), vtext(`cf:${key}`, o[key]), vtext(`cf:${key}`, n[key])]);
        continue;
      }
      out.push([fname(k), vtext(k, d.old), vtext(k, d.new)]);
    }
    return out;
  };
  const hxList = Array.isArray(hx) ? hx : [];
  const historyHtml = () => (hx == null ? html`<p class="muted pad">تعذر تحميل سجل التعديلات (يحتاج تحديث قاعدة البيانات).</p>` : hxList.length ? html`<div class="hx-list">${raw(hxList.map((e, i) => {
    const rows = diffRows(e);
    const reason = e.changes?.change_note?.new || (e.action === 'ARCHIVE' ? e.new?.delete_reason : null);
    return html`<article class="hx-item">
      <div class="hx-head"><span class="tag t-${e.action === 'ARCHIVE' ? 'expired' : e.action === 'RESTORE' ? 'valid' : 'no_date'}">${ACT[e.action] || e.action}</span>
        <b>${TBL[e.table] || e.table}</b><span class="num muted">${dateTime(e.at)}</span><span class="muted">${e.by || ''}</span></div>
      ${raw(rows.length ? html`<div class="table-wrap"><table class="rtable compact"><thead><tr><th>الحقل</th><th>القيمة القديمة</th><th>القيمة الجديدة</th></tr></thead><tbody>
        ${raw(rows.map(([f, o, n]) => html`<tr><td data-l="الحقل">${f}</td><td data-l="القيمة القديمة">${o}</td><td data-l="القيمة الجديدة">${n}</td></tr>`).join(''))}</tbody></table></div>` : '')}
      ${raw(reason ? html`<p class="small">السبب / الوصف: <b>${reason}</b></p>` : '')}
      ${raw(e.table === 'vehicles' && (e.old || e.new) ? html`<div class="btn-row"><button class="btn btn-sm" data-hx-view="${i}">عرض البيانات كاملة</button>
        ${raw(canEdit && e.old && e.action !== 'INSERT' ? html`<button class="btn btn-sm" data-hx-restore="${i}">استعادة البيانات السابقة</button>` : '')}</div>` : '')}
    </article>`;
  }).join(''))}</div>` : html`<p class="muted pad">لا توجد تعديلات مسجلة بعد.</p>`);

  const panels = {
    basic: (() => {
      const plate = (() => { const t = String(v.plate_no || '').trim(); const m = t.match(/^(.*?)[\s-]*([0-9٠-٩]+)$/); return m && m[1] ? [m[1].trim(), m[2]] : [t, '']; })();
      const docRows = (iso, extra = []) => { const s = docState(iso); return [...extra, ['تاريخ الانتهاء', raw(html`<span class="num">${date(iso)}</span>`)],
        ['عدد الأيام حتى الانتهاء', raw(html`<span class="num">${s.daysText}</span>`)], ['الحالة', raw(html`<span class="tag t-${{ none: 'missing', expired: 'expired', expiring: 'expiring', valid: 'valid' }[s.key]}">${s.text}</span>`)]]; };
      const c = costSummary(v, oil, maint);
      // الحقول الإضافية (من الإعدادات) في أقسامها؛ الحقل الموقوف يظهر فقط إن كانت له قيمة محفوظة
      const cvals = v.custom_fields || {};
      const cf = (n) => customFields(true).filter((x) => (n === 6 ? !(Number(x.section) >= 1 && Number(x.section) <= 5) : Number(x.section) === n) && (x.active !== false || (cvals[x.key] != null && cvals[x.key] !== '')))
        .map((x) => [x.label, x.type === 'textarea' && cvals[x.key] ? raw(html`<span class="pre">${cvals[x.key]}</span>`) : cfText(x, cvals[x.key])]);
      const more = (n) => (cf(n).length ? kv(cf(n)) : '');
      const hidden = raw('<span class="muted">مخفي (يتطلب صلاحية البيانات الحساسة)</span>');
      const legacy = [['نوع السيارة', v.vehicle_type], ['اللون', v.color], ['رقم المحرك', v.engine_no], ['موقع السيارة (نص)', v.location_text],
        ['المفوّض بالقيادة', v.authorized_name], ['تاريخ الدخول إلى الموقع', v.site_entry_date ? date(v.site_entry_date) : null]].filter(([, x]) => x != null && x !== '');
      return html`
      <div class="tab-head"><h2>بطاقة السيارة</h2>${raw(canEdit ? html`<button class="btn btn-sm" data-act="edit">${icon('edit')}<span>تعديل البيانات</span></button>` : '')}</div>
      <section class="vcard-sec"><h3>أولاً: بيانات ومعلومات المركبة الأساسية</h3>${kv([
        ['الرقم الداخلي', raw(html`<span class="code">${v.code}</span>`)], [L('plate_letters', 'اللوحة (حروف)'), plate[0] || '—'], [L('plate_digits', 'اللوحة (أرقام)'), raw(html`<span class="num">${plate[1] || '—'}</span>`)],
        [L('make', 'ماركة السيارة'), v.make], [L('model', 'طراز المركبة'), v.model], [L('manufacture_year', 'الموديل'), v.manufacture_year], [L('vin', 'رقم الهيكل'), v.vin], [L('registration_type', 'نوع التسجيل'), v.registration_type], [L('wheels_count', 'عدد العجلات'), v.wheels_count]])}${raw(more(1))}</section>
      <section class="vcard-sec"><h3>ثانياً: التشغيل والمشاريع</h3>${kv([
        [L('site_name', 'المشروع الحالي'), v.site_name], [L('op_state', 'الحالة التشغيلية'), raw(opChip(v))], [L('notes', 'ملاحظة'), v.notes ? raw(html`<span class="pre">${v.notes}</span>`) : null]])}${raw(more(2))}</section>
      <section class="vcard-sec"><h3>ثالثاً: المسؤولية والمالكون</h3>${kv([
        [L('current_user_name', 'المستخدم الحالي'), v.current_user_name], [L('current_user_id_no', 'هوية المستخدم'), sensOk ? raw(html`<span class="num" dir="ltr">${vPriv.current_user_id_no || '—'}</span>`) : hidden],
        [L('current_user_mobile', 'رقم هاتف السائق'), mobileCell()]])}
        ${kv([[L('owner_company', 'المالك'), v.owner_company_name], [L('owner_id_no', 'هوية المالك'), sensOk ? raw(html`<span class="num" dir="ltr">${vPriv.owner_id_no || '—'}</span>`) : hidden]])}${raw(more(3))}</section>
      <section class="vcard-sec"><h3>رابعاً: التراخيص والمستندات</h3>
        <h4>أ. رخصة السير والاستمارة</h4>${kv(docRows(cur('registration')?.expiry_date, [[L('registration_serial', 'الرقم التسلسلي للاستمارة'), v.registration_serial]]))}
        <h4>ب. الفحص الدوري</h4>${kv(docRows(cur('periodic_inspection')?.expiry_date))}
        <h4>ج. تأمين السيارة</h4>${kv(docRows(v.insurance_expiry))}${raw(more(4))}</section>
      <section class="vcard-sec"><h3>خامساً: التكاليف والمالية</h3>${kv([
        [L('cost_oil', 'تكلفة تغيير الزيت'), money(v.cost_oil)], [L('cost_maint', 'تكلفة الصيانة'), money(v.cost_maint)],
        [L('cost_maint_total', 'إجمالي تكلفة الصيانة'), raw(html`<b class="num">${c.total == null ? '—' : money(c.total)}</b><br><small class="muted">المصدر: ${c.source}</small>`)]])}${raw(more(5))}</section>
      ${raw(cf(6).length ? html`<section class="vcard-sec"><h3>${SECTIONS[6]}</h3>${raw(kv(cf(6)))}</section>` : '')}
      ${raw(legacy.length ? html`<details class="legacy-box"><summary>بيانات أخرى محفوظة سابقاً (${legacy.length})</summary>${kv(legacy)}</details>` : '')}`;
    })(),

    driver: html`
      <div class="tab-head"><h2>السائق المسؤول</h2>${raw(canEdit ? html`<button class="btn btn-sm" data-act="driver">${v.current_driver_id ? 'تغيير السائق' : 'تعيين سائق'}</button>` : '')}</div>
      ${raw(v.current_driver_id ? html`<div class="person"><b>${v.driver_name}</b> <span class="code">${v.driver_code}</span>
          <span class="muted">مسؤول منذ <span class="num">${dateTime(assigns.find((a) => !a.end_at)?.start_at)}</span></span>
          <a class="btn btn-sm" href="#/employees/${v.current_driver_id}">ملف الموظف</a></div>`
        : html`<p class="warn-box">لا يوجد سائق مسؤول حالياً عن هذه السيارة.</p>`)}
      ${raw(v.current_user_name || v.authorized_name ? html`<dl class="dl"><div><dt>المستخدم الحالي</dt><dd>${v.current_user_name || '—'}</dd></div><div><dt>رقم جوال المستخدم</dt><dd>${mobileCell()}</dd></div><div><dt>المفوّض بالقيادة</dt><dd>${v.authorized_name || '—'}</dd></div></dl>` : '')}
      ${raw(v.current_driver_id ? driverDocsHtml() : '')}
      <h3 class="sub">كل من استلم هذه السيارة</h3>
      ${table(['الموظف', 'من', 'إلى', 'نموذج التسليم'], assigns.map((a) => [
        raw(html`<a href="#/employees/${a.employee_id}">${data.employeeName(a.employee_id)}</a>`), raw(html`<span class="num">${dateTime(a.start_at)}</span>`),
        a.end_at ? raw(html`<span class="num">${dateTime(a.end_at)}</span>`) : raw('<span class="tag t-valid">حالياً</span>'),
        hand.find((h) => h.id === a.handover_id)?.form_no || '—']), 'لم يُسجل أي سائق لهذه السيارة بعد.')}`,

    auth: html`
      <div class="tab-head"><h2>الملكية والتفويض</h2>${raw(canAdd ? html`<button class="btn btn-sm" data-act="auth">إضافة أو تجديد تفويض</button>` : '')}</div>
      ${raw(authBad ? html`<p class="bad-box">${icon('alert')}<span>تنبيه: السائق الحالي ${v.driver_name} — التفويض ${label('auth_status', v.authorization_status)}.</span></p>` : '')}
      ${kv([
        ['الشركة المالكة للسيارة', v.owner_company_name], ['الموقع المستخدم للسيارة', v.site_name], ['الشركة المشغلة (تبعية الموقع)', v.site_company_name],
        ['السائق الحالي', v.driver_name], ['هل السائق مفوّض؟', !v.current_driver_id ? '—' : authNow?.is_authorized && v.authorization_status === 'valid' ? 'نعم' : 'لا'],
        ['حالة التفويض', raw(html`<span class="tag t-${v.authorization_status}">${label('auth_status', v.authorization_status)}</span>`)],
        ['رقم التفويض', authNow?.auth_no], ['تاريخ الإصدار', date(authNow?.issue_date)], ['تاريخ الانتهاء', date(authNow?.expiry_date)], ['ملاحظات', authNow?.notes],
      ])}
      <h3 class="sub">سجل التفويضات وتجديداتها</h3>
      ${table(['الموظف', 'مفوّض', 'رقم التفويض', 'الإصدار', 'الانتهاء', 'ملاحظات'], auths.map((a) => [
        data.employeeName(a.employee_id), a.is_authorized ? 'نعم' : 'لا', a.auth_no, raw(html`<span class="num">${date(a.issue_date)}</span>`), raw(html`<span class="num">${date(a.expiry_date)}</span>`), a.notes]), 'لا توجد تفويضات مسجلة.')}
      <p class="muted small">صورة التفويض: تبويب «الفواتير والمرفقات» ← نوع المستند «صورة التفويض».</p>`,

    docs: html`
      <div class="tab-head"><h2>الوثائق</h2></div>
      <div class="doc-cards">${docCard('registration')}${docCard('periodic_inspection')}${raw((() => { const s = docState(v.insurance_expiry); const k = { none: 'missing', expired: 'expired', expiring: 'expiring', valid: 'valid' }[s.key];
          return html`<div class="doc-card s-${k}"><div><b>تأمين السيارة</b><span class="tag t-${k}">${s.text}</span></div>
            <div class="num">${v.insurance_expiry ? html`ينتهي ${date(v.insurance_expiry)} · ${s.key === 'expired' ? s.daysText : `باقي ${s.daysText}`}` : 'لا يوجد تاريخ انتهاء مسجل'}</div>
            <small class="muted">تنبيه قبل الانتهاء بـ 30 و15 و7 أيام ويوم واحد</small>
            <div class="btn-row">${raw(canEdit ? html`<button class="btn btn-sm" data-act="ins-edit">${v.insurance_expiry ? 'تعديل أو تجديد' : 'إضافة'}</button>` : '')}</div></div>`; })())}
        <div class="doc-card s-${v.authorization_status === 'valid' ? 'valid' : v.authorization_status === 'expired' ? 'expired' : 'missing'}"><div><b>التفويض</b><span class="tag t-${v.authorization_status}">${label('auth_status', v.authorization_status)}</span></div>
          <div class="num">${v.authorization_expiry ? `ينتهي ${date(v.authorization_expiry)}` : '—'}</div><button class="btn btn-sm" data-tab="auth">عرض التفويض</button></div>
      </div>
      <h3 class="sub">كل وثائق السيارة (الحالية والسابقة)</h3>
      ${table(['الوثيقة', 'رقمها', 'الإصدار', 'الانتهاء', 'ملاحظات'], docs.map((d) => [label('doc_type', d.doc_type), d.doc_no, raw(html`<span class="num">${date(d.issue_date)}</span>`), raw(html`<span class="num">${date(d.expiry_date)}</span>`), d.notes]), 'لا توجد وثائق مسجلة.')}`,

    oil: html`<div class="tab-head"><h2>تغيير الزيت</h2>${raw(canAdd ? html`<button class="btn btn-sm btn-primary" data-act="oil">إضافة تغيير زيت</button>` : '')}</div>
      ${kv([['آخر تغيير', date(oil[0]?.change_date)], ['العداد عند آخر تغيير', km(oil[0]?.odometer)], ['قراءة العداد القادمة', km(v.oil_next_odometer)],
        ['العداد الحالي', km(v.odometer)], ['المسافة المتبقية', v.oil_remaining_km == null ? '—' : km(v.oil_remaining_km)], ['الحالة', label('oil_status', v.oil_status)]])}
      <h3 class="sub">كل عمليات تغيير الزيت</h3>
      ${table(['رقم العملية', 'التاريخ', 'العداد', 'القادم', 'الورشة', 'الزيت / الفلتر', 'الإجمالي', ''], oil.map((o) => [raw(html`<span class="code">${o.oil_no}</span>`), raw(html`<span class="num">${date(o.change_date)}</span>`), km(o.odometer), km(o.next_odometer), o.workshop, [o.oil_type, o.filter_type].filter(Boolean).join(' / ') || '—', money(o.total), edBtn('oil', o.id)]), 'لا توجد سجلات تغيير زيت.')}`,
    maint: html`<div class="tab-head"><h2>طلبات الصيانة</h2>${raw(canAdd && reqs ? html`<button class="btn btn-sm btn-primary" data-act="mreq">طلب صيانة جديد</button>` : '')}</div>
      ${raw(reqs === null ? '<p class="later">طلبات الصيانة تحتاج تشغيل ملف التحديث 0007 في Supabase.</p>' : String(table(['رقم الطلب', 'التاريخ', 'العطل', 'تاريخ آخر تغيير', 'المستخدم', 'الحالة'], reqs.map((r) => [raw(html`<a class="code strong" href="#/requests/${r.id}">${r.request_no}</a>`), raw(html`<span class="num">${date(r.request_date)}</span>`), r.fault && r.fault.length > 60 ? r.fault.slice(0, 60) + '…' : r.fault, raw(html`<span class="num">${date(r.last_change_date)}</span>`), r.driver_name, raw(mrTag(r.status))]), 'لا توجد طلبات صيانة لهذه السيارة.')))}
      <div class="tab-head sub-head"><h3>فواتير الصيانة السابقة</h3>${raw(canAdd ? html`<button class="btn btn-sm" data-act="maint">إضافة فاتورة صيانة</button>` : '')}</div>
      <p class="muted small">إجمالي الصيانة لهذه السيارة: <b class="num">${money(maint.reduce((s, m) => s + Number(m.total || 0), 0))}</b></p>
      ${table(['رقم الصيانة', 'التاريخ', 'النوع', 'الورشة', 'قبل الضريبة', 'الضريبة', 'الإجمالي', 'السداد', ''], maint.map((m) => [raw(html`<span class="code">${m.maint_no}</span>`), raw(html`<span class="num">${date(m.maint_date)}</span>`), m.maint_type, m.workshop, money(m.subtotal), money(m.vat_amount), money(m.total), label('payment_status', m.payment_status), edBtn('maint', m.id)]), 'لا توجد سجلات صيانة.')}`,
    acc: html`<div class="tab-head"><h2>الحوادث</h2>${raw(canAdd ? html`<button class="btn btn-sm btn-primary" data-act="acc">تسجيل حادث</button>` : '')}</div>
      ${table(['رقم الحادث', 'التاريخ والوقت', 'السائق', 'الوصف', 'الحالة', 'الإجمالي', ''], acc.map((a) => [raw(html`<span class="code">${a.accident_no}</span>`), raw(html`<span class="num">${dateTime(a.occurred_at)}</span>`), data.employeeName(a.driver_id), a.description, raw(html`<span class="tag t-acc-${a.status}">${label('accident_status', a.status)}</span>`), money(a.total), edBtn('acc', a.id, 'تحديث')]), 'لا توجد حوادث مسجلة.')}`,
    hand: html`<div class="tab-head"><h2>استلام وتسليم</h2>${raw(canAdd ? html`<button class="btn btn-sm btn-primary" data-act="hand">نموذج جديد</button>` : '')}</div>
      ${table(['رقم النموذج', 'النوع', 'التاريخ والوقت', 'المسلّم', 'المستلم', 'العداد', 'الحالة', ''], hand.map((h) => [raw(html`<span class="code">${h.form_no}</span>`), h.kind === 'receive' ? 'استلام' : 'تسليم', raw(html`<span class="num">${dateTime(h.occurred_at)}</span>`), h.from_employee_id ? data.employeeName(h.from_employee_id) : 'الشركة', h.to_employee_id ? data.employeeName(h.to_employee_id) : 'الشركة', km(h.odometer),
        raw(html`<span class="tag t-ho-${h.state}">${{ draft: 'مسودة', approved: 'معتمد', cancelled: 'ملغى' }[h.state]}</span>`),
        raw(html`<a class="btn btn-sm" href="#/handovers/${h.id}?print=1">طباعة</a>${raw(h.state === 'draft' && canEdit ? html`<button class="btn btn-sm btn-primary" data-act="ho-approve" data-id="${h.id}">اعتماد</button>` : '')}`)]), 'لا توجد نماذج استلام أو تسليم.')}`,
    files: html`<div class="att-box"><p class="muted">جارٍ تحميل المرفقات…</p></div>`,
    costs: html`<div class="tab-head"><h2>سجل التكاليف</h2><span class="num strong">${money(costs.reduce((s, c) => s + Number(c.total || 0), 0))}</span></div>
      ${table(['التاريخ', 'النوع', 'المرجع', 'الموقع وقت العملية', 'الإجمالي'], costs.map((c) => [raw(html`<span class="num">${date(c.expense_date)}</span>`), { oil_change: 'تغيير زيت', maintenance: 'صيانة', accident: 'حادث' }[c.category] || c.category, c.ref_no, data.siteName(c.site_id), money(c.total)]), 'لا توجد تكاليف مسجلة لهذه السيارة.')}`,
    log: html`<div class="tab-head"><h2>سجل التعديلات</h2></div>
      <p class="muted small">كل تغيير على بيانات هذه السيارة محفوظ هنا بقيمته القديمة والجديدة، ولا يُمحى بتعديل لاحق.</p>
      ${raw(historyHtml())}
      <h3 class="sub">ملخص التغييرات المهمة (المالك، الموقع، السائق، الحالة، اللوحة)</h3>
      ${table(['التاريخ والوقت', 'الحقل', 'القيمة السابقة', 'القيمة الجديدة'], hist.map((h) => [raw(html`<span class="num">${dateTime(h.changed_at)}</span>`), label('field', h.field),
        h.field === 'op_status' ? label('op_status', h.old_value) : h.field === 'location_status' ? label('location_status', h.old_value) : (h.old_label ?? h.old_value),
        h.field === 'op_status' ? label('op_status', h.new_value) : h.field === 'location_status' ? label('location_status', h.new_value) : (h.new_label ?? h.new_value)]), 'لا توجد تغييرات مسجلة بعد.')}
      <h3 class="sub">قراءات العداد</h3>
      ${table(['التاريخ والوقت', 'القراءة', 'المصدر', 'السبب'], odo.map((o) => [raw(html`<span class="num">${dateTime(o.read_at)}</span>`), km(o.reading), label('odometer_source', o.source), o.reason]), 'لا توجد قراءات.')}`,
  };

  const soon = (p) => raw(html`data-later="${p}"`);
  el.innerHTML = html`
    <a class="back" href="${archived ? '#/settings/vehicles-archive' : '#/vehicles'}">${icon('back')}<span>${archived ? 'سجل السيارات المحذوفة' : 'السيارات'}</span></a>
    ${raw(archived ? html`<div class="bad-box archived-box">${icon('alert')}<div><b>هذه البطاقة في سجل السيارات المحذوفة</b> — حُذفت من العرض النشط بتاريخ <span class="num">${dateTime(v.deleted_at)}</span>${v.deleted_by_name ? ` بواسطة ${v.deleted_by_name}` : ''}${v.delete_reason ? ` · السبب: ${v.delete_reason}` : ''}.
      جميع معلوماتها وسجلاتها محفوظة، وتنبيهاتها متوقفة.${raw(canRestore ? html`<div class="btn-row"><button class="btn btn-primary" data-act="restore-card">${icon('shield')}<span>استرداد البطاقة</span></button></div>` : '')}</div></div>` : '')}
    <header class="vhead">
      <div class="vhead-main">
        <div class="plate-big plate">${v.plate_no}</div>
        <div><h1>${[v.vehicle_type, v.make, v.model].filter(Boolean).join(' ') || 'سيارة'} <span class="code">${v.code}</span></h1>
          <p class="muted">${raw([v.manufacture_year ? html`موديل <span class="num">${v.manufacture_year}</span>`.toString() : '', v.color ? html`${v.color}`.toString() : ''].filter(Boolean).join(' · '))}</p></div>
        ${raw(opChip(v))}<span class="pill st-${v.op_status}">${label('op_status', v.op_status)}</span>
      </div>
      <dl class="vfacts">
        <div><dt>الشركة المالكة</dt><dd>${v.owner_company_name}</dd></div>
        <div><dt>الموقع الذي تعمل فيه</dt><dd>${v.site_name || '—'}</dd></div>
        <div><dt>السائق المسؤول</dt><dd>${v.driver_name || '—'}</dd></div>
        <div><dt>حالة التفويض</dt><dd><span class="tag t-${v.authorization_status}">${label('auth_status', v.authorization_status)}</span></dd></div>
        <div><dt>قراءة العداد</dt><dd class="num">${km(v.odometer)}</dd></div>
        <div><dt>أقرب موعد صيانة (الزيت)</dt><dd class="num">${v.oil_next_odometer ? html`${km(v.oil_next_odometer)} <small class="tag t-${v.oil_status}">${label('oil_status', v.oil_status)}</small>` : 'لا يوجد سجل'}</dd></div>
        ${raw(['registration', 'periodic_inspection'].map((t) => { const d = cur(t), s = docStatus(d), dl = daysLeft(d?.expiry_date);
          return html`<div><dt>انتهاء ${label('doc_type', t)}</dt><dd class="num">${d?.expiry_date ? date(d.expiry_date) : ''} <small class="tag t-${s}">${d?.expiry_date ? (dl < 0 ? `منتهية منذ ${-dl} يوم` : `باقي ${dl} يوم`) : label('doc_status', s)}</small></dd></div>`; }).join(''))}
        ${raw((() => { const s = docState(v.insurance_expiry); return html`<div><dt>انتهاء التأمين</dt><dd class="num">${v.insurance_expiry ? date(v.insurance_expiry) : ''} <small class="tag t-${{ none: 'missing', expired: 'expired', expiring: 'expiring', valid: 'valid' }[s.key]}">${v.insurance_expiry ? (s.key === 'expired' ? s.daysText : `${s.text} · ${s.daysText}`) : 'غير محدد'}</small></dd></div>`; })())}
        <div><dt>أقرب انتهاء وثيقة</dt><dd class="num">${v.nearest_doc_expiry ? html`${date(v.nearest_doc_expiry)} <small class="muted">${label('doc_type', v.nearest_doc_type)}</small>` : '—'}</dd></div>
      </dl>
      <div class="vactions no-print">
        ${raw(canEdit ? html`<button class="btn btn-primary" data-act="edit">${icon('edit')}<span>تعديل البيانات</span></button><button class="btn" data-act="odo">${icon('gauge')}<span>تحديث العداد</span></button>` : '')}
        ${raw(canAdd ? html`<button class="btn" data-act="oil">${icon('oil')}<span>إضافة تغيير زيت</span></button>
        <button class="btn" data-act="mreq">${icon('wrench')}<span>طلب صيانة</span></button>
        <button class="btn" data-act="acc">${icon('alert')}<span>تسجيل حادث</span></button>
        <button class="btn" data-act="hand">${icon('swap')}<span>نموذج استلام أو تسليم</span></button>` : '')}
        <button class="btn" data-tab="files">${icon('invoice')}<span>الفواتير والصور</span></button>
        <button class="btn" data-act="print">${icon('print')}<span>طباعة ملف السيارة</span></button>
        <button class="btn" ${soon(7)}>${icon('table')}<span>تصدير إلى Excel</span></button>
        ${raw(canEdit ? html`<button class="btn btn-danger-soft" data-act="archive">${icon('close')}<span>حذف البطاقة إلى السجل</span></button>` : '')}
      </div>
    </header>
    <nav class="tabs no-print" role="tablist">${raw(TABS.map(([k, t]) => html`<button role="tab" class="tabbtn ${k === tab ? 'on' : ''}" aria-selected="${k === tab}" data-tab="${k}">${t}</button>`).join(''))}</nav>
    ${raw(TABS.map(([k]) => html`<section class="tab-panel panel ${k === tab ? 'on' : ''}" data-panel="${k}">${panels[k]}</section>`).join(''))}`;

  const reload = (t = tab) => { location.hash = `#/vehicles/${id}?tab=${t}&r=${Date.now()}`; };

  el.onclick = async (e) => {
    const tb = e.target.closest('[data-tab]');
    if (tb) {
      const k = tb.dataset.tab;
      el.querySelectorAll('.tabbtn').forEach((b) => { b.classList.toggle('on', b.dataset.tab === k); b.setAttribute('aria-selected', b.dataset.tab === k); });
      el.querySelectorAll('.tab-panel').forEach((p) => p.classList.toggle('on', p.dataset.panel === k));
      history.replaceState(null, '', `#/vehicles/${id}?tab=${k}`);
      el.querySelector(`.tabbtn[data-tab="${k}"]`)?.scrollIntoView({ block: 'nearest', inline: 'center' });
      return;
    }
    const lt = e.target.closest('[data-later]');
    if (lt) { toast(`هذه الخاصية تُفعَّل في المرحلة ${lt.dataset.later}.`, 'ok'); return; }
    const hv = e.target.closest('[data-hx-view]');
    if (hv) {
      const x = hxList[+hv.dataset.hxView]; const o = x.old || {}, n = x.new || {};
      const keys = [...new Set([...Object.keys(o), ...Object.keys(n)])].filter((k) => !SKIP.has(k) && !['deleted_by', 'restored_by'].includes(k));
      const rows = [];
      for (const k of keys) {
        if (k === 'custom_fields') { for (const ck of new Set([...Object.keys(o.custom_fields || {}), ...Object.keys(n.custom_fields || {})])) rows.push([fname(`cf:${ck}`), vtext(`cf:${ck}`, (o.custom_fields || {})[ck]), vtext(`cf:${ck}`, (n.custom_fields || {})[ck])]); continue; }
        rows.push([fname(k), vtext(k, o[k]), vtext(k, n[k])]);
      }
      rows.sort((p1, p2) => (p2[1] !== p2[2]) - (p1[1] !== p1[2]));  // الحقول التي تغيّرت أولاً
      await confirmBox(html`<p class="muted small">${ACT[x.action] || x.action} · <span class="num">${dateTime(x.at)}</span> · ${x.by || ''}</p>
        <div class="table-wrap"><table class="rtable compact snapshot"><thead><tr><th>الحقل</th><th>قبل التعديل</th><th>بعد التعديل</th></tr></thead><tbody>
        ${raw(rows.map(([f, a1, b1]) => html`<tr class="${a1 !== b1 ? 'hx-changed' : ''}"><td data-l="الحقل">${f}</td><td data-l="قبل التعديل">${a1}</td><td data-l="بعد التعديل">${b1}</td></tr>`).join(''))}</tbody></table></div>`.toString(),
      { title: 'صورة كاملة لبيانات السيارة', okText: 'إغلاق', cancelText: 'رجوع' });
      return;
    }
    const hr = e.target.closest('[data-hx-restore]');
    if (hr) {
      const x = hxList[+hr.dataset.hxRestore]; const o = x.old || {};
      const changedHere = new Set(Object.keys(x.changes || {}));
      const cand = Object.keys(o).filter((k) => !NO_RESTORE.has(k) && k in v && JSON.stringify(o[k] ?? null) !== JSON.stringify(v[k] ?? null));
      if (!cand.length) { toast('بيانات السيارة الحالية مطابقة لما كانت عليه قبل هذا التعديل؛ لا يوجد ما يُستعاد.', 'ok'); return; }
      const show = (k, val) => (k === 'custom_fields' ? Object.entries(val || {}).map(([ck, cv]) => `${fname(`cf:${ck}`)}: ${vtext(`cf:${ck}`, cv)}`).join('، ') || '—' : vtext(k, val));
      const r = await openForm({
        title: 'استعادة البيانات السابقة', draft: false,
        intro: html`اختر الحقول التي تريد إعادتها إلى قيمتها قبل تعديل <b class="num">${dateTime(x.at)}</b>. لكل حقل: <b>القيمة الحالية ← القيمة التي ستُستعاد</b>. تُسجَّل الاستعادة كتعديل جديد، ويبقى كل ما قبلها وبعدها في السجل.`.toString(),
        fields: cand.map((k) => ({ name: `r__${k}`, type: 'checkbox', full: true, label: `${fname(k)}: «${show(k, v[k])}» ← «${show(k, o[k])}»` })),
        values: Object.fromEntries(cand.map((k) => [`r__${k}`, changedHere.has(k)])),
        submitText: 'استعادة البيانات المحددة',
        onSubmit: async (val) => {
          const pick = cand.filter((k) => val[`r__${k}`]);
          if (!pick.length) throw userError('اختر حقلاً واحداً على الأقل.');
          if (!(await confirmBox(`سيتم تغيير ${pick.length} حقل في هذه السيارة إلى قيمها السابقة. هل تريد المتابعة؟`, { title: 'تأكيد الاستعادة', okText: 'استعادة' }))) throw userError('لم تُنفَّذ الاستعادة.');
          const patch = Object.fromEntries(pick.map((k) => [k, o[k] ?? null]));
          const p0 = localParts(x.at);
          patch.change_note = `استعادة قيم سابقة من تعديل ${p0.date} ${p0.time}`;
          const [row] = await api.update('vehicles', { id: `eq.${id}` }, patch);
          if (!row) throw userError('لم تُحفظ الاستعادة.');
          return row;
        },
      });
      if (r) { saved('تمت استعادة البيانات السابقة'); data.invalidate(); reload('log'); }
      return;
    }
    const b = e.target.closest('[data-act]'); if (!b) return;
    const act = b.dataset.act;

    if (act === 'archive') {
      const r = await openForm({
        title: 'حذف البطاقة إلى السجل', draft: false, submitText: 'نقل البطاقة إلى السجل',
        intro: html`ستُنقل بطاقة <b>${v.code} — ${v.plate_no}</b> إلى «سجل السيارات المحذوفة» وتختفي من قائمة السيارات النشطة، وتتوقف تنبيهاتها (التأمين، الاستمارة، الفحص، الزيت، الحوادث، طلبات الصيانة).
          <b>لن يُحذف أي شيء</b>: معلوماتها ومستنداتها وسجلات الصيانة والزيت والحوادث والمصاريف وسجل تعديلاتها تبقى محفوظة، ويمكن استرداد البطاقة في أي وقت.`.toString(),
        fields: [{ name: 'reason', label: 'سبب الحذف (اختياري)', type: 'textarea', full: true }],
        onSubmit: async (val) => api.rpc('archive_vehicle', { p_id: id, p_reason: val.reason || null }),
      });
      if (r) { saved(`نُقلت البطاقة ${v.code} إلى سجل السيارات المحذوفة`); data.invalidate(); location.hash = '#/vehicles'; }
      return;
    }
    if (act === 'restore-card') {
      const r = await openForm({
        title: 'استرداد البطاقة', draft: false, submitText: 'استرداد البطاقة',
        intro: html`ستعود بطاقة <b>${v.code} — ${v.plate_no}</b> إلى قائمة السيارات النشطة بنفس رقمها ومعرّفها وكل سجلاتها، وتعود تنبيهاتها حسب التواريخ الحالية.`.toString(),
        fields: [{ name: 'reason', label: 'ملاحظة (اختياري)', type: 'textarea', full: true }],
        onSubmit: async (val) => api.rpc('restore_vehicle', { p_id: id, p_reason: val.reason || null }),
      });
      if (r) { saved(`تم استرداد البطاقة ${v.code}`); data.invalidate(); location.hash = `#/vehicles/${id}?r=${Date.now()}`; }
      return;
    }

    if (act === 'mreq') { const r = await requestForm(id); if (r) { saved(`تم حفظ الطلب ${r.request_no}`); location.hash = `#/requests/${r.id}`; } return; }
    const opsMap = { oil: [oilForm, 'oil', oil], maint: [maintForm, 'maint', maint], acc: [accidentForm, 'acc', acc], hand: [handoverForm, 'hand', hand] };
    if (opsMap[act]) { const [fn, t] = opsMap[act]; if (await fn(id)) { saved(); reload(t); } return; }
    const ek = act.replace(/-edit$/, '');
    if (act.endsWith('-edit') && opsMap[ek]) { const [fn, t, list] = opsMap[ek]; const row = list.find((x) => x.id === b.dataset.id); if (row && await fn(null, row)) { saved(); reload(t); } return; }
    if (act === 'ho-approve') { const row = hand.find((x) => x.id === b.dataset.id); if (row && await approveHandover(row)) reload('hand'); return; }
    if (act === 'print') { el.classList.add('printing'); window.print(); el.classList.remove('printing'); return; }

    if (act === 'edit') {
      const priv = api.can('view_sensitive') ? (await api.get('vehicle_private', { select: '*', vehicle_id: `eq.${id}` }).catch(() => []))[0] || {} : {};
      const r = await vehicleCardForm(v, { docs: { registration: cur('registration'), periodic_inspection: cur('periodic_inspection') }, priv, oil, maint });
      if (r) { saved('تم حفظ التعديلات'); reload(); }
      return;
    }

    if (act === 'ins-edit') {
      const r = await openForm({
        title: `تأمين السيارة ${v.code}`,
        fields: [{ name: 'insurance_expiry', label: 'تاريخ انتهاء تأمين السيارة', type: 'date', required: true, help: 'بصيغة YYYY/MM/DD أو من التقويم' }],
        values: { insurance_expiry: v.insurance_expiry || '' },
        onSubmit: async (val) => { const [row] = await api.update('vehicles', { id: `eq.${id}` }, { insurance_expiry: val.insurance_expiry }); if (!row) throw userError('لم يُحفظ التاريخ.'); return row; },
      });
      if (r) { saved('تم حفظ تاريخ انتهاء التأمين'); reload('docs'); }
      return;
    }

    if (act === 'odo') {
      const r = await openForm({
        title: 'تحديث قراءة العداد',
        intro: html`آخر قراءة مسجلة: <b class="num">${km(v.odometer)}</b>`.toString(),
        fields: [
          { name: 'reading', label: 'القراءة الجديدة (كم)', type: 'number', required: true, min: 0 },
          { name: 'reason', label: 'سبب التصحيح (فقط إذا كانت القراءة أقل من السابقة)', type: 'textarea', full: true },
        ],
        onSubmit: async ({ reading, reason }) => {
          if (reading < v.odometer) {
            if (!reason) throw userError(`القراءة ${num(reading)} أقل من آخر قراءة موثقة ${num(v.odometer)}. إذا كان هذا تصحيحاً لخطأ سابق فاكتب السبب ثم احفظ مرة أخرى.`);
            await api.rpc('correct_odometer', { p_vehicle: id, p_reading: reading, p_reason: reason }); return true;
          }
          if (reading === v.odometer) return true;
          return api.update('vehicles', { id: `eq.${id}` }, { odometer: reading });
        },
      });
      if (r) { saved('تم تحديث العداد'); reload(); }
    }

    if (act === 'ddocs') {
      const cur = { iqama: dDoc('iqama')?.expiry_date || null, license: dDoc('driving_license')?.expiry_date || null };
      const fields = [];
      if (sensOk) fields.push({ name: 'iqama_no', label: 'رقم الإقامة', inputmode: 'numeric', dir: 'ltr', western: true, help: '10 أرقام' });
      fields.push({ name: 'iqama_expiry', label: 'تاريخ انتهاء الإقامة', type: 'date' }, { name: 'license_expiry', label: 'تاريخ انتهاء رخصة القيادة', type: 'date' });
      const r = await openForm({
        title: `وثائق السائق ${v.driver_name}`, fields,
        intro: 'التاريخ الجديد يُحفظ كسجل جديد ويبقى السابق في ملف الموظف.',
        values: { iqama_no: dPriv[0]?.iqama_no || '', iqama_expiry: cur.iqama, license_expiry: cur.license },
        onSubmit: async (val) => { await saveDriverDocs(v.current_driver_id, val, cur); return true; },
      });
      if (r) { saved(); reload('driver'); }
      return;
    }

    if (act === 'driver') {
      const r = await openForm({
        title: v.current_driver_id ? 'تغيير السائق المسؤول' : 'تعيين سائق مسؤول',
        intro: 'يُغلق النظام فترة السائق السابق تلقائياً ويحفظها في السجل. (من المرحلة 4 يمكن إجراء التغيير عبر نموذج استلام وتسليم رسمي.) تأكد من تسجيل تفويض للسائق الجديد في «الملكية والتفويض».',
        fields: [{ name: 'driver', label: 'السائق', type: 'combo', options: employeeLabels(), full: true, help: 'اختر موظفاً أو اكتب أي اسم؛ اتركه فارغاً لإزالة السائق' }],
        values: { driver: v.current_driver_id ? employeeLabel(v.current_driver_id) : '' },
        onSubmit: async (val) => api.update('vehicles', { id: `eq.${id}` }, { current_driver_id: await resolveEmployee(val.driver, { company_id: v.site_company_id || v.owner_company_id, site_id: v.site_id }) }),
      });
      if (r) { saved(); reload('driver'); }
    }

    if (act === 'auth') {
      const r = await openForm({
        title: 'إضافة أو تجديد تفويض',
        intro: 'كل تفويض يُحفظ سجلاً مستقلاً؛ التفويضات السابقة لا تُحذف.',
        fields: [
          { name: 'employee_id', label: 'الموظف', type: 'select', required: true, options: data.employeeOptions(), full: true },
          { name: 'is_authorized', label: 'السائق مفوّض بقيادة السيارة', type: 'checkbox', full: true },
          { name: 'auth_no', label: 'رقم التفويض', dir: 'ltr', western: true },
          { name: 'issue_date', label: 'تاريخ الإصدار', type: 'date' },
          { name: 'expiry_date', label: 'تاريخ الانتهاء', type: 'date' },
          { name: 'notes', label: 'ملاحظات', type: 'textarea', full: true },
        ],
        values: { employee_id: v.current_driver_id, is_authorized: true },
        onSubmit: (val) => api.insert('authorizations', { ...val, vehicle_id: id }),
      });
      if (r) { saved(); reload('auth'); }
    }

    if (act === 'doc') {
      const type = b.dataset.type;
      const prev = cur(type);
      const r = await openForm({
        title: `${prev ? 'تجديد' : 'إضافة'} ${label('doc_type', type)}`,
        intro: prev ? 'يُحفظ كسجل جديد وتبقى الوثيقة السابقة في السجل.' : '',
        fields: [
          { name: 'doc_no', label: 'رقم الوثيقة', dir: 'ltr', western: true },
          { name: 'issue_date', label: 'تاريخ الإصدار', type: 'date' },
          { name: 'expiry_date', label: 'تاريخ الانتهاء', type: 'date' },
          { name: 'notes', label: 'ملاحظات', type: 'textarea', full: true },
        ],
        onSubmit: (val) => api.insert('documents', { ...val, doc_type: type, vehicle_id: id }),
      });
      if (r) { saved(); reload('docs'); }
    }

    if (act === 'doc-edit') {
      const type = b.dataset.type;
      const d = cur(type);
      const r = await openForm({
        title: `تعديل ${label('doc_type', type)}`,
        intro: 'لتصحيح خطأ في الوثيقة الحالية. للتجديد استخدم زر «تجديد» حتى تبقى الوثيقة السابقة في السجل. كل تعديل يُحفظ في سجل التدقيق.',
        fields: [
          { name: 'doc_no', label: 'رقم الوثيقة', dir: 'ltr', western: true },
          { name: 'issue_date', label: 'تاريخ الإصدار', type: 'date' },
          { name: 'expiry_date', label: 'تاريخ الانتهاء', type: 'date' },
          { name: 'notes', label: 'ملاحظات', type: 'textarea', full: true },
        ],
        values: d,
        onSubmit: (val) => api.update('documents', { id: `eq.${d.id}` }, val),
      });
      if (r) { saved(); reload('docs'); }
    }
  };

  // المرفقات: صور السيارة ووثائقها + فواتير وصور كل عملياتها (زيت، صيانة، حوادث، تسليم)
  const refs = new Map([...oil.map((o) => [o.id, `تغيير زيت ${o.oil_no}`]), ...maint.map((m) => [m.id, `صيانة ${m.maint_no}`]), ...acc.map((a) => [a.id, `حادث ${a.accident_no}`]), ...hand.map((h) => [h.id, `نموذج ${h.form_no}`])]);
  mountAttachments(el.querySelector('[data-panel=files] .att-box'), {
    entity_type: 'vehicle', entity_id: id, extraIds: [...refs.keys()], title: 'الفواتير والمرفقات',
    ownerLabel: (a) => (a.entity_id === id ? 'السيارة' : refs.get(a.entity_id) || ''),
  }).catch(() => {});

  if (params.get('edit') === '1' && canEdit) { history.replaceState(null, '', `#/vehicles/${id}`); el.querySelector('[data-act=edit]')?.click(); }
}
