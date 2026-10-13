// المرفقات: رفع من الكاميرا أو الألبوم أو الملفات، تخزين دائم، عرض وتنزيل، أرشفة
import * as api from './api.js';
import { html, raw, icon, toast, esc } from './ui.js';
import { date, dateTime, todayISO, errorText } from './fmt.js';
import { openForm, confirmBox, saved } from './form.js';

export const CATEGORY = {
  oil_invoice: 'فاتورة تغيير زيت', maintenance_invoice: 'فاتورة صيانة', repair_photo: 'صورة إصلاح',
  accident_photo: 'صورة حادث / أضرار', accident_invoice: 'فاتورة إصلاح حادث',
  handover_photo_before: 'صورة السيارة قبل التسليم', handover_photo_after: 'صورة السيارة بعد التسليم', handover_signed_form: 'النموذج الورقي الموقّع',
  vehicle_photo: 'صورة السيارة', document_image: 'صورة وثيقة (إقامة، رخصة، استمارة، فحص)', authorization_image: 'صورة التفويض',
  housing_invoice: 'فاتورة صيانة سكن', food_invoice: 'فاتورة توريد طعام', other: 'أخرى',
  fault_photo: 'صورة العطل', technical_report: 'تقرير فني',
};
// الفئات المناسبة لكل نوع سجل (الأولى هي الافتراضية)
export const CATS_FOR = {
  vehicle: ['vehicle_photo', 'document_image', 'authorization_image', 'other'],
  employee: ['document_image', 'other'],
  oil_change: ['oil_invoice', 'other'],
  maintenance: ['maintenance_invoice', 'repair_photo', 'other'],
  maintenance_request: ['fault_photo', 'maintenance_invoice', 'technical_report', 'repair_photo', 'other'],
  accident: ['accident_photo', 'accident_invoice', 'repair_photo', 'other'],
  handover: ['handover_photo_before', 'handover_photo_after', 'handover_signed_form', 'other'],
  housing_maintenance: ['housing_invoice', 'other'],
  food_supply: ['food_invoice', 'other'],
};
export const ENTITY = {
  vehicle: 'سيارة', employee: 'موظف', document: 'وثيقة', authorization: 'تفويض', oil_change: 'تغيير زيت', maintenance: 'صيانة',
  accident: 'حادث', handover: 'نموذج تسليم', housing_maintenance: 'صيانة سكن', food_supply: 'توريد طعام', maintenance_request: 'طلب صيانة',
};
const INVOICE = ['oil_invoice', 'maintenance_invoice', 'accident_invoice', 'housing_invoice', 'food_invoice'];
const isImage = (a) => /^image\//.test(a.mime_type || '') || /\.(jpe?g|png|webp|heic|heif)$/i.test(a.file_name);
const sizeText = (b) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} م.ب` : `${Math.max(1, Math.round(b / 1024))} ك.ب`);
const MAX = 20 * 1048576;

export const canUpload = (cat) => api.can('create') || (INVOICE.includes(cat) && api.can('invoices'));

// تصغير الصور الكبيرة قبل الرفع (يحفظ مساحة التخزين ويسرّع الرفع من الجوال)
async function shrink(file) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 1.5 * 1048576) return file;
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, 2200 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.85));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch (_) { return file; }
}

// رفع ملف واحد وإنشاء سجله (يُستخدم أيضاً من نماذج الإدخال مثل فاتورة تغيير الزيت)
export async function uploadOne({ entity_type, entity_id, file: f0, category, doc_date = null, notes = null }) {
  const f = await shrink(f0);
  const ext = (f.name.match(/\.(\w{1,5})$/) || [, f.type === 'application/pdf' ? 'pdf' : 'jpg'])[1].toLowerCase();
  const path = `${entity_type}/${entity_id}/${crypto.randomUUID()}.${ext}`;
  await api.uploadFile(path, f, f.type || 'application/octet-stream');
  const [row] = await api.insert('attachments', {
    entity_type, entity_id, category, file_name: f0.name, storage_path: path,
    mime_type: f.type || null, size_bytes: f.size, doc_date, notes,
  });
  return row;
}

function pickFiles({ camera = false } = {}) {
  return new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = camera ? 'image/*' : 'image/*,application/pdf';
    if (camera) inp.setAttribute('capture', 'environment'); else inp.multiple = true;
    inp.style.display = 'none';
    inp.addEventListener('change', () => { resolve([...inp.files]); inp.remove(); });
    document.body.appendChild(inp);
    inp.click();
  });
}

/**
 * يرفع ملفات ويُنشئ سجلاتها. يعيد عدد الملفات الناجحة.
 */
export async function uploadFlow({ entity_type, entity_id, camera = false, defaultCategory }) {
  const files = await pickFiles({ camera });
  if (!files.length) return 0;
  const cats = CATS_FOR[entity_type] || ['other'];
  const big = files.filter((f) => f.size > MAX);
  if (big.length) { toast(`الملف ${big[0].name} أكبر من 20 ميجابايت.`, 'error'); return 0; }
  let done = 0;
  const res = await openForm({
    title: files.length > 1 ? `رفع ${files.length} ملفات` : 'رفع ملف',
    intro: html`${raw(files.map((f) => html`<span class="file-chip">${f.name} · ${sizeText(f.size)}</span>`).join(''))}`.toString(),
    submitText: 'رفع وحفظ',
    fields: [
      { name: 'category', label: 'نوع المستند', type: 'select', required: true, placeholder: false, options: cats.filter(canUpload).map((c) => [c, CATEGORY[c]]), full: true },
      { name: 'doc_date', label: 'تاريخ المستند', type: 'date' },
      { name: 'notes', label: 'ملاحظات', type: 'textarea', full: true },
      { name: 'progress', type: 'info' },
    ],
    values: { category: defaultCategory && cats.includes(defaultCategory) ? defaultCategory : cats.find(canUpload), doc_date: todayISO() },
    onSubmit: async (v) => {
      const failed = [];
      for (const [i, f0] of files.entries()) {
        const box = document.querySelector('.modal [data-live=progress]');
        if (box) box.textContent = `جارٍ رفع ${i + 1} من ${files.length}: ${f0.name}`;
        try {
          await uploadOne({ entity_type, entity_id, file: f0, category: v.category, doc_date: v.doc_date, notes: v.notes });
          done++;
        } catch (e) { failed.push(`${f0.name}: ${errorText(e)}`); }
      }
      if (failed.length && !done) { const e = new Error(failed.join(' | ')); e.userMessage = 'تعذر رفع الملفات: ' + failed.join(' | '); throw e; }
      if (failed.length) toast(`تعذر رفع ${failed.length} ملف: ${failed[0]}`, 'error');
      return true;
    },
  });
  if (res && done) saved(done > 1 ? `تم رفع ${done} ملفات` : 'تم رفع الملف');
  return done;
}

export async function openAttachment(a, download = false) {
  // نفتح النافذة فوراً (يمنع حجب النوافذ المنبثقة في Safari) ثم نوجّهها للرابط المؤقت
  const w = window.open('', '_blank');
  try {
    const url = await api.signedUrl(a.storage_path, 3600, download);
    if (w) w.location.href = url; else location.href = url;
  } catch (e) { if (w) w.close(); toast(errorText(e), 'error'); }
}

const thumbCache = new Map();
async function fillThumbs(root) {
  const imgs = [...root.querySelectorAll('img[data-path]')];
  await Promise.all(imgs.map(async (img) => {
    const p = img.dataset.path;
    try {
      if (!thumbCache.has(p)) thumbCache.set(p, await api.signedUrl(p, 3600));
      img.src = thumbCache.get(p);
    } catch (_) { img.replaceWith(Object.assign(document.createElement('span'), { className: 'thumb-ph', textContent: 'صورة' })); }
  }));
}

export function attachmentCards(list, { showOwner = false, ownerLabel = () => '' } = {}) {
  if (!list.length) return html`<p class="muted pad">لا توجد مرفقات.</p>`;
  return html`<div class="att-grid">${raw(list.map((a) => html`
    <figure class="att" data-att="${a.id}">
      <button type="button" class="att-open" data-att-open="${a.id}" aria-label="فتح ${a.file_name}">
        ${raw(isImage(a) ? html`<img data-path="${a.storage_path}" alt="" loading="lazy">` : html`<span class="thumb-ph pdf">PDF</span>`)}
      </button>
      <figcaption>
        <b>${CATEGORY[a.category] || a.category}</b>
        <span class="muted small">${a.file_name}</span>
        ${raw(showOwner ? html`<span class="small">${ownerLabel(a)}</span>` : '')}
        <span class="muted small num">${a.doc_date ? `المستند: ${date(a.doc_date)} · ` : ''}رُفع ${dateTime(a.uploaded_at)}</span>
        <span class="att-actions"><button type="button" class="btn btn-sm" data-att-dl="${a.id}">تنزيل</button>${raw(api.can('edit') ? html`<button type="button" class="btn btn-sm" data-att-archive="${a.id}">أرشفة</button>` : '')}</span>
      </figcaption>
    </figure>`).join(''))}</div>`;
}

/** لوحة مرفقات داخل صفحة (ملف السيارة، ملف الموظف...) */
export async function mountAttachments(box, { entity_type, entity_id, extraIds = [], ownerLabel, title }) {
  const ids = [entity_id, ...extraIds];
  const load = async () => {
    const list = await api.get('attachments', { select: '*', entity_id: `in.(${ids.join(',')})`, deleted_at: 'is.null', order: 'uploaded_at.desc' });
    const cats = CATS_FOR[entity_type] || ['other'];
    const up = cats.some(canUpload);
    box.innerHTML = html`
      ${raw(title ? html`<div class="tab-head"><h2>${title}</h2></div>` : '')}
      ${raw(up ? html`<div class="btn-row up-row"><button type="button" class="btn btn-primary" data-up-cam>${icon('camera')}<span>التقاط صورة</span></button><button type="button" class="btn" data-up-file>${icon('upload')}<span>اختيار من الألبوم أو الملفات</span></button></div>` : '')}
      ${attachmentCards(list, { showOwner: extraIds.length > 0, ownerLabel: ownerLabel || (() => '') })}
      <p class="muted small">تُحفظ الملفات في تخزين دائم خاص. الفواتير لا تظهر إلا لمن يملك صلاحية الفواتير، وصور الوثائق الشخصية لمن يملك صلاحية البيانات الحساسة.</p>`;
    box._list = list;
    fillThumbs(box);
  };
  box.onclick = async (e) => {
    const t = e.target;
    if (t.closest('[data-up-cam]') || t.closest('[data-up-file]')) {
      if (await uploadFlow({ entity_type, entity_id, camera: !!t.closest('[data-up-cam]') })) await load();
      return;
    }
    const find = (k) => box._list.find((a) => a.id === t.closest(`[${k}]`)?.getAttribute(k));
    if (t.closest('[data-att-open]')) return openAttachment(find('data-att-open'));
    if (t.closest('[data-att-dl]')) return openAttachment(find('data-att-dl'), true);
    if (t.closest('[data-att-archive]')) {
      const a = find('data-att-archive');
      if (await confirmBox(`أرشفة المرفق «${esc(a.file_name)}»؟ يُخفى من القوائم ويبقى الملف محفوظاً.`, { okText: 'أرشفة', danger: true })) {
        await api.update('attachments', { id: `eq.${a.id}` }, { deleted_at: new Date().toISOString() }); saved('تمت الأرشفة'); await load();
      }
    }
  };
  await load();
}

/** نافذة مرفقات سجل واحد (من القوائم) */
export async function attachmentsDialog({ entity_type, entity_id, title }) {
  const wrap = document.createElement('div');
  wrap.className = 'modal wide'; wrap.setAttribute('role', 'dialog'); wrap.setAttribute('aria-modal', 'true');
  wrap.innerHTML = html`<div class="modal-panel"><div class="modal-head"><h2>${title}</h2><button type="button" class="icon-btn" data-x aria-label="إغلاق">${icon('close')}</button></div><div class="modal-body"><div class="att-box"><p class="muted">جارٍ التحميل…</p></div></div></div>`;
  document.body.appendChild(wrap); document.body.classList.add('modal-open');
  const close = () => { wrap.remove(); if (!document.querySelector('.modal')) document.body.classList.remove('modal-open'); };
  wrap.addEventListener('click', (e) => { if (e.target === wrap || e.target.closest('[data-x]')) close(); });
  await mountAttachments(wrap.querySelector('.att-box'), { entity_type, entity_id });
}

// ---------------------------------------------------------------------
// مكتبة المرفقات: كل الملفات مع الفلاتر
// ---------------------------------------------------------------------
const OWNER_ROUTE = { vehicle: 'vehicles', employee: 'employees', oil_change: 'oil', maintenance: 'maintenance', accident: 'accidents', handover: 'handovers', housing_maintenance: 'housing', food_supply: 'food', maintenance_request: 'requests' };
const libState = { cat: '', type: '', q: '' };

export async function renderAttachmentsLibrary(el) {
  const list = await api.get('attachments', { select: '*', deleted_at: 'is.null', order: 'uploaded_at.desc' });
  const opt = (v, t, cur) => html`<option value="${v}" ${raw(v === cur ? 'selected' : '')}>${t}</option>`;
  el.innerHTML = html`
    <div class="page-head row"><h1>الفواتير والمرفقات <span class="count num">${list.length}</span></h1></div>
    <p class="muted note">لرفع ملف جديد افتح السجل نفسه (ملف السيارة، ملف الموظف، أو زر «المرفقات» في قوائم الزيت والصيانة والحوادث والتسليم والسكن والطعام)، حتى يُربط الملف بسجله.
      ${api.can('invoices') ? '' : ' لا تظهر لك الفواتير لأن حسابك لا يملك صلاحية الفواتير.'}</p>
    <form class="filters wide-filters" onsubmit="return false">
      <label class="grow"><span>بحث</span><input name="q" type="search" value="${libState.q}" placeholder="اسم الملف أو الملاحظات"></label>
      <label><span>نوع المستند</span><select name="cat">${raw(opt('', 'الكل', libState.cat))}${raw(Object.entries(CATEGORY).map(([k, t]) => opt(k, t, libState.cat)).join(''))}</select></label>
      <label><span>السجل المرتبط</span><select name="type">${raw(opt('', 'الكل', libState.type))}${raw(Object.entries(ENTITY).map(([k, t]) => opt(k, t, libState.type)).join(''))}</select></label>
    </form>
    <div class="lib"></div>`;
  const box = el.querySelector('.lib');
  const draw = () => {
    const q = libState.q.trim().toLowerCase();
    const rows = list.filter((a) => (!libState.cat || a.category === libState.cat) && (!libState.type || a.entity_type === libState.type) && (!q || `${a.file_name} ${a.notes || ''}`.toLowerCase().includes(q)));
    box.innerHTML = String(attachmentCards(rows, { showOwner: true, ownerLabel: (a) => raw(html`<a href="#/${OWNER_ROUTE[a.entity_type] || ''}${['vehicle', 'employee', 'maintenance_request'].includes(a.entity_type) ? '/' + a.entity_id : ''}">${ENTITY[a.entity_type] || a.entity_type}</a>`) }));
    box._list = rows;
    fillThumbs(box);
  };
  draw();
  const f = el.querySelector('form');
  f.addEventListener('input', () => { libState.q = f.q.value; libState.cat = f.cat.value; libState.type = f.type.value; draw(); });
  box.onclick = async (e) => {
    const t = e.target;
    const find = (k) => box._list.find((a) => a.id === t.closest(`[${k}]`)?.getAttribute(k));
    if (t.closest('[data-att-open]')) return openAttachment(find('data-att-open'));
    if (t.closest('[data-att-dl]')) return openAttachment(find('data-att-dl'), true);
    if (t.closest('[data-att-archive]')) {
      const a = find('data-att-archive');
      if (await confirmBox(`أرشفة المرفق «${esc(a.file_name)}»؟`, { okText: 'أرشفة', danger: true })) {
        await api.update('attachments', { id: `eq.${a.id}` }, { deleted_at: new Date().toISOString() }); saved('تمت الأرشفة'); renderAttachmentsLibrary(el);
      }
    }
  };
}
