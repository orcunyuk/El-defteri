import * as db from './db.js';
import * as cr from './crypto.js';
import * as cloud from './cloud.js';
import { extractText, parse, parseBilgi } from './extract.js';

const $ = (s, el = document) => el.querySelector(s);
function defaultSettings() { return { autolock: 5, theme: 'sistem' }; }
const THEMES = [['sistem', 'Sistem'], ['acik', 'Açık'], ['koyu', 'Koyu']];
const darkMQ = matchMedia('(prefers-color-scheme: dark)');
function applyTheme() {
  const t = S.settings.theme || 'sistem';
  const dark = t === 'koyu' || (t === 'sistem' && darkMQ.matches);
  document.documentElement.dataset.theme = dark ? 'koyu' : 'acik';
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', dark ? '#000000' : '#f2f2f7');
}
darkMQ.addEventListener?.('change', () => applyTheme());
const app = $('#app');
const S = {
  key: null, vault: null, items: new Map(), settings: defaultSettings(), lastBackup: null,
  filter: 'aktif', q: '', lastActive: Date.now(), urls: new Set(), recording: false,
  viewerFile: null, backupFile: null,
};
let pendingCall = null;
let sheetCleanup = null;

/* ---------- yardımcılar ---------- */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => crypto.randomUUID();
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const localDT = (d = new Date()) => `${ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const today = () => ymd(new Date());
const parseD = s => new Date(s.length === 10 ? s + 'T00:00' : s);
const fmtD = s => s ? parseD(s).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
const fmtDT = s => s ? parseD(s).toLocaleString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
const fmtTs = (ts, time) => new Date(ts).toLocaleString('tr-TR', time ? { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'short', year: 'numeric' });
const daysUntil = s => Math.round((parseD(s.slice(0, 10)) - parseD(today())) / 864e5);
const addDays = (s, n) => { const d = parseD(s); d.setDate(d.getDate() + n); return ymd(d); };
function addMonths(s, n) {
  const [y, m, d] = s.split('-').map(Number);
  const t = new Date(y, m - 1 + n, 1);
  t.setDate(Math.min(d, new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate()));
  return ymd(t);
}
const relDays = n => n === 0 ? 'bugün' : n === 1 ? 'yarın' : n < 0 ? `${-n} gün geçti` : `${n} gün kaldı`;
const badge = s => { const n = daysUntil(s); return `<span class="badge ${n < 0 ? 'bad' : n <= 3 ? 'warn' : 'ok'}">${relDays(n)}</span>`; };
const relPast = s => { const n = -daysUntil(s); return n <= 0 ? 'bugün' : n === 1 ? 'dün' : `${n} gün önce`; };
const fmtSure = sec => `${Math.floor(sec / 60)}:${pad(Math.floor(sec % 60))}`;
const fmtSize = b => b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1048576).toFixed(1)} MB`;
const telHref = t => String(t).replace(/[^\d+]/g, '');
const coll = new Intl.Collator('tr');
const fold = s => String(s || '').toLocaleLowerCase('tr').replace(/\s+/g, ' ').trim();
// Unvanı kısaltır: ilk iki kelime + şirket türü ("Örnek Gıda Tarım ... Ltd. Şti." → "Örnek Gıda Ltd. Şti.")
const TR_FOLD = s => s.toLocaleLowerCase('tr').replace(/[çğıöşüâî]/g, c => ({ ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', â: 'a', î: 'i' }[c]));
const STOP = /^(san|sanayi|sanayii|tic|ticaret|ve|ith|ithalat|ihr|ihracat|ltd|limited|sti|sirketi|as|a\.s|anonim|koll|kollektif|kom|komandit|koop|kooperatifi?|ic|dis|ltd\.?sti)\.?$/;
function kisaAd(m) {
  if (m.kisaAd) return m.kisaAd;
  const u = String(m.unvan || '').replace(/\s+/g, ' ').trim();
  const f = TR_FOLD(u);
  const tur = /\b(limited|ltd)\b/.test(f) ? 'Ltd. Şti.' : /\b(anonim|a\.?\s?s)\b\.?/.test(f) ? 'A.Ş.' : /kollektif|koll\b/.test(f) ? 'Koll. Şti.'
    : /komandit|kom\.\s*sti/.test(f) ? 'Kom. Şti.' : /kooperatif/.test(f) ? 'Koop.' : '';
  if (!tur) return u; // şahıs ya da tanınmayan tür: olduğu gibi
  const words = [];
  for (const w of u.split(' ')) {
    if (STOP.test(TR_FOLD(w).replace(/[.,]/g, m => m === '.' ? '.' : ''))) break;
    words.push(w.replace(/[,]+$/, ''));
    if (words.length === 2) break;
  }
  if (!words.length) return u;
  const out = words.join(' ') + ' ' + tur;
  return u === u.toLocaleUpperCase('tr') ? out.toLocaleUpperCase('tr') : out;
}
const isStandalone = () => navigator.standalone || matchMedia('(display-mode: standalone)').matches;
function trackURL(blob) { const u = URL.createObjectURL(blob); S.urls.add(u); return u; }

const svg = d => `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const I = {
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  back: svg('<path d="M15 18l-6-6 6-6"/>'),
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>'),
  lock: svg('<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'),
  phone: svg('<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/>'),
  mail: svg('<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 6l-10 7L2 6"/>'),
  edit: svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'),
  cal: svg('<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>'),
  doc: svg('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>'),
  play: svg('<path d="M7 4l13 8-13 8z"/>'),
  clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  chev: '<svg class="chev" viewBox="0 0 8 14" width="8" height="14" aria-hidden="true"><path d="M1 1l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  backChev: '<svg viewBox="0 0 12 20" width="12" height="20" aria-hidden="true"><path d="M10 2 2 10l8 8" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  folderFill: '<svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor" aria-hidden="true"><path d="M3 6.5A2.5 2.5 0 0 1 5.5 4h4l2 2.2h7A2.5 2.5 0 0 1 21 8.7v9.8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 18.5z"/></svg>',
  clockFill: '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="currentColor"/><path d="M12 6.5V12l3.5 2.2" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/></svg>',
  gearFill: '<svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor" aria-hidden="true"><path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zm8.2 4.6.1-1.1-.1-1.1 2-1.6-2-3.4-2.4 1a8 8 0 0 0-1.9-1.1L15.5 3h-4l-.4 2.7a8 8 0 0 0-1.9 1.1l-2.4-1-2 3.4 2 1.6-.1 1.2.1 1.1-2 1.6 2 3.4 2.4-1c.6.5 1.2.8 1.9 1.1l.4 2.8h4l.4-2.7c.7-.3 1.3-.7 1.9-1.1l2.4 1 2-3.4z"/></svg>',
  search: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
};
const AV_COLORS = ['#ff9500', '#34c759', '#5ac8fa', '#af52de', '#ff2d55', '#5856d6', '#ffcc00', '#007aff', '#30b0c7', '#a2845e'];
const initials = s => String(s || '?').split(/\s+/).filter(w => /^[A-Za-zÇĞİÖŞÜçğıöşü]/.test(w)).slice(0, 2).map(w => w[0].toLocaleUpperCase('tr')).join('') || '?';
const avIndex = s => [...String(s || '')].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % AV_COLORS.length;
const avatar = s => `<span class="avatar av${avIndex(s)}">${esc(initials(s))}</span>`;

const TURLER = [['telefon', '📞 Telefon'], ['yuzyuze', '🤝 Yüz yüze'], ['yazi', '📄 Resmi yazı'], ['eposta', '✉️ E-posta'], ['diger', '📝 Diğer / not']];
const TUR_LABEL = Object.fromEntries(TURLER);
const INC_TUR = { tam: 'Tam inceleme', sinirli: 'Sınırlı inceleme' };
const BELGE_TUR = ['İş emri', 'Beyanname', 'Yoklama fişi', 'Tutanak', 'Yazışma / tebligat', 'Defter / kayıt', 'Fatura / banka', 'Diğer'];
const ROLLER = ['Mükellef', 'Şirket yetkilisi', 'SMMM / muhasebeci', 'Avukat / vekil', 'Çalışan', 'Diğer'];
const GOREV_SABLON = ['Defter ve belge ibraz süresi', 'Ek süre sonu', 'Bilgi isteme yazısı cevap süresi', 'Karşıt inceleme sonucu', 'Tutanak düzenlenecek', 'Rapor teslimi'];

/* ---------- veri ---------- */
const all = kind => [...S.items.values()].filter(i => i.kind === kind);
const byM = (kind, mid) => all(kind).filter(i => i.mid === mid);
const isAktif = m => (m.durum || 'aktif') === 'aktif';
const lastContact = mid => byM('kayit', mid).reduce((a, k) => (k.tarih > a ? k.tarih : a), '');

// S.cloud = { uid, email, cursor, lastSync } → bulut eşitlemesi açık
const cloudOn = () => !!S.cloud;
async function save(item) {
  item.updated = Date.now();
  item.created ??= item.updated;
  const { iv, data } = await cr.encJSON(S.key, item);
  await db.put('items', { id: item.id, kind: item.kind, iv, data, updated: item.updated, ...(cloudOn() ? { dirty: 1 } : {}) });
  S.items.set(item.id, item);
  scheduleSync();
}
async function removeItems(ids, fileIds = []) {
  if (cloudOn()) {
    // Silinenler diğer cihazlara da bildirilsin diye işaretlenir
    const now = Date.now();
    await db.putMany('items', ids.map(id => ({ id, kind: S.items.get(id)?.kind || '', deleted: 1, updated: now, dirty: 1 })));
    await db.putMany('files', fileIds.filter(Boolean).map(id => ({ id, deleted: 1, dirty: 1 })));
  } else {
    await db.delMany('items', ids);
    await db.delMany('files', fileIds);
  }
  ids.forEach(id => S.items.delete(id));
  scheduleSync();
}
async function saveFile(id, buf) {
  const { iv, data } = await cr.encBytes(S.key, buf);
  await db.put('files', { id, iv, data, ...(cloudOn() ? { dirty: 1 } : {}) });
  scheduleSync();
}
async function loadFile(id, mime) {
  let r = await db.get('files', id);
  // Başka cihazda eklenen dosya bu cihazda yoksa buluttan indir
  if ((!r || r.deleted) && cloudOn() && navigator.onLine) {
    try {
      const c = await cloud.pullFile(id);
      if (c) { r = { id, iv: c.iv, data: c.data }; await db.put('files', r); }
    } catch (e) { console.warn('dosya indirilemedi', e); }
  }
  if (!r || r.deleted) return null;
  return new Blob([await cr.decBytes(S.key, r.iv, r.data)], { type: mime });
}
async function loadItems() {
  S.items.clear();
  for (const r of await db.getAll('items')) {
    if (r.deleted) continue;
    try { S.items.set(r.id, await cr.decJSON(S.key, r.iv, r.data)); } catch (e) { console.error('Çözülemedi', r.id, e); }
  }
}

/* ---------- bulut eşitleme ---------- */
let syncTimer = null, syncing = null;
function scheduleSync(ms = 1500) {
  if (!cloudOn()) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => sync(), ms);
}
async function sync({ quiet = true } = {}) {
  if (!cloudOn() || !S.key) return;
  if (!navigator.onLine) { S.syncError = 'çevrimdışı'; return; }
  if (syncing) return syncing;
  syncing = (async () => {
    try {
      await cloud.init();
      const u = cloud.currentUser();
      if (!u || u.uid !== S.cloud.uid) throw new Error('oturum yok');
      // 1) Bu cihazdaki değişiklikleri gönder
      const dirty = (await db.getAll('items')).filter(r => r.dirty);
      if (dirty.length) {
        await cloud.pushItems(dirty);
        for (const r of dirty) {
          const cur = await db.get('items', r.id);
          if (!cur || cur.updated !== r.updated) continue;
          if (cur.deleted) await db.delMany('items', [r.id]);
          else { delete cur.dirty; await db.put('items', cur); }
        }
      }
      for (const f of (await db.getAll('files')).filter(f => f.dirty)) {
        if (f.deleted) { await cloud.deleteFile(f.id); await db.delMany('files', [f.id]); }
        else { await cloud.pushFile(f.id, f.iv, f.data); delete f.dirty; await db.put('files', f); }
      }
      // 2) Diğer cihazlardaki değişiklikleri al
      const { recs, cursor } = await cloud.pullItems(S.cloud.cursor);
      let changed = false;
      for (const r of recs) {
        const cur = await db.get('items', r.id);
        if (cur && cur.updated >= r.updated) continue; // bu cihazdaki aynı ya da daha yeni
        if (r.deleted) {
          if (cur) { await db.delMany('items', [r.id]); S.items.delete(r.id); changed = true; }
          continue;
        }
        await db.put('items', { id: r.id, kind: r.kind, iv: r.iv, data: r.data, updated: r.updated });
        try { S.items.set(r.id, await cr.decJSON(S.key, r.iv, r.data)); changed = true; } catch (e) { console.error('Çözülemedi', r.id, e); }
      }
      S.cloud.cursor = Math.max(S.cloud.cursor || 0, cursor);
      S.cloud.lastSync = Date.now();
      await db.metaSet('cloud', S.cloud);
      S.syncError = null;
      if (changed && S.key && !$('#sheet').classList.contains('open')) render();
    } catch (e) {
      console.error('eşitleme', e);
      S.syncError = e.code || e.message;
      if (!quiet) toast('Eşitleme hatası: ' + S.syncError);
    } finally {
      syncing = null;
    }
  })();
  return syncing;
}
setInterval(() => sync(), 60000);
addEventListener('online', () => sync());
const pendingCount = async () => (await db.getAll('items')).filter(r => r.dirty).length;

/* ---------- arayüz parçaları ---------- */
// iOS gezinme çubuğu: küçük başlık kaydırınca görünür, büyük başlık içerikte
const header = (title, { back, backLabel = 'Geri', left = '', right = '', large = true } = {}) =>
  `<header class="nav${large ? '' : ' compact'}"><div class="nav-bar">
     <div class="nav-l">${back ? `<a class="nav-back" href="${back}">${I.backChev}<span>${esc(backLabel)}</span></a>` : left}</div>
     <div class="nav-title">${esc(title)}</div>
     <div class="nav-r">${right}</div></div></header>
   ${large ? `<h1 class="large-title">${esc(title)}</h1>` : ''}`;
const tabbar = on => `<nav class="tabbar">${[['dosyalar', '#/', I.folderFill, 'Dosyalar'], ['sureler', '#/sureler', I.clockFill, 'Süreler'], ['ayarlar', '#/ayarlar', I.gearFill, 'Ayarlar']]
  .map(([k, h, ic, l]) => `<a href="${h}" class="${k === on ? 'on' : ''}">${ic}<span>${l}</span></a>`).join('')}</nav>`;
addEventListener('scroll', () => document.body.classList.toggle('scrolled', scrollY > 36), { passive: true });
const attr = (k, v) => (v ? ` ${k}="${esc(v)}"` : '');
const field = (label, name, value = '', o = {}) =>
  `<label class="fld"><span>${esc(label)}</span><input name="${name}" type="${o.type || 'text'}" value="${esc(value)}"${o.required ? ' required' : ''}${attr('placeholder', o.placeholder)}${attr('inputmode', o.inputmode)}${attr('autocomplete', o.autocomplete)}${o.extra ? ' ' + o.extra : ''}></label>`;
const textarea = (label, name, value = '', rows = 3, o = {}) =>
  `<label class="fld"><span>${esc(label)}</span><textarea name="${name}" rows="${rows}"${attr('placeholder', o.placeholder)}>${esc(value)}</textarea></label>`;
const select = (label, name, value, opts) =>
  `<label class="fld"><span>${esc(label)}</span><select name="${name}">${opts.map(([v, l]) => `<option value="${esc(v)}"${v === value ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
const userField = '<input class="vh" type="text" name="username" value="El Defteri" autocomplete="username" tabindex="-1" aria-hidden="true">';

function toast(msg, act) {
  const t = $('#toast');
  t.innerHTML = `<span>${esc(msg)}</span>${act ? `<button class="btn sm primary">${esc(act.label)}</button>` : ''}`;
  t.classList.add('show');
  const hide = () => t.classList.remove('show');
  if (act) t.querySelector('button').onclick = () => { hide(); act.fn(); };
  clearTimeout(t._h);
  t._h = setTimeout(hide, act ? 12000 : 3000);
}

function openSheet(title, body, { onSubmit, submitLabel = 'Kaydet', wide } = {}) {
  closeSheet();
  const root = $('#sheet');
  root.innerHTML = `<div class="sheet-bg" data-act="closeSheet"></div>
    <form class="sheet${wide ? ' wide' : ''}" autocomplete="off">
      <div class="sheet-head">
        <button type="button" class="btn link" data-act="closeSheet">${onSubmit ? 'Vazgeç' : 'Kapat'}</button>
        <h2>${esc(title)}</h2>
        ${onSubmit ? `<button class="btn link strong" type="submit">${esc(submitLabel)}</button>` : '<span class="spacer"></span>'}
      </div>
      <div class="sheet-body">${body}</div>
    </form>`;
  root.classList.add('open');
  document.body.classList.add('noscroll');
  const form = root.querySelector('form');
  form.onsubmit = async e => {
    e.preventDefault();
    if (!onSubmit || form.dataset.busy) return;
    form.dataset.busy = '1';
    const btn = form.querySelector('[type=submit]');
    btn.disabled = true;
    try {
      const r = await onSubmit(form, new FormData(form));
      if (r !== false) { closeSheet(); render(); }
    } catch (err) {
      console.error(err);
      toast('Hata: ' + (err.message || err));
    } finally {
      delete form.dataset.busy;
      btn.disabled = false;
    }
  };
  return form;
}
function closeSheet() {
  sheetCleanup?.();
  sheetCleanup = null;
  const root = $('#sheet');
  root.classList.remove('open');
  root.innerHTML = '';
  document.body.classList.remove('noscroll');
  S.viewerFile = null;
}

/* ---------- yönlendirme ---------- */
function render() {
  if (!S.key) return renderLock();
  const p = (location.hash.slice(1) || '/').split('/').filter(Boolean);
  if (p[0] === 'm' && S.items.get(p[1])) return renderDetail(p[1], p[2] || 'ozet');
  if (p[0] === 'ayarlar') return renderSettings();
  if (p[0] === 'sureler') return renderSureler();
  renderHome();
}
window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); document.body.classList.remove('scrolled'); });

/* ---------- giriş ve kilit ---------- */
const G_LOGO = '<svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>';
const sameVault = (a, b) => a && b && cr.b64(a.wrapped) === cr.b64(b.wrapped) && cr.b64(a.salt) === cr.b64(b.salt);
function lockShell(inner, { footer = true } = {}) {
  const u = cloud.currentUser();
  app.innerHTML = `<div class="lock">
    <img src="icons/el-defteri-192.png" class="lock-icon" alt="">
    <h1>El Defteri</h1>
    ${inner}
    ${footer && u ? `<p class="footnote center lock-foot">${esc(u.email)} · <button class="btn link sm" data-act="signout">Çıkış yap</button></p>` : ''}
  </div>`;
}
let lockSeq = 0;
async function renderLock() {
  const seq = ++lockSeq;
  lockShell('<p class="muted">Yükleniyor…</p>', { footer: false });
  let ok = true;
  try { await cloud.init(); } catch (e) { console.error(e); ok = false; }
  if (seq !== lockSeq || S.key) return;
  // Bağlantı yoksa ve bu cihaz daha önce hazırlandıysa çevrimdışı açılabilir
  if (!ok) return S.vault && S.cloud ? lockPassword('local') : lockShell('<p class="banner warn">İnternet bağlantısı gerekiyor. Bağlanınca yeniden dene.</p><button class="btn primary block lg" data-act="relock">Yeniden dene</button>', { footer: false });
  const u = cloud.currentUser();
  if (!u) return lockGoogle();
  if (S.vault && S.cloud?.uid === u.uid) return lockPassword('local');
  lockShell('<p class="muted">Hesap kontrol ediliyor…</p>');
  let cv;
  try { cv = await cloud.getVault(); } catch (e) {
    if (seq !== lockSeq) return;
    if (e.code === 'permission-denied') {
      return lockShell(`<p class="banner warn"><b>${esc(u.email)}</b> için erişim izni yok. Yöneticiden (${esc(cloud.ADMIN)}) seni üye olarak eklemesini iste.</p>
        <button class="btn block lg" data-act="signout">Başka hesapla giriş yap</button>`, { footer: false });
    }
    return lockShell(`<p class="banner warn">Bağlantı hatası: ${esc(e.code || e.message)}</p><button class="btn primary block lg" data-act="relock">Yeniden dene</button>`);
  }
  if (seq !== lockSeq) return;
  if (cv) return lockPassword('cloud', cv);
  if (S.vault && !S.cloud) return lockPassword('migrate');
  return lockPassword('new');
}
function lockGoogle() {
  const emu = ['localhost', '127.0.0.1'].includes(location.hostname) && location.search.includes('emu');
  lockShell(`<p class="muted">Devam etmek için Google hesabınla giriş yap. Yalnızca izin verilen Gmail adresleri girebilir.</p>
    <div class="lock-form">
      <button class="btn google block lg" id="gBtn">${G_LOGO}<span>Google ile giriş yap</span></button>
      ${emu ? '<input class="lock-input test" id="testEmail" placeholder="test e-posta"><button class="btn block" id="testBtn">Test girişi</button>' : ''}
      <p class="err" id="lockErr" role="alert"></p>
    </div>
    ${S.vault && !S.cloud ? '<p class="banner">Bu cihazda kayıtlı verilerin var. Giriş yaptıktan sonra buluta taşınacak.</p>' : ''}
    <p class="footnote center">Veriler cihazında şifrelenir; buluta yalnızca şifreli hâli gider.</p>
    ${S.vault && !S.cloud ? '' : '<button class="btn link" data-act="importBackup">Yedekten geri yükle</button>'}`, { footer: false });
  const err = $('#lockErr');
  const go = async fn => {
    err.textContent = '';
    try { const u = await fn(); if (u) renderLock(); }
    catch (e) {
      if (e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request') return;
      console.error(e);
      err.textContent = 'Giriş yapılamadı: ' + (e.code || e.message);
    }
  };
  $('#gBtn').onclick = () => go(() => cloud.signIn());
  if (emu) $('#testBtn').onclick = () => go(() => cloud.signInTest($('#testEmail').value.trim()));
}
// mode: local (bu cihazda hazır) · cloud (buluttaki kasa) · migrate (yerel veriyi buluta taşı) · new (ilk kurulum)
function lockPassword(mode, cloudVault) {
  const yeni = mode === 'new';
  const msg = {
    local: 'Devam etmek için şifreni gir.',
    cloud: 'Bulut verilerini açmak için şifreni gir (ilk cihazda belirlediğin şifre).',
    migrate: 'Bu cihazdaki kayıtlar buluta yüklenecek. Mevcut şifreni gir.',
    new: 'Uygulama şifreni belirle. Verilerin bu şifreyle şifrelenir; yeni bir cihazda girerken de istenir.',
  }[mode];
  lockShell(`<p class="muted">${msg}</p>
    <form id="lockForm" class="lock-form">
      ${userField}
      <div class="list">
        <input class="lock-input" type="password" name="p1" inputmode="${S.settings.pwKlavye || 'numeric'}" autocomplete="${yeni ? 'new-password' : 'current-password'}" placeholder="${yeni ? 'Yeni şifre (en az 6 hane)' : 'Şifre'}" required minlength="${yeni ? 6 : 1}" aria-label="Şifre">
        ${yeni ? `<input class="lock-input" type="password" name="p2" inputmode="${S.settings.pwKlavye || 'numeric'}" autocomplete="new-password" placeholder="Şifre (tekrar)" required minlength="6" aria-label="Şifre tekrar">` : ''}
      </div>
      <button class="btn primary block lg" type="submit">${yeni ? 'Başla' : 'Aç'}</button>
      <p class="err" id="lockErr" role="alert"></p>
      ${yeni ? '<p class="hint center">Şifreyi unutursan veriler kurtarılamaz.</p>' : ''}
      <button type="button" class="btn link sm" id="kbBtn">${(S.settings.pwKlavye || 'numeric') === 'numeric' ? 'ABC klavye' : '123 klavye'}</button>
      ${mode === 'migrate' ? '<button type="button" class="btn link sm" id="freshBtn">Şifremi hatırlamıyorum, sıfırdan başla</button>' : ''}
    </form>`);
  // Rakam / harf klavyesi arasında geçiş (tercih hatırlanır)
  $('#kbBtn').addEventListener('click', () => {
    const yeniMod = (S.settings.pwKlavye || 'numeric') === 'numeric' ? 'text' : 'numeric';
    S.settings.pwKlavye = yeniMod; db.metaSet('settings', S.settings);
    for (const inp of $('#lockForm').querySelectorAll('input[type=password]')) inp.setAttribute('inputmode', yeniMod);
    $('#kbBtn').textContent = yeniMod === 'numeric' ? 'ABC klavye' : '123 klavye';
    const f = $('#lockForm').p1; f.blur(); setTimeout(() => f.focus(), 50);
  });
  $('#freshBtn')?.addEventListener('click', async () => {
    if (!confirm('Bu cihazdaki eski kayıtlar silinecek ve yeni, boş bir defterle başlayacaksın. Devam edilsin mi?')) return;
    await db.clearData();
    S.vault = null; S.cloud = null;
    renderLock();
  });
  const form = $('#lockForm');
  const err = $('#lockErr');
  if (!/iPhone|iPad|Android/.test(navigator.userAgent)) form.p1.focus();
  form.onsubmit = async e => {
    e.preventDefault();
    const btn = form.querySelector('[type=submit]');
    const label = btn.textContent;
    const pw = form.p1.value;
    err.textContent = '';
    if (yeni && pw !== form.p2.value) { err.textContent = 'Şifreler aynı değil.'; return; }
    btn.disabled = true; btn.textContent = 'Açılıyor…';
    try {
      const u = cloud.currentUser();
      if (mode === 'local') {
        const key = await cr.openVault(pw, S.vault);
        if (!key) { err.textContent = 'Şifre yanlış.'; form.p1.value = ''; return; }
        S.key = key;
        await loadItems();
      } else if (mode === 'cloud') {
        const key = await cr.openVault(pw, cloudVault);
        if (!key) { err.textContent = 'Şifre yanlış.'; form.p1.value = ''; return; }
        // Bu cihazda başka şifreyle oluşturulmuş eski kayıtlar varsa: aynı şifre açıyorsa taşı, açmıyorsa izin iste
        let eski = null;
        if (S.vault && !sameVault(S.vault, cloudVault)) {
          const lk = await cr.openVault(pw, S.vault);
          if (lk) eski = { key: lk, items: await db.getAll('items'), files: await db.getAll('files') };
          else if (!confirm('Bu cihazda farklı bir şifreyle kaydedilmiş eski veriler var ve buluta aktarılamıyor. Silinip bulut verileri yüklensin mi? (Gerekirse önce vazgeçip eski şifreyle yedek al.)')) return;
        }
        await db.clearData();
        await db.metaSet('vault', cloudVault);
        S.vault = cloudVault; S.key = key;
        S.cloud = { uid: u.uid, email: u.email, cursor: null };
        await db.metaSet('cloud', S.cloud);
        if (eski) {
          for (const r of eski.items) { if (r.deleted) continue; try { await save(await cr.decJSON(eski.key, r.iv, r.data)); } catch {} }
          for (const f of eski.files) { if (f.deleted) continue; try { await saveFile(f.id, await cr.decBytes(eski.key, f.iv, f.data)); } catch {} }
        }
        btn.textContent = 'Veriler indiriliyor…';
        await sync({ quiet: false });
      } else if (mode === 'migrate') {
        const key = await cr.openVault(pw, S.vault);
        if (!key) { err.textContent = 'Şifre yanlış.'; form.p1.value = ''; return; }
        await cloud.putVault(S.vault);
        S.key = key;
        S.cloud = { uid: u.uid, email: u.email, cursor: null };
        await db.metaSet('cloud', S.cloud);
        await db.putMany('items', (await db.getAll('items')).map(r => ({ ...r, updated: r.updated || Date.now(), dirty: 1 })));
        await db.putMany('files', (await db.getAll('files')).map(f => ({ ...f, dirty: 1 })));
        await loadItems();
        btn.textContent = 'Buluta yükleniyor…';
        await sync({ quiet: false });
      } else {
        const { vault, key } = await cr.createVault(pw);
        await cloud.putVault(vault);
        await db.metaSet('vault', vault);
        S.vault = vault; S.key = key;
        S.cloud = { uid: u.uid, email: u.email, cursor: null };
        await db.metaSet('cloud', S.cloud);
        navigator.storage?.persist?.();
      }
      S.lastActive = Date.now();
      document.activeElement?.blur?.();
      render();
      offerCallNote();
      if (mode === 'local') sync();
    } catch (ex) {
      console.error(ex);
      err.textContent = 'Hata: ' + (ex.code || ex.message);
    } finally {
      btn.disabled = false; btn.textContent = label;
    }
  };
}
function lock() {
  closeSheet();
  S.key = null;
  S.items.clear();
  S.backupFile = null;
  S.urls.forEach(u => URL.revokeObjectURL(u));
  S.urls.clear();
  render();
}
function checkIdle() {
  const ms = S.settings.autolock * 60000;
  if (S.key && !S.recording && Date.now() - S.lastActive > ms) lock();
}
['pointerdown', 'keydown', 'input', 'scroll'].forEach(ev => addEventListener(ev, () => { S.lastActive = Date.now(); }, { passive: true, capture: true }));
setInterval(checkIdle, 15000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  checkIdle();
  sync();
  offerCallNote();
});

/* ---------- ana sayfa ---------- */
function sureRow(href, title, sub, date) {
  const n = daysUntil(date);
  const tone = n < 0 ? 'red' : n <= 3 ? 'orange' : 'green';  // rozet renkleriyle aynı
  return `<a class="row" href="${href}"><span class="row-ico ${tone}">${I.clock}</span><div class="row-main"><div class="row-title">${esc(title)}</div><div class="row-sub">${esc(sub)}</div></div>${badge(date)}</a>`;
}
// Aktif dosyalardaki açık süreler ve inceleme bitiş süreleri
/* ---------- bilgi isteme yazıları ---------- */
// Son cevap günü: tebliğ + süre; hafta sonuna denk gelirse izleyen pazartesi (VUK 18). Resmî tatiller hesaba katılmaz.
function bilgiSonGun(b) {
  if (!b.tebligTarihi) return '';
  const d = parseD(addDays(b.tebligTarihi, +(b.sureGun || 15)));
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return ymd(d);
}
const bilgiMuhatap = (b, m) => b.muhatap === 'diger' ? (b.muhatapAd ? kisaAd({ unvan: b.muhatapAd }) : 'Başka mükellef') : (m ? kisaAd(m) : 'Mükellef');
function bilgiDurum(b) {
  if (b.cevapTarihi) return { cls: 'done', text: 'Cevaplandı' };
  if (!b.tebligTarihi) return { cls: 'wait', text: 'Tebliğ bekleniyor' };
  const n = daysUntil(bilgiSonGun(b));
  return { cls: n < 0 ? 'bad' : n <= 3 ? 'warn' : 'ok', text: relDays(n) };
}
function acikSureler() {
  const ms = all('mukellef').filter(isAktif);
  const ids = new Set(ms.map(m => m.id));
  return [
    ...ms.filter(m => m.bitisTarihi).map(m => ({ d: m.bitisTarihi, href: `#/m/${m.id}/sureler`, title: 'İnceleme bitiş süresi', sub: `${kisaAd(m)} · ${fmtD(m.bitisTarihi)}`, m })),
    ...all('gorev').filter(g => !g.bitti && ids.has(g.mid) && g.tarih).map(g => ({ d: g.tarih, href: `#/m/${g.mid}/sureler`, title: g.baslik, sub: `${S.items.get(g.mid) ? kisaAd(S.items.get(g.mid)) : ''} · ${fmtD(g.tarih)}`, g })),
    ...all('bilgi').filter(b => !b.cevapTarihi && b.tebligTarihi && ids.has(b.mid)).map(b => {
      const m = S.items.get(b.mid), d = bilgiSonGun(b);
      const title = b.muhatap === 'diger' ? `Bilgi isteme cevabı: ${b.muhatapAd || 'karşıt'}` : 'Bilgi isteme cevabı';
      return { d, href: `#/m/${b.mid}`, title, sub: `${m ? kisaAd(m) : ''} · ${fmtD(d)}`, mid: b.mid, b };
    }),
  ].sort((a, b) => a.d.localeCompare(b.d));
}
function sureBox(a) {
  const n = daysUntil(a.d);
  const tone = n < 0 ? 'red' : n <= 3 ? 'orange' : 'green';
  const mm = a.m || S.items.get(a.g?.mid || a.mid);
  const unvan = mm ? kisaAd(mm) : '';
  return `<a class="sbox ${tone}" href="${a.href}">
    <span class="sbox-badge">${relDays(n)}</span>
    <b>${esc(a.title)}</b>
    <span>${esc(unvan)}</span>
    <small>${fmtD(a.d)}</small>
  </a>`;
}
function renderHome() {
  const alerts = acikSureler().filter(a => daysUntil(a.d) <= (a.g ? 7 : 30));
  const banners = [];
  if (!isStandalone()) banners.push(`<div class="banner warn"><b>Ana ekrana ekle:</b> Safari'de <b>Paylaş → Ana Ekrana Ekle</b> ile yükleyip uygulamayı oradan aç.</div>`);
  if (S.items.size && !cloudOn() && (!S.lastBackup || Date.now() - S.lastBackup > 14 * 864e5)) {
    banners.push(`<a class="banner" href="#/ayarlar"><b>Yedek al:</b> ${S.lastBackup ? 'Son yedek ' + fmtTs(S.lastBackup) + '.' : 'Henüz yedek almadın.'}</a>`);
  }
  const seg = (v, l) => `<button class="${S.filter === v ? 'on' : ''}" data-act="filter" data-v="${v}">${l}</button>`;
  app.innerHTML = header('Dosyalar', { left: `<button class="nav-btn" data-act="lock">Kilitle</button>`, right: `<button class="nav-btn icon" data-act="newM" aria-label="Yeni dosya">${I.plus}</button>` }) +
    `<div class="page">
      <label class="search">${I.search}<input id="q" type="search" placeholder="Unvan veya VKN ara" value="${esc(S.q)}"></label>
      <div class="sec-row"><h2 class="sec">${S.filter === 'aktif' ? 'Aktif dosyalar' : 'Kapanan dosyalar'}</h2><div class="seg sm">${seg('aktif', 'Aktif')}${seg('kapandi', 'Kapanan')}</div></div>
      <div id="mlist"></div>
      ${alerts.length ? `<h2 class="sec">Yaklaşan süreler</h2><div class="box-grid">${alerts.map(sureBox).join('')}</div>` : ''}
      ${banners.join('')}
    </div>
    <button class="fab" data-act="newM" aria-label="Yeni dosya">${I.plus}</button>${tabbar('dosyalar')}`;
  $('#q').oninput = e => { S.q = e.target.value; drawMList(); };
  drawMList();
}
function drawMList() {
  const q = S.q.trim().toLocaleLowerCase('tr');
  const list = all('mukellef')
    .filter(m => (m.durum || 'aktif') === S.filter)
    .filter(m => !q || [m.unvan, m.kod, m.vkn, m.tckn].some(x => (x || '').toLocaleLowerCase('tr').includes(q)))
    .sort((a, b) => coll.compare(a.unvan, b.unvan));
  $('#mlist').innerHTML = list.length ? `<div class="box-grid">${list.map(m => {
    const lc = lastContact(m.id);
    const og = byM('gorev', m.id).filter(g => !g.bitti).length;
    const tur = m.incelemeTuru === 'sinirli' ? 'Sınırlı' : m.incelemeTuru === 'tam' ? 'Tam' : '';
    return `<a class="dbox" href="#/m/${m.id}">
      <b>${esc(kisaAd(m))}</b>
      <dl>
        <dt>${m.vkn || !m.tckn ? 'VKN' : 'TCKN'}</dt><dd>${esc(m.vkn || m.tckn || '—')}</dd>
        <dt>Yıl</dt><dd>${esc([m.donem, tur].filter(Boolean).join(' · ') || '—')}</dd>
      </dl>
      <small>${lc ? 'Son temas: ' + relPast(lc) : 'Görüşme yok'}${og ? ` · ${og} süre` : ''}</small>
    </a>`;
  }).join('')}</div>`
    : `<div class="list"><p class="empty">${q ? 'Eşleşen dosya yok.' : S.filter === 'aktif' ? 'Henüz dosya yok. <b>+</b> ile yeni dosya aç.' : 'Kapanan dosya yok.'}</p></div>`;
}

/* ---------- tüm süreler ---------- */
function renderSureler() {
  const list = acikSureler();
  const groups = [['Süresi geçenler', a => daysUntil(a.d) < 0], ['Bu hafta', a => daysUntil(a.d) >= 0 && daysUntil(a.d) <= 7], ['Bu ay', a => daysUntil(a.d) > 7 && daysUntil(a.d) <= 31], ['Daha sonra', a => daysUntil(a.d) > 31]];
  app.innerHTML = header('Süreler') + `<div class="page">
    ${groups.map(([t, f]) => { const g = list.filter(f); return g.length ? `<h2 class="sec">${t}</h2><div class="list">${g.map(a => sureRow(a.href, a.title, a.sub, a.d)).join('')}</div>` : ''; }).join('')
      || '<p class="empty">Açık süre yok. Dosyalarda <b>Süreler</b> sekmesinden ibraz, ek süre, cevap süreleri gibi tarihleri ekleyebilirsin.</p>'}
    <p class="footnote">Aktif dosyalardaki açık görevler ve inceleme bitiş süreleri listelenir.</p>
  </div>${tabbar('sureler')}`;
}

/* ---------- mükellef dosyası ---------- */
function renderDetail(id) {
  const m = S.items.get(id);
  const box = (l, v, { full = false, raw = false, empty = false } = {}) => (v || empty)
    ? `<div class="ibox${full ? ' full' : ''}"><span>${esc(l)}</span><b>${v ? (raw ? v : esc(v)) : '—'}</b></div>` : '';
  const inc = [m.incelemeTuru === 'sinirli' ? 'Sınırlı' : m.incelemeTuru === 'tam' ? 'Tam' : '', m.vergiTuru].filter(Boolean).join(' · ');
  const kisiler = m.kisiler || [];
  app.innerHTML = header(kisaAd(m), { back: '#/', backLabel: 'Dosyalar', large: false, right: `<button class="nav-btn" data-act="editM" data-id="${id}">Düzenle</button>` }) +
    `<div class="page detail">
      <div class="info-grid">
        ${box('Adı / Unvanı', m.unvan, { full: true, empty: true })}
        ${box('VKN', m.vkn, { empty: true })}${box('İnceleme yılı', m.donem, { empty: true })}
        ${box('Vergi dairesi', m.vergiDairesi, { empty: true })}${box('İnceleme', inc, { empty: true })}
        ${m.bitisTarihi ? box('Bitiş süresi', `${esc(fmtD(m.bitisTarihi))} ${isAktif(m) ? badge(m.bitisTarihi) : ''}`, { raw: true, full: true }) : ''}
        ${isAktif(m) ? '' : box('Durum', 'Kapandı', { full: true })}
      </div>
      ${[m.tckn, m.isEmriNo, m.isEmriTarihi, m.baslamaTarihi, m.adres, m.faaliyet].some(Boolean) ? `<details class="more"><summary>Diğer bilgiler</summary><div class="info-grid">
        ${box('TCKN', m.tckn)}${box('Başlama', fmtD(m.baslamaTarihi))}
        ${box('İş emri', [m.isEmriNo, fmtD(m.isEmriTarihi)].filter(Boolean).join(' · '), { full: true })}
        ${box('Adres', m.adres, { full: true })}${box('Faaliyet', m.faaliyet, { full: true })}
      </div></details>` : ''}

      <div class="sec-row"><h2 class="sec">Telefonlar</h2><button class="btn link sm" data-act="kisi" data-mid="${id}">+ Ekle</button></div>
      ${kisiler.length ? `<div class="tel-grid">${kisiler.map(k => `<div class="tbox">
          <button class="tbox-main" data-act="kisi" data-mid="${id}" data-kid="${k.id}">
            <b>${esc(k.ad)}</b>${k.rol ? `<span>${esc(k.rol)}</span>` : ''}
            ${k.tel ? `<em>${esc(k.tel)}</em>` : k.eposta ? `<em class="mail">${esc(k.eposta)}</em>` : '<em class="none">numara yok</em>'}
          </button>
          ${k.tel ? `<a class="call" href="tel:${esc(telHref(k.tel))}" data-act="call" data-mid="${id}" data-kid="${k.id}" aria-label="${esc(k.ad)} ara">${I.phone}</a>`
            : k.eposta ? `<a class="call mail" href="mailto:${esc(k.eposta)}" aria-label="E-posta gönder">${I.mail}</a>` : ''}
        </div>`).join('')}</div>`
        : `<div class="list"><button class="row action" data-act="kisi" data-mid="${id}">Telefon / kişi ekle</button></div>`}

      ${bilgiHTML(m)}

      ${surelerHTML(m)}

      <h2 class="sec">Görüşme notları</h2>
      ${kayitlarHTML(m)}

      <div class="list end">
        <button class="row action" data-act="toggleDurum" data-id="${id}">${isAktif(m) ? 'Dosyayı kapat' : 'Dosyayı yeniden aç'}</button>
        <button class="row action danger-text" data-act="delM" data-id="${id}">Dosyayı sil</button>
      </div>
    </div>
    <button class="fab wide" data-act="newKayit" data-mid="${id}">${I.plus}<span>Görüşme notu</span></button>${tabbar('dosyalar')}`;
}

// Mükellef ile SMMM aynı e-postayı kullanabilir: yalnızca aynı kişi ya da aynı roldeki aynı iletişim birleşir
function mergeKisiler(list, found) {
  const kisiler = (list || []).map(k => ({ ...k }));
  for (const k of found) {
    const same = kisiler.find(x => fold(x.ad) === fold(k.ad) || (x.rol === k.rol && ((k.tel && telHref(x.tel) === telHref(k.tel)) || (k.eposta && x.eposta === k.eposta))));
    if (same && same.tel && k.tel && telHref(same.tel) !== telHref(k.tel)) {
      if (!kisiler.some(x => telHref(x.tel) === telHref(k.tel))) kisiler.push({ id: uid(), ad: k.ad, rol: k.rol, tel: k.tel, eposta: k.eposta || '' });
    } else if (same) { same.tel ||= k.tel || ''; same.eposta ||= k.eposta || ''; }
    else kisiler.push({ id: uid(), ad: k.ad || '', rol: k.rol || '', tel: k.tel || '', eposta: k.eposta || '' });
  }
  return kisiler;
}

/* ---------- hazır dosya paketi (Claude'un belgelerden hazırladığı .json) ---------- */
const M_FIELDS = ['unvan', 'kod', 'vkn', 'tckn', 'vergiDairesi', 'faaliyet', 'incelemeTuru', 'donem', 'vergiTuru', 'gerekce', 'isEmriNo', 'isEmriTarihi', 'baslamaTarihi', 'bitisTarihi', 'adres'];
async function importPaket(obj) {
  const p = obj.mukellef || {};
  const m = all('mukellef').find(x => (p.vkn && x.vkn === p.vkn) || (p.tckn && x.tckn === p.tckn));
  const item = m ? { ...m } : { id: uid(), kind: 'mukellef', durum: 'aktif', kisiler: [] };
  // Var olan dosyada dolu alanların üzerine yazılmaz; yalnızca boşlar doldurulur
  for (const k of M_FIELDS) if (p[k] && !item[k]) item[k] = String(p[k]).trim();
  if (p.not && !(item.not || '').includes(p.not.trim())) item.not = [item.not, p.not.trim()].filter(Boolean).join('\n\n');
  if (item.baslamaTarihi && !item.bitisTarihi) item.bitisTarihi = addMonths(item.baslamaTarihi, item.incelemeTuru === 'sinirli' ? 6 : 12);
  item.kisiler = mergeKisiler(item.kisiler, obj.kisiler || []);
  await save(item);
  const n = { gorev: 0, kayit: 0 };
  for (const g of obj.gorevler || []) {
    if (!g.baslik || !g.tarih || byM('gorev', item.id).some(x => x.baslik === g.baslik && x.tarih === g.tarih)) continue;
    await save({ id: uid(), kind: 'gorev', mid: item.id, baslik: g.baslik, tarih: g.tarih, not: g.not || '', bitti: false });
    n.gorev++;
  }
  for (const x of obj.bilgiIstemeleri || []) {
    if (byM('bilgi', item.id).some(y => y.sayi && y.sayi === x.sayi && y.muhatapAd === (x.muhatapAd || ''))) continue;
    await save({ id: uid(), kind: 'bilgi', mid: item.id, muhatap: x.muhatap === 'diger' ? 'diger' : 'mukellef', muhatapAd: x.muhatapAd || '', muhatapVkn: x.muhatapVkn || '',
      sayi: x.sayi || '', yaziTarihi: x.yaziTarihi || '', konu: x.konu || '', tebligTarihi: x.tebligTarihi || '', sureGun: +x.sureGun || 15, cevapTarihi: x.cevapTarihi || '', cevapNot: x.cevapNot || '' });
  }
  for (const k of obj.kayitlar || []) {
    if (byM('kayit', item.id).some(x => x.tarih === k.tarih && x.konu === (k.konu || ''))) continue;
    await save({ id: uid(), kind: 'kayit', mid: item.id, tarih: k.tarih || localDT(), tur: k.tur || 'diger', kisi: k.kisi || '', konu: k.konu || '', metin: k.metin || '', sesler: [] });
    n.kayit++;
  }
  return { item, yeni: !m, n };
}
async function paketFlow() {
  const file = await pickFile('application/json,.json');
  if (!file) return;
  let obj;
  try { obj = JSON.parse(await file.text()); if (obj.app !== 'el-defteri-paket') throw new Error(); } catch { return toast('Bu dosya bir El Defteri paketi değil'); }
  const p = obj.mukellef || {};
  const var_ = all('mukellef').find(x => (p.vkn && x.vkn === p.vkn) || (p.tckn && x.tckn === p.tckn));
  openSheet('Paketi içe aktar', `
    <div class="card">
      <div class="row-title">${esc(p.unvan || 'Adsız dosya')}</div>
      <div class="row-sub">${esc([p.vkn && 'VKN ' + p.vkn, p.tckn && 'TCKN ' + p.tckn, p.donem, INC_TUR[p.incelemeTuru]].filter(Boolean).join(' · '))}</div>
      <p class="muted">${(obj.kisiler || []).length} kişi · ${(obj.kayitlar || []).length} not · ${(obj.gorevler || []).length} süre</p>
    </div>
    ${var_ ? `<p class="banner">Bu mükellefin dosyası zaten var: <b>${esc(var_.unvan)}</b>. Boş alanlar doldurulacak, yeni kişi ve notlar eklenecek; mevcut bilgilerin üzerine yazılmayacak.</p>` : ''}
    <p class="hint">Aktarımdan sonra paket dosyasını Dosyalar uygulamasından silebilirsin; bilgiler uygulamada şifreli saklanır.</p>`,
  { submitLabel: 'Aktar', onSubmit: async () => {
    const r = await importPaket(obj);
    location.hash = `#/m/${r.item.id}`;
    toast(`${r.yeni ? 'Dosya oluşturuldu' : 'Dosya güncellendi'} · ${r.n.kayit} not eklendi`);
  } });
}

function mukellefSheet(m = null) {
  const v = m || { incelemeTuru: 'tam' };
  const foundKisi = []; // belgeden bulunan kişiler (kaydederken eklenir)
  const form = openSheet(m ? 'Dosyayı düzenle' : 'Yeni dosya', `
    <div class="autofill">
      <button type="button" class="btn primary block" data-autofill>${I.doc} Belgeden doldur</button>
      ${m ? '' : '<button type="button" class="btn block" data-act="paket">📦 Hazır paketi içe aktar</button>'}
      <p class="hint">İş emri, beyanname, yoklama fişi ya da ekran görüntüsü seç. Bilgiler telefonun içinde okunur; belge saklanmaz, hiçbir yere gönderilmez.</p>
      <div class="af-status" aria-live="polite"></div>
    </div>
    ${field('Adı / Unvanı', 'unvan', v.unvan, { required: true })}
    ${field('Kısa ad (isteğe bağlı)', 'kisaAd', v.kisaAd, { placeholder: 'Boş bırakırsan otomatik kısaltılır' })}
    <p class="hint" id="kisaOnizle"></p>
    <div class="row2">${field('VKN', 'vkn', v.vkn, { inputmode: 'numeric' })}${field('TCKN', 'tckn', v.tckn, { inputmode: 'numeric' })}</div>
    <div class="row2">${field('İnceleme yılı', 'donem', v.donem, { placeholder: 'ör. 2024' })}${field('Vergi dairesi', 'vergiDairesi', v.vergiDairesi)}</div>
    <div class="row2">${select('İnceleme türü', 'incelemeTuru', v.incelemeTuru, Object.entries(INC_TUR))}${field('Vergi türü', 'vergiTuru', v.vergiTuru, { placeholder: 'ör. KDV' })}</div>
    <div class="row2">${field('İş emri sayısı', 'isEmriNo', v.isEmriNo)}${field('İş emri tarihi', 'isEmriTarihi', v.isEmriTarihi, { type: 'date' })}</div>
    <div class="row2">${field('İncelemeye başlama', 'baslamaTarihi', v.baslamaTarihi, { type: 'date' })}${field('Bitiş süresi', 'bitisTarihi', v.bitisTarihi, { type: 'date' })}</div>
    <p class="hint">Bitiş süresi başlama tarihine göre önerilir (VUK 140: tam 12 ay, sınırlı 6 ay; ek süre hariç). Kontrol et.</p>
    ${textarea('Adres', 'adres', v.adres, 2)}
    ${field('Faaliyet', 'faaliyet', v.faaliyet)}
    ${m ? '' : '<p class="hint">Telefonları dosyayı kaydettikten sonra “Telefonlar → + Ekle” ile eklersin.</p>'}`,
  { onSubmit: async (f, fd) => {
    const item = m ? { ...m } : { id: uid(), kind: 'mukellef', durum: 'aktif', kisiler: [] };
    for (const k of ['unvan', 'kisaAd', 'vkn', 'tckn', 'donem', 'vergiDairesi', 'incelemeTuru', 'vergiTuru', 'isEmriNo', 'isEmriTarihi', 'baslamaTarihi', 'bitisTarihi', 'adres', 'faaliyet']) item[k] = String(fd.get(k) ?? '').trim();
    if (foundKisi.length) item.kisiler = mergeKisiler(item.kisiler, foundKisi);
    await save(item);
    if (foundKisi.length) toast(`${foundKisi.length} kişi / telefon eklendi`);
    if (!m) location.hash = `#/m/${item.id}`;
  } });
  const e = form.elements;
  // Belgeden doldur: seçilen belgeler okunur, boş alanlar doldurulur (belgeler saklanmaz)
  const status = form.querySelector('.af-status');
  const LABELS = { unvan: 'Unvan', vkn: 'VKN', tckn: 'TCKN', vergiDairesi: 'Vergi dairesi', faaliyet: 'Faaliyet', incelemeTuru: 'İnceleme türü', donem: 'İnceleme yılı', vergiTuru: 'Vergi türü', isEmriNo: 'İş emri sayısı', isEmriTarihi: 'İş emri tarihi', adres: 'Adres' };
  form.querySelector('[data-autofill]').onclick = async ev => {
    const btn = ev.currentTarget;
    const files = await pickFiles('application/pdf,image/*');
    if (!files.length) return;
    btn.disabled = true;
    const filled = new Set();
    try {
      const results = [];
      for (const file of files) {
        status.textContent = `${file.name}: okunuyor…`;
        let text = '';
        try { text = await extractText(file, msg => { status.textContent = `${file.name}: ${msg}`; }); } catch (err) { console.error(err); }
        results.push(parse(text));
      }
      results.sort((a, b) => (b.tur === 'İş emri') - (a.tur === 'İş emri')); // iş emri öncelikli
      for (const r of results) {
        for (const [k, val] of Object.entries(r.fields)) {
          const el = e[k];
          if (!el || filled.has(k) || (el.value && !el.dataset.af && !(k === 'incelemeTuru' && !m))) continue;
          el.value = val; el.dataset.af = '1'; el.classList.add('filled'); filled.add(k);
          el.addEventListener('input', () => el.classList.remove('filled'), { once: true });
        }
        // Aynı kişinin farklı numarası da alınır; yalnızca aynı numara tekrar edilmez
        for (const k of r.kisiler) if (!foundKisi.some(x => fold(x.ad) === fold(k.ad) && telHref(x.tel || '') === telHref(k.tel || ''))) foundKisi.push(k);
      }
      auto(); onizle();
      const kisiTxt = foundKisi.map(k => `${k.ad} (${k.rol}${k.tel ? ', ' + k.tel : ''})`).join('; ');
      status.innerHTML = filled.size || foundKisi.length
        ? `<b>Bulunanlar:</b> ${esc([...filled].map(k => LABELS[k]).join(', ') || '—')}${kisiTxt ? `<br><b>Telefonlar:</b> ${esc(kisiTxt)}` : ''}<br><span class="muted">Sarı alanları belgeyle karşılaştırıp kontrol et. Telefonlar kaydedince eklenecek.</span>`
        : 'Belgeden bilgi okunamadı; alanları elle doldurabilirsin.';
    } finally {
      btn.disabled = false;
    }
  };
  const onizle = () => { const k = kisaAd({ unvan: e.unvan.value, kisaAd: e.kisaAd.value.trim() }); $('#kisaOnizle').textContent = k && k !== e.unvan.value.trim() ? 'Listede görünecek: ' + k : ''; };
  e.unvan.addEventListener('input', onizle); e.kisaAd.addEventListener('input', onizle); onizle();
  const auto = () => {
    if (!e.baslamaTarihi.value || (e.bitisTarihi.value && !e.bitisTarihi.dataset.auto)) return;
    e.bitisTarihi.value = addMonths(e.baslamaTarihi.value, e.incelemeTuru.value === 'sinirli' ? 6 : 12);
    e.bitisTarihi.dataset.auto = '1';
  };
  e.baslamaTarihi.addEventListener('change', auto);
  e.incelemeTuru.addEventListener('change', auto);
  e.bitisTarihi.addEventListener('input', () => delete e.bitisTarihi.dataset.auto);
}

function kisiSheet(mid, kid) {
  const m = S.items.get(mid);
  const k = (m.kisiler || []).find(x => x.id === kid) || {};
  openSheet(kid ? 'Kişiyi düzenle' : 'Kişi ekle', `
    ${field('Ad Soyad', 'ad', k.ad, { required: true })}
    ${field('Görevi / sıfatı', 'rol', k.rol, { extra: 'list="rolList"' })}
    <datalist id="rolList">${ROLLER.map(r => `<option value="${esc(r)}">`).join('')}</datalist>
    ${field('Telefon', 'tel', k.tel, { type: 'tel' })}
    ${field('E-posta', 'eposta', k.eposta, { type: 'email' })}
    ${kid ? `<button type="button" class="btn block danger-text" data-act="delKisi" data-mid="${mid}" data-kid="${kid}">Kişiyi sil</button>` : ''}`,
  { onSubmit: async (f, fd) => {
    const item = { ...m, kisiler: [...(m.kisiler || [])] };
    const data = { id: kid || uid(), ad: fd.get('ad').trim(), rol: fd.get('rol').trim(), tel: fd.get('tel').trim(), eposta: fd.get('eposta').trim() };
    const i = item.kisiler.findIndex(x => x.id === data.id);
    if (i >= 0) item.kisiler[i] = data; else item.kisiler.push(data);
    await save(item);
  } });
}

function bilgiHTML(m) {
  const bs = byM('bilgi', m.id).sort((a, b) => (!!a.cevapTarihi - !!b.cevapTarihi) || (bilgiSonGun(a) || '9').localeCompare(bilgiSonGun(b) || '9'));
  const kart = b => {
    const st = bilgiDurum(b), son = bilgiSonGun(b);
    return `<button class="bcard${b.cevapTarihi ? ' cevapli' : ''}" data-act="editBilgi" data-id="${b.id}">
      <div class="bcard-head">
        <div><b>${esc(bilgiMuhatap(b, m))}</b>${b.muhatap === 'diger' && b.muhatapVkn ? `<span>VKN ${esc(b.muhatapVkn)}</span>` : b.muhatap === 'diger' ? '<span>Başka mükellef</span>' : '<span>Mükellefin kendisi</span>'}</div>
        <span class="badge ${st.cls}">${esc(st.text)}</span>
      </div>
      ${b.konu ? `<p class="bcard-konu">${esc(b.konu)}</p>` : ''}
      <dl class="bcard-grid">
        <div><dt>Yazı</dt><dd>${esc([b.sayi, fmtD(b.yaziTarihi)].filter(Boolean).join(' · ') || '—')}</dd></div>
        <div><dt>Tebliğ</dt><dd>${b.tebligTarihi ? fmtD(b.tebligTarihi) : '—'}</dd></div>
        <div><dt>Süre</dt><dd>${+(b.sureGun || 15)} gün</dd></div>
        <div><dt>Son gün</dt><dd>${son ? fmtD(son) : '—'}</dd></div>
        ${b.cevapTarihi ? `<div class="wide"><dt>Cevap</dt><dd>${fmtD(b.cevapTarihi)}${b.cevapNot ? ' · ' + esc(b.cevapNot) : ''}</dd></div>` : ''}
      </dl>
    </button>`;
  };
  return `<div class="sec-row"><h2 class="sec">Bilgi isteme yazıları</h2><button class="btn link sm" data-act="newBilgi" data-mid="${m.id}">+ Ekle</button></div>
    ${bs.length ? `<div class="bcards">${bs.map(kart).join('')}</div>` : '<p class="footnote">Mükellefe ya da başka mükelleflere yazdığın bilgi isteme yazılarını ekle; tebliğ tarihinden cevap süresi ve kalan gün hesaplanır.</p>'}`;
}
function bilgiSheet(mid, b = null) {
  const v = b || { muhatap: 'mukellef', sureGun: 15, yaziTarihi: today() };
  const form = openSheet(b ? 'Bilgi isteme yazısı' : 'Yeni bilgi isteme yazısı', `
    <div class="autofill">
      <button type="button" class="btn primary block" data-bilgi-af>${I.doc} Yazıyı yükle, bilgileri doldur</button>
      <p class="hint">Bilgi isteme yazısının PDF'ini ya da fotoğrafını seç. Sayı, tarih, konu, cevap süresi ve muhatap okunur; yazı saklanmaz. Tebliğ tarihini tebliğden sonra sen gir.</p>
      <div class="af-status" aria-live="polite"></div>
    </div>
    <div class="seg full" id="muhSeg">
      <button type="button" class="${v.muhatap !== 'diger' ? 'on' : ''}" data-m="mukellef">Mükellefe</button>
      <button type="button" class="${v.muhatap === 'diger' ? 'on' : ''}" data-m="diger">Başka mükellefe</button>
    </div>
    <input type="hidden" name="muhatap" value="${v.muhatap === 'diger' ? 'diger' : 'mukellef'}">
    <div id="digerAlan" ${v.muhatap === 'diger' ? '' : 'hidden'}>
      <p class="hint">İncelemeyle ilgili başka bir mükellefe (karşıt) yazılan yazı.</p>
      ${field('Muhatap unvanı / adı', 'muhatapAd', v.muhatapAd)}
      ${field('Muhatap VKN / TCKN', 'muhatapVkn', v.muhatapVkn, { inputmode: 'numeric' })}
    </div>
    <div class="row2">${field('Yazı sayısı', 'sayi', v.sayi)}${field('Yazı tarihi', 'yaziTarihi', v.yaziTarihi, { type: 'date' })}</div>
    ${field('Konu', 'konu', v.konu, { placeholder: 'ör. 2024 yılı banka hesap hareketleri' })}
    <div class="row2">${field('Tebliğ tarihi', 'tebligTarihi', v.tebligTarihi, { type: 'date' })}${field('Cevap süresi (gün)', 'sureGun', v.sureGun || 15, { type: 'number', inputmode: 'numeric', extra: 'min="1" max="365"' })}</div>
    <p class="hint" id="sonGunBilgi"></p>
    <details class="takip"${v.cevapTarihi ? ' open' : ''}><summary>Cevap geldi</summary>
      ${field('Cevap tarihi', 'cevapTarihi', v.cevapTarihi, { type: 'date' })}
      ${textarea('Cevap notu', 'cevapNot', v.cevapNot, 2, { placeholder: 'ör. Ekstreler e-posta ile gönderildi' })}
    </details>
    ${b ? `<button type="button" class="btn block danger-text" data-act="delBilgi" data-id="${b.id}">Yazıyı sil</button>` : ''}`,
  { onSubmit: async (f, fd) => {
    const item = b ? { ...b } : { id: uid(), kind: 'bilgi', mid };
    for (const k of ['muhatap', 'muhatapAd', 'muhatapVkn', 'sayi', 'yaziTarihi', 'konu', 'tebligTarihi', 'cevapTarihi', 'cevapNot']) item[k] = String(fd.get(k) ?? '').trim();
    item.sureGun = Math.max(1, parseInt(fd.get('sureGun'), 10) || 15);
    if (item.muhatap !== 'diger') { item.muhatapAd = ''; item.muhatapVkn = ''; }
    else if (!item.muhatapAd) { toast('Muhatabın unvanını yaz'); return false; }
    await save(item);
    toast('Kaydedildi');
  } });
  const e = form.elements;
  const seg = form.querySelector('#muhSeg');
  seg.onclick = ev => {
    const btn = ev.target.closest('button[data-m]'); if (!btn) return;
    seg.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === btn));
    e.muhatap.value = btn.dataset.m;
    form.querySelector('#digerAlan').hidden = btn.dataset.m !== 'diger';
  };
  const bilgiGoster = () => {
    const son = bilgiSonGun({ tebligTarihi: e.tebligTarihi.value, sureGun: e.sureGun.value });
    form.querySelector('#sonGunBilgi').textContent = son
      ? `Son cevap günü: ${fmtD(son)} (${relDays(daysUntil(son))}). Hafta sonu ise izleyen iş gününe kaydırıldı; resmî tatilleri kontrol et.`
      : 'Tebliğ tarihini girince son cevap günü hesaplanır.';
  };
  e.tebligTarihi.addEventListener('input', bilgiGoster); e.sureGun.addEventListener('input', bilgiGoster); bilgiGoster();
  // Yazıyı yükle: bilgileri yazıdan oku
  const status = form.querySelector('.af-status');
  const setMuhatap = v => seg.querySelector(`[data-m=${v}]`)?.click();
  form.querySelector('[data-bilgi-af]').onclick = async ev => {
    const btn = ev.currentTarget;
    const files = await pickFiles('application/pdf,image/*');
    if (!files.length) return;
    btn.disabled = true;
    try {
      status.textContent = `${files[0].name}: okunuyor…`;
      let text = '';
      for (const f of files) {
        try { text += '\n' + await extractText(f, msg => { status.textContent = `${f.name}: ${msg}`; }); } catch (err) { console.error(err); }
      }
      const m = S.items.get(mid) || {};
      const r = parseBilgi(text, { vkn: m.vkn, tckn: m.tckn });
      // VKN bulunamadıysa adı dosyadaki unvanla karşılaştır
      if (!r.muhatap && r.muhatapAdi) {
        const ilk = fold(String(m.unvan || '').split(/\s+/)[0] || '');
        if (ilk && fold(r.muhatapAdi).includes(ilk)) r.muhatap = 'mukellef';
        else { r.muhatap = 'diger'; r.muhatapAd = r.muhatapAdi; }
      }
      const doldur = (k, val) => { const el = e[k]; if (!el || val == null || val === '') return false; el.value = val; el.classList.add('filled'); el.addEventListener('input', () => el.classList.remove('filled'), { once: true }); return true; };
      const bulunan = [];
      if (r.muhatap) { setMuhatap(r.muhatap); bulunan.push(r.muhatap === 'diger' ? 'Muhatap: başka mükellef' : 'Muhatap: mükellefin kendisi'); }
      if (doldur('muhatapAd', r.muhatapAd)) bulunan.push('Unvan');
      if (doldur('muhatapVkn', r.muhatapVkn)) bulunan.push('VKN');
      if (doldur('sayi', r.sayi)) bulunan.push('Sayı');
      if (doldur('yaziTarihi', r.yaziTarihi)) bulunan.push('Tarih');
      if (doldur('konu', r.konu)) bulunan.push('Konu');
      if (doldur('sureGun', r.sureGun)) bulunan.push(`Süre (${r.sureGun} gün)`);
      bilgiGoster();
      status.innerHTML = bulunan.length
        ? `<b>Bulunanlar:</b> ${esc(bulunan.join(', '))}<br><span class="muted">Sarı alanları yazıyla karşılaştır. Tebliğ tarihini tebliğden sonra gir.</span>`
        : 'Yazıdan bilgi okunamadı; alanları elle doldurabilirsin. Örnek yazıyı Claude\'a gönderirsen okuma iyileştirilebilir.';
    } finally { btn.disabled = false; }
  };
}

/* ---------- görüşmeler ---------- */
function kayitlarHTML(m) {
  const ks = byM('kayit', m.id).sort((a, b) => b.tarih.localeCompare(a.tarih));
  if (!ks.length) return '<p class="empty">Mükellefle her temastan sonra <b>Görüşme notu</b> ile yazılı veya sesli not ekle. Tüm görüşmeler burada tarih sırasıyla durur.</p>';
  return `<div class="timeline">${ks.map(k => `<article class="entry">
    <div class="entry-head"><span class="tag">${TUR_LABEL[k.tur] || k.tur}</span><time>${fmtDT(k.tarih)}</time></div>
    ${k.kisi ? `<div class="entry-who">${esc(k.kisi)}</div>` : ''}
    ${k.konu ? `<h3>${esc(k.konu)}</h3>` : ''}
    ${k.metin ? `<p class="pre">${esc(k.metin)}</p>` : ''}
    ${(k.sesler || []).map(s => `<div class="audio-slot"><button class="btn sm" data-act="play" data-file="${s.fileId}" data-mime="${esc(s.mime)}">${I.play} Sesli not · ${fmtSure(s.sure)}</button></div>`).join('')}
    <div class="entry-actions">
      <button class="btn sm link" data-act="editKayit" data-id="${k.id}">Düzenle</button>
      <button class="btn sm link danger-text" data-act="delKayit" data-id="${k.id}">Sil</button>
    </div></article>`).join('')}</div>`;
}

async function playInto(slot, blob) {
  if (!blob) return toast('Ses dosyası bulunamadı');
  slot.innerHTML = `<audio controls src="${trackURL(blob)}"></audio>`;
  slot.querySelector('audio').play().catch(() => {});
}

function recorder(box, clips) {
  let mr = null, stream = null, chunks = [], t0 = 0, timer = null, resolveStop = null, cancelled = false;
  const btn = box.querySelector('[data-rec]'), list = box.querySelector('.clips');
  const ui = () => {
    btn.classList.toggle('on', !!mr);
    btn.textContent = mr ? `■ Durdur · ${fmtSure((Date.now() - t0) / 1000)}` : '● Sesli not kaydet';
  };
  const draw = () => {
    list.innerHTML = clips.map((c, i) => `<div class="clip"><span class="audio-slot"><button type="button" class="btn sm" data-i="${i}" data-do="play">${I.play} Ses ${i + 1} · ${fmtSure(c.sure)}</button></span><button type="button" class="btn sm link danger-text" data-i="${i}" data-do="del">Sil</button></div>`).join('');
  };
  box.addEventListener('click', async e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b === btn) return mr ? stop() : start();
    const c = clips[+b.dataset.i];
    if (b.dataset.do === 'del' && confirm('Bu ses kaydı silinsin mi?')) { clips.splice(+b.dataset.i, 1); draw(); }
    if (b.dataset.do === 'play') playInto(b.parentElement, c.blob || await loadFile(c.fileId, c.mime));
  });
  async function start() {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return toast('Bu cihazda ses kaydı desteklenmiyor');
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { return toast('Mikrofon izni verilmedi'); }
    const type = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'].find(t => MediaRecorder.isTypeSupported?.(t));
    mr = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    chunks = [];
    mr.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    mr.onstop = () => {
      const mime = mr.mimeType || type || 'audio/mp4';
      if (!cancelled && chunks.length) clips.push({ blob: new Blob(chunks, { type: mime }), mime, sure: Math.max(1, Math.round((Date.now() - t0) / 1000)) });
      stream.getTracks().forEach(t => t.stop());
      mr = null; S.recording = false; clearInterval(timer);
      if (!cancelled) { ui(); draw(); }
      resolveStop?.(); resolveStop = null;
    };
    mr.start(1000);
    t0 = Date.now(); S.recording = true;
    timer = setInterval(ui, 500);
    ui();
  }
  const stop = () => new Promise(res => { if (!mr) return res(); resolveStop = res; mr.stop(); });
  draw();
  return { finish: stop, cancel: () => { cancelled = true; stop(); } };
}

