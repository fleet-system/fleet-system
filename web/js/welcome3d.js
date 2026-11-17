// 1.33: الترحيب الحقيقي: الكرة الأرضية بصور القمر الصناعي ثم نزول سينمائي على مزارعكم الحقيقية (realmap.js)،
// وإن لم تصل الصور (بدون إنترنت) أو لم يتوفر WebGL يعمل المشهد المرسوم أدناه، ثم بديل CSS.
import { loadMapLib, webglOk, satStyle, autoDispose, prefetchTiles } from './realmap.js';
import { FARM_LOCATIONS } from './farm-locations.js';
const FARM_NAMES = { nursery: 'مشتل الغملاس', ghamlas: 'مزرعة الغملاس', aram: 'مزرعة ارم', baraka: 'مزرعة البركة' };

export async function startWelcome(host) {
  if (!host || navigator.webdriver) return; // الاختبارات الآلية: بدون رسم ثقيل
  if (!webglOk()) return;
  let ml;
  try { ml = await loadMapLib(); } catch { return startScene(host); }
  if (!host.isConnected) return;
  const box = document.createElement('div'); box.className = 'w3d-map'; host.append(box);
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const center = [43.92, 26.62];
  let map;
  try {
    map = new ml.Map({ container: box, style: satStyle({ globe: true, terrain: true }), center: [46, 21], zoom: still ? 8 : 1.4, pitch: 0, bearing: 0,
      interactive: false, attributionControl: { compact: true }, fadeDuration: 0, maxPitch: 75 });
  } catch { box.remove(); return startScene(host); }
  autoDispose(map, box);
  let tiles = false;
  map.on('data', (e) => { if (e.sourceId === 'sat' && e.tile) tiles = true; });
  // بدون صور خلال 10 ثوانٍ (لا إنترنت/محجوبة) = المشهد المرسوم بدلها
  setTimeout(() => { if (!tiles && box.isConnected) { try { map.remove(); } catch { /* */ } box.remove(); startScene(host); } }, 10000);
  map.once('styledata', () => map.resize());
  map.on('load', () => {
    try { map.setTerrain({ source: 'dem', exaggeration: 2.2 }); } catch { /* بدون تضاريس */ }
    for (const f of FARM_LOCATIONS) {
      const el = document.createElement('div'); el.className = 'w3d-pin';
      el.innerHTML = `<i></i><span>${FARM_NAMES[f.key] || ''}</span>`;
      new ml.Marker({ element: el, anchor: 'bottom' }).setLngLat([f.lng, f.lat]).addTo(map);
    }
    requestAnimationFrame(() => box.classList.add('on'));
    // صور المزارع تُحمَّل مسبقاً بترتيب الجولة أثناء نزول الكاميرا من الفضاء
    if (!still) prefetchTiles(FARM_LOCATIONS.filter((f) => f.key !== 'ghamlas').map((f) => [f.lng, f.lat]), undefined, () => box.isConnected);
    if (still) { map.jumpTo({ center, zoom: 8.6, pitch: 45, bearing: -12 }); return; }
    // الجولة: من الفضاء إلى منطقة المزارع، ثم كل مزرعة من قريب بزاوية مائلة، وتعاد
    const stops = [{ center, zoom: 8.4, pitch: 50, bearing: -18 },
      ...FARM_LOCATIONS.filter((f) => f.key !== 'ghamlas').map((f, i) => ({ center: [f.lng, f.lat], zoom: 14.8, pitch: 56, bearing: -40 + i * 55 })),
      { center, zoom: 8.6, pitch: 48, bearing: 20 }];
    let i = 0;
    // بعد كل نزول: انتظار اكتمال الصور (idle، بحد أقصى 4 ثوانٍ) قبل الدوران والانتقال، حتى لا تظهر فراغات
    const whenReady = (fn) => { let done = false; const go = () => { if (!done) { done = true; fn(); } }; map.once('idle', go); setTimeout(go, 4000); };
    const next = () => {
      if (!box.isConnected) return;
      const st = stops[i % stops.length]; i += 1;
      map.flyTo({ ...st, duration: i === 1 ? 7000 : 7500, curve: 1.4, essential: true });
      map.once('moveend', () => whenReady(() => { if (!box.isConnected) return;
        map.easeTo({ bearing: st.bearing + 25, duration: 5000, easing: (t) => t }); map.once('moveend', () => setTimeout(next, 200)); }));
    };
    setTimeout(next, 900);
  });
}

