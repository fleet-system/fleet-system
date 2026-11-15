// 1.31: «خريطة المزارع الحية» في لوحة التحكم: كل موقع نقطة، وحوله سياراته بلون حالتها (نفس ألوان خانات السيارات).
// البيانات نفسها التي تقرأها لوحة التحكم (v_vehicles_overview + المواقع)؛ الضغط على سيارة يفتح بطاقتها بالمعرّف الداخلي.
import { html, raw } from './ui.js';
import { num } from './fmt.js';
import { PLACES, placeOf } from './pages/vehicles.js';
import { loadMapLib, webglOk, satStyle, autoDispose } from './realmap.js';
import { locate } from './farm-locations.js';

const PNAME = Object.fromEntries(PLACES);
const GOLD = Math.PI * (3 - Math.sqrt(5));
let lastHubs = [];

export function fleetMap(vrows, sites) {
  if (!vrows) return '';
  const mobile = window.matchMedia('(max-width: 640px)').matches;
  const W = mobile ? 400 : 1000, H = mobile ? 500 : 440;
  // المواقع: النشطة + أي موقع عليه سيارات، و«بدون موقع» إن وُجدت سيارات غير مربوطة
  const by = new Map();
  for (const v of vrows) { const k = v.site_id || ''; if (!by.has(k)) by.set(k, []); by.get(k).push(v); }
  const hubs = sites.filter((s) => s.is_active !== false || by.has(s.id)).map((s) => ({ id: s.id, name: s.name, cars: by.get(s.id) || [] }));
  if (by.has('')) hubs.push({ id: '', name: 'بدون موقع', cars: by.get('') });
  if (!hubs.length) return '';
  hubs.sort((a, b) => b.cars.length - a.cars.length || a.name.localeCompare(b.name, 'ar'));
  lastHubs = hubs;
  // توزيع المواقع على قطع ناقص حول المركز (الأسطول)
  const cx = W / 2, cy = H / 2 + (mobile ? 10 : 6);
  const rx = mobile ? W * .32 : W * .36, ry = mobile ? H * .34 : H * .32;
  const n = hubs.length;
  hubs.forEach((h, i) => {
    const a = n === 1 ? -Math.PI / 2 : -Math.PI / 2 + (i * 2 * Math.PI) / n;
    h.x = cx + rx * Math.cos(a); h.y = cy + ry * Math.sin(a);
  });
  const maxCars = Math.max(1, ...hubs.map((h) => h.cars.length));
  const hubR = (h) => 22 + Math.sqrt(h.cars.length / maxCars) * (mobile ? 18 : 26);
  const total = vrows.length;
  const car = (v, h, i) => {
    const d = hubR(h) * .55 + (mobile ? 9 : 11) + (mobile ? 5 : 6.5) * Math.sqrt(i) ;
    const a = i * GOLD + Math.PI / 2; // تبدأ من الأسفل-الجانب بعيداً عن اسم الموقع
    const p = placeOf(v);
    return html`<a class="cc-car pl-${p}" href="#/vehicles/${v.id}" data-car tabindex="0" aria-label="${v.plate_no || v.code}: ${PNAME[p]}"
      data-plate="${v.plate_no || ''}" data-code="${v.code || ''}" data-st="${PNAME[p]}" data-site="${h.name}">
      <circle cx="${(h.x + d * Math.cos(a)).toFixed(1)}" cy="${(h.y + d * Math.sin(a)).toFixed(1)}" r="${mobile ? 5.5 : 6.5}"></circle></a>`;
  };
  const counts = PLACES.map(([k, t]) => [k, t, vrows.filter((v) => placeOf(v) === k).length]).filter((x) => x[2]);
  return html`<section class="cc-map" data-fleet-map aria-labelledby="p-map">
    <div class="cc-scan" aria-hidden="true"></div>
    <div class="cc-map-h"><h2 id="p-map">خريطة المزارع الحية</h2><span class="cc-live"><i></i>مباشر</span></div>
    <div class="cc-stage" style="aspect-ratio:${W} / ${H}">
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="توزيع ${num(total)} سيارة على المواقع">
        <defs><linearGradient id="cc-grad" x1="0" x2="1"><stop offset="0" stop-color="#3BE08F"/><stop offset="1" stop-color="#E9C47E"/></linearGradient>
          <radialGradient id="cc-core"><stop offset="0" stop-color="#3BE08F" stop-opacity=".55"/><stop offset="1" stop-color="#3BE08F" stop-opacity="0"/></radialGradient></defs>
        <ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" class="cc-ring" />
        <ellipse cx="${cx}" cy="${cy}" rx="${rx * 1.18}" ry="${ry * 1.18}" class="cc-ring r2" />
        ${raw(hubs.map((h) => html`<path class="cc-link" d="M${cx},${cy} Q${((cx + h.x) / 2).toFixed(1)},${(Math.min(cy, h.y) - 40).toFixed(1)} ${h.x.toFixed(1)},${h.y.toFixed(1)}"/>`).join(''))}
        <circle cx="${cx}" cy="${cy}" r="60" fill="url(#cc-core)"/>
        <circle cx="${cx}" cy="${cy}" r="30" class="cc-hub"/>
        <text x="${cx}" y="${cy + 5}" class="cc-site-name" style="font-size:18px">${num(total)}</text>
        <text x="${cx}" y="${cy + 48}" class="cc-site-sub">إجمالي الأسطول</text>
        ${raw(hubs.map((h) => html`<g class="cc-site" data-site-id="${h.id}">
          <circle cx="${h.x.toFixed(1)}" cy="${h.y.toFixed(1)}" r="${hubR(h).toFixed(1)}" class="cc-pulse"/>
          <circle cx="${h.x.toFixed(1)}" cy="${h.y.toFixed(1)}" r="${(hubR(h) * .55).toFixed(1)}" class="cc-hub"/>
          <text x="${h.x.toFixed(1)}" y="${(h.y + 4).toFixed(1)}" class="cc-site-name">${num(h.cars.length)}</text>
          <text x="${h.x.toFixed(1)}" y="${(h.y - hubR(h) * .55 - (mobile ? 9 : 11) - (mobile ? 5 : 6.5) * Math.sqrt(Math.max(0, h.cars.length - 1)) - 16).toFixed(1)}" class="cc-site-name cc-name">${h.name}</text>
          ${raw(h.cars.map((v, i) => car(v, h, i)).join(''))}</g>`).join(''))}
      </svg>
      <div class="cc-info" hidden></div>
    </div>
    <ul class="cc-legend">${raw(counts.map(([k, t, c]) => html`<li><i class="dot pl-${k}"></i>${t} <b class="num">${num(c)}</b></li>`).join(''))}</ul>
  </section>`;
}