function kayitSheet(mid, k = null, preset = {}) {
  const m = S.items.get(mid);
  const v = k || { tarih: localDT(), tur: 'telefon', ...preset };
  const clips = (k?.sesler || []).map(s => ({ ...s }));
  const form = openSheet(k ? 'Görüşme notunu düzenle' : 'Görüşme notu', `
    <div class="row2">${field('Tarih ve saat', 'tarih', v.tarih, { type: 'datetime-local', required: true })}${select('Tür', 'tur', v.tur, TURLER)}</div>
    ${field('Görüşülen kişi', 'kisi', v.kisi, { extra: 'list="kisiList"' })}
    <datalist id="kisiList">${(m.kisiler || []).map(x => `<option value="${esc(x.ad + (x.rol ? ` (${x.rol})` : ''))}">`).join('')}</datalist>
    ${field('Konu', 'konu', v.konu, { placeholder: 'ör. Defter ibrazı, ek süre talebi' })}
    ${textarea('Not', 'metin', v.metin, 7, { placeholder: 'Ne konuşuldu, ne söz verildi, ne istendi…' })}
    <p class="hint">İpucu: Klavyedeki 🎤 tuşuyla konuşarak yazdırabilirsin.</p>
    <div class="rec"><button type="button" class="btn rec-btn" data-rec>● Sesli not kaydet</button><div class="clips"></div></div>
    ${k ? '' : `<details class="takip"><summary>Takip süresi / görev ekle</summary>
      ${field('Görev', 'takipBaslik', '', { placeholder: 'ör. Belgeleri teslim edecek' })}
      ${field('Tarih', 'takipTarih', '', { type: 'date' })}</details>`}`,
  { onSubmit: async (f, fd) => {
    await rec.finish();
    const item = k ? { ...k } : { id: uid(), kind: 'kayit', mid };
    Object.assign(item, { tarih: fd.get('tarih'), tur: fd.get('tur'), kisi: fd.get('kisi').trim(), konu: fd.get('konu').trim(), metin: fd.get('metin').trim() });
    if (!item.metin && !item.konu && !clips.length) { toast('Bir not yaz ya da ses kaydı ekle'); return false; }
    const sesler = [];
    for (const c of clips) {
      if (c.blob) {
        const fileId = uid();
        await saveFile(fileId, await c.blob.arrayBuffer());
        sesler.push({ fileId, mime: c.mime, sure: c.sure });
      } else sesler.push({ fileId: c.fileId, mime: c.mime, sure: c.sure });
    }
    const removed = (k?.sesler || []).filter(s => !sesler.some(x => x.fileId === s.fileId)).map(s => s.fileId);
    item.sesler = sesler;
    await save(item);
    await db.delMany('files', removed);
    const tt = fd.get('takipTarih');
    if (!k && tt) {
      const tb = (fd.get('takipBaslik') || '').trim();
      await save({ id: uid(), kind: 'gorev', mid, baslik: tb || 'Takip: ' + (item.konu || item.kisi || 'görüşme'), tarih: tt, bitti: false, not: '' });
    }
    toast('Kaydedildi');
  } });
  const rec = recorder(form.querySelector('.rec'), clips);
  sheetCleanup = () => rec.cancel();
}

