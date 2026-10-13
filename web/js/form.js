// نماذج الإدخال المنبثقة: تحفظ ما أدخله المستخدم إذا فشل الحفظ، وتعرض الأخطاء بالعربي
import { html, raw, icon, esc, toast, $ } from './ui.js';
import { parseDate, toWestern, errorText } from './fmt.js';
import { currentUser } from './api.js';
import { draftKey as makeDraftKey, readDraft, writeDraft, clearDraft, filePut, fileGet } from './drafts.js';

let seq = 0;

function fieldHtml(f, v) {
  const id = `f${++seq}`;
  const req = f.required ? raw('<span class="req" aria-hidden="true">*</span>') : '';
  const help = f.help ? html`<small class="help">${f.help}</small>` : '';
  const val = v ?? '';
  const common = raw(`id="${id}" name="${esc(f.name)}" ${f.required ? 'required' : ''} ${f.readonly ? 'readonly' : ''}`);
  let input;
  switch (f.type) {
    case 'section':
      return html`<h3 class="form-sec">${f.label}</h3>`;
    case 'subsection':
      return html`<h4 class="form-subsec">${f.label}</h4>`;
    case 'select':
      input = html`<select ${common}>${raw(f.placeholder !== false ? html`<option value="">${f.placeholder || '— اختر —'}</option>` : '')}${raw((f.options || []).map(([o, t]) => html`<option value="${o}" ${raw(String(o) === String(val) ? 'selected' : '')}>${t}</option>`).join(''))}</select>`;
      break;
    case 'textarea':
      input = html`<textarea ${common} rows="${f.rows || 3}">${val}</textarea>`;
      break;
    case 'checkbox':
      return html`<label class="check ${f.full ? 'full' : ''}"><input type="checkbox" name="${f.name}" ${raw(val ? 'checked' : '')}><span>${f.label}</span></label>${raw(help)}`;
    case 'date':
      input = html`<span class="date-in"><input ${common} type="text" inputmode="numeric" dir="ltr" placeholder="YYYY/MM/DD" maxlength="10" value="${val ? String(val).slice(0, 10).replaceAll('-', '/') : ''}" autocomplete="off"><button type="button" class="cal" aria-label="اختيار من التقويم">${icon('calendar')}</button><input type="date" class="native" tabindex="-1" aria-hidden="true"></span>`;
      break;
    case 'number':
      input = html`<input ${common} type="text" inputmode="${f.decimal ? 'decimal' : 'numeric'}" dir="ltr" value="${val}" autocomplete="off">`;
      break;
    case 'datetime': {
      const p = val ? localParts(val) : { date: '', time: '' };
      input = html`<span class="dt-in"><span class="date-in"><input ${common} type="text" inputmode="numeric" dir="ltr" placeholder="YYYY/MM/DD" maxlength="10" value="${p.date}" autocomplete="off"><button type="button" class="cal" aria-label="اختيار من التقويم">${icon('calendar')}</button><input type="date" class="native" tabindex="-1" aria-hidden="true"></span><input name="${f.name}__t" class="time-in" type="text" inputmode="numeric" dir="ltr" placeholder="HH:mm" maxlength="5" value="${p.time}" aria-label="الوقت" autocomplete="off"></span>`;
      break;
    }
    case 'items': {
      const rows = (Array.isArray(val) && val.length ? val : [{ kind: 'part', quantity: 1 }]);
      return html`<div class="field full items" data-items="${f.name}"><span>${f.label}${req}</span>
        <div class="items-rows">${raw(rows.map(itemRow).join(''))}</div>
        <button type="button" class="btn btn-sm" data-add-item>${icon('plus')}<span>إضافة بند</span></button>${raw(help)}</div>`;
    }
    case 'info':
      return html`<div class="live full" data-live="${f.name}"></div>`;
    case 'combo':
      // نص حر مع اقتراحات: يمكن اختيار قيمة مسجلة أو كتابة أي قيمة جديدة
      input = html`<input ${common} type="text" list="${id}-l" value="${val}" autocomplete="off"><datalist id="${id}-l">${raw((f.options || []).map((o) => html`<option value="${o}"></option>`).join(''))}</datalist>`;
      break;
    case 'file':
      // صورة الفاتورة: تصوير أو اختيار من الجهاز + معاينة قبل الحفظ
      return html`<div class="field full file-field" data-file="${f.name}"><span>${f.label}</span>
        <div class="btn-row"><label class="btn btn-sm">${icon('camera')}<span>تصوير</span><input type="file" name="${f.name}__cam" accept="image/*" capture="environment" data-file-in class="sr"></label>
        <label class="btn btn-sm">${icon('upload')}<span>اختيار من الجهاز</span><input type="file" name="${f.name}" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf" data-file-in class="sr"></label></div>
        <div class="file-prev" data-file-prev="${f.name}"></div>${raw(help)}</div>`;
    default:
      input = html`<input ${common} type="${f.type || 'text'}" ${raw(f.dir ? `dir="${f.dir}"` : '')} ${raw(f.inputmode ? `inputmode="${f.inputmode}"` : '')} value="${val}" autocomplete="off">`;
  }
  const check = f.normalize ? html`<small class="field-check" data-check="${f.name}" aria-live="polite"></small>` : '';
  return html`<label class="field ${f.full ? 'full' : ''}" for="${id}" ${raw(f.hidden ? 'hidden' : '')}><span>${f.label}${req}</span>${raw(input)}${raw(help)}${raw(check)}</label>`;
}

