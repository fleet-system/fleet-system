// الإعدادات ← «إدارة بيانات السيارات» و«سجل السيارات المحذوفة»
import * as api from '../api.js';
import * as data from '../data.js';
import { html, raw, icon, toast, $ } from '../ui.js';
import { dateTime, num, errorText, parseDate } from '../fmt.js';
import { openForm, saved, userError, confirmBox } from '../form.js';
import { BUILTIN, SECTIONS, TYPES, DEFAULT_REG_TYPES, DEFAULT_OP_STATE, config, newKey } from '../vehicle-config.js';
import { VERSION } from '../app.js';

const lines = (t) => [...new Set(String(t || '').split(/\n|،|,/).map((x) => x.trim()).filter(Boolean))];

// حفظ إعدادات الحقول: نسخة احتياطية تلقائية أولاً (للمسؤول)، ثم الحفظ. كل تغيير يُسجَّل في سجل التدقيق ويمكن التراجع عنه.
async function saveConfig(cfg) {
  if (api.currentUser()?.is_admin) {
    try { await api.rpc('create_backup', { p_kind: 'pre_update', p_note: 'تلقائية قبل تعديل إعدادات حقول السيارات', p_app_version: VERSION }); }
    catch (e) { if (!/function|not exist|404/i.test(String(e.message))) throw userError(`لم يُحفظ التعديل: تعذر إنشاء النسخة الاحتياطية أولاً. ${errorText(e)}`); }
  }
  const value = { labels: cfg.labels || {}, options: cfg.options || {}, custom: cfg.custom || [] };
  const u = await api.update('app_settings', { key: 'eq.vehicle_fields_config' }, { value });
  if (!u.length) await api.insert('app_settings', { key: 'vehicle_fields_config', value, description: 'vehicle card: field names, lists and extra fields' });
  data.invalidate();
  return true;
}