async function shareOrDownload(file) {
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return true; } catch (e) { if (e.name === 'AbortError') return false; }
  }
  const u = URL.createObjectURL(file);
  const a = Object.assign(document.createElement('a'), { href: u, download: file.name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 60000);
  return true;
}

/* ---------- süreler ---------- */
function surelerHTML(m) {
  const gs = byM('gorev', m.id);
  const open = gs.filter(g => !g.bitti).sort((a, b) => a.tarih.localeCompare(b.tarih));
  const done = gs.filter(g => g.bitti).sort((a, b) => b.tarih.localeCompare(a.tarih));
  const row = g => `<div class="row">
    <button class="check${g.bitti ? ' on' : ''}" data-act="toggleGorev" data-id="${g.id}" aria-label="Tamamlandı olarak işaretle">${g.bitti ? '✓' : ''}</button>
    <button class="row-main plain" data-act="editGorev" data-id="${g.id}">
      <div class="row-title wrap${g.bitti ? ' strike' : ''}">${esc(g.baslik)}</div>
      <div class="row-sub">${fmtD(g.tarih)}${g.not ? ' · ' + esc(g.not) : ''}</div>
    </button>
    ${g.bitti ? '' : badge(g.tarih)}
    ${g.bitti ? '' : `<button class="icon-btn" data-act="icsGorev" data-id="${g.id}" aria-label="Takvime ekle">${I.cal}</button>`}
  </div>`;
  return `<div class="sec-row"><h2 class="sec">Süreler</h2><button class="btn link sm" data-act="newGorev" data-mid="${m.id}">+ Ekle</button></div>
    ${open.length ? `<div class="list">${open.map(row).join('')}</div>` : '<p class="footnote">Açık süre yok. İbraz, ek süre, cevap süresi gibi tarihleri ekleyebilirsin; son 7 gün kala ana sayfada uyarı çıkar.</p>'}
    ${done.length ? `<details class="done"><summary>${done.length} tamamlanan</summary><div class="list">${done.map(row).join('')}</div></details>` : ''}`;
}
function gorevSheet(mid, g = null) {
  const v = g || {};
  const form = openSheet(g ? 'Süreyi düzenle' : 'Yeni süre / görev', `
    ${field('Başlık', 'baslik', v.baslik, { required: true, extra: 'list="gorevList"' })}
    <datalist id="gorevList">${GOREV_SABLON.map(x => `<option value="${esc(x)}">`).join('')}</datalist>
    ${field('Tarih', 'tarih', v.tarih, { type: 'date', required: true })}
    <div class="chips">${[7, 15, 30, 60].map(n => `<button type="button" class="chip" data-plus="${n}">Bugün +${n} gün</button>`).join('')}</div>
    ${textarea('Not', 'not', v.not, 3)}
    ${g ? `<button type="button" class="btn block danger-text" data-act="delGorev" data-id="${g.id}">Sil</button>` : ''}`,
  { onSubmit: async (f, fd) => {
    const item = g ? { ...g } : { id: uid(), kind: 'gorev', mid, bitti: false };
    Object.assign(item, { baslik: fd.get('baslik').trim(), tarih: fd.get('tarih'), not: fd.get('not').trim() });
    await save(item);
  } });
  form.querySelector('.chips').onclick = e => { const n = e.target.dataset.plus; if (n) form.elements.tarih.value = addDays(today(), +n); };
}
function icsFile(uidStr, date, title) {
  const esc2 = s => s.replace(/[\\;,]/g, c => '\\' + c).replace(/\n/g, '\\n');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const alarm = trig => ['BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + esc2(title), 'TRIGGER:' + trig, 'END:VALARM'];
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//El Defteri//TR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT', `UID:${uidStr}@el-defteri`, `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${date.replace(/-/g, '')}`, `DTEND;VALUE=DATE:${addDays(date, 1).replace(/-/g, '')}`,
    'SUMMARY:' + esc2(title), ...alarm('-PT15H'), ...alarm('PT9H'), 'END:VEVENT', 'END:VCALENDAR'];
  const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar' });
  const u = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: u, download: 'sure.ics' });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 60000);
}
const dosyaEtiket = m => m.kod || 'İnceleme dosyası';

