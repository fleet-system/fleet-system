// استيراد Excel: معاينة ← تحقق ← تأكيد ← حفظ. الربط بالرقم الداخلي فقط، ولا يحذف شيئاً أبداً.
import * as api from './api.js';
import * as data from './data.js';
import { LABELS, toWestern, parseDate, num, saMobile } from './fmt.js';
import { serialToDate } from './xlsx.js';

const rev = (obj) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [v, k]));
const norm = (s) => toWestern(String(s ?? '')).replace(/[‎‏‪-‮⁦-⁩]/g, '').replace(/\s+/g, ' ').trim();

// تحويل قيمة خلية إلى تاريخ ISO، أو خطأ
function cellDate(v, label) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'object' && 'serial' in v) return serialToDate(v.serial);
  if (typeof v === 'number') { if (v > 20000 && v < 80000) return serialToDate(v); throw new Error(`«${label}»: قيمة غير مفهومة ${v}`); }
  try { return parseDate(norm(v)); } catch (e) { throw new Error(`«${label}»: ${e.message}`); }
}
function cellInt(v, label, min, max) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(norm(v).replace(/,/g, ''));
  if (!Number.isFinite(n) || !Number.isInteger(Math.round(n * 1000) / 1000) || n < min || n > max) throw new Error(`«${label}»: يجب أن يكون رقماً صحيحاً بين ${min} و ${max}`);
  return Math.round(n);
}
const cellText = (v) => { const s = norm(typeof v === 'object' && v && 'serial' in v ? v.serial : v); return s === '' ? null : s; };

// ---------------------------------------------------------------------
// تعريف الحقول القابلة للاستيراد
// ---------------------------------------------------------------------
const VEHICLE_FIELDS = [
  ['الرقم الداخلي', 'code'], ['رقم اللوحة', 'plate_no', 'text', true], ['الماركة', 'make'], ['نوع السيارة', 'vehicle_type'], ['الموديل', 'model'],
  ['سنة الصنع', 'manufacture_year', 'year'], ['اللون', 'color'], ['رقم الهيكل', 'vin'], ['رقم المحرك', 'engine_no'], ['نوع التسجيل', 'registration_type'], ['الرقم التسلسلي للاستمارة', 'registration_serial'],
  ['الشركة المالكة', 'owner_company_id', 'company', true], ['الموقع', 'site_id', 'site'], ['موقع السيارة الحالي', 'location_text'], ['المستخدم الحالي', 'current_user_name'], ['جوال المستخدم', 'current_user_mobile', 'samobile'], ['المفوّض بالقيادة', 'authorized_name'],
  ['موقع السيارة', 'location_status', 'enum:location_status'], ['الحالة التشغيلية', 'op_status', 'enum:op_status'],
  ['قراءة العداد', 'odometer', 'odometer'], ['فترة تغيير الزيت', 'oil_interval_km', 'interval'],
  ['انتهاء الاستمارة', 'reg', 'docdate'], ['انتهاء الفحص الدوري', 'insp', 'docdate'], ['انتهاء التأمين', 'insurance_expiry', 'date'], ['تاريخ الدخول إلى الموقع', 'site_entry_date', 'date'], ['ملاحظات', 'notes'],
];
const EMPLOYEE_FIELDS = [
  ['الرقم الداخلي', 'code'], ['الاسم الكامل', 'full_name', 'text', true], ['الشركة', 'company_id', 'company'], ['الموقع', 'site_id', 'site'],
  ['المسمى الوظيفي', 'job_title'], ['حالة الموظف', 'status', 'enum:employee_status'],
  ['رقم الإقامة', 'iqama_no', 'iqama'], ['رقم الجوال', 'mobile', 'mobile'], ['رقم رخصة القيادة', 'driving_license_no', 'sens'],
  ['انتهاء الإقامة', 'iq', 'docdate'], ['انتهاء رخصة القيادة', 'lic', 'docdate'], ['ملاحظات', 'notes'],
];
export const IMPORTS = {
  vehicles: { title: 'السيارات', fields: VEHICLE_FIELDS, readonly: ['شركة الموقع', 'السائق الحالي', 'حالة التفويض', 'تاريخ تحديث العداد', 'موعد الزيت القادم', 'المسافة المتبقية للزيت', 'حالة الزيت'] },
  employees: { title: 'الموظفون', fields: EMPLOYEE_FIELDS, readonly: ['السيارة الحالية'] },
};