export async function renderVehicleFields(el) {
  await data.lookups(true);
  if (!api.can('settings')) { el.innerHTML = html`<div class="empty"><h1>إدارة بيانات السيارات</h1><p>تحتاج صلاحية «الإعدادات».</p></div>`; return; }
  const cfg = config();
  const hist = await api.get('audit_log', { select: 'id,changed_at,changed_by,old_data,new_data,action', table_name: 'eq.app_settings', record_id: 'eq.vehicle_fields_config', order: 'id.desc', limit: 30 }).catch(() => []);
  const profs = hist.length ? await api.get('profiles', { select: 'user_id,full_name,email' }).catch(() => []) : [];
  const who = (id) => { const p = profs.find((x) => x.user_id === id); return p ? (p.full_name || p.email) : ''; };
  const op = { ...DEFAULT_OP_STATE, ...(cfg.options.op_state || {}) };

  el.innerHTML = html`
    <a class="back" href="#/settings">${icon('back')}<span>الإعدادات</span></a>
    <div class="page-head"><h1>إدارة بيانات السيارات</h1>
      <p class="muted">غيّر أسماء الحقول، وعدّل القوائم، وأضف حقولاً جديدة لبطاقة السيارة. لا يحذف أي تغيير هنا بيانات محفوظة: كل قيمة مربوطة بمفتاح ثابت، وقبل كل حفظ تُنشأ نسخة احتياطية تلقائية، ويمكن التراجع من «سجل تعديلات الإعدادات».</p></div>

    <section class="panel prot">
      <div class="tab-head"><h2>الحقول الإضافية</h2><button class="btn btn-primary btn-sm" data-act="cf-new">${icon('plus')}<span>إضافة حقل جديد</span></button></div>
      ${raw(cfg.custom.length ? html`<div class="table-wrap"><table class="rtable"><thead><tr><th>اسم الحقل</th><th>النوع</th><th>القسم</th><th>في القائمة</th><th>في التصدير</th><th>الحالة</th><th></th></tr></thead><tbody>
        ${raw(cfg.custom.map((c) => html`<tr><td data-l="اسم الحقل"><b>${c.label}</b>${raw(c.type === 'select' ? html`<small class="muted">${(c.options || []).join('، ')}</small>` : '')}</td>
          <td data-l="النوع">${TYPES[c.type] || c.type}</td><td data-l="القسم">${SECTIONS[c.section] || SECTIONS[6]}</td>
          <td data-l="في القائمة">${c.in_list ? 'نعم' : 'لا'}</td><td data-l="في التصدير">${c.in_export !== false ? 'نعم' : 'لا'}</td>
          <td data-l="الحالة"><span class="tag t-${c.active === false ? 'no_date' : 'valid'}">${c.active === false ? 'موقوف (بياناته محفوظة)' : 'مفعّل'}</span></td>
          <td class="act"><button class="btn btn-sm" data-cf-edit="${c.key}">تعديل</button></td></tr>`).join(''))}</tbody></table></div>`
        : html`<p class="muted pad">لا توجد حقول إضافية بعد. اضغط «إضافة حقل جديد».</p>`)}
    </section>

    <section class="panel prot">
      <div class="tab-head"><h2>أسماء حقول بطاقة السيارة</h2><button class="btn btn-sm btn-primary" data-act="labels-save">حفظ الأسماء</button></div>
      <p class="muted small">اترك الخانة كما هي للإبقاء على الاسم الافتراضي. تغيير الاسم لا يغيّر البيانات المحفوظة.</p>
      <form class="form-grid labels-form" onsubmit="return false">
        ${raw(Object.entries(SECTIONS).filter(([n]) => n !== '6').map(([n, t]) => html`<h3 class="form-sec">${t}</h3>${raw(BUILTIN.filter((b) => b[2] === Number(n)).map(([k, d]) => html`<label class="field"><span>${d}</span><input name="${k}" type="text" value="${cfg.labels[k] || d}" autocomplete="off"></label>`).join(''))}`).join(''))}
      </form>
    </section>

    <section class="panel prot">
      <div class="tab-head"><h2>القوائم والخيارات</h2><button class="btn btn-sm btn-primary" data-act="lists-save">حفظ القوائم</button></div>
      <form class="form-grid lists-form" onsubmit="return false">
        <label class="field full"><span>خيارات «نوع التسجيل» (كل خيار في سطر)</span><textarea name="registration_type" rows="5">${(cfg.options.registration_type || DEFAULT_REG_TYPES).join('\n')}</textarea></label>
        <label class="field full"><span>ماركات إضافية تظهر في الاقتراحات (كل ماركة في سطر)</span><textarea name="makes" rows="3">${(cfg.options.makes || []).join('\n')}</textarea></label>
        <h3 class="form-sec">أسماء خيارات «الحالة التشغيلية» (الخيارات الثلاثة ثابتة، ويمكن تغيير أسمائها)</h3>
        ${raw(Object.entries(DEFAULT_OP_STATE).map(([k, d]) => html`<label class="field"><span>${d}</span><input name="op_${k}" type="text" value="${op[k]}" autocomplete="off"></label>`).join(''))}
      </form>
      <p class="muted small">حذف خيار من القائمة لا يمسح القيمة من السيارات التي اختارته سابقاً؛ تبقى محفوظة وظاهرة في بطاقاتها.</p>
    </section>

    <section class="panel prot">
      <div class="tab-head"><h2>إدارة بقية معلومات السيارات</h2></div>
      <div class="btn-row wrap">
        <a class="btn" href="#/vehicles">${icon('car')}<span>بطاقات السيارات</span></a><a class="btn" href="#/documents">${icon('doc')}<span>الوثائق والتأمين</span></a>
        <a class="btn" href="#/oil">${icon('oil')}<span>تغيير الزيت</span></a><a class="btn" href="#/requests">${icon('wrench')}<span>الصيانة</span></a>
        <a class="btn" href="#/accidents">${icon('alert')}<span>الحوادث</span></a><a class="btn" href="#/sites">${icon('sites')}<span>الشركات والمواقع</span></a>
        <a class="btn" href="#/excel">${icon('table')}<span>استيراد وتصدير Excel</span></a><a class="btn" href="#/settings/vehicles-archive">${icon('clock')}<span>سجل السيارات المحذوفة</span></a>
      </div>
    </section>

    <section class="panel prot">
      <div class="tab-head"><h2>سجل تعديلات الإعدادات</h2></div>
      ${raw(hist.length ? html`<div class="table-wrap"><table class="rtable"><thead><tr><th>الوقت</th><th>بواسطة</th><th>ما تغيّر</th><th></th></tr></thead><tbody>
        ${raw(hist.map((h) => { const o = h.old_data?.value || {}, n = h.new_data?.value || {};
          const parts = [];
          if (JSON.stringify(o.labels || {}) !== JSON.stringify(n.labels || {})) parts.push('أسماء الحقول');
          if (JSON.stringify(o.options || {}) !== JSON.stringify(n.options || {})) parts.push('القوائم');
          if (JSON.stringify(o.custom || []) !== JSON.stringify(n.custom || [])) parts.push(`الحقول الإضافية (${(n.custom || []).length})`);
          return html`<tr><td data-l="الوقت" class="num">${dateTime(h.changed_at)}</td><td data-l="بواسطة">${who(h.changed_by)}</td><td data-l="ما تغيّر">${parts.join('، ') || (h.action === 'INSERT' ? 'الإعدادات الأولى' : '—')}</td>
            <td class="act">${raw(h.old_data?.value ? html`<button class="btn btn-sm" data-cfg-undo="${h.id}">استعادة الإعدادات قبل هذا التعديل</button>` : '')}</td></tr>`; }).join(''))}</tbody></table></div>`
        : html`<p class="muted pad">لا توجد تعديلات بعد.</p>`)}
    </section>`;

  const reload = () => renderVehicleFields(el);
  const fieldForm = (c) => openForm({
    title: c ? `تعديل الحقل «${c.label}»` : 'إضافة حقل جديد', draft: false,
    intro: c ? 'تغيير الاسم أو القسم أو الخيارات لا يمس القيم المحفوظة. نوع الحقل لا يتغير بعد إنشائه حتى لا تختلط القيم. «إيقاف» الحقل يخفيه من النماذج فقط وتبقى بياناته.' : 'الحقل الجديد يظهر في نموذج بطاقة السيارة وفي ملفها، ويمكن إظهاره في قائمة السيارات وفي تصدير Excel.',
    fields: [
      { name: 'label', label: 'اسم الحقل', required: true },
      c ? { name: 'type_show', label: 'النوع', readonly: true } : { name: 'type', label: 'نوع الحقل', type: 'select', required: true, placeholder: false, options: Object.entries(TYPES) },
      { name: 'options', label: 'خيارات القائمة المنسدلة (كل خيار في سطر)', type: 'textarea', full: true, help: 'تُستخدم فقط إذا كان النوع «قائمة منسدلة»' },
      { name: 'section', label: 'القسم في بطاقة السيارة', type: 'select', required: true, placeholder: false, options: Object.entries(SECTIONS) },
      { name: 'required', label: 'إلزامي عند حفظ البطاقة', type: 'checkbox' },
      { name: 'in_list', label: 'إظهاره كعمود في قائمة السيارات', type: 'checkbox' },
      { name: 'in_export', label: 'إدراجه في تصدير Excel', type: 'checkbox' },
      ...(c ? [{ name: 'active', label: 'مفعّل (إلغاء التحديد = إيقاف الحقل مع الاحتفاظ ببياناته)', type: 'checkbox', full: true }] : []),
    ],
    values: c ? { ...c, type_show: TYPES[c.type], options: (c.options || []).join('\n'), active: c.active !== false, in_export: c.in_export !== false } : { type: 'text', section: '6', in_export: true },
    submitText: c ? 'حفظ الحقل' : 'إضافة الحقل',
    onSubmit: async (v) => {
      const type = c ? c.type : v.type;
      const options = lines(v.options);
      if (type === 'select' && !options.length) throw userError('أضف خياراً واحداً على الأقل للقائمة المنسدلة.');
      const cur = config();
      if (cur.custom.some((x) => x.label.trim() === v.label.trim() && (!c || x.key !== c.key))) throw userError('يوجد حقل إضافي بنفس الاسم.');
      const def = { key: c ? c.key : newKey(), label: v.label.trim(), type, options: type === 'select' ? options : [], section: Number(v.section), required: !!v.required, in_list: !!v.in_list, in_export: !!v.in_export, active: c ? !!v.active : true };
      const custom = c ? cur.custom.map((x) => (x.key === c.key ? def : x)) : [...cur.custom, def];
      return saveConfig({ ...cur, custom });
    },
  });

  el.onclick = async (e) => {
    const ce = e.target.closest('[data-cf-edit]');
    if (ce) { const c = config().custom.find((x) => x.key === ce.dataset.cfEdit); if (c && await fieldForm(c)) { saved('تم حفظ الحقل'); reload(); } return; }
    const un = e.target.closest('[data-cfg-undo]');
    if (un) {
      const h = hist.find((x) => String(x.id) === un.dataset.cfgUndo); const old = h?.old_data?.value; if (!old) return;
      const ok = await confirmBox(html`ستعود إعدادات حقول السيارات كما كانت قبل تعديل <b class="num">${dateTime(h.changed_at)}</b>:
        <br>${(old.custom || []).length} حقل إضافي، و${Object.keys(old.labels || {}).length} اسم معدّل. البيانات المحفوظة في السيارات لا تتغير، والإعدادات الحالية تبقى في السجل.`.toString(),
      { title: 'استعادة الإعدادات', okText: 'استعادة' });
      if (!ok) return;
      try {
        // الحقول الإضافية التي أُنشئت بعد ذلك التاريخ لا تُحذف؛ تُوقف فقط حتى لا تضيع قيمها
        const now = config(); const keep = (old.custom || []).map((x) => x.key);
        const later = now.custom.filter((x) => !keep.includes(x.key)).map((x) => ({ ...x, active: false }));
        await saveConfig({ ...old, custom: [...(old.custom || []), ...later] }); saved('تمت استعادة الإعدادات'); reload();
      } catch (err) { toast(err.userMessage || errorText(err), 'error'); }
      return;
    }
    const b = e.target.closest('[data-act]'); if (!b) return;
    try {
      if (b.dataset.act === 'cf-new') { if (await fieldForm(null)) { saved('تمت إضافة الحقل'); reload(); } return; }
      if (b.dataset.act === 'labels-save') {
        const f = $('.labels-form', el); const labels = {};
        for (const [k, d] of BUILTIN) { const x = (f.elements[k]?.value || '').trim(); if (x && x !== d) labels[k] = x; }
        b.disabled = true; await saveConfig({ ...config(), labels }); saved('تم حفظ أسماء الحقول'); reload(); return;
      }
      if (b.dataset.act === 'lists-save') {
        const f = $('.lists-form', el);
        const reg = lines(f.elements.registration_type.value);
        if (!reg.length) throw userError('أضف خياراً واحداً على الأقل لنوع التسجيل.');
        const opn = Object.fromEntries(Object.entries(DEFAULT_OP_STATE).map(([k, d]) => [k, (f.elements[`op_${k}`].value || '').trim() || d]));
        b.disabled = true; await saveConfig({ ...config(), options: { ...config().options, registration_type: reg, makes: lines(f.elements.makes.value), op_state: opn } });
        saved('تم حفظ القوائم'); reload();
      }
    } catch (err) { b.disabled = false; toast(err.userMessage || errorText(err), 'error'); }
  };
}