const KIND = { part: 'قطع غيار', labor: 'أجور عمل', other: 'أخرى' };
function itemRow(it = {}) {
  return html`<div class="item-row">
    <select name="it_kind" aria-label="نوع البند">${raw(Object.entries(KIND).map(([k, t]) => html`<option value="${k}" ${raw(k === (it.kind || 'part') ? 'selected' : '')}>${t}</option>`).join(''))}</select>
    <input name="it_desc" type="text" placeholder="الوصف" value="${it.description ?? ''}" aria-label="وصف البند" autocomplete="off">
    <label class="mini"><span>الكمية</span><input name="it_qty" type="text" inputmode="decimal" dir="ltr" value="${it.quantity ?? 1}" autocomplete="off"></label>
    <label class="mini"><span>سعر الوحدة (ر.س)</span><input name="it_price" type="text" inputmode="decimal" dir="ltr" value="${it.unit_price ?? ''}" autocomplete="off"></label>
    <span class="line-total num" aria-live="polite"></span>
    <button type="button" class="icon-btn sm" data-del-item aria-label="حذف البند">${icon('close')}</button></div>`;
}

// تاريخ ووقت بتوقيت الرياض لعرضه في الحقول
export function localParts(ts) {
  const d = new Date(ts);
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(d).reduce((a, p) => ((a[p.type] = p.value), a), {});
  return { date: `${f.year}/${f.month}/${f.day}`, time: `${f.hour}:${f.minute}` };
}

const num = (v) => Number(toWestern(String(v ?? '')).replace(/,/g, '').trim());

