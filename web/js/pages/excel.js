// صفحة Excel: التصدير والاستيراد
import * as api from '../api.js';
import { html, raw, icon, toast, $ } from '../ui.js';
import { num, date, todayISO, errorText } from '../fmt.js';
import { confirmBox, saved } from '../form.js';
import { writeXlsx, readXlsx, saveBlob } from '../xlsx.js';
import { EXPORTS, buildSheets } from '../excel-specs.js';
import { IMPORTS, analyze, apply } from '../excel-import.js';

const STATUS = { new: ['جديد', 't-valid'], update: ['تعديل', 't-expiring'], same: ['بدون تغيير', 't-no_date'], error: ['مرفوض', 't-expired'] };
const show = (v) => (v === null || v === undefined || v === '' ? '—' : /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? date(v) : String(v));

export async function renderExcel(el) {
  const canExp = api.can('export'), canImp = api.can('import');
  el.innerHTML = html`
    <div class="page-head"><h1>Excel: الاستيراد والتصدير</h1></div>
    <section class="panel">
      <div class="tab-head"><h2>التصدير</h2></div>
      ${raw(canExp ? html`
        <p class="muted small">ملفات XLSX حقيقية تفتح في Excel وNumbers وGoogle Sheets: عناوين عربية، فلاتر، صف عناوين ثابت، اتجاه من اليمين لليسار، والتواريخ قابلة للفرز والحساب بصيغة yyyy/mm/dd.</p>
        <div class="exp-grid">${raw(EXPORTS.map((e) => html`<button class="btn" data-exp="${e.key}">${icon('table')}<span>${e.title}</span></button>`).join(''))}</div>
        <button class="btn btn-primary wide" data-exp="all">${icon('table')}<span>تصدير كل الأقسام في ملف واحد</span></button>
        <p class="muted small" data-exp-msg></p>` : html`<p class="muted">التصدير يتطلب صلاحية «تصدير Excel».</p>`)}
    </section>
    <section class="panel">
      <div class="tab-head"><h2>الاستيراد</h2></div>
      ${raw(canImp ? html`
        <ol class="steps-list">
          <li>صدّر ملف <b>السيارات</b> أو <b>الموظفين</b> من الأعلى واستخدمه كقالب. لا تغيّر عناوين الأعمدة.</li>
          <li>عدّل البيانات في Excel. لإضافة سجل جديد اترك «الرقم الداخلي» فارغاً.</li>
          <li>ارفع الملف هنا وراجع المعاينة: الجديد، والمعدّل، والمرفوض مع سببه. لن يُحفظ شيء قبل ضغطك «اعتماد».</li>
        </ol>
        <div class="warn-box small"><span>الربط يتم بالرقم الداخلي الثابت وليس برقم اللوحة. الاستيراد لا يحذف أي سجل ولا صورة ولا فاتورة. الخلية الفارغة لا تمسح تاريخ وثيقة. تغيير السائق يتم بنموذج التسليم وليس بالاستيراد. الصور والفواتير لا تدخل في ملف Excel، تُرفع من صفحات السجلات.</span></div>
        <div class="btn-row"><button class="btn btn-primary" data-imp="vehicles">${icon('upload')}<span>استيراد ملف السيارات</span></button><button class="btn btn-primary" data-imp="employees">${icon('upload')}<span>استيراد ملف الموظفين</span></button></div>
        <div class="imp-box"></div>` : html`<p class="muted">الاستيراد يتطلب صلاحية «استيراد Excel».</p>`)}
    </section>`;

  el.onclick = async (e) => {
    const ex = e.target.closest('[data-exp]');
    if (ex) {
      const msg = $('[data-exp-msg]', el); ex.disabled = true; msg.textContent = 'جارٍ تجهيز الملف…';
      try {
        const keys = ex.dataset.exp === 'all' ? EXPORTS.map((x) => x.key) : [ex.dataset.exp];
        const sheets = await buildSheets(keys);
        const name = ex.dataset.exp === 'all' ? 'كل-البيانات' : EXPORTS.find((x) => x.key === ex.dataset.exp).title.replace(/\s+/g, '-');
        saveBlob(writeXlsx(sheets), `${name}-${todayISO()}.xlsx`);
        msg.textContent = `تم التصدير: ${sheets.map((s) => `${s.name} (${num(s.rows.length)})`).join('، ')}`;
      } catch (err) { toast(errorText(err), 'error'); msg.textContent = ''; }
      ex.disabled = false;
      return;
    }
    const im = e.target.closest('[data-imp]');
    if (im) {
      const kind = im.dataset.imp;
      const inp = Object.assign(document.createElement('input'), { type: 'file', accept: '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      inp.onchange = () => preview(el, kind, inp.files[0]);
      inp.click();
    }
  };
}

async function preview(el, kind, file) {
  const box = $('.imp-box', el);
  box.innerHTML = html`<p class="loading">جارٍ قراءة الملف والتحقق من البيانات…</p>`;
  let an;
  try { an = await analyze(kind, await readXlsx(file)); }
  catch (e) { box.innerHTML = html`<p class="bad-box">${e.message || errorText(e)}</p>`; return; }
  const c = (s) => an.rows.filter((r) => r.status === s).length;
  const n = { new: c('new'), update: c('update'), same: c('same'), error: c('error') };
  let filter = n.error ? 'error' : 'changes';
  const draw = () => {
    const rows = an.rows.filter((r) => filter === 'all' || (filter === 'changes' ? r.status === 'new' || r.status === 'update' : r.status === filter));
    $('.imp-rows', box).innerHTML = rows.length ? html`<ol class="imp-list">${raw(rows.map((r) => html`<li class="imp-${r.status}">
      <div class="a-head"><span class="tag ${STATUS[r.status][1]}">${STATUS[r.status][0]}</span><b>السطر <span class="num">${r.line}</span></b><span class="code">${r.code || 'جديد'}</span><span>${r.label}</span></div>
      ${raw(r.errors.length ? html`<ul class="errs">${raw(r.errors.map((x) => html`<li>${x}</li>`).join(''))}</ul>` : '')}
      ${raw(!r.errors.length && r.changes.length ? html`<table class="diff"><tbody>${raw(r.changes.map((ch) => html`<tr><th>${ch.header}</th>${raw(r.status === 'update' ? html`<td class="old">${show(ch.fromLabel ?? ch.from)}</td><td class="arrow">←</td>` : '')}<td class="new">${show(ch.toLabel ?? ch.to)}</td></tr>`).join(''))}</tbody></table>` : '')}
    </li>`).join(''))}</ol>` : html`<p class="muted pad">لا توجد أسطر في هذا التصنيف.</p>`;
  };
  box.innerHTML = html`
    <h3 class="sub">معاينة «${file.name}» — ${IMPORTS[kind].title}</h3>
    <div class="chips imp-chips">
      <button class="chip t-valid" data-f="new">جديد <b class="num">${n.new}</b></button>
      <button class="chip t-expiring" data-f="update">تعديل <b class="num">${n.update}</b></button>
      <button class="chip t-no_date" data-f="same">بدون تغيير <b class="num">${n.same}</b></button>
      <button class="chip t-expired" data-f="error">مرفوض <b class="num">${n.error}</b></button>
      <button class="chip" data-f="all">الكل <b class="num">${an.rows.length}</b></button>
    </div>
    ${raw(an.ignored.length ? html`<p class="muted small">أعمدة للعرض فقط لن تُستورد: ${an.ignored.join('، ')}</p>` : '')}
    <div class="imp-rows"></div>
    <div class="imp-actions">
      ${raw(n.new + n.update ? html`<button class="btn btn-primary" data-apply>اعتماد ${n.new} جديد و ${n.update} تعديل</button>` : '<p class="muted">لا توجد تغييرات قابلة للاعتماد.</p>')}
      ${raw(n.error ? html`<p class="small muted">الأسطر المرفوضة (${n.error}) لن تُحفظ. صححها في الملف وأعد رفعه، وباقي البيانات الصحيحة لا تتأثر.</p>` : '')}
    </div>`;
  draw();
  box.onclick = async (e) => {
    const f = e.target.closest('[data-f]'); if (f) { filter = f.dataset.f; draw(); return; }
    if (!e.target.closest('[data-apply]')) return;
    if (!(await confirmBox(`سيتم حفظ <b>${n.new}</b> سجل جديد وتعديل <b>${n.update}</b> سجل. كل تعديل يُسجَّل في سجل التعديلات. هل تريد المتابعة؟`, { title: 'اعتماد الاستيراد', okText: 'اعتماد' }))) return;
    const btn = $('[data-apply]', box); btn.disabled = true;
    const res = await apply(kind, an, file.name, (i, t) => { btn.textContent = `جارٍ الحفظ ${i} من ${t}…`; });
    box.innerHTML = html`<div class="${res.failed.length ? 'warn-box' : 'warn-box ok-box'}"><span>تم: إضافة <b class="num">${res.inserted}</b> وتعديل <b class="num">${res.updated}</b>.${res.failed.length ? ` تعذر حفظ ${res.failed.length}:` : ''}</span></div>
      ${raw(res.failed.length ? html`<ul class="errs">${raw(res.failed.map((x) => html`<li>السطر ${x.line} (${x.label}): ${errorText(x.error)}</li>`).join(''))}</ul>` : '')}`;
    saved('تم الاستيراد');
  };
}