export function bindFleetMap(sec) {
  if (!sec) return;
  const info = sec.querySelector('.cc-info'), stage = sec.querySelector('.cc-stage');
  const show = (a) => {
    const c = (a.querySelector('circle') || a).getBoundingClientRect(), s = stage.getBoundingClientRect();
    info.innerHTML = html`<b class="plate">${a.dataset.plate || a.dataset.code}</b><span class="muted small">${a.dataset.code} · ${a.dataset.site}</span><br><span>${a.dataset.st}</span>`;
    info.style.left = `${c.left - s.left + c.width / 2}px`; info.style.top = `${c.top - s.top}px`;
    // لا تخرج النافذة عن البطاقة في الجوال
    info.style.transform = c.left - s.left < 120 ? 'translate(0, -115%)' : c.right > s.right - 120 ? 'translate(-100%, -115%)' : '';
    info.hidden = false;
  };
  const hide = () => { info.hidden = true; };
  sec.addEventListener('pointerover', (e) => { const a = e.target.closest('[data-car]'); if (a) show(a); });
  sec.addEventListener('pointerout', (e) => { if (e.target.closest('[data-car]')) hide(); });
  sec.addEventListener('focusin', (e) => { const a = e.target.closest('[data-car]'); if (a) show(a); });
  sec.addEventListener('focusout', hide);
  upgradeToReal(sec, lastHubs);
}

