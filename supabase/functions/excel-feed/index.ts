// دالة Supabase: ملف Excel المربوط (للقراءة فقط). الرابط: .../functions/v1/excel-feed?key=المفتاح
// المفتاح يُنشأ من الموقع (الإعدادات ← ملف Excel المربوط) وتُحفظ بصمته فقط في app_settings.excel_feed.
import { DATASETS, keyAllowed, buildWorkbook } from './feed.js';

const URL_ = Deno.env.get('SUPABASE_URL')!;
const KEY_ = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

async function get(path: string) {
  const r = await fetch(`${URL_}/rest/v1/${path}`, { headers: { apikey: KEY_, Authorization: `Bearer ${KEY_}`, Accept: 'application/json' } });
  if (!r.ok) throw new Error(`${path.split('?')[0]}: ${r.status}`);
  return r.json();
}

Deno.serve(async (req) => {
  if (req.method !== 'GET') return new Response('Method not allowed', { status: 405 });
  const key = new URL(req.url).searchParams.get('key') || '';
  try {
    const settings = await get(DATASETS.settings);
    if (!(await keyAllowed(key, settings))) return new Response('Not allowed', { status: 403 });
    const names = Object.keys(DATASETS).filter((n) => n !== 'settings');
    const rows = await Promise.all(names.map((n) => get(DATASETS[n as keyof typeof DATASETS])));
    const d: Record<string, unknown[]> = { settings };
    names.forEach((n, i) => { d[n] = rows[i]; });
    const blob = buildWorkbook(d);
    return new Response(blob, { headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="fleet-data.xlsx"',
      'Cache-Control': 'no-store',
    } });
  } catch (_e) {
    return new Response('Temporarily unavailable', { status: 503 });
  }
});
