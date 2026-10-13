// بيانات مرجعية مشتركة (الشركات، المواقع، الموظفون) مع ذاكرة مؤقتة تُحدّث عند التعديل
import * as api from './api.js';

let cache = null;
export async function lookups(force = false) {
  if (!cache || force) {
    const [companies, sites, employees, vehicles, settings] = await Promise.all([
      api.get('companies', { select: '*', order: 'name' }),
      api.get('sites', { select: 'id,name,company_id,kind,is_active', order: 'name' }),
      api.get('employees', { select: 'id,code,full_name,site_id,company_id,status', deleted_at: 'is.null', order: 'full_name' }),
      api.get('vehicles', { select: 'id,code,plate_no,vehicle_type,make,model,manufacture_year,site_id,owner_company_id,current_driver_id,odometer,oil_interval_km,op_status,location_status', deleted_at: 'is.null', order: 'code' }),
      api.get('app_settings', { select: 'key,value' }).catch(() => []),
    ]);
    cache = { companies, sites, employees, vehicles, settings: Object.fromEntries(settings.map((x) => [x.key, x.value])) };
  }
  return cache;
}
export const invalidate = () => { cache = null; };
export { cacheGet as cache };
function cacheGet() { return cache; }

export const companyName = (id) => cache?.companies.find((c) => c.id === id)?.name || '—';
export const siteName = (id) => cache?.sites.find((s) => s.id === id)?.name || '—';
export const siteCompany = (id) => cache?.sites.find((s) => s.id === id)?.company_id || null;
export const employeeName = (id) => { const e = cache?.employees.find((x) => x.id === id); return e ? e.full_name : '—'; };

export const companyOptions = (active = true) => cache.companies.filter((c) => !active || c.is_active).map((c) => [c.id, c.name]);
// الشركات الرئيسية فقط (بدون مالكي المركبات المسجلين من بطاقة السيارة)
export const mainCompanyOptions = (active = true) => cache.companies.filter((c) => !c.is_vehicle_owner && (!active || c.is_active)).map((c) => [c.id, c.name]);
export const siteOptions = (active = true) => cache.sites.filter((s) => !active || s.is_active).map((s) => [s.id, `${s.name} — ${companyName(s.company_id)}`]);
export const employeeOptions = () => cache.employees.filter((e) => e.status !== 'terminated').map((e) => [e.id, `${e.full_name} (${e.code})`]);

export const vehicleById = (id) => cache?.vehicles.find((v) => v.id === id) || null;
export const vehicleLabel = (id) => { const v = vehicleById(id); return v ? `${v.plate_no} (${v.code})` : '—'; };
export const vehicleOptions = () => cache.vehicles.map((v) => [v.id, `${v.plate_no} — ${v.code}${v.vehicle_type ? ' — ' + v.vehicle_type : ''}`]);

// الإعدادات (تُعدّل من صفحة الإعدادات)
export const setting = (k, dflt) => { const v = cache?.settings?.[k]; return v === undefined || v === null ? dflt : v; };
export const vatRate = () => Number(setting('default_vat_rate', 0.15));
export const vatLabel = (rate = vatRate()) => `إضافة ضريبة القيمة المضافة ${Math.round(rate * 1000) / 10}%`;
// عند تعديل سجل قديم نحافظ على نسبة الضريبة التي سُجّل بها، حتى لو تغيّرت النسبة في الإعدادات لاحقاً
export const rateFor = (row) => {
  const sub = Number(row?.subtotal || 0), vat = Number(row?.vat_amount || 0);
  if (!row || !(vat > 0) || !(sub > 0)) return vatRate();
  if (Math.abs(Math.round(sub * vatRate() * 100) / 100 - vat) < 0.005) return vatRate(); // النسبة الحالية نفسها
  return Math.round((vat / sub) * 1000) / 1000;
};