// 1.33: الخريطة الحقيقية (صور القمر الصناعي) بدل الرسم، بنفس السيارات ونفس الروابط. الرسم يبقى إن لم يتوفر WebGL.
const carDot = (v, h, i, n) => {
  const p = placeOf(v);
  const ring = n <= 10 ? 1 : 0; // قليل = حلقة منتظمة، كثير = حلزون
  const a = ring ? (i / n) * Math.PI * 2 + Math.PI / 2 : i * GOLD + Math.PI / 2;
  const d = ring ? 30 : 28 + 6 * Math.sqrt(i);
  return html`<a class="cc-dot pl-${p}" href="#/vehicles/${v.id}" data-car aria-label="${v.plate_no || v.code}: ${PNAME[p]}" style="transform:translate(${(d * Math.cos(a)).toFixed(1)}px, ${(d * Math.sin(a)).toFixed(1)}px)"
    data-plate="${v.plate_no || ''}" data-code="${v.code || ''}" data-st="${PNAME[p]}" data-site="${h.name}"></a>`;
};
async function upgradeToReal(sec, hubs) {
  if (!hubs.length || !webglOk()) return;
  let ml; try { ml = await loadMapLib(); } catch { return; }
  const stage = sec.querySelector('.cc-stage'); if (!stage || !sec.isConnected) return;
  const placed = hubs.map((h) => ({ ...h, loc: h.id ? locate(h.name) : null }));
  const on = placed.filter((h) => h.loc), off = placed.filter((h) => !h.loc);
  if (!on.length) return;
  const box = document.createElement('div'); box.className = 'cc-real';
  stage.classList.add('real'); stage.prepend(box); // في الصفحة قبل إنشاء الخريطة حتى تأخذ مقاسها
  let map;
  try {
    map = new ml.Map({ container: box, style: satStyle({ terrain: true }), center: [on[0].loc.lng, on[0].loc.lat], zoom: 8, pitch: 40,
      attributionControl: { compact: true }, cooperativeGestures: true, maxPitch: 70, locale: { 'CooperativeGesturesHandler.WindowsHelpText': 'استخدم Ctrl + التمرير للتكبير', 'CooperativeGesturesHandler.MacHelpText': 'استخدم ⌘ + التمرير للتكبير', 'CooperativeGesturesHandler.MobileHelpText': 'استخدم إصبعين لتحريك الخريطة' } });
  } catch { box.remove(); stage.classList.remove('real'); return; }
  stage.querySelector('svg')?.remove();
  autoDispose(map, box);
  const all = () => {
    const xs = on.map((h) => h.loc.lng), ys = on.map((h) => h.loc.lat);
    if (on.length === 1) map.flyTo({ center: [xs[0], ys[0]], zoom: 14, pitch: 55, duration: 1800 });
    else map.fitBounds([[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]], { padding: { top: 90, bottom: 70, left: 70, right: 70 }, pitch: 42, bearing: -8, duration: 1800, maxZoom: 13 });
  };
  for (const h of on) {
    const el = document.createElement('div'); el.className = `cc-farm f-${h.loc.key}`; el.dataset.siteId = h.id;
    el.innerHTML = html`<button type="button" class="cc-farm-name" data-fly="${h.id}">${h.name}${raw(h.loc.approx ? ' <small>(تقريبي)</small>' : '')}</button>
      <span class="cc-farm-core num">${num(h.cars.length)}</span>${raw(h.cars.map((v, i) => carDot(v, h, i, h.cars.length)).join(''))}`;
    new ml.Marker({ element: el, anchor: 'center' }).setLngLat([h.loc.lng, h.loc.lat]).addTo(map);
  }
  // مواقع بلا إحداثيات: تحت الخريطة بنفس النقاط والروابط
  if (off.length) {
    const ul = document.createElement('div'); ul.className = 'cc-unplaced';
    ul.innerHTML = off.map((h) => html`<div class="cc-off" data-site-id="${h.id}"><b>${h.name}</b> <span class="muted num">(${num(h.cars.length)})</span>
      <span class="cc-off-dots">${raw(h.cars.map((v) => String(carDot(v, h, 0, 1)).replace(/ style="[^"]*"/, '')).join(''))}</span></div>`).join('');
    stage.after(ul);
  }
  const bar = document.createElement('div'); bar.className = 'cc-map-tools';
  bar.innerHTML = '<button type="button" class="cc-tool" data-fly-all>كل المزارع</button><span class="muted small">مكان السيارة = مزرعتها المسجلة في النظام (بدون GPS). اضغط اسم المزرعة للاقتراب.</span>';
  sec.querySelector('.cc-legend').after(bar);
  sec.addEventListener('click', (e) => {
    if (e.target.closest('[data-fly-all]')) { all(); return; }
    const f = e.target.closest('[data-fly]'); if (!f) return;
    const h = on.find((x) => x.id === f.dataset.fly);
    if (h) map.flyTo({ center: [h.loc.lng, h.loc.lat], zoom: 15.2, pitch: 60, bearing: map.getBearing() - 30, duration: 2600, essential: true });
  });
  map.once('styledata', () => map.resize());
  map.on('load', () => { try { map.setTerrain({ source: 'dem', exaggeration: 1.8 }); } catch { /* */ } all(); });
}