// ---------------------------------------------------------------------
// المعاينة
// ---------------------------------------------------------------------
export async function analyze(kind, sheets) {
  const spec = IMPORTS[kind];
  await data.lookups(true);
  const sheet = sheets.find((s) => norm(s.name) === spec.title) || sheets[0];
  const header = (sheet.rows[0] || []).map((h) => norm(h));
  const idx = Object.fromEntries(spec.fields.map(([h, k]) => [k, header.indexOf(h)]));
  const missing = spec.fields.filter(([h, k, , req]) => (req || k === 'code') && idx[k] < 0).map(([h]) => h);
  if (missing.length) throw new Error(`الأعمدة التالية غير موجودة في الملف: ${missing.join('، ')}. استخدم ملفاً مُصدَّراً من النظام كقالب ولا تغيّر عناوين الأعمدة.`);
  const ignored = header.filter((h) => h && !spec.fields.some(([x]) => x === h));
  const sens = api.can('view_sensitive');

  // البيانات الحالية للمقارنة
  let current = [], docs = [], priv = [];
  if (kind === 'vehicles') {
    [current, docs] = await Promise.all([api.get('vehicles', { select: '*', deleted_at: 'is.null' }), api.get('v_document_status', { select: 'owner_id,doc_type,expiry_date', owner_type: 'eq.vehicle' })]);
  } else {
    [current, docs, priv] = await Promise.all([api.get('employees', { select: '*', deleted_at: 'is.null' }), api.get('v_document_status', { select: 'owner_id,doc_type,expiry_date', owner_type: 'eq.employee' }), sens ? api.get('employee_private', { select: '*' }) : Promise.resolve([])]);
  }
  const byCode = new Map(current.map((r) => [r.code, r]));
  const docOf = (id, t) => docs.find((d) => d.owner_id === id && d.doc_type === t)?.expiry_date || null;
  const P = Object.fromEntries(priv.map((p) => [p.employee_id, p]));
  const companyByName = new Map(data.companyOptions(false).map(([id, n]) => [norm(n), id]));
  const siteByName = new Map((await data.lookups()).sites.map((s) => [norm(s.name), s.id]));
  const seenCodes = new Map(), seenPlates = new Map(), seenIqama = new Map();

  const out = [];
  for (let i = 1; i < sheet.rows.length; i++) {
    const row = sheet.rows[i] || [];
    const raw = (k) => (idx[k] >= 0 ? row[idx[k]] : undefined);
    if (spec.fields.every(([, k]) => idx[k] < 0 || cellText(raw(k)) === null)) continue; // سطر فارغ
    const line = i + 1; const errs = []; const val = {};
    const code = cellText(raw('code'));
    const cur = code ? byCode.get(code) : null;
    if (code && !cur) errs.push(`الرقم الداخلي ${code} غير موجود في النظام. اتركه فارغاً لإضافة سجل جديد.`);
    if (code) { if (seenCodes.has(code)) errs.push(`الرقم الداخلي ${code} مكرر في الملف (السطر ${seenCodes.get(code)}).`); else seenCodes.set(code, line); }

    for (const [h, k, type = 'text', req] of spec.fields) {
      if (k === 'code' || idx[k] < 0) continue;
      const v = raw(k);
      try {
        let x;
        if (type === 'text') x = cellText(v);
        else if (type === 'year') x = cellInt(v, h, 1950, 2100);
        else if (type === 'samobile') { try { x = saMobile(cellText(v)); } catch (e) { throw new Error(`«${h}»: ${e.message}`); } }
        else if (type === 'odometer') x = cellInt(v, h, 0, 5000000);
        else if (type === 'interval') x = cellInt(v, h, 500, 100000);
        else if (type === 'date' || type === 'docdate') x = cellDate(v, h);
        else if (type === 'company') { const t = cellText(v); x = t ? companyByName.get(t) : null; if (t && !x) throw new Error(`«${h}»: الشركة «${t}» غير مسجلة. أضفها من «الشركات والمواقع» أولاً.`); }
        else if (type === 'site') { const t = cellText(v); x = t ? siteByName.get(t) : null; if (t && !x) throw new Error(`«${h}»: الموقع «${t}» غير مسجل.`); }
        else if (type.startsWith('enum:')) { const t = cellText(v); const m = rev(LABELS[type.slice(5)]); x = t ? m[t] : null; if (t && !x) throw new Error(`«${h}»: القيمة «${t}» غير معروفة. القيم المسموحة: ${Object.keys(m).join('، ')}`); }
        else if (['iqama', 'mobile', 'sens'].includes(type)) {
          if (!sens) continue;
          x = cellText(v); if (x) x = x.replace(/[\s-]/g, '');
          if (type === 'iqama' && x && !/^\d{10}$/.test(x)) throw new Error('رقم الإقامة يجب أن يكون 10 أرقام.');
          if (type === 'mobile' && x && !/^\+?\d{9,15}$/.test(x)) throw new Error('رقم الجوال غير صحيح.');
        }
        if (req && (x === null || x === undefined)) throw new Error(`«${h}» مطلوب.`);
        val[k] = x ?? null;
      } catch (e) { errs.push(e.message); }
    }

    // تحققات إضافية
    if (kind === 'vehicles' && val.plate_no) {
      const p = val.plate_no;
      const other = current.find((v) => v.plate_no === p && v.id !== cur?.id);
      if (other) errs.push(`رقم اللوحة ${p} مسجل لسيارة أخرى (${other.code}).`);
      if (seenPlates.has(p)) errs.push(`رقم اللوحة ${p} مكرر في الملف (السطر ${seenPlates.get(p)}).`); else seenPlates.set(p, line);
      if (cur && val.odometer != null && val.odometer < cur.odometer) errs.push(`قراءة العداد ${num(val.odometer)} أقل من آخر قراءة موثقة ${num(cur.odometer)}. صححها من ملف السيارة مع ذكر السبب.`);
    }
    if (kind === 'employees' && sens && val.iqama_no) {
      const other = priv.find((x) => x.iqama_no === val.iqama_no && x.employee_id !== cur?.id);
      if (other) errs.push(`رقم الإقامة مسجل لموظف آخر.`);
      if (seenIqama.has(val.iqama_no)) errs.push(`رقم الإقامة مكرر في الملف (السطر ${seenIqama.get(val.iqama_no)}).`); else seenIqama.set(val.iqama_no, line);
    }

    // مقارنة مع الحالي
    const changes = [];
    const before = cur ? { ...cur, ...(P[cur.id] || {}) } : {};
    if (cur) {
      if (kind === 'vehicles') { before.reg = docOf(cur.id, 'registration'); before.insp = docOf(cur.id, 'periodic_inspection'); }
      else { before.iq = docOf(cur.id, 'iqama'); before.lic = docOf(cur.id, 'driving_license'); }
    }
    for (const [h, k] of spec.fields) {
      if (k === 'code' || !(k in val)) continue;
      const a = before[k] ?? null, b = val[k] ?? null;
      if (cur && String(a ?? '') === String(b ?? '')) continue;
      if (cur && b === null && ['reg', 'insp', 'iq', 'lic', 'odometer'].includes(k)) continue; // الخلية الفارغة لا تمسح وثيقة أو عداداً
      if (!cur && b === null) continue;
      const lab = (x) => {
        if (x === null || x === undefined) return null;
        const t = spec.fields.find((f) => f[1] === k)?.[2] || 'text';
        if (t === 'company') return data.companyName(x);
        if (t === 'site') return data.siteName(x);
        if (t.startsWith('enum:')) return LABELS[t.slice(5)][x] || x;
        return x;
      };
      changes.push({ key: k, header: h, from: a, to: b, fromLabel: lab(a), toLabel: lab(b) });
    }
    const status = errs.length ? 'error' : !cur ? 'new' : changes.length ? 'update' : 'same';
    out.push({ line, code, id: cur?.id || null, label: val.plate_no || val.full_name || cur?.plate_no || cur?.full_name || '', status, errors: errs, changes, val });
  }
  return { rows: out, ignored, sheetName: sheet.name };
}

