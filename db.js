// IndexedDB: meta (kasa, ayarlar), items (şifreli kayıtlar), files (şifreli belge/ses)
const NAME = 'el-defteri';
let dbp = null;

function open() {
  return dbp ??= new Promise((res, rej) => {
    const r = indexedDB.open(NAME, 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore('meta');
      d.createObjectStore('items', { keyPath: 'id' });
      d.createObjectStore('files', { keyPath: 'id' });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const done = t => new Promise((res, rej) => { t.oncomplete = () => res(); t.onerror = t.onabort = () => rej(t.error); });

export async function metaGet(k) { const d = await open(); return req(d.transaction('meta').objectStore('meta').get(k)); }
export async function metaSet(k, v) { const d = await open(); const t = d.transaction('meta', 'readwrite'); t.objectStore('meta').put(v, k); return done(t); }
export async function getAll(store) { const d = await open(); return req(d.transaction(store).objectStore(store).getAll()); }
export async function get(store, id) { const d = await open(); return req(d.transaction(store).objectStore(store).get(id)); }
export async function put(store, val) { const d = await open(); const t = d.transaction(store, 'readwrite'); t.objectStore(store).put(val); return done(t); }
export async function delMany(store, ids) {
  if (!ids.length) return;
  const d = await open(); const t = d.transaction(store, 'readwrite'); const s = t.objectStore(store);
  ids.forEach(id => s.delete(id)); return done(t);
}
export async function replaceAll(vault, items, files) {
  const d = await open();
  const t = d.transaction(['meta', 'items', 'files'], 'readwrite');
  const it = t.objectStore('items'), fs = t.objectStore('files');
  it.clear(); fs.clear();
  items.forEach(r => it.put(r)); files.forEach(r => fs.put(r));
  t.objectStore('meta').put(vault, 'vault');
  return done(t);
}
export async function wipe() {
  const d = await open();
  const t = d.transaction(['meta', 'items', 'files'], 'readwrite');
  ['meta', 'items', 'files'].forEach(s => t.objectStore(s).clear());
  return done(t);
}