function readValues(form, fields, loose = false) {
  const out = {};
  const errs = [];
  for (const f of fields) {
    if (f.type === 'section' || f.type === 'subsection' || f.type === 'info') continue;
    if (f.type === 'items') {
      const items = [];
      form.querySelectorAll(`[data-items="${f.name}"] .item-row`).forEach((r, i) => {
        const desc = r.querySelector('[name=it_desc]').value.trim();
        const q = r.querySelector('[name=it_qty]').value.trim(), pr = r.querySelector('[name=it_price]').value.trim();
        if (!desc && !pr) return;
        const quantity = num(q || 1), unit_price = num(pr);
        if (!desc) errs.push(`البند ${i + 1}: اكتب الوصف.`);
        if (!(quantity > 0)) errs.push(`البند ${i + 1}: الكمية يجب أن تكون أكبر من صفر.`);
        if (!(unit_price >= 0) || pr === '') errs.push(`البند ${i + 1}: اكتب سعر الوحدة.`);
        items.push({ kind: r.querySelector('[name=it_kind]').value, description: desc, quantity, unit_price, sort_order: i });
      });
      if (f.required && !items.length) errs.push(`أضف بنداً واحداً على الأقل في «${f.label}».`);
      out[f.name] = items;
      continue;
    }
    if (f.type === 'file') {
      const a = form.elements[`${f.name}__cam`], b = form.elements[f.name];
      out[f.name] = (a && a.files[0]) || (b && b.files[0]) || (form._restoredFiles && form._restoredFiles[f.name]) || null;
      if (out[f.name] && out[f.name].size > 20 * 1048576) errs.push('الملف أكبر من 20 ميجابايت.');
      continue;
    }
    const el = form.elements[f.name];
    if (!el) continue;
    if (f.type === 'checkbox') { out[f.name] = el.checked; continue; }
    if (f.type === 'items') continue;
    let v = (el.value ?? '').trim();
    if (v === '') {
      if (f.required) errs.push(`حقل «${f.label}» مطلوب.`);
      out[f.name] = null;
      continue;
    }
    if (f.type === 'date') {
      try { v = parseDate(v); } catch (e) { errs.push(`«${f.label}»: ${e.message}`); continue; }
    } else if (f.type === 'datetime') {
      let d, t = toWestern(form.elements[f.name + '__t']?.value || '').trim() || '00:00';
      try { d = parseDate(v); } catch (e) { errs.push(`«${f.label}»: ${e.message}`); continue; }
      if (/^\d{1,2}$/.test(t)) t = t.padStart(2, '0') + ':00';
      const m = t.match(/^(\d{1,2}):(\d{2})$/);
      if (!m || +m[1] > 23 || +m[2] > 59) { errs.push(`«${f.label}»: الوقت يجب أن يكون بصيغة HH:mm مثل 14:30`); continue; }
      v = `${d}T${m[1].padStart(2, '0')}:${m[2]}:00+03:00`;
    } else if (f.type === 'number') {
      const n = num(v);
      if (!isFinite(n)) { errs.push(`«${f.label}» يجب أن يكون رقماً.`); continue; }
      if (f.min != null && n < f.min) { errs.push(`«${f.label}» لا يقل عن ${f.min}.`); continue; }
      if (f.max != null && n > f.max) { errs.push(`«${f.label}» لا يزيد على ${f.max}.`); continue; }
      v = n;
    } else if (f.western) {
      v = toWestern(v);
    }
    if (f.normalize) {
      try { v = f.normalize(v); } catch (e) { errs.push(`«${f.label}»: ${e.message}`); continue; }
    }
    out[f.name] = v;
  }
  return { out, errs };
}

function wireDates(root) {
  root.querySelectorAll('.date-in').forEach((w) => {
    const t = w.querySelector('input[type=text]');
    const n = w.querySelector('.native');
    t.addEventListener('input', (e) => {
      // يضيف الشرطة المائلة تلقائياً أثناء الكتابة: 20261012 => 2026/10/12
      if (e.inputType && e.inputType.startsWith('delete')) { t.value = toWestern(t.value); return; }
      const d = toWestern(t.value).replace(/\D/g, '').slice(0, 8);
      t.value = d.slice(0, 4) + (d.length > 4 ? '/' + d.slice(4, 6) : '') + (d.length > 6 ? '/' + d.slice(6, 8) : '');
    });
    w.querySelector('.cal').addEventListener('click', () => {
      try { n.value = parseDate(t.value) || ''; } catch (_) { n.value = ''; }
      if (n.showPicker) { try { n.showPicker(); return; } catch (_) {} }
      n.focus(); n.click();
    });
    n.addEventListener('change', () => { if (n.value) t.value = n.value.replaceAll('-', '/'); });
  });
}

let openCount = 0;
// نماذج مفتوحة فيها تعديلات لم تُحفظ — لتحذير المستخدم قبل إغلاق الصفحة
const dirtyForms = new Set();
export const hasUnsavedForms = () => dirtyForms.size > 0;
window.addEventListener('beforeunload', (e) => {
  if (!dirtyForms.size) return;
  dirtyForms.forEach((f) => f.flush && f.flush());
  e.preventDefault(); e.returnValue = '';
});
// الآيفون قد يغلق الصفحة في الخلفية (مثلاً عند فتح الكاميرا) دون beforeunload، فنحفظ المسودة فوراً
const flushAll = () => dirtyForms.forEach((f) => f.flush && f.flush());
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushAll(); });
window.addEventListener('pagehide', flushAll);

