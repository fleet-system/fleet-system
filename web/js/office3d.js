// 1.38: المكتب الثلاثي الأبعاد لصفحة «مكتب الأسطول» (طلب المالك بعد اعتماد المعاينة):
// مكتب المدير بالأعلى وثمانية مكاتب تحته، كل موظف روبوت لامع بشكل ولون (AGENTS[].bot في office.js)، لمبة حالة، وكرات ضوء
// تطير من الموظف للمدير عند أي تنبيه أو طلب موافقة. three.js محلي (web/vendor، MIT) ويُحمَّل عند فتح الصفحة فقط.
// العرض فقط: ما يكتب أي بيانات. إن فشل WebGL ترجع الدالة null وتبقى بقية الصفحة كما هي.
const V = '../vendor/';
const SCREEN = { manager: 'farms', fleet: 'map', maintenance: 'tickets', oil: 'gauge', docs: 'docs', accidents: 'car', expenses: 'bars', reports: 'pie', purchasing: 'boxes' };
const PROP = { fleet: 'tablet', maintenance: 'wrench', oil: 'oil', docs: 'folder', accidents: 'camera', expenses: 'laptop', reports: 'holo', purchasing: 'box' };
const ST = { working: 'يشتغل', waiting: 'ينتظر موافقتك', alert: 'عنده تنبيه', idle: 'هادئ' };
const STC = { working: 0x1F9D61, waiting: 0xE29A2E, alert: 0xD24A3F, idle: 0x9AA59F };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const dotCss = (st) => `st-${st}`;

