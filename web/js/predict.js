// 1.36: «الصيانة التنبؤية» (طلب المالك): توقعات بدون حساسات، من البيانات الموجودة فقط:
// سجلات تغيير الزيت (oil_changes + أوراق غيار_الزيت في cost_lines مع «الممشى N» في الملاحظات)، قراءات العداد،
// والكفرات والبطاريات والصيانة من ملف Excel (cost_lines). لا كتابة في قاعدة البيانات؛ كل شيء يُحسب في المتصفح.
// منطق خالص بدون DOM حتى يُختبر في node (tests/unit_js.mjs).

export const RULES = {
  oilKm: 10000,        // مسافة الغيار إن لم تُحدَّد للسيارة (vehicles.oil_interval_km)
  tireKm: 50000,       // العمر التقريبي للكفر بالكيلو
  tireDays: 730,       // أو سنتان، أيهما أقرب
  batteryDays: 540,    // البطارية في الحر: سنة ونصف تقريباً
  soonDays: 14, soonKm: 1000, tireSoonDays: 30,
  episodeGap: 45,      // شراء القطع ثم التركيب لنفس العطل قد يفصلهما أسابيع: ما بينه 45 يوماً أو أقل = مرة واحدة
  recurringDays: 180, recurringMin: 2,
  punctureDays: 90, punctureMin: 3,
  costWindow: 90, costRise: 1.5, costRiseMin: 1000, costHighMin: 2000,
};

// مجموعات الأعطال (بعد توحيد الحروف). الترتيب مهم: أول مجموعة تطابق تكفي لكل مجموعة على حدة (السطر قد يطابق أكثر من مجموعة).
export const FAULTS = [
  ['clutch', 'الكلتش', /كلتش|كلج|حداف/],
  ['ac', 'المكيف', /مكيف|فريون|كمبروسر|كمبريسر/],
  ['gear', 'القير', /قير|جير|رمان قير/],
  ['brakes', 'الفرامل', /فرامل|هوبات|فحمات/, /كلتش/],  // سطر فيه كلتش بدون كلمة فرامل = كلتش
  ['fuel', 'البخاخات والديزل', /بخاخ|فلتر ديزل|فلتر وقود|fuel filter|nozzle|طرمبه ديزل/],
  ['electric', 'الكهرباء', /ظفيره|كهرباء|دينمو|سلف|لمبه مكينه/],
  ['steering', 'الدركسون والميزان', /دركسون|ميزان|جوزه|دوده|مقص|ستب|سسه/],
  ['cooling', 'التبريد (الرديتر)', /رديتر|راديتر|حراره|ماء الرديتر|ثرموستات/],
  ['belts', 'السيور', /سير /],
  ['suspension', 'المساعدات والسستة', /مساعد|ساسته|سستة|اسطب|جلده ساسته/],
];
const ACCIDENT = /حادث|سمكره|صدام|بوية|بويه|رفرف|زجاج|باب سواق|قايم/;

export const norm = (s) => String(s || '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/[ًٌٍَُِّْ]/g, '').toLowerCase();
const day = (iso) => { const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number); return Date.UTC(y, m - 1, d) / 864e5; };
export const daysBetween = (a, b) => Math.round(day(b) - day(a));
export const addDays = (iso, n) => new Date((day(iso) + Math.round(n)) * 864e5).toISOString().slice(0, 10);
const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const i = s.length >> 1; return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2; };
const kmFromNotes = (s) => { const m = norm(s).match(/الممشي\s*:?\s*(\d{3,7})/); return m ? Number(m[1]) : null; };

export function tireKind(desc) {
  const t = norm(desc);
  if (/بنشر|رقعه/.test(t)) return 'puncture';
  if (/خدمه|تغيير كفر/.test(t)) return 'service';
  if (/كفر|لاستك|تاير|اطار/.test(t)) return 'purchase';
  return 'service';
}