function modalShell(title, body, foot, guard) {
  const wrap = document.createElement('div');
  wrap.className = 'modal';
  wrap.setAttribute('role', 'dialog');
  wrap.setAttribute('aria-modal', 'true');
  wrap.innerHTML = html`<div class="modal-panel">
      <div class="modal-head"><h2>${title}</h2><button type="button" class="icon-btn" data-close aria-label="إغلاق">${icon('close')}</button></div>
      ${raw(body)}${raw(foot || '')}</div>`;
  document.body.appendChild(wrap);
  document.body.classList.add('modal-open'); openCount++;
  let closed = false;
  const close = () => { if (closed) return; closed = true; wrap.remove(); if (--openCount <= 0) { openCount = 0; document.body.classList.remove('modal-open'); } if (wrap._onClosed) wrap._onClosed(); };
  // guard(reason) يقرر هل يُغلق النموذج (مثلاً يسأل المستخدم إذا كانت هناك بيانات لم تُحفظ)
  const tryClose = async (reason) => { if (closed) return; if (!guard || (await guard(reason))) close(); };
  wrap.addEventListener('click', (e) => { if (e.target === wrap) tryClose('backdrop'); else if (e.target.closest('[data-close]')) tryClose('button'); });
  wrap.addEventListener('keydown', (e) => { if (e.key === 'Escape') tryClose('escape'); });
  return { wrap, close };
}

// لقطة من قيم النموذج (بدون الملفات وكلمات المرور) لحفظها كمسودة ومقارنتها لمعرفة وجود تعديلات
function snapshot(form) {
  const v = {}, items = {};
  form.querySelectorAll('[data-items]').forEach((b) => { items[b.dataset.items] = b.querySelectorAll('.item-row').length; });
  for (const el of form.elements) {
    if (!el.name || el.type === 'file' || el.type === 'password' || el.type === 'button' || el.classList.contains('native')) continue;
    (v[el.name] ||= []).push(el.type === 'checkbox' ? el.checked : el.value);
  }
  return { v, items };
}
function applySnapshot(form, snap) {
  const q = {}; for (const [k, arr] of Object.entries(snap.v || {})) q[k] = arr.slice();
  for (const el of form.elements) {
    if (!el.name || !q[el.name] || !q[el.name].length || el.type === 'file' || el.type === 'password' || el.classList.contains('native')) continue;
    const val = q[el.name].shift();
    if (el.type === 'checkbox') el.checked = !!val;
    else if (el.tagName === 'SELECT' && ![...el.options].some((o) => o.value === val)) continue;
    else el.value = val;
  }
}

/**
 * openForm({ title, fields, values, submitText, intro, onSubmit(values) })
 * onSubmit يرمي خطأ عند الفشل => النموذج يبقى مفتوحاً بنفس البيانات وتظهر رسالة الخطأ.
 * ما يكتبه المستخدم يُحفظ كمسودة على الجهاز ويُستعاد إذا أُغلقت الصفحة قبل الحفظ (draft:false لإيقافه).
 * لا تظهر رسالة النجاح إلا بعد أن يؤكد الخادم الحفظ (onSubmit ينتهي بلا خطأ).
 */