// ---------------------------------------------------------------- سجل السيارات المحذوفة
const ast = { q: '', from: '', to: '' };
export async function renderVehiclesArchive(el) {
  await data.lookups();
  const rows = await api.get('v_vehicles_archive', { select: '*', deleted_at: 'not.is.null', order: 'deleted_at.desc' });
  el.innerHTML = html`
    <a class="back" href="#/settings">${icon('back')}<span>الإعدادات</span></a>
    <div class="page-head row"><h1>سجل السيارات المحذوفة <span class="count num">${num(rows.length)}</span></h1></div>
    <p class="muted">بطاقات نُقلت من قائمة السيارات النشطة. كل معلوماتها ومستنداتها وسجلاتها وسجل تعديلاتها محفوظة، وتنبيهاتها متوقفة. افتح البطاقة للاطلاع على كل شيء، أو استردها بنفس رقمها ومعرّفها.</p>
    <form class="filters wide-filters" onsubmit="return false">
      <label class="grow"><span>بحث</span><input name="q" type="search" value="${ast.q}" placeholder="اللوحة، الرقم الداخلي، الماركة، المالك، المستخدم، سبب الحذف"></label>
      <label><span>حُذفت من</span><input name="from" type="text" inputmode="numeric" dir="ltr" placeholder="YYYY/MM/DD" value="${ast.from}"></label>
      <label><span>إلى</span><input name="to" type="text" inputmode="numeric" dir="ltr" placeholder="YYYY/MM/DD" value="${ast.to}"></label>
    </form>
    <div id="arch"></div>`;
  const day = (x) => { try { return x ? parseDate(x) : ''; } catch (_) { return ''; } };
  const draw = () => {
    const q = ast.q.trim().toLowerCase(), from = day(ast.from), to = day(ast.to);
    const list = rows.filter((r) => {
      const d = String(r.deleted_at).slice(0, 10);
      return (!from || d >= from) && (!to || d <= to) && (!q || [r.plate_no, r.code, r.make, r.model, r.owner_company_name, r.current_user_name, r.delete_reason, r.deleted_by_name, r.site_name, r.vin]
        .some((x) => (x || '').toLowerCase().includes(q)));
    });
    $('#arch', el).innerHTML = list.length ? html`<div class="table-wrap"><table class="rtable"><thead><tr><th>الرقم الداخلي</th><th>اللوحة</th><th>الماركة والطراز</th><th>المالك</th><th>المستخدم الحالي</th><th>تاريخ الحذف</th><th>حذفها</th><th>السبب</th><th></th></tr></thead><tbody>
      ${raw(list.map((r) => html`<tr><td data-l="الرقم الداخلي" class="code strong">${r.code}</td><td data-l="اللوحة" class="plate">${r.plate_no}</td>
        <td data-l="الماركة والطراز">${[r.make, r.model, r.manufacture_year].filter(Boolean).join(' · ') || '—'}</td><td data-l="المالك">${r.owner_company_name}</td>
        <td data-l="المستخدم الحالي">${r.current_user_name || '—'}</td><td data-l="تاريخ الحذف" class="num">${dateTime(r.deleted_at)}</td><td data-l="حذفها">${r.deleted_by_name || '—'}</td>
        <td data-l="السبب">${r.delete_reason || '—'}</td>
        <td class="act"><a class="btn btn-sm" href="#/vehicles/${r.id}">فتح البطاقة</a><a class="btn btn-sm" href="#/vehicles/${r.id}?tab=log">سجل التعديلات</a>
          ${raw(api.can('edit') ? html`<button class="btn btn-sm btn-primary" data-restore="${r.id}">استرداد البطاقة</button>` : '')}</td></tr>`).join(''))}</tbody></table></div>`
      : html`<div class="empty soft"><p>${rows.length ? 'لا توجد بطاقات مطابقة.' : 'لا توجد بطاقات محذوفة.'}</p></div>`;
  };
  draw();
  $('form', el).addEventListener('input', (e) => { ast[e.target.name] = e.target.value; draw(); });
  el.onclick = async (e) => {
    const b = e.target.closest('[data-restore]'); if (!b) return;
    const r = rows.find((x) => x.id === b.dataset.restore);
    const ok = await openForm({
      title: 'استرداد البطاقة', draft: false, submitText: 'استرداد البطاقة',
      intro: html`ستعود بطاقة <b>${r.code} — ${r.plate_no}</b> إلى قائمة السيارات النشطة بنفس رقمها ومعرّفها وكل سجلاتها، وتعود تنبيهاتها حسب التواريخ الحالية.`.toString(),
      fields: [{ name: 'reason', label: 'ملاحظة (اختياري)', type: 'textarea', full: true }],
      onSubmit: async (v) => api.rpc('restore_vehicle', { p_id: r.id, p_reason: v.reason || null }),
    });
    if (ok) { saved(`تم استرداد البطاقة ${r.code}`); data.invalidate(); renderVehiclesArchive(el); }
  };
}