/* ---------- ayarlar ---------- */
function renderSettings() {
  const t = S.settings.theme || 'sistem';
  const u = cloud.currentUser();
  app.innerHTML = header('Ayarlar') + `<div class="page">
    ${cloudOn() ? `<h2 class="sec">Hesap</h2>
    <div class="list inset-avatar">
      <div class="row">${avatar(S.cloud.email)}<div class="row-main"><div class="row-title">${esc(S.cloud.email)}</div><div class="row-sub" id="syncInfo">Eşitleme durumu…</div></div></div>
      <button class="row action" data-act="syncNow">Şimdi eşitle</button>
      <button class="row action danger-text" data-act="signout">Çıkış yap</button>
    </div>
    <p class="footnote">Veriler cihazında şifrelenip buluta öyle gönderilir; Google dahil kimse içeriği okuyamaz.</p>` : ''}
    ${cloud.isAdmin() ? `<h2 class="sec">Üyeler</h2>
    <div class="list" id="uyeler"><div class="row"><div class="row-sub">Yükleniyor…</div></div></div>
    <p class="footnote">Yalnızca bu listedeki Gmail adresleri üye olup giriş yapabilir. Herkes yalnızca kendi dosyalarını görür. Sen (${esc(cloud.ADMIN)}) her zaman girebilirsin.</p>` : ''}
    <h2 class="sec">Görünüm</h2>
    <div class="list pad"><div class="seg full">${THEMES.map(([v, l]) => `<button class="${t === v ? 'on' : ''}" data-act="theme" data-v="${v}">${l}</button>`).join('')}</div></div>
    <p class="footnote">“Sistem”, iPhone'un açık/koyu mod ayarını izler.</p>
    <h2 class="sec">Yedekleme</h2>
    <div class="list">
      <button class="row action" data-act="exportBackup">Yedek al</button>
      <button class="row action" data-act="importBackup">Yedekten geri yükle</button>
    </div>
    <p class="footnote">Son yedek: ${S.lastBackup ? fmtTs(S.lastBackup, true) : 'hiç alınmadı'}. Yedek dosyası şifrelidir; açmak için yedeği aldığın andaki şifre gerekir. “Dosyalar”a kaydedebilirsin.</p>
    <h2 class="sec">Güvenlik</h2>
    <div class="list">
      <label class="row"><div class="row-main"><div class="row-title">Otomatik kilit</div></div>
        <select class="row-select" name="autolock">${[['1', '1 dakika'], ['3', '3 dakika'], ['5', '5 dakika'], ['10', '10 dakika'], ['30', '30 dakika']].map(([v, l]) => `<option value="${v}"${String(S.settings.autolock) === v ? ' selected' : ''}>${l}</option>`).join('')}</select>${I.chev}</label>
      <button class="row action" data-act="chpw">Şifreyi değiştir</button>
      <button class="row action" data-act="lock">Şimdi kilitle</button>
    </div>
    <h2 class="sec">Depolama</h2>
    <div class="list"><div class="row"><div class="row-main"><div class="row-sub" id="storeInfo">Hesaplanıyor…</div></div></div></div>
    <p class="footnote">Veriler bu cihazda AES-256 ile şifreli tutulur; şifre olmadan okunamaz. Uygulama internetsiz de çalışır.</p>
    ${cloudOn() ? '' : `<div class="list">
      <button class="row action danger-text" data-act="wipe">Bu cihazdaki tüm verileri sil</button>
    </div>`}
    <p class="footnote center">El Defteri 2.0</p>
  </div>${tabbar('ayarlar')}`;
  $('select[name=autolock]').onchange = e => { S.settings.autolock = +e.target.value; db.metaSet('settings', S.settings); toast('Kaydedildi'); };
  if (cloudOn()) drawSyncInfo();
  if (cloud.isAdmin()) drawUyeler();
  (async () => {
    const est = await navigator.storage?.estimate?.();
    const per = await navigator.storage?.persisted?.();
    const el = $('#storeInfo');
    if (!el) return;
    el.innerHTML = `${est ? `Kullanılan: <b>${fmtSize(est.usage || 0)}</b>. ` : ''}${isStandalone() ? 'Ana ekran uygulaması olarak çalışıyor.' : '<b>Ana ekrana eklenmemiş</b>: Safari → Paylaş → Ana Ekrana Ekle.'} ${per ? 'Kalıcı depolama açık.' : ''}`;
  })();
}