// ---------------------------------------------------------------------
// التطبيق (بعد تأكيد المستخدم) — كل سطر مستقل: فشل سطر لا يوقف البقية
// ---------------------------------------------------------------------
export async function apply(kind, analysis, fileName, onProgress = () => {}) {
  const todo = analysis.rows.filter((r) => r.status === 'new' || r.status === 'update');
  const res = { inserted: 0, updated: 0, failed: [] };
  for (const [i, r] of todo.entries()) {
    onProgress(i + 1, todo.length);
    try {
      const ch = Object.fromEntries(r.changes.map((c) => [c.key, c.to]));
      if (kind === 'vehicles') {
        const { reg, insp, ...veh } = r.status === 'new' ? r.val : ch;
        let id = r.id;
        if (r.status === 'new') { if (veh.odometer == null) delete veh.odometer; if (veh.oil_interval_km == null) delete veh.oil_interval_km; if (!veh.location_status) delete veh.location_status; if (!veh.op_status) delete veh.op_status; id = (await api.insert('vehicles', veh))[0].id; }
        else if (Object.keys(veh).length) await api.update('vehicles', { id: `eq.${id}` }, veh);
        if (reg) await api.insert('documents', { doc_type: 'registration', vehicle_id: id, expiry_date: reg, notes: `استيراد Excel: ${fileName}` });
        if (insp) await api.insert('documents', { doc_type: 'periodic_inspection', vehicle_id: id, expiry_date: insp, notes: `استيراد Excel: ${fileName}` });
      } else {
        const src = r.status === 'new' ? r.val : ch;
        const { iq, lic, iqama_no, mobile, driving_license_no, ...emp } = src;
        if (emp.site_id && !emp.company_id && r.status === 'new') emp.company_id = data.siteCompany(emp.site_id);
        let id = r.id;
        if (r.status === 'new') { if (!emp.status) delete emp.status; id = (await api.insert('employees', emp))[0].id; }
        else if (Object.keys(emp).length) await api.update('employees', { id: `eq.${id}` }, emp);
        const privCh = Object.fromEntries(Object.entries({ iqama_no, mobile, driving_license_no }).filter(([, v]) => v !== undefined));
        if (Object.keys(privCh).length && api.can('view_sensitive')) {
          const u = await api.update('employee_private', { employee_id: `eq.${id}` }, privCh);
          if (!u.length) await api.insert('employee_private', { employee_id: id, ...privCh });
        }
        if (iq) await api.insert('documents', { doc_type: 'iqama', employee_id: id, expiry_date: iq, notes: `استيراد Excel: ${fileName}` });
        if (lic) await api.insert('documents', { doc_type: 'driving_license', employee_id: id, expiry_date: lic, notes: `استيراد Excel: ${fileName}` });
      }
      if (r.status === 'new') res.inserted++; else res.updated++;
    } catch (e) { res.failed.push({ line: r.line, label: r.label, error: e }); }
  }
  try {
    await api.insert('import_batches', { target_table: kind, file_name: fileName, status: 'committed', committed_at: new Date().toISOString(),
      summary: { inserted: res.inserted, updated: res.updated, failed: res.failed.length, rejected: analysis.rows.filter((r) => r.status === 'error').length } });
  } catch (_) { /* السجل ليس حرجاً */ }
  data.invalidate();
  return res;
}
