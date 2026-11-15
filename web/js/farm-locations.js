// 1.33: مواقع المزارع الحقيقية (من روابط خرائط Google التي أرسلها المالك، 2026/11/15).
// الربط باسم الموقع في النظام (أول تطابق). «مزرعة الغملاس» بجانب «مشتل الغملاس» (حسب المالك)؛ موقعها تقريبي حتى يصل رابطها.
export const FARM_LOCATIONS = [
  { key: 'nursery', match: /مشتل/, lng: 43.900743, lat: 26.2345176 },
  { key: 'ghamlas', match: /الغملاس|الغماس/, lng: 43.9052, lat: 26.2372, approx: true },
  { key: 'aram', match: /ارم|آرام|إرم|أرم/, lng: 44.4830216, lat: 26.5197704 },
  { key: 'baraka', match: /البركة|براكه|البركه|بركة/, lng: 43.3575999, lat: 27.0494906 },
];
export function locate(name) {
  const n = String(name || '');
  return FARM_LOCATIONS.find((f) => f.match.test(n)) || null;
}