async function drawSyncInfo() {
  const el = $('#syncInfo');
  if (!el) return;
  const n = await pendingCount();
  el.textContent = S.syncError ? `Eşitlenemedi (${S.syncError})${n ? ` · ${n} kayıt bekliyor` : ''}`
    : `${S.cloud.lastSync ? 'Son eşitleme: ' + fmtTs(S.cloud.lastSync, true) : 'Henüz eşitlenmedi'}${n ? ` · ${n} kayıt bekliyor` : ''}`;
}
let uyeList = [];
async function drawUyeler() {
  const el = $('#uyeler');
  if (!el) return;
  try { uyeList = await cloud.getAllow(); } catch (e) { el.innerHTML = `<div class="row"><div class="row-sub">Liste alınamadı: ${esc(e.code || e.message)}</div></div>`; return; }
  el.innerHTML = uyeList.map(m => `<div class="row">${avatar(m)}<div class="row-main"><div class="row-title">${esc(m)}</div></div>
      <button class="btn link sm danger-text" data-act="uyeSil" data-email="${esc(m)}">Kaldır</button></div>`).join('')
    + `<button class="row action" data-act="uyeEkle">Üye ekle</button>`;
  el.classList.toggle('inset-avatar', uyeList.length > 0);
}

async function buildBackup() {
  const items = await db.getAll('items');
  const files = await db.getAll('files');
  const obj = {
    app: 'el-defteri', v: 1, createdAt: new Date().toISOString(), vault: cr.vaultToJSON(S.vault),
    items: items.map(r => ({ id: r.id, kind: r.kind, iv: cr.b64(r.iv), data: cr.b64(r.data) })),
    files: files.map(r => ({ id: r.id, iv: cr.b64(r.iv), data: cr.b64(r.data) })),
  };
  return new File([JSON.stringify(obj)], `el-defteri-yedek-${today()}.json`, { type: 'application/json' });
}
function pickFiles(accept) {
  return new Promise(res => {
    const i = Object.assign(document.createElement('input'), { type: 'file', accept, multiple: true });
    i.onchange = () => res([...i.files]);
    i.click();
  });
}
function pickFile(accept) {
  return new Promise(res => {
    const i = Object.assign(document.createElement('input'), { type: 'file', accept });
    i.onchange = () => res(i.files[0] || null);
    i.click();
  });
}
async function importFlow() {
  const file = await pickFile('application/json,.json');
  if (!file) return;
  let obj;
  try { obj = JSON.parse(await file.text()); if (obj.app !== 'el-defteri') throw new Error(); } catch { return toast('Bu dosya geçerli bir El Defteri yedeği değil'); }
  openSheet('Yedekten geri yükle', `
    <p class="muted">${esc(file.name)} · ${obj.items.length} kayıt · ${fmtTs(Date.parse(obj.createdAt), true)}</p>
    ${cloudOn() && S.key ? '<p class="banner">Yedekteki kayıtlar mevcut verilerine eklenecek ve buluta da gönderilecek. Mevcut kayıtların silinmez.</p>'
      : S.vault ? '<p class="banner warn">Bu cihazdaki mevcut tüm veriler silinip yerine yedek yüklenecek.</p>' : ''}
    ${userField}
    ${field('Yedeğin şifresi', 'pw', '', { type: 'password', required: true, autocomplete: 'current-password' })}
    <p class="hint">${cloudOn() && S.key ? 'Yedeği aldığın andaki şifreyi gir; kayıtlar mevcut şifrenle yeniden şifrelenir.' : 'Geri yüklemeden sonra uygulamanın şifresi, yedeği aldığın andaki şifre olur.'}</p>`,
  { submitLabel: 'Yükle', onSubmit: async (f, fd) => {
    const vault = cr.vaultFromJSON(obj.vault);
    const key = await cr.openVault(fd.get('pw'), vault);
    if (!key) { toast('Şifre yanlış'); return false; }
    if (cloudOn() && S.key) {
      // Bulut açıkken: yedeği birleştir (mevcut anahtarla yeniden şifreleyip ekle)
      let n = 0;
      for (const r of obj.items) {
        try {
          const it = await cr.decJSON(key, cr.unb64(r.iv), cr.unb64(r.data));
          const cur = S.items.get(it.id);
          if (cur && (cur.updated || 0) >= (it.updated || 0)) continue;
          await save(it); n++;
        } catch (e) { console.warn('yedek kaydı atlandı', r.id); }
      }
      for (const fl of obj.files) {
        if ((await db.get('files', fl.id))?.data) continue;
        try { await saveFile(fl.id, await cr.decBytes(key, cr.unb64(fl.iv), cr.unb64(fl.data))); } catch {}
      }
      sync();
      location.hash = '#/';
      toast(`${n} kayıt eklendi`);
      return;
    }
    await db.replaceAll(vault,
      obj.items.map(r => ({ id: r.id, kind: r.kind, iv: cr.unb64(r.iv), data: cr.unb64(r.data) })),
      obj.files.map(r => ({ id: r.id, iv: cr.unb64(r.iv), data: cr.unb64(r.data) })));
    S.vault = vault;
    S.lastBackup = Date.parse(obj.createdAt);
    await db.metaSet('lastBackup', S.lastBackup);
    await db.metaSet('cloud', null);
    S.cloud = null;
    // Uygulama Google girişi olmadan açılmaz: yedek yerelde hazır, girişten sonra buluta taşınır
    S.key = null;
    location.hash = '#/';
    toast('Yedek yüklendi. Google ile giriş yapınca buluta taşınacak.');
  } });
}

