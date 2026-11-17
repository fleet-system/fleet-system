// 1.33: خرائط حقيقية بصور القمر الصناعي (MapLibre GL 5.19، محلي في web/vendor، رخصة BSD).
// الصور: Esri World Imagery (مجانية مع ذكر المصدر)، والتضاريس: AWS Terrain Tiles. لا مفاتيح ولا حسابات.
// مواقع السيارات = مواقع مزارعها المسجلة في النظام (لا يوجد GPS)، وهذا مكتوب للمستخدم تحت الخريطة.
import { FARM_LOCATIONS } from './farm-locations.js';

const BASE = new URL('../vendor/maplibre-gl-5.19.0/', import.meta.url).href;
let loading = null;
export function loadMapLib() {
  if (window.maplibregl) return Promise.resolve(window.maplibregl);
  if (loading) return loading;
  loading = new Promise((ok, fail) => {
    const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = `${BASE}maplibre-gl.css`; document.head.append(css);
    const s = document.createElement('script'); s.src = `${BASE}maplibre-gl.js`; s.async = true;
    s.onload = () => (window.maplibregl ? ok(window.maplibregl) : fail(new Error('maplibre')));
    s.onerror = () => { loading = null; fail(new Error('maplibre')); };
    document.head.append(s);
  });
  return loading;
}
export function webglOk() {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; }
}

export function satStyle({ globe = false, terrain = false } = {}) {
  return {
    version: 8,
    projection: { type: globe ? 'globe' : 'mercator' },
    sources: {
      sat: { type: 'raster', tileSize: 256, maxzoom: 19, attribution: 'صور: Esri, Maxar, Earthstar Geographics',
        tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'] },
      ...(terrain ? { dem: { type: 'raster-dem', tileSize: 256, maxzoom: 13, encoding: 'terrarium',
        tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'] } } : {}),
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#A88B66' } }, // لون صحراوي بدل الأسود حتى لا تظهر فراغات سوداء قبل وصول الصور,
      { id: 'sat', type: 'raster', source: 'sat', paint: { 'raster-saturation': .08, 'raster-contrast': .08, 'raster-brightness-max': .95 } },
    ],
    sky: { 'sky-color': '#071a12', 'horizon-color': '#d39a5c', 'fog-color': '#1d3326', 'sky-horizon-blend': .6, 'horizon-fog-blend': .55, 'fog-ground-blend': .7, 'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 7, .9, 11, 0] },
  };
}
// 1.32: تحميل صور المزارع مسبقاً (قبل وصول الكاميرا) حتى لا تظهر مربعات فارغة أثناء الجولة؛ المتصفح يحفظها في ذاكرته.
const SAT_URL = (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
function tileXY(lng, lat, z) {
  const n = 2 ** z, r = (lat * Math.PI) / 180;
  return [Math.floor(((lng + 180) / 360) * n), Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n)];
}
export function prefetchTiles(points, plan = [[10, 1], [12, 1], [13, 1], [14, 2], [15, 1]], alive = () => true) {
  const urls = [];
  for (const [lng, lat] of points) for (const [z, r] of plan) {
    const [x, y] = tileXY(lng, lat, z);
    for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) urls.push(SAT_URL(z, x + dx, y + dy));
  }
  let k = 0;
  const pump = () => { if (k >= urls.length || !alive()) return; const im = new Image(); im.crossOrigin = 'anonymous'; im.onload = im.onerror = pump; im.src = urls[k++]; };
  for (let c = 0; c < 4; c++) pump();
  return urls.length;
}
export const farmBounds = () => {
  const xs = FARM_LOCATIONS.map((f) => f.lng), ys = FARM_LOCATIONS.map((f) => f.lat);
  return [[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]];
};
// يوقف الخريطة ويحررها إذا أُزيل عنصرها من الصفحة (تنقل/تسجيل دخول)
export function autoDispose(map, el) {
  const t = setInterval(() => { if (!el.isConnected) { clearInterval(t); try { map.remove(); } catch { /* تمت إزالتها */ } } }, 1500);
}