// معدل الاستخدام: كم في اليوم من نقاط العداد (تاريخ، قراءة) لكل سيارة
export function usageRate(points) {
  const p = points.filter((x) => x.km > 0 && x.date).sort((a, b) => a.date.localeCompare(b.date) || a.km - b.km);
  if (p.length < 2) return null;
  const first = p[0], last = p[p.length - 1];
  const days = daysBetween(first.date, last.date), dk = last.km - first.km;
  if (days < 7 || dk <= 0) return null;
  const r = dk / days;
  return r > 0 && r < 2000 ? r : null;
}

export function analyze({ vehicles = [], oil = [], costs = [], readings = [], today }) {
  const byV = new Map(vehicles.map((v) => [v.id, { v, pts: [], oil: [], tires: [], batteries: [], maint: [], spend: [] }]));
  const at = (id) => byV.get(id);
  for (const v of vehicles) if (v.odometer > 0 && v.odometer_updated_at) at(v.id).pts.push({ date: String(v.odometer_updated_at).slice(0, 10), km: v.odometer });
  for (const r of readings) { const x = at(r.vehicle_id); if (x && r.reading > 0 && r.read_at) x.pts.push({ date: String(r.read_at).slice(0, 10), km: r.reading }); }
  for (const o of oil) {
    const x = at(o.vehicle_id); if (!x || !o.change_date) continue;
    x.oil.push({ date: o.change_date, km: o.odometer > 0 ? o.odometer : null, interval: o.interval_km || null });
  }
  for (const c of costs) {
    const x = at(c.vehicle_id); if (!x || !c.line_date) continue;
    const amt = Number(c.amount || 0);
    if (c.category === 'oil') {
      const km = kmFromNotes(c.notes) || kmFromNotes(c.description);
      const same = x.oil.find((o) => o.date === c.line_date);
      if (same) { if (!same.km && km) same.km = km; } else x.oil.push({ date: c.line_date, km, interval: null });
      continue;
    }
    x.spend.push({ date: c.line_date, amt, acc: ACCIDENT.test(norm(c.description)) });
    if (c.category === 'tires') x.tires.push({ date: c.line_date, kind: tireKind(c.description), qty: Number(c.quantity) || 1, desc: c.description });
    else {
      x.maint.push({ date: c.line_date, desc: c.description || '', amt });
      if (/بطاري/.test(norm(c.description))) x.batteries.push({ date: c.line_date });
    }
  }
  for (const x of byV.values()) for (const o of x.oil) if (o.km) x.pts.push({ date: o.date, km: o.km });

  // متوسط المدة بين الغيارات (لكل سيارة، ثم للأسطول كبديل)
  const gaps = (list) => { const d = [...new Set(list.map((o) => o.date))].sort(); const g = []; for (let i = 1; i < d.length; i++) g.push(daysBetween(d[i - 1], d[i])); return g.filter((n) => n > 0); };
  const fleetGap = median([...byV.values()].flatMap((x) => gaps(x.oil)));
  // معدل الأسطول (كم/يوم) بديل للسيارة التي لها ممشى بدون قراءتين
  const fleetRate = median([...byV.values()].map((x) => usageRate(x.pts)).filter(Boolean));
  // المسافة الفعلية بين الغيارات من سجل السيارة (إن عُرف الممشى في غيارين متتاليين)
  const kmGaps = (list) => { const k = list.filter((o) => o.km).sort((a, b) => a.date.localeCompare(b.date)); const g = []; for (let i = 1; i < k.length; i++) { const d = k[i].km - k[i - 1].km; if (d > 500 && d < 30000) g.push(d); } return g; };

  // تكاليف آخر 90 يوماً لكل السيارات (للمقارنة)
  const W = RULES.costWindow;
  const sumIn = (sp, from, to) => sp.filter((s) => { const d = daysBetween(s.date, today); return d >= from && d < to; }).reduce((t, s) => t + s.amt, 0);
  const fleetLast = median([...byV.values()].map((x) => sumIn(x.spend, 0, W)).filter((n) => n > 0));

  const out = [];
  for (const x of byV.values()) {
    const { v } = x;
    const rate = usageRate(x.pts);
    const lastPt = [...x.pts].sort((a, b) => a.date.localeCompare(b.date) || a.km - b.km).pop() || null;
    const curKm = lastPt ? Math.round(lastPt.km + (rate ? rate * Math.max(0, daysBetween(lastPt.date, today)) : 0)) : null;
    const alerts = [];
    const r = { v, rate, curKm, curKmEstimated: !!(lastPt && rate && lastPt.date < today), alerts };

    // ---- الزيت
    if (x.oil.length) {
      const last = [...x.oil].sort((a, b) => a.date.localeCompare(b.date)).pop();
      const setKm = v.oil_interval_km || last.interval || RULES.oilKm;
      const ownKm = median(kmGaps(x.oil));
      const interval = ownKm ? Math.min(setKm, Math.round(ownKm / 100) * 100) : setKm;
      const o = { lastDate: last.date, lastKm: last.km, interval, ownInterval: !!ownKm && interval < setKm, count: x.oil.length, sinceDays: daysBetween(last.date, today) };
      const ownGap = median(gaps(x.oil));
      const useRate = rate || (last.km ? fleetRate : null);
      if (last.km && useRate) {
        const base = rate && curKm != null ? curKm : Math.round(last.km + useRate * Math.max(0, daysBetween(last.date, today)));
        if (!rate) r.curKm = base, r.curKmEstimated = true;
        o.dueKm = last.km + interval; o.leftKm = o.dueKm - base;
        o.dueDate = addDays(today, o.leftKm / useRate); o.basis = rate ? 'km' : 'fleet-rate'; o.conf = rate ? 'high' : 'medium';
      } else if (ownGap) { o.dueDate = addDays(last.date, ownGap); o.basis = 'own-gap'; o.conf = 'medium'; if (last.km) o.dueKm = last.km + interval; }
      else if (fleetRate || fleetGap) { o.dueDate = addDays(last.date, fleetRate ? interval / fleetRate : fleetGap); o.basis = 'fleet-gap'; o.conf = 'low'; if (last.km) o.dueKm = last.km + interval; }
      if (o.dueDate) o.daysLeft = daysBetween(today, o.dueDate);
      o.level = (o.leftKm != null && o.leftKm <= 0) || (o.daysLeft != null && o.daysLeft < 0) ? 'bad'
        : (o.leftKm != null && o.leftKm <= RULES.soonKm) || (o.daysLeft != null && o.daysLeft <= RULES.soonDays) ? 'warn' : 'ok';
      r.oil = o;
      if (o.level !== 'ok') alerts.push({ kind: 'oil', level: o.level, text: o.level === 'bad' ? (o.basis === 'km' || o.basis === 'fleet-rate' ? 'تغيير الزيت متأخر حسب التوقع' : `آخر تغيير زيت مسجل قبل ${o.sinceDays} يوماً`) : 'تغيير الزيت قريب' });
    }

    // ---- الكفرات
    const buys = x.tires.filter((t) => t.kind === 'purchase').sort((a, b) => a.date.localeCompare(b.date));
    const punct = x.tires.filter((t) => t.kind === 'puncture' && daysBetween(t.date, today) <= RULES.punctureDays);
    const punctDays = new Set(punct.map((t) => t.date)).size;
    if (buys.length || x.tires.length) {
      const t = { punctures: punctDays };
      if (buys.length) {
        const b = buys[buys.length - 1];
        const lifeDays = rate ? Math.min(RULES.tireDays, RULES.tireKm / rate) : RULES.tireDays;
        Object.assign(t, { lastDate: b.date, qty: b.qty, partial: b.qty < 4, used: /مستعمل/.test(norm(b.desc)), dueDate: addDays(b.date, (/مستعمل/.test(norm(b.desc)) ? 0.5 : 1) * lifeDays), basis: rate ? 'km' : 'age' });
        t.daysLeft = daysBetween(today, t.dueDate);
        t.level = t.daysLeft < 0 ? 'bad' : t.daysLeft <= RULES.tireSoonDays ? 'warn' : 'ok';
        if (t.level !== 'ok') alerts.push({ kind: 'tires', level: t.level, text: t.level === 'bad' ? 'الكفرات تعدّت عمرها التقريبي' : 'تغيير الكفرات قريب' });
      }
      if (punctDays >= RULES.punctureMin) alerts.push({ kind: 'puncture', level: 'warn', text: `بنشر متكرر: ${punctDays} مرات خلال ${RULES.punctureDays} يوماً، افحص الكفرات` });
      r.tires = t;
    }

    // ---- البطارية
    if (x.batteries.length) {
      const b = x.batteries.map((y) => y.date).sort().pop();
      r.battery = { lastDate: b, dueDate: addDays(b, RULES.batteryDays) };
      r.battery.daysLeft = daysBetween(today, r.battery.dueDate);
      if (r.battery.daysLeft <= RULES.tireSoonDays) alerts.push({ kind: 'battery', level: r.battery.daysLeft < 0 ? 'bad' : 'warn', text: 'البطارية قاربت عمرها التقريبي' });
    }

    // ---- الأعطال المتكررة: كل مجموعة، المرات = حلقات منفصلة (أكثر من 14 يوماً بينها) خلال 180 يوماً
    r.faults = [];
    for (const [key, name, re, not] of FAULTS) {
      const hits = x.maint.filter((m) => { const t = norm(m.desc); return daysBetween(m.date, today) <= RULES.recurringDays && re.test(t) && !(not && not.test(t) && !/فرامل/.test(t)); }).sort((a, b) => a.date.localeCompare(b.date));
      if (!hits.length) continue;
      const eps = [];
      for (const h of hits) { const e = eps[eps.length - 1]; if (e && daysBetween(e.end, h.date) <= RULES.episodeGap) { e.end = h.date; e.cost += h.amt; } else eps.push({ start: h.date, end: h.date, cost: h.amt }); }
      if (eps.length >= RULES.recurringMin) {
        const f = { key, name, times: eps.length, dates: eps.map((e) => e.start), cost: eps.reduce((t, e) => t + e.cost, 0) };
        r.faults.push(f);
        alerts.push({ kind: 'fault', level: eps.length >= 3 ? 'bad' : 'warn', text: `عطل متكرر في ${name}: ${eps.length} مرات خلال 6 أشهر` });
      }
    }

    // ---- المصاريف (صيانة + كفرات + بطاريات، بدون الزيت)
    const last90 = sumIn(x.spend, 0, W), prev90 = sumIn(x.spend, W, 2 * W);
    const acc90 = x.spend.filter((s) => s.acc && daysBetween(s.date, today) < W).reduce((t, s) => t + s.amt, 0);
    r.cost = { last90, prev90, acc90, fleet: fleetLast, change: prev90 > 0 ? (last90 - prev90) / prev90 : null };
    const mostlyAccident = last90 > 0 && acc90 / last90 > 0.5;
    if (last90 >= RULES.costRise * prev90 && last90 - prev90 >= RULES.costRiseMin && !mostlyAccident) {
      r.cost.flag = 'rising';
      alerts.push({ kind: 'cost', level: 'warn', text: prev90 > 0 ? 'مصاريف الصيانة زادت عن الثلاثة أشهر السابقة' : 'مصاريف صيانة جديدة مرتفعة خلال 3 أشهر' });
    } else if (fleetLast && last90 >= 2 * fleetLast && last90 >= RULES.costHighMin && !mostlyAccident) {
      r.cost.flag = 'high';
      alerts.push({ kind: 'cost', level: 'warn', text: 'مصاريفها أعلى بكثير من باقي السيارات' });
    } else if (mostlyAccident && last90 >= RULES.costHighMin) r.cost.flag = 'accident';

    r.level = alerts.some((a) => a.level === 'bad') ? 'bad' : alerts.length ? 'warn' : 'ok';
    r.hasData = !!(r.oil || r.tires || r.battery || x.maint.length);
    out.push(r);
  }
  const rank = { bad: 0, warn: 1, ok: 2 };
  out.sort((a, b) => rank[a.level] - rank[b.level] || b.alerts.length - a.alerts.length || String(a.v.plate_no || a.v.code).localeCompare(String(b.v.plate_no || b.v.code)));
  return { rows: out, fleetGap, fleetRate, fleetLast, today };
}
