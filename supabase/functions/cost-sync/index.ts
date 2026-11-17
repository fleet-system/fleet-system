// 1.35: المزامنة اللحظية من ملف Excel المالك (برنامج المراقبة في اللابتوب يرسل الملف عند كل حفظ).
// POST .../functions/v1/cost-sync  مع الترويسة x-sync-key = المفتاح، والجسم = ملف xlsx.
// المفتاح لا يُحفظ؛ بصمته SHA-256 فقط في app_settings (key = 'cost_sync', value.hash). يستدعي sync_cost_lines:
// الجديد يُضاف، المعدّل يتحدّث، والمحذوف من Excel يُؤرشف (لا حذف أبداً).
import { unzip } from './zip.js';
import { sheetsFromZip, costRowsFromSheets } from './rows.js';

const URL_ = Deno.env.get('SUPABASE_URL')!;
const KEY_ = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const H = { apikey: KEY_, Authorization: `Bearer ${KEY_}`, 'Content-Type': 'application/json', Accept: 'application/json' };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

async function sha256Hex(t: string) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
async function keyAllowed(key: string) {
  if (typeof key !== 'string' || key.length < 32) return false;
  const r = await fetch(`${URL_}/rest/v1/app_settings?key=eq.cost_sync&select=value`, { headers: H });
  if (!r.ok) throw new Error('settings');
  const cfg = (await r.json())[0]?.value;
  if (!cfg || cfg.enabled === false || !cfg.hash) return false;
  const h = await sha256Hex(key);
  if (h.length !== cfg.hash.length) return false;
  let d = 0; for (let i = 0; i < h.length; i++) d |= h.charCodeAt(i) ^ cfg.hash.charCodeAt(i);
  return d === 0;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  try {
    if (!(await keyAllowed(req.headers.get('x-sync-key') || ''))) return json({ error: 'not allowed' }, 403);
    const buf = await req.arrayBuffer();
    if (buf.byteLength < 100 || buf.byteLength > 30_000_000) return json({ error: 'bad file' }, 400);
    const { rows, sheets } = costRowsFromSheets(sheetsFromZip(await unzip(buf)));
    if (!sheets.length) return json({ error: 'no cost sheets' }, 400);
    const r = await fetch(`${URL_}/rest/v1/rpc/sync_cost_lines`, { method: 'POST', headers: H, body: JSON.stringify({ p_rows: rows, p_sheets: sheets }) });
    if (!r.ok) return json({ error: 'sync', status: r.status }, 502);
    return json({ ok: true, rows: rows.length, sheets, result: await r.json() });
  } catch (_e) {
    return json({ error: 'unavailable' }, 503);
  }
});
