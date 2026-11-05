// Bulut: Google ile giriş + Firestore eşitleme.
// Buluta yalnızca cihazda şifrelenmiş veri gider (uçtan uca şifreleme); Google dahil kimse içeriği okuyamaz.
export const CONFIG = {
  apiKey: 'AIzaSyB24oQvUV4KLg_PYsTT6WOutQVGBjgoePc',
  authDomain: 'el-defteri.firebaseapp.com',
  projectId: 'el-defteri',
  storageBucket: 'el-defteri.firebasestorage.app',
  messagingSenderId: '46477459522',
  appId: '1:46477459522:web:0c69350f1a8c201d21addb',
};
// İzinli üye listesini yöneten hesap (Firestore kurallarındaki ile aynı olmalı)
export const ADMIN = 'orcunyuk@gmail.com';

const CHUNK = 900 * 1024; // Firestore belge sınırı 1 MiB
let fb, auth, fs, user = null, ready = null;
const emulator = ['localhost', '127.0.0.1'].includes(location.hostname) && new URLSearchParams(location.search).has('emu');

export function init() {
  return ready ??= (async () => {
    fb = await import('./vendor/firebase/firebase.js');
    const app = fb.initializeApp(emulator ? { ...CONFIG, projectId: 'demo-el-defteri', apiKey: 'demo' } : CONFIG);
    auth = fb.initializeAuth(app, {
      persistence: [fb.indexedDBLocalPersistence, fb.browserLocalPersistence],
      popupRedirectResolver: fb.browserPopupRedirectResolver,
    });
    fs = fb.initializeFirestore(app, {});
    if (emulator) {
      fb.connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
      fb.connectFirestoreEmulator(fs, '127.0.0.1', 8085);
    }
    try { await fb.getRedirectResult(auth); } catch (e) { console.warn('redirect', e.code); }
    await new Promise(res => { const un = fb.onAuthStateChanged(auth, u => { user = u; un(); res(); }); });
    fb.onAuthStateChanged(auth, u => { user = u; });
    return true;
  })();
}
export const currentUser = () => user;
export const isAdmin = () => !!user && user.email?.toLowerCase() === ADMIN;

export async function signIn() {
  await init();
  const p = new fb.GoogleAuthProvider();
  p.setCustomParameters({ prompt: 'select_account' });
  try {
    user = (await fb.signInWithPopup(auth, p)).user;
    return user;
  } catch (e) {
    // Açılır pencere kullanılamıyorsa yönlendirme ile dene (sayfa Google'a gidip geri döner)
    if (['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment', 'auth/web-storage-unsupported'].includes(e.code)) {
      await fb.signInWithRedirect(auth, p);
      return null;
    }
    throw e;
  }
}
// Yalnızca yerel test ortamında: sahte Google hesabıyla giriş
export async function signInTest(email) {
  if (!emulator) throw new Error('yalnızca test');
  await init();
  const cred = fb.GoogleAuthProvider.credential(JSON.stringify({ sub: 'test-' + email, email, email_verified: true }));
  user = (await fb.signInWithCredential(auth, cred)).user;
  return user;
}
export async function signOutUser() { await init(); await fb.signOut(auth); user = null; }

const uref = () => fb.doc(fs, 'users', user.uid);
const items = () => fb.collection(fs, 'users', user.uid, 'items');
const files = () => fb.collection(fs, 'users', user.uid, 'files');
const bytes = b => fb.Bytes.fromUint8Array(b instanceof Uint8Array ? b : new Uint8Array(b));

/* ---------- kasa (şifreyle sarmalanmış anahtar) ---------- */
export async function getVault() {
  const s = await fb.getDoc(uref());
  const v = s.exists() ? s.data().vault : null;
  return v ? { salt: v.salt.toUint8Array(), iterations: v.iterations, wrapped: v.wrapped.toUint8Array() } : null;
}
export async function putVault(v) {
  await fb.setDoc(uref(), { vault: { salt: bytes(v.salt), iterations: v.iterations, wrapped: bytes(v.wrapped) }, email: user.email, guncelleme: fb.serverTimestamp() }, { merge: true });
}

/* ---------- kayıtlar ---------- */
export async function pushItems(recs) {
  for (let i = 0; i < recs.length; i += 300) {
    const b = fb.writeBatch(fs);
    for (const r of recs.slice(i, i + 300)) {
      b.set(fb.doc(items(), r.id), r.deleted
        ? { kind: r.kind || '', deleted: true, updated: r.updated, sv: fb.serverTimestamp() }
        : { kind: r.kind, iv: bytes(r.iv), data: bytes(r.data), updated: r.updated, deleted: false, sv: fb.serverTimestamp() });
    }
    await b.commit();
  }
}
// since: son çekilen sunucu zamanı (ms); null ise hepsi
export async function pullItems(since) {
  const q = since ? fb.query(items(), fb.where('sv', '>', fb.Timestamp.fromMillis(since))) : items();
  const snap = await fb.getDocs(q);
  let max = since || 0;
  const out = snap.docs.map(d => {
    const x = d.data();
    const sv = x.sv?.toMillis?.() || 0;
    if (sv > max) max = sv;
    return x.deleted ? { id: d.id, kind: x.kind, deleted: true, updated: x.updated }
      : { id: d.id, kind: x.kind, iv: x.iv.toUint8Array(), data: x.data.toUint8Array(), updated: x.updated };
  });
  return { recs: out, cursor: max };
}

/* ---------- dosyalar (belge, ses): parçalara bölünür ---------- */
export async function pushFile(id, iv, data) {
  const u = new Uint8Array(data);
  const total = Math.max(1, Math.ceil(u.length / CHUNK));
  for (let n = 0; n < total; n++) {
    await fb.setDoc(fb.doc(files(), `${id}_${n}`), { fid: id, n, total, iv: bytes(iv), data: bytes(u.subarray(n * CHUNK, (n + 1) * CHUNK)) });
  }
}
export async function pullFile(id) {
  const snap = await fb.getDocs(fb.query(files(), fb.where('fid', '==', id)));
  if (snap.empty) return null;
  const parts = snap.docs.map(d => d.data()).sort((a, b) => a.n - b.n);
  if (parts.length !== parts[0].total) return null;
  const len = parts.reduce((s, p) => s + p.data.toUint8Array().length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) { const b = p.data.toUint8Array(); out.set(b, o); o += b.length; }
  return { iv: parts[0].iv.toUint8Array(), data: out.buffer };
}
export async function deleteFile(id) {
  const snap = await fb.getDocs(fb.query(files(), fb.where('fid', '==', id)));
  await Promise.all(snap.docs.map(d => fb.deleteDoc(d.ref)));
}

/* ---------- izinli üyeler (yalnızca yönetici) ---------- */
const allowRef = () => fb.doc(fs, 'config', 'izinliler');
export async function getAllow() { const s = await fb.getDoc(allowRef()); return s.exists() ? (s.data().emails || []) : []; }
export async function setAllow(emails) { await fb.setDoc(allowRef(), { emails }); }
