// مسودات النماذج: ما يكتبه المستخدم في أي نموذج يُحفظ مؤقتاً على هذا الجهاز أثناء الكتابة،
// حتى لا يضيع إذا أُغلقت الصفحة أو حُدِّثت أو انقطع الإنترنت أو أعاد الآيفون تحميل الصفحة بعد فتح الكاميرا.
// المسودة ليست بديلاً عن قاعدة البيانات: تُحذف تلقائياً بمجرد نجاح الحفظ الفعلي في Supabase.
// النصوص في localStorage، والصور المختارة في IndexedDB. كل الوصول داخل try/catch لأن التخزين قد يكون ممنوعاً.

const PREFIX = 'fleet.draft.v1|';
const MAX_AGE = 30 * 24 * 3600 * 1000; // 30 يوماً

export function draftKey(userId, title, recordId) {
  const page = (location.hash || '#/').split('?')[0];
  return `${PREFIX}${userId || 'anon'}|${page}|${title}|${recordId ?? 'new'}`;
}

export function readDraft(key) {
  try {
    const d = JSON.parse(localStorage.getItem(key) || 'null');
    if (!d || Date.now() - d.at > MAX_AGE) return null;
    return d;
  } catch (_) { return null; }
}

export function writeDraft(key, snap, files = []) {
  try { localStorage.setItem(key, JSON.stringify({ ...snap, files, at: Date.now() })); return true; } catch (_) { return false; }
}

export function clearDraft(key) {
  try { localStorage.removeItem(key); } catch (_) {}
  fileDel(key).catch(() => {});
}

// تنظيف المسودات القديمة جداً
export function pruneDrafts() {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(PREFIX)) continue;
      try { const d = JSON.parse(localStorage.getItem(k)); if (!d || Date.now() - d.at > MAX_AGE) clearDraft(k); } catch (_) { localStorage.removeItem(k); }
    }
  } catch (_) {}
}

export function hasDrafts(userId) {
  try {
    for (let i = 0; i < localStorage.length; i++) if ((localStorage.key(i) || '').startsWith(`${PREFIX}${userId}|`)) return true;
  } catch (_) {}
  return false;
}

// ---------------------------------------------------------------- الصور (IndexedDB)
let dbp = null;
function db() {
  if (!dbp) dbp = new Promise((res, rej) => {
    try {
      const r = indexedDB.open('fleet-drafts', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('files');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    } catch (e) { rej(e); }
  }).catch((e) => { dbp = null; throw e; });
  return dbp;
}
async function tx(mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction('files', mode); const st = t.objectStore('files');
    const out = fn(st);
    t.oncomplete = () => res(out && 'result' in out ? out.result : undefined);
    t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
  });
}
export async function filePut(key, field, file) {
  if (!file) return tx('readwrite', (st) => st.delete(`${key}#${field}`));
  // نحفظ نسخة بالاسم والنوع حتى تعود كما هي
  return tx('readwrite', (st) => st.put({ name: file.name, type: file.type, blob: file.slice(0, file.size, file.type) }, `${key}#${field}`));
}
export async function fileGet(key, field) {
  const v = await tx('readonly', (st) => st.get(`${key}#${field}`));
  if (!v || !v.blob) return null;
  try { return new File([v.blob], v.name, { type: v.type }); } catch (_) { const b = v.blob; b.name = v.name; return b; }
}
async function fileDel(key) {
  const d = await db();
  return new Promise((res) => {
    const t = d.transaction('files', 'readwrite'); const st = t.objectStore('files');
    const range = IDBKeyRange.bound(`${key}#`, `${key}#￿`);
    st.delete(range); t.oncomplete = () => res(); t.onerror = () => res();
  });
}