// 1.31: صفحة الترحيب ثلاثية الأبعاد (خلف نموذج الدخول): صحراء وقت الغروب، دوائر زراعية بمرشّات محورية تدور،
// نخيل، وسيارات الأسطول تمشي على الطرق بأضوائها، والكاميرا تنزل بلقطة سينمائية ثم تدور ببطء وتتبع الإصبع/الفأرة.
// المكتبة (three.js، web/vendor) تُحمَّل عند الحاجة فقط؛ إن لم تتوفر (بدون إنترنت أو متصفح قديم) تبقى الخلفية المتحركة بـ CSS.
const THREE_URL = '../vendor/three-0.169.0.module.min.js'; // نسخة محلية (MIT) حتى لا يعتمد الموقع على خدمة خارجية

async function startScene(host) {
  if (!host || !host.isConnected) return;
  let THREE;
  try { THREE = await import(THREE_URL); } catch { return; }
  if (!host.isConnected) return;
  const canvas = document.createElement('canvas');
  canvas.className = 'w3d-canvas'; canvas.setAttribute('aria-hidden', 'true');
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }); } catch { return; }
  host.append(canvas); // فوق البديل، ويظهر تدريجياً
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const SKY = new THREE.Color('#1a2a2a');
  scene.fog = new THREE.FogExp2('#3a3328', 0.0105);
  // سماء متدرجة (غروب): كرة كبيرة بلون من الأسفل للأعلى
  const skyGeo = new THREE.SphereGeometry(400, 32, 16);
  const skyMat = new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color('#06140e') }, mid: { value: new THREE.Color('#1d3b2c') }, low: { value: new THREE.Color('#e09a52') } },
    vertexShader: 'varying vec3 p; void main(){ p = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 mid; uniform vec3 low; varying vec3 p; void main(){ float h = p.y; vec3 c = h > .12 ? mix(mid, top, smoothstep(.12,.7,h)) : mix(low, mid, smoothstep(-.05,.12,h)); gl_FragColor = vec4(c,1.); }' });
  scene.add(new THREE.Mesh(skyGeo, skyMat));
  // نجوم
  const starPos = []; for (let i = 0; i < 700; i++) { const t = Math.random() * Math.PI * 2, u = .25 + Math.random() * .7; starPos.push(300 * Math.cos(t) * Math.sqrt(1 - u * u), 300 * u, 300 * Math.sin(t) * Math.sqrt(1 - u * u)); }
  const stars = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3)),
    new THREE.PointsMaterial({ color: '#cfe8da', size: 1.1, sizeAttenuation: false, transparent: true, opacity: .8, fog: false }));
  scene.add(stars);

  const camera = new THREE.PerspectiveCamera(48, 1, 0.5, 900);
  scene.add(new THREE.HemisphereLight('#9fd3b8', '#5a3d1e', 0.75));
  const sun = new THREE.DirectionalLight('#ffbf7a', 2.4); sun.position.set(-90, 45, -60); sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024); Object.assign(sun.shadow.camera, { left: -90, right: 90, top: 90, bottom: -90, near: 1, far: 300 });
  scene.add(sun);
  // شمس متوهجة على الأفق
  const glow = new THREE.Mesh(new THREE.CircleGeometry(18, 48), new THREE.MeshBasicMaterial({ color: '#ffcf8a', transparent: true, opacity: .9, fog: false }));
  glow.position.set(-260, 22, -200); glow.lookAt(0, 0, 0); scene.add(glow);

  // الأرض: كثبان رملية
  const ground = new THREE.PlaneGeometry(600, 600, 160, 160); ground.rotateX(-Math.PI / 2);
  const gp = ground.attributes.position;
  const dune = (x, z) => { const r = Math.hypot(x, z); const flat = Math.min(1, Math.max(0, (r - 70) / 60)); return flat * (Math.sin(x * .045) * 3.2 + Math.sin(z * .06 + x * .02) * 2.4 + Math.sin((x + z) * .11) * .8); };
  for (let i = 0; i < gp.count; i++) gp.setY(i, dune(gp.getX(i), gp.getZ(i)));
  ground.computeVertexNormals();
  const land = new THREE.Mesh(ground, new THREE.MeshStandardMaterial({ color: '#c79a62', roughness: .95, flatShading: true }));
  land.receiveShadow = true; scene.add(land);

  // الدوائر الزراعية (رشاشات محورية) مع ذراع يدور
  const pivots = [];
  const FIELDS = [[-34, -18, 20, '#3f8f4e'], [18, -34, 17, '#5aa457'], [40, 12, 19, '#2f7a45'], [-8, 30, 15, '#79b35a'], [-48, 28, 13, '#4c9a52'], [8, -2, 9, '#a5c46a']];
  for (const [x, z, r, c] of FIELDS) {
    const f = new THREE.Mesh(new THREE.CircleGeometry(r, 64), new THREE.MeshStandardMaterial({ color: c, roughness: .9 }));
    f.rotation.x = -Math.PI / 2; f.position.set(x, .06, z); f.receiveShadow = true; scene.add(f);
    // حلقات المحصول
    for (let k = 1; k < 4; k++) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(r * k / 4 - .15, r * k / 4 + .15, 64), new THREE.MeshBasicMaterial({ color: '#1f5a33', transparent: true, opacity: .35 }));
      ring.rotation.x = -Math.PI / 2; ring.position.set(x, .08, z); scene.add(ring);
    }
    const arm = new THREE.Group(); arm.position.set(x, 0, z);
    const beam = new THREE.Mesh(new THREE.BoxGeometry(r, .25, .25), new THREE.MeshStandardMaterial({ color: '#d9dfe2', metalness: .6, roughness: .4 }));
    beam.position.set(r / 2, 1.6, 0); beam.castShadow = true; arm.add(beam);
    for (let k = 1; k <= 4; k++) { const leg = new THREE.Mesh(new THREE.CylinderGeometry(.08, .12, 1.6, 6), beam.material); leg.position.set((r * k) / 4.2, .8, 0); arm.add(leg); }
    scene.add(arm); pivots.push([arm, 0.05 + Math.random() * .08]);
  }
  // النخيل
  const trunkMat = new THREE.MeshStandardMaterial({ color: '#6b4a2b', roughness: 1, flatShading: true });
  const leafMat = new THREE.MeshStandardMaterial({ color: '#2f6b3a', roughness: .8, flatShading: true, side: THREE.DoubleSide });
  const palm = (x, z, s) => {
    const g = new THREE.Group(); g.position.set(x, 0, z); g.scale.setScalar(s);
    const t = new THREE.Mesh(new THREE.CylinderGeometry(.18, .3, 5, 6), trunkMat); t.position.y = 2.5; t.rotation.z = (Math.random() - .5) * .12; t.castShadow = true; g.add(t);
    for (let i = 0; i < 7; i++) {
      const lf = new THREE.Mesh(new THREE.ConeGeometry(.45, 3.2, 4, 1, true), leafMat);
      lf.position.y = 5; lf.rotation.set(Math.PI / 2.6, (i / 7) * Math.PI * 2, 0); lf.translateY(1.3); lf.castShadow = true; g.add(lf);
    }
    scene.add(g);
  };
  for (let i = 0; i < 14; i++) palm(-70 + i * 4.6, 52 + Math.sin(i) * 1.2, .9 + Math.random() * .3);
  for (let i = 0; i < 10; i++) palm(60 + Math.sin(i) * 1.5, -48 + i * 4.8, .9 + Math.random() * .3);
  for (let i = 0; i < 9; i++) palm(-66 + Math.cos(i) * 1.5, -50 + i * 4.4, .8 + Math.random() * .3);

  // الطريق ومسارات السيارات
  const path = new THREE.CatmullRomCurve3([[-80, 0, 0], [-52, 0, -42], [-6, 0, -54], [34, 0, -12], [62, 0, 34], [22, 0, 50], [-24, 0, 48], [-62, 0, 26]].map(([x, y, z]) => new THREE.Vector3(x, y, z)), true, 'catmullrom', .4);
  const road = new THREE.Mesh(new THREE.TubeGeometry(path, 300, 1.6, 4, true), new THREE.MeshStandardMaterial({ color: '#3b3229', roughness: 1 }));
  road.scale.y = .05; road.position.y = .05; road.receiveShadow = true; scene.add(road);
  const COLORS = ['#f4f4f0', '#1B5E3B', '#d9b26a', '#e8e8e8', '#2a78d6'];
  const trucks = [];
  const truck = (color, offset) => {
    const g = new THREE.Group();
    const body = new THREE.MeshStandardMaterial({ color, metalness: .55, roughness: .35 });
    const cab = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.3, 1.8), body); cab.position.set(.9, 1.15, 0); cab.castShadow = true; g.add(cab);
    const bed = new THREE.Mesh(new THREE.BoxGeometry(2.4, .7, 1.8), body); bed.position.set(-1.25, .85, 0); bed.castShadow = true; g.add(bed);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(.05, .55, 1.5), new THREE.MeshStandardMaterial({ color: '#0e1e1a', metalness: .9, roughness: .1 })); glass.position.set(1.86, 1.4, 0); g.add(glass);
    const wm = new THREE.MeshStandardMaterial({ color: '#111', roughness: .9 });
    for (const [x, z] of [[1.2, .9], [1.2, -.9], [-1.4, .9], [-1.4, -.9]]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(.42, .42, .3, 12), wm); w.rotation.x = Math.PI / 2; w.position.set(x, .42, z); g.add(w); }
    const lm = new THREE.MeshBasicMaterial({ color: '#fff6d6' });
    for (const z of [.6, -.6]) { const l = new THREE.Mesh(new THREE.SphereGeometry(.14, 8, 8), lm); l.position.set(1.88, .95, z); g.add(l); }
    const beam = new THREE.SpotLight('#ffe6b0', 30, 26, .45, .6, 1.5); beam.position.set(1.9, 1, 0); beam.target.position.set(10, 0, 0); g.add(beam, beam.target);
    const tail = new THREE.MeshBasicMaterial({ color: '#ff3b30' });
    for (const z of [.7, -.7]) { const l = new THREE.Mesh(new THREE.BoxGeometry(.06, .18, .25), tail); l.position.set(-2.46, .95, z); g.add(l); }
    scene.add(g); trucks.push({ g, t: offset, speed: .012 + Math.random() * .006 });
  };
  COLORS.forEach((c, i) => truck(c, i / COLORS.length));
  // غبار متطاير ذهبي
  const dustPos = []; for (let i = 0; i < 500; i++) dustPos.push((Math.random() - .5) * 200, Math.random() * 30, (Math.random() - .5) * 200);
  const dust = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(dustPos, 3)),
    new THREE.PointsMaterial({ color: '#f3d29a', size: .35, transparent: true, opacity: .55, depthWrite: false }));
  scene.add(dust);

  // الكاميرا: لقطة نزول سينمائية ثم دوران بطيء + تتبع الإصبع/الفأرة
  let aim = { x: 0, y: 0 }, cur = { x: 0, y: 0 }, drag = null, spin = 0;
  const onMove = (e) => { const p = e.touches ? e.touches[0] : e; aim.x = (p.clientX / innerWidth - .5) * 2; aim.y = (p.clientY / innerHeight - .5) * 2; if (drag !== null) { spin += (p.clientX - drag) * .004; drag = p.clientX; } };
  const onDown = (e) => { const p = e.touches ? e.touches[0] : e; drag = p.clientX; };
  const onUp = () => { drag = null; };
  addEventListener('pointermove', onMove, { passive: true }); canvas.addEventListener('pointerdown', onDown); addEventListener('pointerup', onUp);
  const resize = () => { const w = host.clientWidth || innerWidth, h = host.clientHeight || innerHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.fov = w < 700 ? 62 : 48; camera.updateProjectionMatrix(); };
  resize(); addEventListener('resize', resize);
  const t0 = performance.now(); const tmp = new THREE.Vector3(), tan = new THREE.Vector3();
  const ease = (x) => 1 - Math.pow(1 - Math.min(1, x), 3);
  let raf = 0;
  const frame = (now) => {
    if (!canvas.isConnected) { cleanup(); return; }
    raf = requestAnimationFrame(frame);
    if (document.hidden) return;
    const t = (now - t0) / 1000;
    const intro = ease(t / 4.2);
    cur.x += (aim.x - cur.x) * .04; cur.y += (aim.y - cur.y) * .04;
    const ang = (still ? 0.6 : 0.6 + t * .035) + spin + cur.x * .25;
    const dist = 170 - intro * 85, hgt = 140 - intro * 102 + cur.y * 8;
    camera.position.set(Math.cos(ang) * dist, hgt, Math.sin(ang) * dist);
    camera.lookAt(0, 4 - intro * 2, 0);
    for (const [arm, s] of pivots) arm.rotation.y += still ? 0 : s * .05;
    for (const tr of trucks) {
      tr.t = (tr.t + (still ? 0 : tr.speed * .016)) % 1;
      path.getPointAt(tr.t, tmp); path.getTangentAt(tr.t, tan);
      tr.g.position.set(tmp.x, 0, tmp.z); tr.g.rotation.y = Math.atan2(-tan.z, tan.x);
    }
    dust.rotation.y = t * .01; stars.rotation.y = t * .002;
    renderer.render(scene, camera);
  };
  const cleanup = () => {
    cancelAnimationFrame(raf); removeEventListener('pointermove', onMove); removeEventListener('pointerup', onUp); removeEventListener('resize', resize);
    scene.traverse((o) => { o.geometry?.dispose?.(); const m = o.material; (Array.isArray(m) ? m : m ? [m] : []).forEach((x) => x.dispose?.()); });
    renderer.dispose();
  };
  raf = requestAnimationFrame(frame);
  requestAnimationFrame(() => canvas.classList.add('on'));
}