/* ---------- arama sonrası not hatırlatması ---------- */
function offerCallNote() {
  if (!pendingCall || !S.key) return;
  const pc = pendingCall;
  pendingCall = null;
  if (Date.now() - pc.at > 3 * 3600e3 || !S.items.get(pc.mid)) return;
  toast(`${pc.kisi} ile görüşmeni not al`, {
    label: 'Not ekle',
    fn: () => { location.hash = `#/m/${pc.mid}/kayitlar`; kayitSheet(pc.mid, null, { tur: 'telefon', kisi: pc.kisi }); },
  });
}

/* ---------- eylemler ---------- */
const ACT = {
  closeSheet: () => closeSheet(),
  theme: async d => { S.settings.theme = d.v; applyTheme(); await db.metaSet('settings', S.settings); renderSettings(); },
  lock: () => lock(),
  filter: d => { S.filter = d.v; renderHome(); },
  newM: () => mukellefSheet(),
  editM: d => mukellefSheet(S.items.get(d.id)),
  toggleDurum: async d => { const m = S.items.get(d.id); await save({ ...m, durum: isAktif(m) ? 'kapandi' : 'aktif' }); render(); },
  delM: async d => {
    const m = S.items.get(d.id);
    if (!confirm(`“${m.unvan}” dosyası ve içindeki tüm notlar, ses kayıtları, bilgi isteme yazıları ve süreler silinsin mi? Bu işlem geri alınamaz.`)) return;
    const kids = [...S.items.values()].filter(i => i.mid === m.id);
    const fileIds = kids.flatMap(i => i.kind === 'belge' ? [i.fileId] : i.kind === 'kayit' ? (i.sesler || []).map(s => s.fileId) : []);
    await removeItems([m.id, ...kids.map(i => i.id)], fileIds);
    location.hash = '#/';
    toast('Dosya silindi');
  },
  kisi: d => kisiSheet(d.mid, d.kid),
  delKisi: async d => {
    if (!confirm('Kişi silinsin mi?')) return;
    const m = S.items.get(d.mid);
    await save({ ...m, kisiler: (m.kisiler || []).filter(k => k.id !== d.kid) });
    closeSheet(); render();
  },
  call: d => {
    const k = (S.items.get(d.mid).kisiler || []).find(x => x.id === d.kid);
    pendingCall = { mid: d.mid, kisi: k.ad + (k.rol ? ` (${k.rol})` : ''), at: Date.now() };
  },
  newKayit: d => kayitSheet(d.mid),
  editKayit: d => { const k = S.items.get(d.id); kayitSheet(k.mid, k); },
  delKayit: async d => {
    if (!confirm('Bu görüşme notu (ve ses kayıtları) silinsin mi?')) return;
    const k = S.items.get(d.id);
    await removeItems([k.id], (k.sesler || []).map(s => s.fileId));
    render();
  },
  play: async (d, el) => playInto(el.parentElement, await loadFile(d.file, d.mime)),
  newGorev: d => gorevSheet(d.mid),
  newBilgi: d => bilgiSheet(d.mid),
  editBilgi: d => { const b = S.items.get(d.id); bilgiSheet(b.mid, b); },
  delBilgi: async d => {
    if (!confirm('Bu bilgi isteme yazısı silinsin mi?')) return;
    await removeItems([d.id]);
    closeSheet(); render();
  },
  editGorev: d => { const g = S.items.get(d.id); gorevSheet(g.mid, g); },
  toggleGorev: async d => { const g = S.items.get(d.id); await save({ ...g, bitti: !g.bitti }); render(); },
  delGorev: async d => {
    if (!confirm('Bu süre / görev silinsin mi?')) return;
    await removeItems([d.id]);
    closeSheet(); render();
  },
  icsGorev: d => { const g = S.items.get(d.id); icsFile(g.id, g.tarih, `${dosyaEtiket(S.items.get(g.mid))}: ${g.baslik}`); },
  icsBitis: d => { const m = S.items.get(d.mid); icsFile(m.id + '-bitis', m.bitisTarihi, `${dosyaEtiket(m)}: İnceleme bitiş süresi`); },
  exportBackup: async (d, el) => {
    el.disabled = true; el.textContent = 'Hazırlanıyor…';
    try {
      S.backupFile = await buildBackup();
      openSheet('Yedek hazır', `<p><b>${esc(S.backupFile.name)}</b> · ${fmtSize(S.backupFile.size)}</p>
        <button type="button" class="btn primary block" data-act="shareBackup">Kaydet / Paylaş</button>
        <p class="hint">Açılan menüde “Dosyalar'a Kaydet”i seçebilirsin.</p>`);
    } finally { el.disabled = false; el.textContent = 'Yedek al'; }
  },
  shareBackup: async () => {
    if (!S.backupFile || !(await shareOrDownload(S.backupFile))) return;
    S.lastBackup = Date.now();
    await db.metaSet('lastBackup', S.lastBackup);
    closeSheet(); render();
    toast('Yedek kaydedildi');
  },
  importBackup: () => importFlow(),
  relock: () => renderLock(),
  syncNow: async (d, el) => { el.disabled = true; el.textContent = 'Eşitleniyor…'; await sync({ quiet: false }); if (!S.syncError) toast('Eşitlendi'); renderSettings(); },
  signout: () => {
    if (!S.key) { cloud.signOutUser().then(() => renderLock()); return; }
    openSheet('Çıkış yap', `<p class="card">Çıkış yapınca bu cihazdaki kopya silinir; verilerin bulutta şifreli olarak kalır. Tekrar girişte Google hesabın ve uygulama şifren istenir.</p>`,
      { submitLabel: 'Çıkış yap', onSubmit: async () => {
        await sync({ quiet: false });
        const n = await pendingCount();
        if (n && !confirm(`${n} kayıt henüz buluta gönderilemedi (internet yok olabilir). Yine de çıkılsın mı? Bu kayıtlar kaybolur.`)) return false;
        await db.clearData();
        await cloud.signOutUser();
        S.vault = null; S.cloud = null; S.lastBackup = null;
        history.replaceState(null, '', location.pathname + location.search + '#/');
        lock();
      } });
  },
  uyeEkle: () => openSheet('Üye ekle', `${field('Gmail adresi', 'email', '', { type: 'email', required: true, placeholder: 'ornek@gmail.com', autocomplete: 'off' })}
    <p class="hint">Eklediğin kişi uygulamayı açıp bu Gmail hesabıyla giriş yapabilir ve kendi şifresini belirler. Senin dosyalarını göremez.</p>`,
  { submitLabel: 'Ekle', onSubmit: async (f, fd) => {
    const m = fd.get('email').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(m)) { toast('Geçerli bir e-posta yaz'); return false; }
    await cloud.setAllow([...new Set([...uyeList, m])]);
    toast('Üye eklendi');
  } }),
  uyeSil: async d => {
    if (!confirm(`${d.email} üyelikten çıkarılsın mı? Artık giriş yapamaz (bulutta duran şifreli verisi silinmez).`)) return;
    await cloud.setAllow(uyeList.filter(x => x !== d.email));
    drawUyeler();
  },
  paket: () => paketFlow(),
  chpw: () => openSheet('Şifreyi değiştir', `${userField}
    ${field('Mevcut şifre', 'old', '', { type: 'password', required: true, autocomplete: 'current-password', inputmode: S.settings.pwKlavye || 'numeric' })}
    ${field('Yeni şifre', 'p1', '', { type: 'password', required: true, autocomplete: 'new-password', inputmode: 'numeric', extra: 'minlength="6"' })}
    ${field('Yeni şifre (tekrar)', 'p2', '', { type: 'password', required: true, autocomplete: 'new-password', inputmode: 'numeric', extra: 'minlength="6"' })}
    <p class="hint">Yalnızca rakamdan oluşan bir şifre seçersen girişte rakam klavyesi yeter. Güvenlik için en az 8 hane önerilir.</p>
    <p class="hint">Daha önce aldığın yedekler, alındıkları andaki şifreyle açılmaya devam eder.</p>`,
  { onSubmit: async (f, fd) => {
    if (fd.get('p1') !== fd.get('p2')) { toast('Yeni şifreler aynı değil'); return false; }
    const k = await cr.openVault(fd.get('old'), S.vault, true);
    if (!k) { toast('Mevcut şifre yanlış'); return false; }
    const vault = await cr.wrapWith(k, fd.get('p1'));
    if (cloudOn()) await cloud.putVault(vault); // önce bulut: başarısız olursa yerelde de değişmez
    await db.metaSet('vault', vault);
    S.vault = vault;
    S.key = await cr.openVault(fd.get('p1'), vault);
    toast('Şifre değiştirildi');
  } }),
  wipe: () => openSheet('Tüm verileri sil', `<p>Bu cihazdaki tüm dosyalar, notlar, ses kayıtları ve belgeler kalıcı olarak silinecek. Geri getirmek için yedeğin olmalı.</p>
    ${field('Onaylamak için SİL yaz', 'onay', '', { required: true })}`,
  { submitLabel: 'Sil', onSubmit: async (f, fd) => {
    if (fd.get('onay').trim().toLocaleUpperCase('tr') !== 'SİL') { toast('Onay metni hatalı'); return false; }
    await db.wipe();
    S.vault = null; S.lastBackup = null; S.settings = defaultSettings(); applyTheme();
    lock();
  } }),
};
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const fn = ACT[el.dataset.act];
  if (!fn) return;
  if (el.tagName === 'BUTTON' || el.dataset.act === 'closeSheet') e.preventDefault();
  Promise.resolve(fn(el.dataset, el, e)).catch(err => { console.error(err); toast('Hata: ' + (err.message || err)); });
});

/* ---------- başlat ---------- */
async function init() {
  if (!window.isSecureContext || !crypto?.subtle) {
    app.innerHTML = '<div class="lock"><h1>El Defteri</h1><p class="banner warn">Bu uygulama yalnızca güvenli bağlantı (HTTPS) üzerinden çalışır.</p></div>';
    return;
  }
  if ('serviceWorker' in navigator) {
    // Yeni sürüm devreye girince sayfayı bir kez yenile (kilit ekranındayken)
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloaded && !S.key) { reloaded = true; location.reload(); } });
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(r => r.update()).catch(() => {});
  }
  S.vault = await db.metaGet('vault');
  S.settings = { ...S.settings, ...(await db.metaGet('settings')) };
  applyTheme();
  S.lastBackup = await db.metaGet('lastBackup');
  S.cloud = (await db.metaGet('cloud')) || null;
  render();
}
init();