export function openForm({ title, fields, values = {}, submitText = 'حفظ', intro = '', onSubmit, onChange, wide = false, draft = true, draftKey, recordId }) {
  return new Promise((resolve) => {
    const body = html`<form class="modal-body form-grid" novalidate>
        <div class="draft-note full" role="status" hidden></div>
        ${raw(intro ? html`<p class="intro full">${raw(intro)}</p>` : '')}
        ${raw(fields.map((f) => fieldHtml(f, values[f.name])).join(''))}
        <p class="form-error full" role="alert" hidden></p>
      </form>`;
    const foot = html`<div class="modal-foot"><button type="button" class="btn" data-close>إلغاء</button><button type="button" class="btn btn-primary" data-save>${submitText}</button></div>`;
    const entry = { dirty: false, flush: () => {} };
    let submitting = false, ready = false, baseline = '', saveTimer = null;
    const user = currentUser();
    const plainTitle = String(title).replace(/<[^>]*>/g, '').trim();
    const dkey = draft === false ? null : (draftKey || makeDraftKey(user && user.id, plainTitle, recordId ?? values.id));
    const setDirty = (v) => { entry.dirty = v; if (v) dirtyForms.add(entry); else dirtyForms.delete(entry); };
    const guard = async (reason) => {
      if (submitting) return false; // لا نغلق النموذج أثناء انتظار رد الخادم
      if (!entry.dirty) return true;
      if (reason === 'backdrop') { // لمسة خارج النموذج لا تمسح ما كتبه المستخدم
        err.textContent = 'لديك بيانات لم تُحفظ بعد. اضغط «' + submitText + '» لحفظها، أو «إلغاء» للخروج.';
        err.hidden = false; err.scrollIntoView({ block: 'nearest' });
        return false;
      }
      const ok = await confirmBox('البيانات التي أدخلتها في هذا النموذج <b>لم تُحفظ</b> بعد. هل تريد الخروج وتجاهلها؟',
        { title: 'بيانات غير محفوظة', okText: 'تجاهل والخروج', cancelText: 'متابعة التعديل', danger: true });
      if (ok && dkey) clearDraft(dkey);
      return ok;
    };
    const { wrap, close } = modalShell(title, body, foot, guard);
    if (wide) wrap.classList.add('wide');
    const form = $('form', wrap);
    const err = $('.form-error', wrap);
    const save = $('[data-save]', wrap);
    const note = $('.draft-note', wrap);
    form._restoredFiles = {};
    wrap._onClosed = () => { setDirty(false); clearTimeout(saveTimer); resolve(null); };
    wireDates(wrap);
    // الوقت: 1430 => 14:30
    wrap.querySelectorAll('.time-in').forEach((t) => t.addEventListener('input', (e) => {
      if (e.inputType && e.inputType.startsWith('delete')) return;
      const d = toWestern(t.value).replace(/\D/g, '').slice(0, 4);
      t.value = d.length > 2 ? `${d.slice(0, 2)}:${d.slice(2)}` : d;
    }));
    const ctx = {
      form,
      get values() { return readValues(form, fields).out; },
      set(name, v) { const el = form.elements[name]; if (el) { el.value = v ?? ''; } },
      live(name, markup) { const box = form.querySelector(`[data-live="${name}"]`); if (box) box.innerHTML = String(markup ?? ''); },
    };
    const lineTotals = () => form.querySelectorAll('.item-row').forEach((r) => {
      const q = num(r.querySelector('[name=it_qty]').value || 0), p = num(r.querySelector('[name=it_price]').value || 0);
      r.querySelector('.line-total').textContent = isFinite(q * p) && q * p > 0 ? `= ${(Math.round(q * p * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })} ر.س` : '';
    });
    const showFile = (box, file, fromDraft) => {
      const prev = box.querySelector('.file-prev');
      if (!file) { prev.innerHTML = ''; return; }
      const isImg = /^image\//.test(file.type) && !/hei[cf]/.test(file.type);
      prev.innerHTML = String(html`<figure class="file-chip-prev">${raw(isImg ? html`<img src="${URL.createObjectURL(file)}" alt="معاينة">` : html`<span class="thumb-ph pdf">${/pdf/.test(file.type) ? 'PDF' : 'صورة'}</span>`)}
        <figcaption><b>${file.name}</b><span class="muted small">${(file.size / 1024).toFixed(0)} ك.ب · ${fromDraft ? 'من المسودة · ' : ''}تُرفع عند الحفظ</span>
        <button type="button" class="btn btn-sm" data-file-clear>إزالة</button></figcaption></figure>`);
    };
    const preview = (inp) => {
      const box = inp.closest('.file-field'); const name = box.dataset.file;
      box.querySelectorAll('[data-file-in]').forEach((o) => { if (o !== inp) o.value = ''; });
      const file = inp.files[0];
      delete form._restoredFiles[name];
      showFile(box, file, false);
      if (dkey) filePut(dkey, name, file || null).catch(() => {});
    };
    const fileNames = () => fields.filter((f) => f.type === 'file' && (form._restoredFiles[f.name] ||
      [...form.querySelectorAll(`[data-file="${f.name}"] [data-file-in]`)].some((i) => i.files && i.files.length))).map((f) => f.name);
    // حفظ المسودة على الجهاز
    const flush = () => {
      clearTimeout(saveTimer);
      if (!dkey || !ready || submitting) return;
      if (entry.dirty) writeDraft(dkey, snapshot(form), fileNames());
      else clearDraft(dkey);
    };
    entry.flush = flush;
    const track = () => {
      if (!ready) return;
      setDirty(JSON.stringify(snapshot(form)) !== baseline || fileNames().length > 0);
      clearTimeout(saveTimer); saveTimer = setTimeout(flush, 300);
    };
    const updateCheck = (el) => {
      const f = fields.find((x) => x.normalize && x.name === el.name); if (!f) return;
      const box = form.querySelector(`[data-check="${f.name}"]`); const v = toWestern(el.value || '').trim();
      if (!v) { box.textContent = ''; box.className = 'field-check'; return; }
      try { const n = f.normalize(v); box.textContent = f.preview ? f.preview(n) : '✓'; box.className = 'field-check ok'; }
      catch (e2) { box.textContent = e2.message; box.className = 'field-check bad'; }
    };
    form.addEventListener('change', (e) => { if (e.target.matches('[data-file-in]')) preview(e.target); });
    // تحقق فوري أثناء الكتابة للحقول التي لها قاعدة (مثل رقم الجوال)
    form.addEventListener('input', (e) => updateCheck(e.target));
    form.addEventListener('click', (e) => {
      const c = e.target.closest('[data-file-clear]'); if (!c) return;
      const box = c.closest('.file-field'); box.querySelectorAll('[data-file-in]').forEach((o) => { o.value = ''; }); box.querySelector('.file-prev').innerHTML = '';
      delete form._restoredFiles[box.dataset.file];
      if (dkey) filePut(dkey, box.dataset.file, null).catch(() => {});
      track();
    });
    const changed = (e) => { lineTotals(); if (onChange) onChange(ctx, e?.target?.name || ''); track(); };
    form.addEventListener('input', changed);
    form.addEventListener('change', changed);
    form.addEventListener('click', (e) => {
      if (e.target.closest('[data-add-item]')) {
        const box = e.target.closest('.items').querySelector('.items-rows');
        box.insertAdjacentHTML('beforeend', String(itemRow({ kind: 'part', quantity: 1 })));
        box.lastElementChild.querySelector('[name=it_desc]').focus();
        changed();
      }
      const del = e.target.closest('[data-del-item]');
      if (del) {
        const box = del.closest('.items-rows');
        if (box.children.length > 1) del.closest('.item-row').remove();
        else del.closest('.item-row').querySelectorAll('input').forEach((i) => (i.value = i.name === 'it_qty' ? '1' : ''));
        changed();
      }
    });
    const setRows = (snap) => {
      for (const [name, n] of Object.entries(snap.items || {})) {
        const box = form.querySelector(`[data-items="${name}"] .items-rows`); if (!box) continue;
        while (box.children.length < n) box.insertAdjacentHTML('beforeend', String(itemRow({ kind: 'part', quantity: 1 })));
        while (box.children.length > Math.max(n, 1)) box.lastElementChild.remove();
      }
    };
    // استعادة مسودة سابقة لم تُحفظ
    const restore = async (d) => {
      setRows(d);
      applySnapshot(form, d);
      if (onChange) form.querySelectorAll('select').forEach((el) => { if (el.name) onChange(ctx, el.name); });
      applySnapshot(form, d); // بعد تحديث الحقول المعتمدة على الاختيار نعيد القيم كما كتبها المستخدم
      form.querySelectorAll('input').forEach(updateCheck);
      lineTotals();
      for (const name of d.files || []) {
        try {
          const file = await fileGet(dkey, name);
          const box = form.querySelector(`[data-file="${name}"]`);
          if (file && box) { form._restoredFiles[name] = file; showFile(box, file, true); }
        } catch (_) {}
      }
      const p = localParts(d.at);
      note.innerHTML = String(html`<span>${icon('alert')}<b>استُعيدت بيانات كتبتها سابقاً في هذا النموذج ولم تُحفظ بعد</b> (آخر تعديل <span class="num" dir="ltr">${p.date} ${p.time}</span>). راجعها ثم اضغط «${submitText}».</span>
        <button type="button" class="btn btn-sm" data-draft-discard>تجاهل المسودة</button>`);
      note.hidden = false;
    };
    note.addEventListener('click', (e) => {
      if (!e.target.closest('[data-draft-discard]')) return;
      const base = JSON.parse(baseline);
      setRows(base); applySnapshot(form, base);
      form._restoredFiles = {};
      form.querySelectorAll('[data-file-in]').forEach((o) => { o.value = ''; });
      form.querySelectorAll('.file-prev').forEach((o) => { o.innerHTML = ''; });
      form.querySelectorAll('input').forEach(updateCheck); lineTotals();
      if (onChange) onChange(ctx, '');
      clearDraft(dkey); note.hidden = true; setDirty(false);
    });
    setTimeout(async () => {
      lineTotals(); if (onChange) onChange(ctx, '');
      baseline = JSON.stringify(snapshot(form));
      if (dkey) {
        const d = readDraft(dkey);
        if (d && (JSON.stringify({ v: d.v, items: d.items }) !== baseline || (d.files || []).length)) {
          try { await restore(d); } catch (_) {}
        } else if (d) clearDraft(dkey);
      }
      ready = true;
      track();
    }, 0);
    const submit = async () => {
      if (submitting) return;
      err.hidden = true;
      const { out, errs } = readValues(form, fields);
      if (errs.length) { err.innerHTML = errs.map(esc).join('<br>'); err.hidden = false; err.scrollIntoView({ block: 'nearest' }); return; }
      if (navigator.onLine === false) {
        flush();
        err.textContent = 'لا يوجد اتصال بالإنترنت، لذلك لم تُحفظ البيانات بعد. ما أدخلته باقٍ في النموذج ومحفوظ كمسودة على هذا الجهاز — اضغط «' + submitText + '» عند عودة الاتصال.';
        err.hidden = false; err.scrollIntoView({ block: 'nearest' }); return;
      }
      flush();
      submitting = true; save.disabled = true; save.textContent = 'جارٍ الحفظ…';
      try {
        const res = await onSubmit(out);
        // نجح الحفظ في قاعدة البيانات: نحذف المسودة ثم نغلق النموذج
        submitting = false;
        if (dkey) clearDraft(dkey);
        setDirty(false);
        resolve(res ?? out);
        close();
      } catch (e) {
        submitting = false;
        flush();
        err.textContent = e && e.userMessage ? e.userMessage
          : e && e.code === 'NETWORK' ? 'تعذر الاتصال بالخادم، لذلك لم تُحفظ البيانات بعد. ما أدخلته باقٍ في النموذج ومحفوظ كمسودة على هذا الجهاز — تحقق من الإنترنت ثم اضغط «' + submitText + '» مرة أخرى.'
          : errorText(e);
        err.hidden = false; err.scrollIntoView({ block: 'nearest' });
        save.disabled = false; save.textContent = submitText;
      }
    };
    save.addEventListener('click', submit);
    form.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
    const first = form.querySelector('input:not([type=hidden]):not(.native),select,textarea');
    if (first && window.matchMedia('(min-width: 640px)').matches) first.focus();
  });
}

export function confirmBox(message, { title = 'تأكيد', okText = 'تأكيد', cancelText = 'إلغاء', danger = false } = {}) {
  return new Promise((resolve) => {
    const { wrap, close } = modalShell(title, html`<div class="modal-body"><p>${raw(message)}</p></div>`,
      html`<div class="modal-foot"><button type="button" class="btn" data-no>${cancelText}</button><button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-yes>${okText}</button></div>`);
    wrap.addEventListener('click', (e) => {
      if (e.target.closest('[data-yes]')) { close(); resolve(true); }
      else if (e.target.closest('[data-no]') || e.target.closest('[data-close]') || e.target === wrap) { close(); resolve(false); }
    });
  });
}

export function userError(msg) { const e = new Error(msg); e.userMessage = msg; return e; }
export function saved(msg = 'تم الحفظ بنجاح') { toast(msg, 'ok'); }
