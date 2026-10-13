// تعريف أوراق Excel لكل قسم (التصدير) — تُستخدم أيضاً كقالب للاستيراد
import * as api from './api.js';
import * as data from './data.js';
import { label, LABELS } from './fmt.js';
import { customFields } from './vehicle-config.js';

const yn = (b) => (b ? 'نعم' : 'لا');
const pay = (k) => label('payment_status', k);

export const EXPORTS = [
  {
    key: 'vehicles', title: 'السيارات', importable: true,
    async load() {
      const [rows, docs, priv] = await Promise.all([
        api.get('v_vehicles_overview', { select: '*', order: 'code' }),
        api.get('v_document_status', { select: 'owner_id,doc_type,expiry_date,status', owner_type: 'eq.vehicle' }),
        api.can('view_sensitive') ? api.get('vehicle_private', { select: 'vehicle_id,owner_id_no,current_user_id_no' }).catch(() => []) : Promise.resolve([]),
      ]);
      const d = (id, t) => docs.find((x) => x.owner_id === id && x.doc_type === t);
      const pv = (id) => priv.find((x) => x.vehicle_id === id) || {};
      return rows.map((r) => ({ ...r, reg: d(r.id, 'registration')?.expiry_date || null, insp: d(r.id, 'periodic_inspection')?.expiry_date || null,
        ins_status: d(r.id, 'insurance')?.status || null, owner_id_no: pv(r.id).owner_id_no || null }));
    },
    columns: () => [
      { header: 'الرقم الداخلي', type: 'text', width: 12, value: (r) => r.code },
      { header: 'رقم اللوحة', type: 'text', value: (r) => r.plate_no },
      { header: 'الماركة', type: 'text', value: (r) => r.make },
      { header: 'نوع السيارة', type: 'text', value: (r) => r.vehicle_type },
      { header: 'الموديل', type: 'text', value: (r) => r.model },
      { header: 'سنة الصنع', type: 'int', width: 10, value: (r) => r.manufacture_year },
      { header: 'اللون', type: 'text', width: 10, value: (r) => r.color },
      { header: 'رقم الهيكل', type: 'text', value: (r) => r.vin },
      { header: 'رقم المحرك', type: 'text', value: (r) => r.engine_no },
      { header: 'نوع التسجيل', type: 'text', value: (r) => r.registration_type },
      { header: 'الرقم التسلسلي للاستمارة', type: 'text', value: (r) => r.registration_serial },
      { header: 'الشركة المالكة', type: 'text', width: 26, value: (r) => r.owner_company_name },
      ...(api.can('view_sensitive') ? [{ header: 'هوية المالك', type: 'text', value: (r) => r.owner_id_no }] : []),
      { header: 'الموقع', type: 'text', value: (r) => r.site_name },
      { header: 'موقع السيارة الحالي', type: 'text', value: (r) => r.location_text },
      { header: 'شركة الموقع', type: 'text', width: 26, value: (r) => r.site_company_name },
      { header: 'السائق الحالي', type: 'text', value: (r) => r.driver_name },
      { header: 'المستخدم الحالي', type: 'text', value: (r) => r.current_user_name },
      { header: 'جوال المستخدم', type: 'text', value: (r) => r.current_user_mobile },
      { header: 'المفوّض بالقيادة', type: 'text', value: (r) => r.authorized_name },
      { header: 'حالة التفويض', type: 'text', value: (r) => label('auth_status', r.authorization_status) },
      { header: 'موقع السيارة', type: 'text', value: (r) => label('location_status', r.location_status) },
      { header: 'الحالة التشغيلية', type: 'text', value: (r) => label('op_status', r.op_status) },
      { header: 'قراءة العداد', type: 'int', value: (r) => r.odometer },
      { header: 'تاريخ تحديث العداد', type: 'datetime', value: (r) => r.odometer_updated_at },
      { header: 'فترة تغيير الزيت', type: 'int', value: (r) => r.oil_interval_km },
      { header: 'موعد الزيت القادم', type: 'int', value: (r) => r.oil_next_odometer },
      { header: 'المسافة المتبقية للزيت', type: 'int', value: (r) => r.oil_remaining_km },
      { header: 'حالة الزيت', type: 'text', value: (r) => label('oil_status', r.oil_status) },
      { header: 'انتهاء الاستمارة', type: 'date', value: (r) => r.reg },
      { header: 'انتهاء الفحص الدوري', type: 'date', value: (r) => r.insp },
      { header: 'انتهاء التأمين', type: 'date', value: (r) => r.insurance_expiry },
      { header: 'حالة التأمين', type: 'text', value: (r) => (r.insurance_expiry ? { valid: 'ساري', expiring: 'قريب الانتهاء', expired: 'منتهي' }[r.ins_status] || '' : 'غير محدد') },
      { header: 'تاريخ الدخول إلى الموقع', type: 'date', value: (r) => r.site_entry_date },
      { header: 'ملاحظات', type: 'wrap', value: (r) => r.notes },
      // الحقول الإضافية من «إدارة بيانات السيارات»
      ...customFields(true).filter((c) => c.in_export !== false).map((c) => ({ header: c.label, type: c.type === 'date' ? 'date' : 'text', value: (r) => { const x = (r.custom_fields || {})[c.key]; return x == null || x === '' ? null : c.type === 'date' ? x : String(x); } })),
    ],
  },
  {
    key: 'employees', title: 'الموظفون', importable: true,
    async load() {
      const sens = api.can('view_sensitive');
      const [emps, priv, docs, cars] = await Promise.all([
        api.get('employees', { select: '*', deleted_at: 'is.null', order: 'code' }),
        sens ? api.get('employee_private', { select: '*' }) : Promise.resolve([]),
        api.get('v_document_status', { select: 'owner_id,doc_type,expiry_date', owner_type: 'eq.employee' }),
        api.get('vehicles', { select: 'plate_no,current_driver_id', deleted_at: 'is.null' }),
      ]);
      const P = Object.fromEntries(priv.map((p) => [p.employee_id, p]));
      const d = (id, t) => docs.find((x) => x.owner_id === id && x.doc_type === t)?.expiry_date || null;
      return emps.map((e) => ({ ...e, ...(P[e.id] || {}), iq: d(e.id, 'iqama'), lic: d(e.id, 'driving_license'), cars: cars.filter((c) => c.current_driver_id === e.id).map((c) => c.plate_no).join('، ') }));
    },
    columns: () => [
      { header: 'الرقم الداخلي', type: 'text', width: 12, value: (r) => r.code },
      { header: 'الاسم الكامل', type: 'text', width: 26, value: (r) => r.full_name },
      { header: 'الشركة', type: 'text', width: 26, value: (r) => data.companyName(r.company_id) },
      { header: 'الموقع', type: 'text', value: (r) => (r.site_id ? data.siteName(r.site_id) : '') },
      { header: 'المسمى الوظيفي', type: 'text', value: (r) => r.job_title },
      { header: 'حالة الموظف', type: 'text', value: (r) => label('employee_status', r.status) },
      ...(api.can('view_sensitive') ? [
        { header: 'رقم الإقامة', type: 'text', value: (r) => r.iqama_no },
        { header: 'رقم الجوال', type: 'text', value: (r) => r.mobile },
        { header: 'رقم رخصة القيادة', type: 'text', value: (r) => r.driving_license_no },
      ] : []),
      { header: 'انتهاء الإقامة', type: 'date', value: (r) => r.iq },
      { header: 'انتهاء رخصة القيادة', type: 'date', value: (r) => r.lic },
      { header: 'السيارة الحالية', type: 'text', value: (r) => r.cars },
      { header: 'ملاحظات', type: 'wrap', value: (r) => r.notes },
    ],
  },
  {
    key: 'documents', title: 'الوثائق',
    load: () => api.get('v_document_status', { select: '*', order: 'expiry_date.nullsfirst' }),
    columns: () => [
      { header: 'السيارة أو الموظف', type: 'text', width: 30, value: (r) => r.subject_label },
      { header: 'الوثيقة', type: 'text', value: (r) => label('doc_type', r.doc_type) },
      { header: 'رقم الوثيقة', type: 'text', value: (r) => r.doc_no },
      { header: 'تاريخ الإصدار', type: 'date', value: (r) => r.issue_date },
      { header: 'تاريخ الانتهاء', type: 'date', value: (r) => r.expiry_date },
      { header: 'الأيام المتبقية', type: 'int', value: (r) => r.days_left },
      { header: 'الحالة', type: 'text', value: (r) => (r.doc_type === 'authorization' ? label('auth_status', r.status) : label('doc_status', r.status)) },
      { header: 'الموقع', type: 'text', value: (r) => (r.site_id ? data.siteName(r.site_id) : '') },
      { header: 'الشركة', type: 'text', width: 26, value: (r) => (r.company_id ? data.companyName(r.company_id) : '') },
    ],
  },
  {
    key: 'authorizations', title: 'التفويضات',
    load: () => api.get('authorizations', { select: '*', deleted_at: 'is.null', order: 'expiry_date.desc.nullslast' }),
    columns: () => [
      { header: 'السيارة', type: 'text', value: (r) => data.vehicleLabel(r.vehicle_id) },
      { header: 'الموظف', type: 'text', value: (r) => data.employeeName(r.employee_id) },
      { header: 'مفوّض', type: 'text', width: 8, value: (r) => yn(r.is_authorized) },
      { header: 'رقم التفويض', type: 'text', value: (r) => r.auth_no },
      { header: 'تاريخ الإصدار', type: 'date', value: (r) => r.issue_date },
      { header: 'تاريخ الانتهاء', type: 'date', value: (r) => r.expiry_date },
      { header: 'السائق الحالي للسيارة', type: 'text', value: (r) => yn(data.vehicleById(r.vehicle_id)?.current_driver_id === r.employee_id) },
      { header: 'ملاحظات', type: 'wrap', value: (r) => r.notes },
    ],
  },
  {
    key: 'oil', title: 'تغيير الزيت',
    load: () => api.get('oil_changes', { select: '*', deleted_at: 'is.null', order: 'change_date.desc' }),
    columns: () => [
      { header: 'رقم العملية', type: 'text', width: 12, value: (r) => r.oil_no },
      { header: 'السيارة', type: 'text', value: (r) => data.vehicleLabel(r.vehicle_id) },
      { header: 'الموقع', type: 'text', value: (r) => data.siteName(r.site_id) },
      { header: 'التاريخ', type: 'date', value: (r) => r.change_date },
      { header: 'العداد عند التغيير', type: 'int', value: (r) => r.odometer },
      { header: 'فترة التغيير', type: 'int', value: (r) => r.interval_km },
      { header: 'القراءة القادمة', type: 'int', value: (r) => r.next_odometer },
      { header: 'الورشة', type: 'text', value: (r) => r.workshop },
      { header: 'نوع الزيت', type: 'text', value: (r) => r.oil_type },
      { header: 'نوع الفلتر', type: 'text', value: (r) => r.filter_type },
      { header: 'تكلفة الزيت', type: 'money', value: (r) => r.oil_cost },
      { header: 'تكلفة الفلتر', type: 'money', value: (r) => r.filter_cost },
      { header: 'تكاليف إضافية', type: 'money', value: (r) => r.extra_cost },
      { header: 'الإجمالي', type: 'money', value: (r) => r.total },
      { header: 'رقم الفاتورة', type: 'text', value: (r) => r.invoice_no },
      { header: 'الجهة الدافعة', type: 'text', width: 26, value: (r) => r.payer_text || (r.payer_company_id ? data.companyName(r.payer_company_id) : '') },
      { header: 'حالة السداد', type: 'text', value: (r) => pay(r.payment_status) },
      { header: 'ملاحظات', type: 'wrap', value: (r) => r.notes },
    ],
  },
  {
    key: 'maintenance', title: 'الصيانة',
    load: () => api.get('maintenance', { select: '*', deleted_at: 'is.null', order: 'maint_date.desc' }),
    extra: async () => ({ title: 'بنود الصيانة', rows: await api.get('maintenance_items', { select: '*', deleted_at: 'is.null', order: 'maintenance_id,sort_order' }) }),
    columns: () => [
      { header: 'رقم الصيانة', type: 'text', width: 12, value: (r) => r.maint_no },
      { header: 'السيارة', type: 'text', value: (r) => data.vehicleLabel(r.vehicle_id) },
      { header: 'الموقع', type: 'text', value: (r) => data.siteName(r.site_id) },
      { header: 'التاريخ', type: 'date', value: (r) => r.maint_date },
      { header: 'العداد', type: 'int', value: (r) => r.odometer },
      { header: 'نوع الصيانة', type: 'text', value: (r) => r.maint_type },
      { header: 'وصف العطل', type: 'wrap', value: (r) => r.fault_description },
      { header: 'الورشة', type: 'text', value: (r) => r.workshop },
      { header: 'قطع الغيار', type: 'money', value: (r) => r.parts_cost },
      { header: 'أجور العمل', type: 'money', value: (r) => r.labor_cost },
      { header: 'أخرى', type: 'money', value: (r) => r.other_cost },
      { header: 'قبل الضريبة', type: 'money', value: (r) => r.subtotal },
      { header: 'الضريبة', type: 'money', value: (r) => r.vat_amount },
      { header: 'الإجمالي', type: 'money', value: (r) => r.total },
      { header: 'رقم الفاتورة', type: 'text', value: (r) => r.invoice_no },
      { header: 'حالة السداد', type: 'text', value: (r) => pay(r.payment_status) },
      { header: 'الحالة قبل', type: 'text', value: (r) => label('op_status', r.status_before) },
      { header: 'الحالة بعد', type: 'text', value: (r) => label('op_status', r.status_after) },
      { header: 'ملاحظات', type: 'wrap', value: (r) => r.notes },
    ],
    extraColumns: (heads) => [
      { header: 'رقم الصيانة', type: 'text', width: 12, value: (r) => heads.get(r.maintenance_id) || '' },
      { header: 'النوع', type: 'text', value: (r) => ({ part: 'قطع غيار', labor: 'أجور عمل', other: 'أخرى' }[r.kind]) },
      { header: 'الوصف', type: 'wrap', value: (r) => r.description },
      { header: 'الكمية', type: 'number', value: (r) => r.quantity },
      { header: 'سعر الوحدة', type: 'money', value: (r) => r.unit_price },
      { header: 'الإجمالي', type: 'money', value: (r) => r.line_total },
    ],
  },
  {
    key: 'requests', title: 'طلبات الصيانة',
    load: () => api.get('maintenance_requests', { select: '*', deleted_at: 'is.null', order: 'request_date.desc,request_no.desc' }).catch(() => []),
    columns: () => [
      { header: 'رقم الطلب', type: 'text', width: 12, value: (r) => r.request_no },
      { header: 'التاريخ', type: 'date', value: (r) => r.request_date },
      { header: 'المشروع', type: 'text', value: (r) => (r.site_id ? data.siteName(r.site_id) : '') },
      { header: 'تفاصيل المشروع', type: 'text', value: (r) => r.project_text },
      { header: 'المعدة / السيارة', type: 'text', value: (r) => (r.vehicle_id ? data.vehicleLabel(r.vehicle_id) : r.equipment_text) },
      { header: 'رقم اللوحة', type: 'text', value: (r) => r.plate_no },
      { header: 'الموديل', type: 'text', value: (r) => r.model },
      { header: 'المستخدم', type: 'text', value: (r) => r.driver_name },
      { header: 'كيلو متر / الساعة', type: 'int', value: (r) => r.meter_reading },
      { header: 'الوحدة', type: 'text', width: 10, value: (r) => LABELS.meter_unit[r.meter_unit] },
      { header: 'العطل', type: 'wrap', value: (r) => r.fault },
      { header: 'سبب العطل', type: 'wrap', value: (r) => r.fault_cause },
      { header: 'رأي الفني', type: 'wrap', value: (r) => r.technician_opinion },
      { header: 'ملاحظات الموقع', type: 'wrap', value: (r) => r.site_notes },
      { header: 'تاريخ آخر تغيير', type: 'date', value: (r) => r.last_change_date },
      { header: 'الحالة', type: 'text', value: (r) => LABELS.mr_status[r.status] },
      { header: 'مشرف الصيانة', type: 'text', value: (r) => r.supervisor_name },
      { header: 'المعتمد', type: 'text', value: (r) => r.approver_name },
      { header: 'تاريخ القرار', type: 'datetime', value: (r) => r.decided_at },
      { header: 'تاريخ الإنجاز', type: 'datetime', value: (r) => r.completed_at },
    ],
  },
  {
    key: 'accidents', title: 'الحوادث',
    load: () => api.get('accidents', { select: '*', deleted_at: 'is.null', order: 'occurred_at.desc' }),
    columns: () => [
      { header: 'رقم الحادث', type: 'text', width: 12, value: (r) => r.accident_no },
      { header: 'السيارة', type: 'text', value: (r) => data.vehicleLabel(r.vehicle_id) },
      { header: 'السائق', type: 'text', value: (r) => (r.driver_id ? data.employeeName(r.driver_id) : '') },
      { header: 'الموقع', type: 'text', value: (r) => data.siteName(r.site_id) },
      { header: 'تاريخ ووقت الحادث', type: 'datetime', value: (r) => r.occurred_at },
      { header: 'الوصف', type: 'wrap', value: (r) => r.description },
      { header: 'الأضرار', type: 'wrap', value: (r) => r.damages },
      { header: 'الورشة', type: 'text', value: (r) => r.workshop },
      { header: 'قطع الغيار', type: 'money', value: (r) => r.parts_cost },
      { header: 'أجور الإصلاح', type: 'money', value: (r) => r.labor_cost },
      { header: 'تكاليف إضافية', type: 'money', value: (r) => r.extra_cost },
      { header: 'الإجمالي', type: 'money', value: (r) => r.total },
      { header: 'الحالة', type: 'text', value: (r) => label('accident_status', r.status) },
      { header: 'بدء الإصلاح', type: 'date', value: (r) => r.repair_start_date },
      { header: 'انتهاء الإصلاح', type: 'date', value: (r) => r.repair_end_date },
      { header: 'العودة للعمل', type: 'date', value: (r) => r.back_to_work_date },
      { header: 'حالة السداد', type: 'text', value: (r) => pay(r.payment_status) },
    ],
  },
  {
    key: 'handovers', title: 'الاستلام والتسليم',
    load: () => api.get('handovers', { select: '*', deleted_at: 'is.null', order: 'occurred_at.desc' }),
    columns: () => [
      { header: 'رقم النموذج', type: 'text', width: 12, value: (r) => r.form_no },
      { header: 'النوع', type: 'text', value: (r) => (r.kind === 'receive' ? 'استلام' : 'تسليم') },
      { header: 'السيارة', type: 'text', value: (r) => data.vehicleLabel(r.vehicle_id) },
      { header: 'الموقع', type: 'text', value: (r) => data.siteName(r.site_id) },
      { header: 'المسلِّم', type: 'text', value: (r) => (r.from_employee_id ? data.employeeName(r.from_employee_id) : 'الشركة') },
      { header: 'المستلِم', type: 'text', value: (r) => (r.to_employee_id ? data.employeeName(r.to_employee_id) : 'الشركة') },
      { header: 'التاريخ والوقت', type: 'datetime', value: (r) => r.occurred_at },
      { header: 'العداد', type: 'int', value: (r) => r.odometer },
      { header: 'الوقود', type: 'text', value: (r) => ({ empty: 'فارغ', quarter: 'ربع', half: 'نصف', three_quarters: 'ثلاثة أرباع', full: 'ممتلئ' }[r.fuel_level] || '') },
      { header: 'الهيكل', type: 'text', value: (r) => r.body_condition },
      { header: 'الإطارات', type: 'text', value: (r) => r.tires_condition },
      { header: 'الأنوار', type: 'text', value: (r) => r.lights_condition },
      { header: 'المكيف', type: 'text', value: (r) => r.ac_condition },
      { header: 'الأضرار السابقة', type: 'wrap', value: (r) => r.prior_damages },
      { header: 'الحالة', type: 'text', value: (r) => ({ draft: 'مسودة', approved: 'معتمد', cancelled: 'ملغى' }[r.state]) },
    ],
  },
  {
    key: 'housing', title: 'صيانة السكن',
    load: () => api.get('housing_maintenance', { select: '*', deleted_at: 'is.null', order: 'work_date.desc' }),
    columns: () => [
      { header: 'رقم العملية', type: 'text', width: 12, value: (r) => r.op_no },
      { header: 'الشركة', type: 'text', width: 26, value: (r) => data.companyName(r.company_id) },
      { header: 'الموقع', type: 'text', value: (r) => data.siteName(r.site_id) },
      { header: 'التاريخ', type: 'date', value: (r) => r.work_date },
      { header: 'الوصف', type: 'wrap', value: (r) => r.description },
      { header: 'المقاول أو المورد', type: 'text', value: (r) => r.contractor },
      { header: 'رقم الفاتورة', type: 'text', value: (r) => r.invoice_no },
      { header: 'قبل الضريبة', type: 'money', value: (r) => r.subtotal },
      { header: 'الضريبة', type: 'money', value: (r) => r.vat_amount },
      { header: 'الإجمالي', type: 'money', value: (r) => r.total },
      { header: 'حالة السداد', type: 'text', value: (r) => pay(r.payment_status) },
      { header: 'تاريخ السداد', type: 'date', value: (r) => r.paid_date },
    ],
  },
  {
    key: 'food', title: 'توريد الطعام',
    load: () => api.get('food_supplies', { select: '*', deleted_at: 'is.null', order: 'supply_date.desc' }),
    columns: () => [
      { header: 'رقم العملية', type: 'text', width: 12, value: (r) => r.op_no },
      { header: 'الشركة', type: 'text', width: 26, value: (r) => data.companyName(r.company_id) },
      { header: 'الموقع', type: 'text', value: (r) => data.siteName(r.site_id) },
      { header: 'التاريخ', type: 'date', value: (r) => r.supply_date },
      { header: 'المورد', type: 'text', value: (r) => r.supplier },
      { header: 'الوصف', type: 'wrap', value: (r) => r.description },
      { header: 'الكمية', type: 'number', value: (r) => r.quantity },
      { header: 'الوحدة', type: 'text', width: 10, value: (r) => r.unit },
      { header: 'سعر الوحدة', type: 'money', value: (r) => r.unit_price },
      { header: 'قبل الضريبة', type: 'money', value: (r) => r.subtotal },
      { header: 'الضريبة', type: 'money', value: (r) => r.vat_amount },
      { header: 'الإجمالي', type: 'money', value: (r) => r.total },
      { header: 'رقم الفاتورة', type: 'text', value: (r) => r.invoice_no },
      { header: 'حالة السداد', type: 'text', value: (r) => pay(r.payment_status) },
    ],
  },
];

export async function buildSheets(keys) {
  await data.lookups(true);
  const sheets = [];
  for (const k of keys) {
    const spec = EXPORTS.find((e) => e.key === k);
    const rows = await spec.load();
    sheets.push({ name: spec.title, columns: spec.columns(), rows });
    if (spec.extra) {
      const ex = await spec.extra();
      const heads = new Map(rows.map((r) => [r.id, r.maint_no]));
      sheets.push({ name: ex.title, columns: spec.extraColumns(heads), rows: ex.rows.filter((i) => heads.has(i.maintenance_id)) });
    }
  }
  return sheets;
}
