// 1.31: «خريطة المزارع الحية» في لوحة التحكم: كل موقع نقطة، وحوله سياراته بلون حالتها (نفس ألوان خانات السيارات).
// البيانات نفسها التي تقرأها لوحة التحكم (v_vehicles_overview + المواقع)؛ الضغط على سيارة يفتح بطاقتها بالمعرّف الداخلي.
import { html, raw } from './ui.js';
import { num } from './fmt.js';
import { PLACES, placeOf } from './pages/vehicles.js';

const PNAME = Object.fromEntries(PLACES);
const GOLD = Math.PI * (3 - Math.sqrt(5));

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
    const c = a.querySelector('circle').getBoundingClientRect(), s = stage.getBoundingClientRect();
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
}