// officeAgents: ناتج buildOffice().agents. يرجع { select(id, fly), pulse(id, kind, title, body), portraits } أو null.
export async function mountOffice3D(host, officeAgents, opts = {}) {
  let THREE, OrbitControls, RoomEnvironment;
  try {
    THREE = await import(V + 'three-0.169.0.module.min.js');
    ({ OrbitControls } = await import(V + 'three-addons/OrbitControls.js'));
    ({ RoomEnvironment } = await import(V + 'three-addons/RoomEnvironment.js'));
  } catch { return null; }
  if (!host.isConnected) return null;
  const AGENTS = officeAgents.map((a) => ({ ...a, st: a.state, n: a.busy, screen: SCREEN[a.id], prop: PROP[a.id] }));
  try { return build(); } catch { host.querySelector('.o3-loading')?.remove(); host.classList.add('o3-off'); return null; }

  function build() {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    function canvasTex(w, h, draw, srgb = true) {
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      draw(c.getContext('2d'), w, h);
      const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
    }
    const woodTex = canvasTex(512, 512, (g, w, h) => {
      g.fillStyle = '#C9A57A'; g.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += 32) for (let x = (y / 32) % 2 ? -60 : 0; x < w; x += 170) {
        const l = 0.92 + Math.random() * 0.12; g.fillStyle = `rgb(${201 * l | 0},${165 * l | 0},${122 * l | 0})`; g.fillRect(x + 1, y + 1, 168, 30);
        g.strokeStyle = 'rgba(120,85,50,.12)'; for (let i = 0; i < 5; i++) { g.beginPath(); g.moveTo(x, y + 5 + i * 5); g.bezierCurveTo(x + 50, y + 3 + i * 5, x + 110, y + 9 + i * 5, x + 168, y + 6 + i * 5); g.stroke(); }
      }
    });
    woodTex.wrapS = woodTex.wrapT = THREE.RepeatWrapping;
    const rugTex = canvasTex(256, 256, (g, w, h) => {
      g.fillStyle = '#123F2D'; g.fillRect(0, 0, w, h); g.strokeStyle = '#C7A65A'; g.lineWidth = 6; g.strokeRect(14, 14, w - 28, h - 28);
      g.strokeStyle = 'rgba(199,166,90,.35)'; g.lineWidth = 2; g.strokeRect(28, 28, w - 56, h - 56);
    });
    function screenTex(kind) {
      return canvasTex(320, 200, (g, w, h) => {
        const grd = g.createLinearGradient(0, 0, 0, h); grd.addColorStop(0, '#0C2A20'); grd.addColorStop(1, '#071A13'); g.fillStyle = grd; g.fillRect(0, 0, w, h);
        g.fillStyle = 'rgba(255,255,255,.08)'; g.fillRect(0, 0, w, 18); g.fillStyle = '#3FD18F'; g.fillRect(10, 6, 40, 6);
        const green = '#43D394', gold = '#E2B85C', red = '#F06A5D', soft = 'rgba(255,255,255,.55)';
        g.lineWidth = 3;
        if (kind === 'map' || kind === 'farms') {
          g.strokeStyle = 'rgba(67,211,148,.25)'; for (let i = 0; i < 8; i++) { g.beginPath(); g.moveTo(0, 30 + i * 22); g.lineTo(w, 20 + i * 24); g.stroke(); }
          const pts = kind === 'farms' ? [[90, 70], [210, 60], [150, 140], [250, 150]] : [[60, 60], [120, 90], [200, 70], [260, 130], [90, 150], [170, 160]];
          pts.forEach(([x, y], i) => { g.fillStyle = 'rgba(67,211,148,.18)'; g.beginPath(); g.arc(x, y, kind === 'farms' ? 26 : 12, 0, 7); g.fill(); g.fillStyle = i % 3 ? green : gold; g.beginPath(); g.arc(x, y, 5, 0, 7); g.fill(); });
        } else if (kind === 'bars') {
          [60, 110, 80, 140, 100, 125, 160].forEach((v, i) => { g.fillStyle = i === 6 ? gold : green; g.fillRect(24 + i * 40, h - 20 - v * .9, 24, v * .9); });
        } else if (kind === 'pie') {
          const a = [0, 2.2, 3.9, 5.2, 6.283], c = [green, gold, '#7FB6FF', red];
          for (let i = 0; i < 4; i++) { g.fillStyle = c[i]; g.beginPath(); g.moveTo(100, 110); g.arc(100, 110, 62, a[i], a[i + 1]); g.fill(); }
          g.strokeStyle = green; g.beginPath(); [190, 210, 230, 250, 270, 290].forEach((x, i) => g.lineTo(x, 150 - [10, 40, 30, 70, 60, 95][i])); g.stroke();
        } else if (kind === 'gauge') {
          g.strokeStyle = 'rgba(255,255,255,.15)'; g.lineWidth = 14; g.beginPath(); g.arc(160, 140, 80, Math.PI, 0); g.stroke();
          g.strokeStyle = gold; g.beginPath(); g.arc(160, 140, 80, Math.PI, Math.PI * 1.78); g.stroke();
          g.strokeStyle = '#fff'; g.lineWidth = 3; g.beginPath(); g.moveTo(160, 140); g.lineTo(215, 85); g.stroke();
        } else if (kind === 'car') {
          g.strokeStyle = soft; g.lineWidth = 4; g.beginPath(); g.moveTo(60, 140); g.lineTo(80, 100); g.lineTo(200, 95); g.lineTo(250, 120); g.lineTo(260, 140); g.closePath(); g.stroke();
          g.fillStyle = red; g.beginPath(); g.arc(235, 118, 10, 0, 7); g.fill(); g.beginPath(); g.arc(95, 130, 7, 0, 7); g.fill();
        } else {
          for (let i = 0; i < 6; i++) { g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(16, 30 + i * 27, w - 32, 20);
            g.fillStyle = [green, gold, green, red, green, gold][i]; g.fillRect(w - 30, 36 + i * 27, 8, 8); g.fillStyle = soft; g.fillRect(24, 37 + i * 27, 90 + (i * 37) % 120, 6); }
        }
      });
    }

    // ===== المشهد =====
    const stage = host, hud = host.querySelector('.o3-hud');
    let renderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' }); }
    catch (e) { throw e; }
    const mobile = matchMedia('(max-width: 760px)').matches;
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, mobile ? 1.5 : 2));
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    stage.prepend(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#DCE4DF');
    scene.fog = new THREE.Fog('#DCE4DF', 70, 140);
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

    const camera = new THREE.PerspectiveCamera(30, 1, 0.5, 300);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = 0.08; controls.enablePan = false;
    controls.minPolarAngle = 0.55; controls.maxPolarAngle = 1.1; controls.minAzimuthAngle = -0.6; controls.maxAzimuthAngle = 0.6;
    controls.target.set(0, 0, -2);

    const hemi = new THREE.HemisphereLight(0xFFFFFF, 0xC9B79C, 0.9); scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xFFF2DD, 2.2);
    sun.position.set(-18, 34, 16); sun.castShadow = true;
    sun.shadow.mapSize.set(mobile ? 1024 : 2048, mobile ? 1024 : 2048);
    Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 1, far: 90 }); sun.shadow.bias = -0.0004; sun.shadow.radius = 4;
    scene.add(sun);

    const M = {
      wall: new THREE.MeshStandardMaterial({ color: 0xF4F4F1, roughness: 0.92 }),
      wallTop: new THREE.MeshStandardMaterial({ color: 0x0E4D35, roughness: 0.6 }),
      base: new THREE.MeshStandardMaterial({ color: 0x2A2F2C, roughness: 0.7 }),
      glass: new THREE.MeshPhysicalMaterial({ color: 0xDDEEE6, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.22, envMapIntensity: 1.2, side: THREE.DoubleSide, depthWrite: false }),
      frame: new THREE.MeshStandardMaterial({ color: 0x1D2622, roughness: 0.4, metalness: 0.6 }),
      wood: new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.62 }),
      walnut: new THREE.MeshStandardMaterial({ color: 0x5B3A24, roughness: 0.45 }),
      oak: new THREE.MeshStandardMaterial({ color: 0xB89064, roughness: 0.55 }),
      metal: new THREE.MeshStandardMaterial({ color: 0xB9BDB9, roughness: 0.3, metalness: 0.85 }),
      dark: new THREE.MeshStandardMaterial({ color: 0x1B1F1D, roughness: 0.5, metalness: 0.2 }),
      chair: new THREE.MeshStandardMaterial({ color: 0x26302B, roughness: 0.7 }),
      rug: new THREE.MeshStandardMaterial({ map: rugTex, roughness: 1 }),
      runner: new THREE.MeshStandardMaterial({ color: 0x14513A, roughness: 1 }),
      stone: new THREE.MeshStandardMaterial({ color: 0xE9E7E1, roughness: 0.8 }),
      pot: new THREE.MeshStandardMaterial({ color: 0xEDEBE6, roughness: 0.5 }),
      leaf: new THREE.MeshStandardMaterial({ color: 0x2F7A45, roughness: 0.7 }),
      leaf2: new THREE.MeshStandardMaterial({ color: 0x3E9255, roughness: 0.7 }),
      brass: new THREE.MeshStandardMaterial({ color: 0xC9A458, roughness: 0.3, metalness: 0.9 }),
      paper: new THREE.MeshStandardMaterial({ color: 0xFAFAF7, roughness: 0.9 }),
    };
    const box = (w, h, d, mat, x = 0, y = 0, z = 0, parent = scene, cast = true) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.castShadow = cast; m.receiveShadow = true; parent.add(m); return m; };
    const rbox = (w, h, d, r, mat) => { const s = new THREE.Shape(); const x = -w / 2, y = -d / 2;
      s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r); s.lineTo(x + w, y + d - r); s.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
      s.lineTo(x + r, y + d); s.quadraticCurveTo(x, y + d, x, y + d - r); s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
      const g = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: true, bevelSize: Math.min(r, .03), bevelThickness: Math.min(r, .03), bevelSegments: 3 }); g.rotateX(Math.PI / 2); g.translate(0, h, 0);
      const m = new THREE.Mesh(g, mat); m.castShadow = m.receiveShadow = true; return m; };

    // الأرضية العامة
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), new THREE.MeshStandardMaterial({ color: 0xD3DCD6, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.02; ground.receiveShadow = true; scene.add(ground);
    const slab = box(34, 0.4, 28.6, M.base, 0, -0.2, -2, scene, false);
    const floorMat = M.wood.clone(); floorMat.map = woodTex.clone(); floorMat.map.repeat.set(8, 7); floorMat.map.needsUpdate = true;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(33.4, 28), floorMat); floor.rotation.x = -Math.PI / 2; floor.position.set(0, 0.01, -2); floor.receiveShadow = true; scene.add(floor);
    // ممرات بسجاد أخضر
    [[-5.5, 30, 2.6], [3.5, 30, 2.6]].forEach(([z, w, d]) => { const r = box(w, 0.02, d, M.runner, 0, 0.025, z, scene, false); r.castShadow = false; });

    // ===== الشخصيات =====
    const skinCache = {};
    const mat = (color, rough = 0.75, extra = {}) => new THREE.MeshPhysicalMaterial({ color, roughness: rough, sheen: 0.4, sheenRoughness: 0.8, sheenColor: new THREE.Color(color).offsetHSL(0, 0, 0.15), ...extra });
    const skinMat = (c) => skinCache[c] ||= new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.55, clearcoat: 0.05, sheen: 0.3, sheenColor: new THREE.Color('#ffd9c0') });
    const lathe = (pts, m, seg = 28) => { const g = new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), seg); const o = new THREE.Mesh(g, m); o.castShadow = o.receiveShadow = true; return o; };
    const cap = (r, l, m) => { const o = new THREE.Mesh(new THREE.CapsuleGeometry(r, l, 6, 14), m); o.castShadow = true; return o; };
    const sph = (r, m, ws = 24, hs = 18) => { const o = new THREE.Mesh(new THREE.SphereGeometry(r, ws, hs), m); o.castShadow = true; return o; };


    // ===== موظفو الذكاء الاصطناعي: روبوتات صغيرة لامعة، لكل واحد شكل ولون =====

    function makeBot(a) {
      const B = a.bot, col = new THREE.Color(B.c);
      const root = new THREE.Group(), turn = new THREE.Group(); turn.rotation.y = Math.PI; root.add(turn);
      const head = new THREE.Group(); head.position.y = 1.05; turn.add(head);
      const m = new THREE.MeshPhysicalMaterial({ color: col, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.15, emissive: col, emissiveIntensity: 0.18, sheen: 0.3 });
      let body, fz = 0.3, ey = 0.04;
      const S = B.shape;
      if (S === 'ball') body = new THREE.Mesh(new THREE.SphereGeometry(0.32, 40, 28), m);
      else if (S === 'hex') { body = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.5, 6), m); body.rotation.y = Math.PI / 6; fz = 0.29; }
      else if (S === 'drop') { body = new THREE.Mesh(new THREE.LatheGeometry([[0, -0.3], [0.2, -0.27], [0.3, -0.12], [0.3, 0.02], [0.22, 0.18], [0.1, 0.32], [0, 0.42]].map(([x, y]) => new THREE.Vector2(x, y)), 40), m); fz = 0.29; ey = -0.02; }
      else if (S === 'cube') { body = rbox(0.56, 0.56, 0.5, 0.12, m); body.position.y = -0.28; fz = 0.27; }
      else if (S === 'tri') { body = new THREE.Mesh(new THREE.ConeGeometry(0.4, 0.62, 3), m); body.rotation.y = Math.PI; fz = 0.21; ey = -0.08; }
      else if (S === 'pill') { body = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 0.24, 10, 32), m); fz = 0.26; ey = 0.08; }
      else if (S === 'ghost') { body = new THREE.Mesh(new THREE.LatheGeometry([[0, 0.34], [0.16, 0.31], [0.27, 0.2], [0.31, 0.02], [0.31, -0.2], [0.33, -0.28], [0.27, -0.3], [0, -0.3]].map(([x, y]) => new THREE.Vector2(x, y)), 40), m); fz = 0.31; }
      else { body = new THREE.Mesh(new THREE.OctahedronGeometry(0.36, 0), m); body.scale.y = 1.2; fz = 0.22; ey = 0.0; }
      body.castShadow = true; head.add(body);
      // عيون
      const white = new THREE.MeshStandardMaterial({ color: 0xFFFFFF, roughness: 0.2, emissive: 0xFFFFFF, emissiveIntensity: 0.15 });
      const ink = new THREE.MeshStandardMaterial({ color: 0x10151A, roughness: 0.1 });
      for (const sx of [-1, 1]) {
        const e = new THREE.Mesh(new THREE.SphereGeometry(0.075, 20, 14), white); e.scale.set(0.85, 1.1, 0.55); e.position.set(sx * 0.1, ey, fz); head.add(e);
        const p = new THREE.Mesh(new THREE.SphereGeometry(0.038, 14, 10), ink); p.position.set(sx * 0.1, ey - 0.005, fz + 0.035); head.add(p);
        const hl = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), white); hl.position.set(sx * 0.1 + 0.015, ey + 0.025, fz + 0.065); head.add(hl);
      }
      const blush = new THREE.MeshBasicMaterial({ color: 0xFF8FA3, transparent: true, opacity: 0.45 });
      for (const sx of [-1, 1]) { const b = new THREE.Mesh(new THREE.CircleGeometry(0.035, 16), blush); b.position.set(sx * 0.19, ey - 0.08, fz - 0.02); b.lookAt(sx * 0.6, ey - 0.08, fz + 1); if (S !== 'tri' && S !== 'gem') head.add(b); }
      // هوائي بضوء (حالة الموظف)
      const tipM = new THREE.MeshStandardMaterial({ color: STC[a.st], emissive: STC[a.st], emissiveIntensity: 2 });
      const topY = { ball: 0.32, hex: 0.25, drop: 0.42, cube: 0.3, tri: 0.31, pill: 0.38, ghost: 0.34, gem: 0.43 }[S];
      if (B.crown) { const gm = new THREE.MeshPhysicalMaterial({ color: 0xF5D27A, metalness: 0.9, roughness: 0.2, emissive: 0x6B4A10, emissiveIntensity: 0.3 });
        const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.19, 0.08, 24, 1, true), gm); ring.position.y = topY - 0.01; head.add(ring);
        for (let i = 0; i < 5; i++) { const an = i / 5 * Math.PI * 2; const sp = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.1, 10), gm); sp.position.set(Math.sin(an) * 0.17, topY + 0.08, Math.cos(an) * 0.17); head.add(sp);
          const gem = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6), new THREE.MeshStandardMaterial({ color: 0x3FD38E, emissive: 0x3FD38E, emissiveIntensity: 1.5 })); gem.position.set(Math.sin(an) * 0.19, topY, Math.cos(an) * 0.19); head.add(gem); } }
      const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.16, 8), new THREE.MeshStandardMaterial({ color: 0x2A2F2C, metalness: 0.6, roughness: 0.3 })); stick.position.y = topY + 0.08; head.add(stick);
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.045, 16, 12), tipM); tip.position.y = topY + 0.18; head.add(tip);
      if (B.crown) { stick.visible = false; tip.position.y = topY + 0.07; tip.scale.setScalar(0.8); }
      if (B.phones) { const pm = new THREE.MeshStandardMaterial({ color: 0x1B1F24, roughness: 0.4 }); const band = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.025, 10, 40, Math.PI), pm); band.position.y = 0.02; head.add(band);
        for (const sx of [-1, 1]) { const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.07, 20), pm); cup.rotation.z = Math.PI / 2; cup.position.set(sx * 0.33, 0.0, 0); head.add(cup); } }
      // ظل متوهج تحته
      const glow = new THREE.Mesh(new THREE.CircleGeometry(0.34, 32), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.22, depthWrite: false })); glow.rotation.x = -Math.PI / 2; glow.position.y = 0.43; turn.add(glow);
      root.userData = { arms: [], head, torso: body, badge: tip, bot: true, baseY: 1.05 };
      return root;
    }
    function propFor(kind) {
      const p = new THREE.Group();
      if (kind === 'tablet') { const t = rbox(0.34, 0.025, 0.24, 0.02, M.dark); p.add(t); const s = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.2), new THREE.MeshStandardMaterial({ map: screenTex('map'), emissive: 0xffffff, emissiveMap: screenTex('map'), emissiveIntensity: 0.6 })); s.rotation.x = -Math.PI / 2; s.position.y = 0.03; p.add(s); p.rotation.x = 0.5; }
      if (kind === 'wrench') { const h = box(0.04, 0.04, 0.4, M.metal, 0, 0, 0, p); const hd = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.018, 8, 16, Math.PI * 1.5), M.metal); hd.position.z = 0.22; hd.rotation.x = Math.PI / 2; p.add(hd); }
      if (kind === 'oil') { const b = lathe([[0, 0], [0.08, 0], [0.085, 0.2], [0.04, 0.26], [0.03, 0.3], [0, 0.3]], new THREE.MeshPhysicalMaterial({ color: 0xD9A73A, roughness: 0.25, clearcoat: 0.8 })); p.add(b);
        const lab = new THREE.Mesh(new THREE.CylinderGeometry(0.087, 0.087, 0.09, 20, 1, true), mat(0x0E4D35, 0.5)); lab.position.y = 0.1; p.add(lab); }
      if (kind === 'folder') { const f = rbox(0.3, 0.03, 0.22, 0.01, mat(0x0E4D35, 0.6)); p.add(f); const pp = box(0.27, 0.01, 0.2, M.paper, 0, 0.035, 0, p); }
      if (kind === 'camera') { const c = rbox(0.18, 0.11, 0.1, 0.02, M.dark); p.add(c); const l = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.045, 0.08, 20), M.metal); l.rotation.x = Math.PI / 2; l.position.set(0, 0.055, 0.08); p.add(l);
        const cb = rbox(0.24, 0.02, 0.32, 0.02, mat(0x8B6B45, 0.6)); cb.position.set(0.3, 0, 0); p.add(cb); box(0.2, 0.01, 0.26, M.paper, 0.3, 0.025, 0, p); }
      if (kind === 'laptop') { const base = rbox(0.4, 0.02, 0.27, 0.015, M.metal); p.add(base); const lid = new THREE.Group(); lid.position.set(0, 0.02, -0.13); lid.rotation.x = -1.85; p.add(lid);
        const l = rbox(0.4, 0.015, 0.27, 0.015, M.metal); l.position.z = 0.135; lid.add(l); const sc = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.23), new THREE.MeshStandardMaterial({ emissive: 0xffffff, emissiveMap: screenTex('bars'), map: screenTex('bars'), emissiveIntensity: 0.7 })); sc.rotation.x = Math.PI / 2; sc.position.set(0, -0.001, 0.135); sc.scale.y = -1; lid.add(sc); }
      if (kind === 'holo') { const hm = new THREE.MeshStandardMaterial({ color: 0x6FF3B8, emissive: 0x2BD982, emissiveIntensity: 1.6, transparent: true, opacity: 0.75 });
        [0.12, 0.2, 0.16, 0.28].forEach((h, i) => { const b = box(0.05, h, 0.05, hm, -0.1 + i * 0.07, h / 2, 0, p, false); b.userData.h = h; });
        const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.01, 32), new THREE.MeshStandardMaterial({ color: 0x0E4D35, emissive: 0x1BAA6A, emissiveIntensity: 0.8 })); p.add(disc); p.userData.holo = true; }
      if (kind === 'box') { const b = box(0.36, 0.26, 0.3, mat(0xB98E5E, 0.85), 0, 0.13, 0, p); box(0.36, 0.02, 0.06, mat(0xD9C79E, 0.6), 0, 0.27, 0, p); box(0.16, 0.005, 0.22, M.paper, 0.05, 0.275, 0.02, p); }
      return p;
    }

    // ===== المكاتب =====
    const offices = [];
    const DESK_Y = 0.74;
    function deskSet(parent, x, z, w = 2.2, dir = 1, walnut = false) {
      const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = dir > 0 ? 0 : Math.PI; parent.add(g);
      const top = rbox(w, 0.06, 1.0, 0.05, walnut ? M.walnut : M.oak); top.position.y = DESK_Y - 0.06; g.add(top);
      for (const sx of [-1, 1]) box(0.06, DESK_Y - 0.06, 0.9, M.frame, sx * (w / 2 - 0.12), (DESK_Y - 0.06) / 2, 0, g);
      if (walnut) box(w - 0.3, 0.55, 0.05, M.walnut, 0, 0.36, -0.42, g);
      return g;
    }
    function monitor(parent, x, z, kind, scale = 1, ry = 0) {
      const g = new THREE.Group(); g.position.set(x, DESK_Y, z); g.rotation.y = ry; g.scale.setScalar(scale); parent.add(g);
      box(0.24, 0.015, 0.16, M.metal, 0, 0.008, 0, g); box(0.04, 0.3, 0.04, M.metal, 0, 0.16, -0.03, g);
      const fr = rbox(0.78, 0.47, 0.035, 0.02, M.dark); fr.rotation.x = Math.PI / 2; fr.position.set(0, 0.29, -0.06); fr.position.y = 0.3 + 0.235; fr.position.y = 0.3; g.add(fr);
      fr.geometry.translate(0, 0, 0);
      const t = screenTex(kind);
      const sc = new THREE.Mesh(new THREE.PlaneGeometry(0.73, 0.42), new THREE.MeshStandardMaterial({ map: t, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.85, roughness: 0.3 }));
      sc.position.set(0, 0.3 + 0.235, -0.06 + 0.04); g.add(sc);
      fr.position.set(0, 0.3 + 0.235, -0.06 + 0.0); fr.rotation.set(0, 0, 0); fr.geometry = new THREE.BoxGeometry(0.78, 0.47, 0.035);
      return g;
    }
    function chair(parent, x, z, ry = 0) {
      const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry; parent.add(g);
      const seat = rbox(0.56, 0.1, 0.54, 0.05, M.chair); seat.position.y = 0.38; g.add(seat);
      const back = rbox(0.54, 0.62, 0.08, 0.05, M.chair); back.position.set(0, 0.5, -0.3); g.add(back);
      box(0.06, 0.32, 0.06, M.metal, 0, 0.2, 0, g); const b = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.04, 5), M.metal); b.position.y = 0.04; g.add(b);
      return g;
    }
    function plant(parent, x, z, s = 1) {
      const g = new THREE.Group(); g.position.set(x, 0, z); g.scale.setScalar(s); parent.add(g);
      const p = lathe([[0, 0], [0.2, 0], [0.24, 0.42], [0.22, 0.44], [0, 0.44]], M.pot); g.add(p);
      for (let i = 0; i < 9; i++) { const l = new THREE.Mesh(new THREE.IcosahedronGeometry(0.16 + Math.random() * 0.08, 1), i % 2 ? M.leaf : M.leaf2);
        const a = i * 0.7; l.position.set(Math.cos(a) * 0.14, 0.62 + (i % 3) * 0.16, Math.sin(a) * 0.14); l.scale.set(1, 1.25, 1); l.castShadow = true; g.add(l); }
      return g;
    }
    function shelf(parent, x, z, kind, w = 1.6) {
      const g = new THREE.Group(); g.position.set(x, 0, z); parent.add(g);
      for (const y of [0.9, 1.45, 2.0]) box(w, 0.04, 0.32, M.oak, 0, y, 0, g);
      box(0.04, 2.1, 0.32, M.oak, -w / 2, 1.05, 0, g); box(0.04, 2.1, 0.32, M.oak, w / 2, 1.05, 0, g);
      const cols = { docs: [0x0E4D35, 0xEDEBE6, 0x1F7A55, 0xC9A458], tools: [0xB9BDB9, 0x2A2F2C, 0xC9A458], oil: [0xD9A73A, 0x0E4D35, 0x2A2F2C], parts: [0xB98E5E, 0xD9C79E], car: [0xE07A32, 0xF2F2EE], data: [0x0E4D35, 0x7FB6FF, 0xC9A458], map: [0x1F7A55, 0xEDEBE6] }[kind] || [0x0E4D35, 0xEDEBE6];
      [0.92, 1.47].forEach((y, r) => { let cx = -w / 2 + 0.12; while (cx < w / 2 - 0.15) {
        if (kind === 'oil' || kind === 'parts') { const s = kind === 'oil' ? 0.18 : 0.26; const o = kind === 'oil' ? new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, s, 14), new THREE.MeshStandardMaterial({ color: cols[(cx * 7 | 0) % cols.length & 0 | Math.abs(cx * 3 | 0) % cols.length], roughness: 0.35 })) : new THREE.Mesh(new THREE.BoxGeometry(s, s * 0.8, 0.26), new THREE.MeshStandardMaterial({ color: cols[Math.abs(cx * 5 | 0) % cols.length], roughness: 0.9 }));
          o.position.set(cx + s / 2, y + 0.02 + s * 0.45, 0); o.castShadow = true; g.add(o); cx += s + 0.08; }
        else { const bw = 0.05 + Math.random() * 0.04, bh = 0.26 + Math.random() * 0.14; const b = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, 0.24), new THREE.MeshStandardMaterial({ color: cols[Math.floor(Math.random() * cols.length)], roughness: 0.8 }));
          b.position.set(cx, y + 0.02 + bh / 2, 0); b.rotation.z = Math.random() < 0.12 ? 0.25 : 0; b.castShadow = true; g.add(b); cx += bw + 0.012; } } });
      return g;
    }
    function wallScreen(parent, x, y, z, w, h, kind) {
      const t = screenTex(kind); box(w + 0.08, h + 0.08, 0.06, M.dark, x, y, z, parent);
      const s = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: t, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.9 })); s.position.set(x, y, z + 0.035); parent.add(s); return s;
    }
    function statusLamp(parent, x, y, z, st) {
      const m = new THREE.MeshStandardMaterial({ color: STC[st], emissive: STC[st], emissiveIntensity: 1.6, roughness: 0.3 });
      const o = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.28, 6, 12), m); o.rotation.z = Math.PI / 2; o.position.set(x, y, z); parent.add(o);
      const l = new THREE.PointLight(STC[st], 0.6, 3, 2); l.position.set(x, y - 0.2, z + 0.2); parent.add(l);
      return { mesh: o, mat: m, light: l };
    }

    // المكتب الرئيسي (المدير)
    const WALL_H = 2.7;
    function buildOffice(o) {
      const { x, z, w, d, back, a } = o; // back = -1 (الجدار الخلفي في -z) — المشهد يُرى من +z
      const g = new THREE.Group(); scene.add(g); o.group = g;
      const bz = z - d / 2; // الجدار الخلفي
      box(w, WALL_H, 0.16, M.wall, x, WALL_H / 2, bz, g); box(w, 0.08, 0.2, M.wallTop, x, WALL_H + 0.04, bz, g);
      box(w, 0.12, 0.02, M.base, x, 0.06, bz + 0.09, g, false);
      // جداران جانبيان زجاج بإطار
      for (const sx of [-1, 1]) {
        const wx = x + sx * (w / 2);
        const gl = new THREE.Mesh(new THREE.BoxGeometry(0.04, 2.3, d - 0.1), M.glass); gl.position.set(wx, 1.15, z); g.add(gl);
        box(0.08, 0.06, d, M.frame, wx, 2.33, z, g, false); box(0.08, 0.1, d, M.frame, wx, 0.05, z, g, false);
        box(0.08, 2.36, 0.08, M.frame, wx, 1.18, z + d / 2 - 0.04, g);
      }
      // جدار أمامي منخفض زجاجي بفتحة باب (بدون ما يحجب الرؤية)
      const fz = z + d / 2;
      for (const sx of [-1, 1]) { const len = w / 2 - 0.7; const gl = new THREE.Mesh(new THREE.BoxGeometry(len, 1.0, 0.04), M.glass); gl.position.set(x + sx * (0.7 + len / 2), 0.5, fz); g.add(gl);
        box(len, 0.05, 0.08, M.frame, x + sx * (0.7 + len / 2), 1.02, fz, g, false); }
      // سجادة
      const rug = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.62, d * 0.55), M.rug); rug.rotation.x = -Math.PI / 2; rug.position.set(x, 0.03, z + 0.2); rug.receiveShadow = true; g.add(rug);
      // أرضية تفاعلية (للضغط)
      const hit = new THREE.Mesh(new THREE.BoxGeometry(w, 0.05, d), new THREE.MeshBasicMaterial({ visible: false })); hit.position.set(x, 0.04, z); hit.userData.agent = a.id; g.add(hit); o.hit = hit;
      // ضوء دافئ داخلي
      const pl = new THREE.PointLight(0xFFE2B8, a.id === 'manager' ? 6 : 3.2, a.id === 'manager' ? 12 : 7, 2); pl.position.set(x, 2.4, z); g.add(pl); o.light = pl;
      const pend = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 0.14, 24, 1, true), M.brass); pend.position.set(x, 2.45, z); g.add(pend);
      return g;
    }

    const ROWS = [
      { z: -1, ids: ['fleet', 'maintenance', 'oil', 'docs'] },
      { z: 8, ids: ['accidents', 'expenses', 'reports', 'purchasing'] },
    ];
    const PROPS_WALL = { fleet: 'map', maintenance: 'tools', oil: 'oil', docs: 'docs', accidents: 'car', expenses: 'data', reports: 'data', purchasing: 'parts' };
    const W = 8, D = 6;
    const charByAgent = {};

    // مكتب المدير
    {
      const a = AGENTS.find((x) => x.id === 'manager'); const o = { x: 0, z: -11, w: 22, d: 8, a }; buildOffice(o); offices.push(o);
      const g = o.group;
      wallScreen(g, 0, 1.6, -14.88 + 0.1, 5.2, 2.0, 'farms');
      wallScreen(g, -5.2, 1.6, -14.88 + 0.1, 2.2, 1.3, 'bars'); wallScreen(g, 5.2, 1.6, -14.88 + 0.1, 2.2, 1.3, 'docs');
      const desk = deskSet(g, 0, -10.6, 3.2, 1, true);
      monitor(g, -0.55, -10.95, 'farms', 1.05, 0.12); monitor(g, 0.55, -10.95, 'tickets', 1.05, -0.12);
      chair(g, 0, -9.8, Math.PI); const c = makeBot(a); c.position.set(0, 0.0, -9.75); c.rotation.y = Math.PI; g.add(c); charByAgent[a.id] = c; c.userData.agent = a.id;
      // جلسة اجتماعات وكنب
      const sofa = rbox(2.6, 0.45, 0.9, 0.12, mat(0x2C3A33, 0.8)); sofa.position.set(-7.6, 0, -12.6); g.add(sofa);
      const sofaB = rbox(2.6, 0.5, 0.25, 0.1, mat(0x2C3A33, 0.8)); sofaB.position.set(-7.6, 0.4, -13.0); g.add(sofaB);
      const ct = rbox(1.2, 0.36, 0.7, 0.2, M.walnut); ct.position.set(-7.6, 0, -11.3); g.add(ct);
      const mt = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 0.06, 40), M.stone); mt.position.set(7.4, 0.74, -11.4); mt.castShadow = mt.receiveShadow = true; g.add(mt);
      const ml = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.3, 0.72, 20), M.metal); ml.position.set(7.4, 0.36, -11.4); g.add(ml);
      for (let i = 0; i < 4; i++) { const ang = i * Math.PI / 2 + 0.4; chair(g, 7.4 + Math.cos(ang) * 1.45, -11.4 + Math.sin(ang) * 1.45, -ang + Math.PI / 2); }
      plant(g, -10.2, -14.2, 1.4); plant(g, 10.2, -14.2, 1.4); plant(g, -3.2, -14.2, 1);
      // درج طلبات الموافقة (صينية)
      const tray = rbox(0.4, 0.05, 0.3, 0.02, M.brass); tray.position.set(1.2, DESK_Y, -10.5); g.add(tray);
      o.lamp = statusLamp(g, 0, 2.55, -7.05, 'working'); o.chipAt = new THREE.Vector3(0, 3.3, -11);
      o.door = new THREE.Vector3(0, 1.6, -9.5);
    }
    // مكاتب الموظفين
    ROWS.forEach((row, ri) => row.ids.forEach((id, i) => {
      const a = AGENTS.find((x) => x.id === id); const x = (i - 1.5) * W; const z = row.z;
      const o = { x, z, w: W, d: D, a }; buildOffice(o); offices.push(o); const g = o.group;
      shelf(g, x + (i % 2 ? -2.6 : 2.6), z - D / 2 + 0.3, PROPS_WALL[id]);
      wallScreen(g, x + (i % 2 ? 1.2 : -1.2), 1.55, z - D / 2 + 0.1, 2.0, 1.15, a.screen);
      deskSet(g, x, z - 0.7, 2.2, 1);
      monitor(g, x - 0.3, z - 1.0, a.screen, 0.95, 0.08);
      chair(g, x, z + 0.05, Math.PI);
      const c = makeBot(a); c.position.set(x, 0, z + 0.1); c.rotation.y = Math.PI; g.add(c); charByAgent[id] = c; c.userData.agent = id;
      const pr = propFor(a.prop); g.add(pr);
      if (a.prop === 'holo') { pr.position.set(x + 0.7, DESK_Y, z - 0.65); }
      else if (a.prop === 'laptop') { pr.position.set(x + 0.45, DESK_Y, z - 0.55); pr.rotation.y = Math.PI + 0.3; }
      else if (a.prop === 'box') { pr.position.set(x + 1.6, 0, z + 1.3); pr.scale.setScalar(1.8); }
      else { pr.position.set(x + 0.7, DESK_Y + 0.02, z - 0.6); pr.rotation.y = 0.4; }
      if (a.prop === 'oil') { for (let k = 0; k < 3; k++) { const dr = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.88, 24), new THREE.MeshStandardMaterial({ color: k === 1 ? 0x0E4D35 : 0x2A2F2C, roughness: 0.4, metalness: 0.5 })); dr.position.set(x - 3.1 + k * 0.68, 0.44, z + 1.9); dr.castShadow = true; g.add(dr); } }
      if (a.prop === 'camera') { for (let k = 0; k < 2; k++) { const cn = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.5, 20), new THREE.MeshStandardMaterial({ color: 0xE76F2B, roughness: 0.5 })); cn.position.set(x - 3.2 + k * 0.45, 0.25, z + 2.1); cn.castShadow = true; g.add(cn); } }
      if (a.prop === 'wrench') { const board = box(1.8, 1.0, 0.04, new THREE.MeshStandardMaterial({ color: 0x2E3833, roughness: 0.8 }), x - 1.6, 1.5, z - D / 2 + 0.12, g);
        for (let k = 0; k < 6; k++) box(0.05, 0.4 + (k % 3) * 0.12, 0.04, M.metal, x - 2.3 + k * 0.28, 1.5, z - D / 2 + 0.16, g); }
      plant(g, x + (i % 2 ? 3.3 : -3.3), z + 2.2, 0.9);
      o.lamp = statusLamp(g, x, 2.55, z + D / 2 - 0.05, a.st);
      o.chipAt = new THREE.Vector3(x, 3.0, z);
      o.door = new THREE.Vector3(x, 1.4, z + 0.3);
    }));
    // ديكور الممرات
    [-15, 15].forEach((x) => { plant(scene, x, -5.5, 1.3); plant(scene, x, 3.5, 1.3); });
    const bench = rbox(2.4, 0.42, 0.6, 0.1, M.oak); bench.position.set(0, 0, 3.5); scene.add(bench);

    host.querySelector('.o3-loading')?.remove();

    // ===== الحركة =====
    const orbs = [];
    const orbMat = new THREE.MeshStandardMaterial({ color: 0x8BFFC9, emissive: 0x2BD982, emissiveIntensity: 3 });
    function sendOrb(from, to, color = 0x2BD982) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 12), orbMat.clone()); m.material.emissive.setHex(color);
      const l = new THREE.PointLight(color, 1.5, 3, 2); m.add(l); scene.add(m);
      const mid = from.clone().lerp(to, 0.5); mid.y = 6;
      orbs.push({ m, curve: new THREE.QuadraticBezierCurve3(from.clone(), mid, to.clone()), t: 0 });
    }
    const toastEl = host.querySelector('.o3-toast'); let toastT;
    function toast(title, body) { toastEl.innerHTML = `<b>${esc(title)}</b>${esc(body)}`; toastEl.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove('show'), 3600); }
    // ===== الواجهة فوق المشهد =====
    const chips = offices.map((o) => {
      const a = o.a; const el = document.createElement('button'); el.type = 'button'; el.className = 'o3-chip' + (a.id === 'manager' ? ' mgr' : ''); el.dataset.chip = a.id;
      el.innerHTML = `<span class="dot ${dotCss(a.st)}"></span><span>${esc(a.name)}</span><span class="role" style="opacity:.7;font-weight:500">· ${esc(a.role)}</span>${a.n ? `<span class="n">${a.n}</span>` : ''}`;
      el.setAttribute('aria-label', `${a.name}، ${a.role}، ${ST[a.st]}`); el.addEventListener('click', () => select(a.id, true)); hud.appendChild(el); return { el, o };
    });

    // اختيار موظف
    const camGoal = { pos: null, target: null };
    let selected = null;
    function select(id, fly) {
      selected = id; const o = offices.find((x) => x.a.id === id);
      chips.forEach((c) => c.el.classList.toggle('sel', c.o === o));
      offices.forEach((x) => { x.light.intensity = x === o ? (x.a.id === 'manager' ? 9 : 6) : (x.a.id === 'manager' ? 6 : 3.2); });
      if (fly) { camGoal.target = new THREE.Vector3(o.x, 0.8, o.z); const off = camera.position.clone().sub(controls.target).setLength(id === 'manager' ? 24 : 15); camGoal.pos = camGoal.target.clone().add(off); }
      opts.onSelect?.(id);
    }
    const ray = new THREE.Raycaster(), ptr = new THREE.Vector2(); let downAt = null;
    renderer.domElement.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
    renderer.domElement.addEventListener('pointerup', (e) => {
      if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 6) return;
      const r = renderer.domElement.getBoundingClientRect(); ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ptr, camera); const hit = ray.intersectObjects(offices.map((o) => o.hit))[0]; if (hit) select(hit.object.userData.agent, true);
    });

    function resize() {
      const w = stage.clientWidth, h = stage.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / h;
      camera.fov = w / h < 1 ? 46 : 30; camera.updateProjectionMatrix();
      const dist = w / h < 1 ? 62 : 60; const dir = new THREE.Vector3(w / h < 1 ? 0.18 : 0.35, 0.95, 0.82).normalize();
      camera.position.copy(controls.target).add(dir.multiplyScalar(dist)); controls.minDistance = 10; controls.maxDistance = dist * 1.25;
    }
    new ResizeObserver(resize).observe(stage); resize();

    const clock = new THREE.Clock(); const v = new THREE.Vector3();
    let visible = true; new IntersectionObserver(([en]) => { visible = en.isIntersecting; }).observe(stage);
    function loop() {
      if (!host.isConnected) { renderer.dispose(); renderer.forceContextLoss?.(); return; }
      requestAnimationFrame(loop); if (!visible || document.hidden) return;
      const t = clock.getElapsedTime(), dt = Math.min(clock.getDelta(), 0.05);
      if (camGoal.pos) { camera.position.lerp(camGoal.pos, 0.06); controls.target.lerp(camGoal.target, 0.06); if (camera.position.distanceTo(camGoal.pos) < 0.05) camGoal.pos = null; }
      controls.update();
      if (!reduce) for (const id in charByAgent) {
        const c = charByAgent[id], a = AGENTS.find((x) => x.id === id), k = id.length * 1.7;
        const busy = a.st !== 'idle';
        c.userData.arms.forEach(({ el, s }, j) => { el.rotation.x = -1.15 + (busy ? Math.sin(t * 9 + j * 1.8 + k) * 0.09 : 0); });
        c.userData.head.rotation.y = Math.sin(t * 0.6 + k) * (busy ? 0.18 : 0.35); c.userData.head.rotation.x = busy ? 0.12 + Math.sin(t * 1.3 + k) * 0.03 : -0.05;
        c.userData.torso.scale.y = 1 + Math.sin(t * 1.6 + k) * 0.012;
        if (c.userData.bot) { c.userData.head.position.y = c.userData.baseY + Math.sin(t * 2.2 + k) * 0.05; c.userData.head.rotation.x = 0; }
        if (c.userData.badge) c.userData.badge.material.emissiveIntensity = 1.6 + Math.sin(t * 3 + k) * 0.8;
      }
      offices.forEach((o) => { if (o.a.st === 'waiting' || o.a.st === 'alert') { const p = (Math.sin(t * 4) + 1) / 2; o.lamp.mat.emissiveIntensity = 0.8 + p * 2; o.lamp.light.intensity = 0.3 + p * 1.2; } });
      scene.traverse((ob) => { if (ob.userData.holo) ob.children.forEach((b, i) => { if (b.userData.h) { b.scale.y = 0.7 + (Math.sin(t * 2 + i) + 1) * 0.3; b.position.y = b.userData.h * b.scale.y / 2; } }); });
      for (let i = orbs.length - 1; i >= 0; i--) { const ob = orbs[i]; ob.t += 0.012; ob.m.position.copy(ob.curve.getPoint(Math.min(ob.t, 1))); if (ob.t >= 1) { scene.remove(ob.m); orbs.splice(i, 1); } }
      renderer.render(scene, camera);
      const r = renderer.domElement.getBoundingClientRect();
      chips.forEach(({ el, o }) => { v.copy(o.chipAt).project(camera); el.style.left = `${(v.x + 1) / 2 * r.width}px`; el.style.top = `${(1 - v.y) / 2 * r.height}px`; el.style.display = v.z < 1 ? '' : 'none'; });
    }
    loop();

    // ===== صور الشخصيات للبطاقات (من نفس النماذج ثلاثية الأبعاد) =====
    const portraits = {};
    try {
      const pr = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true }); pr.setSize(320, 320); pr.setPixelRatio(1);
      pr.toneMapping = THREE.ACESFilmicToneMapping; pr.outputColorSpace = THREE.SRGBColorSpace;
      const ps = new THREE.Scene(); ps.environment = scene.environment;
      ps.add(new THREE.HemisphereLight(0xffffff, 0xBFAF95, 1.1)); const key = new THREE.DirectionalLight(0xFFF1DE, 2.4); key.position.set(-2, 3, 3); ps.add(key);
      const rim = new THREE.DirectionalLight(0x9CFFD0, 1.4); rim.position.set(2.5, 2, -2.5); ps.add(rim);
      const pc = new THREE.PerspectiveCamera(24, 1, 0.1, 20); pc.position.set(0.4, 1.5, 3.3); pc.lookAt(0, 1.2, 0);
      for (const a of AGENTS) {
        const c = makeBot(a); c.userData.arms.forEach(({ el, sh }) => { sh.rotation.x = -0.15; el.rotation.x = -0.9; }); c.userData.head.rotation.set(0.04, -0.25, 0);
        if (true) { c.rotation.y = Math.PI; pc.position.set(0.3, 1.32, 3.0); pc.lookAt(0, 1.16, 0); } else { pc.position.set(0.4, 1.5, 3.3); pc.lookAt(0, 1.2, 0); }
        ps.add(c); pr.render(ps, pc); portraits[a.id] = pr.domElement.toDataURL('image/png'); ps.remove(c);
      }
      pr.dispose();
    } catch { /* بدون صور، البطاقات تعرض بديل */ }

  return {
    portraits,
    select: (id, fly) => select(id, fly),
    // كرة ضوء من مكتب الموظف للمدير + إشعار صغير فوق المشهد
    pulse(id, kind, title, text) {
      const o = offices.find((x) => x.a.id === id), m = offices.find((x) => x.a.id === 'manager');
      if (!o || !m || o === m || reduce) return;
      sendOrb(o.door, m.door, kind === 'ask' ? 0xE29A2E : kind === 'bad' ? 0xD24A3F : 0x2BD982);
      if (title) setTimeout(() => host.isConnected && toast(title, text || ''), 1500);
    },
  };
  }
}
