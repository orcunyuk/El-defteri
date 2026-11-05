import * as db from './db.js';
import * as cr from './crypto.js';
import { extractText, parse } from './extract.js';

const $ = (s, el = document) => el.querySelector(s);
function defaultSettings() { return { autolock: 5, paper: 'cizgili', paperColor: 'sari' }; }
const PAPERS = [['cizgili', 'Çizgili'], ['kareli', 'Kareli'], ['noktali', 'Noktalı'], ['duz', 'Düz']];
const PAPER_COLORS = [['sari', 'Sarı'], ['krem', 'Krem'], ['beyaz', 'Beyaz']];
function applyTheme() {
  document.documentElement.dataset.paper = S.settings.paper;
  document.documentElement.dataset.paperColor = S.settings.paperColor;
}
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
};

const TURLER = [['telefon', '📞 Telefon'], ['yuzyuze', '🤝 Yüz yüze'], ['yazi', '📄 Resmi yazı'], ['eposta', '✉️ E-posta'], ['diger', '📝 Diğer / not']];
const TUR_LABEL = Object.fromEntries(TURLER);
const INC_TUR = { tam: 'Tam inceleme', sinirli: 'Sınırlı inceleme' };
const BELGE_TUR = ['İş emri', 'Beyanname', 'Tutanak', 'Yazışma / tebligat', 'Defter / kayıt', 'Fatura / banka', 'Diğer'];
const ROLLER = ['Mükellef', 'Şirket yetkilisi', 'SMMM / muhasebeci', 'Avukat / vekil', 'Çalışan', 'Diğer'];
const GOREV_SABLON = ['Defter ve belge ibraz süresi', 'Ek süre sonu', 'Bilgi isteme yazısı cevap süresi', 'Karşıt inceleme sonucu', 'Tutanak düzenlenecek', 'Rapor teslimi'];

/* ---------- veri ---------- */
const all = kind => [...S.items.values()].filter(i => i.kind === kind);
const byM = (kind, mid) => all(kind).filter(i => i.mid === mid);
const isAktif = m => (m.durum || 'aktif') === 'aktif';
const lastContact = mid => byM('kayit', mid).reduce((a, k) => (k.tarih > a ? k.tarih : a), '');

async function save(item) {
  item.updated = Date.now();
  item.created ??= item.updated;
  const { iv, data } = await cr.encJSON(S.key, item);
  await db.put('items', { id: item.id, kind: item.kind, iv, data });
  S.items.set(item.id, item);
}
async function removeItems(ids, fileIds = []) {
  await db.delMany('items', ids);
  await db.delMany('files', fileIds);
  ids.forEach(id => S.items.delete(id));
}
async function saveFile(id, buf) { const { iv, data } = await cr.encBytes(S.key, buf); await db.put('files', { id, iv, data }); }
async function loadFile(id, mime) {
  const r = await db.get('files', id);
  if (!r) return null;
  return new Blob([await cr.decBytes(S.key, r.iv, r.data)], { type: mime });
}
async function loadItems() {
  S.items.clear();
  for (const r of await db.getAll('items')) {
    try { S.items.set(r.id, await cr.decJSON(S.key, r.iv, r.data)); } catch (e) { console.error('Çözülemedi', r.id, e); }
  }
}

/* ---------- arayüz parçaları ---------- */
const header = (title, left = '', right = '') =>
  `<header class="bar"><div class="bar-side">${left}</div><h1>${esc(title)}</h1><div class="bar-side right">${right}</div></header>`;
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
  renderHome();
}
window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });

/* ---------- kilit ---------- */
function renderLock() {
  const has = !!S.vault;
  app.innerHTML = `<div class="cover">
    <div class="cover-spine"></div>
    <div class="cover-band"></div>
    <div class="cover-inner">
      <h1 class="cover-title">Notebook</h1>
      <div class="cover-rule"></div>
      <form id="lockForm" class="cover-form">
        ${has ? '' : `<p class="cover-note">Notlar yalnızca bu telefonda, belirleyeceğin şifreyle şifreli saklanır. Şifreyi unutursan veriler kurtarılamaz.</p>`}
        ${userField}
        <input type="password" name="p1" autocomplete="${has ? 'current-password' : 'new-password'}" placeholder="${has ? 'Şifre' : 'Yeni şifre'}" required minlength="${has ? 1 : 6}" aria-label="Şifre">
        ${has ? '' : '<input type="password" name="p2" autocomplete="new-password" placeholder="Şifre (tekrar)" required minlength="6" aria-label="Şifre tekrar">'}
        <button class="cover-btn" type="submit">${has ? 'Aç' : 'Defteri oluştur'}</button>
        <p class="err" id="lockErr" role="alert"></p>
      </form>
      <button class="cover-link" data-act="importBackup">Yedekten geri yükle</button>
    </div>
  </div>`;
  const form = $('#lockForm');
  const err = $('#lockErr');
  if (!/iPhone|iPad|Android/.test(navigator.userAgent)) form.p1.focus();
  form.onsubmit = async e => {
    e.preventDefault();
    const btn = form.querySelector('button');
    const p1 = form.p1.value;
    err.textContent = '';
    if (!has && p1 !== form.p2.value) { err.textContent = 'Şifreler aynı değil.'; return; }
    btn.disabled = true; btn.textContent = has ? 'Açılıyor…' : 'Hazırlanıyor…';
    let opened = false;
    try {
      if (has) {
        const key = await cr.openVault(p1, S.vault);
        if (!key) { err.textContent = 'Şifre yanlış.'; form.p1.value = ''; return; }
        S.key = key;
        await loadItems();
      } else {
        const { vault, key } = await cr.createVault(p1);
        await db.metaSet('vault', vault);
        S.vault = vault; S.key = key;
        navigator.storage?.persist?.();
      }
      S.lastActive = Date.now();
      opened = true;
      openCover();
      offerCallNote();
    } catch (ex) {
      console.error(ex);
      err.textContent = 'Hata: ' + ex.message;
    } finally {
      if (!opened) { btn.disabled = false; btn.textContent = has ? 'Aç' : 'Defteri oluştur'; }
    }
  };
}
// Kapak, sayfanın üstünden sola doğru açılır
function openCover() {
  const cover = app.querySelector('.cover');
  document.activeElement?.blur?.();
  if (!cover || matchMedia('(prefers-reduced-motion: reduce)').matches) return render();
  document.body.append(cover);
  cover.classList.add('floating');
  render();
  requestAnimationFrame(() => requestAnimationFrame(() => cover.classList.add('opening')));
  setTimeout(() => cover.remove(), 900);
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
  offerCallNote();
});

/* ---------- ana sayfa ---------- */
function alertRow(href, title, m, date) {
  return `<a class="row" href="${href}"><div class="row-main"><div class="row-title">${esc(title)}</div><div class="row-sub">${esc(m?.kod ? m.kod + ' · ' : '')}${esc(m?.unvan)} · ${fmtD(date)}</div></div>${badge(date)}</a>`;
}
function renderHome() {
  const ms = all('mukellef');
  const aktif = new Set(ms.filter(isAktif).map(m => m.id));
  const gAlerts = all('gorev').filter(g => !g.bitti && aktif.has(g.mid) && g.tarih && daysUntil(g.tarih) <= 7);
  const bAlerts = ms.filter(m => aktif.has(m.id) && m.bitisTarihi && daysUntil(m.bitisTarihi) <= 30);
  const alerts = [
    ...bAlerts.map(m => ({ d: m.bitisTarihi, h: alertRow(`#/m/${m.id}/sureler`, 'İnceleme bitiş süresi', m, m.bitisTarihi) })),
    ...gAlerts.map(g => ({ d: g.tarih, h: alertRow(`#/m/${g.mid}/sureler`, g.baslik, S.items.get(g.mid), g.tarih) })),
  ].sort((a, b) => a.d.localeCompare(b.d));

  const banners = [];
  if (!isStandalone()) banners.push(`<div class="banner warn"><b>Ana ekrana ekle:</b> Safari'de <b>Paylaş → Ana Ekrana Ekle</b> ile yükleyip uygulamayı oradan aç. Safari sekmesinde kalan veriler, siteye bir süre girilmezse iOS tarafından silinebilir.</div>`);
  if (S.items.size && (!S.lastBackup || Date.now() - S.lastBackup > 14 * 864e5)) {
    banners.push(`<a class="banner" href="#/ayarlar"><b>Yedek al:</b> ${S.lastBackup ? 'Son yedek ' + fmtTs(S.lastBackup) + '.' : 'Henüz yedek almadın.'} Telefon kaybolursa veriler yedek olmadan kurtarılamaz. ›</a>`);
  }
  const seg = (v, l) => `<button class="${S.filter === v ? 'on' : ''}" data-act="filter" data-v="${v}">${l}</button>`;

  app.innerHTML = header('El Defteri',
    `<button class="icon-btn" data-act="lock" aria-label="Kilitle">${I.lock}</button>`,
    `<a class="icon-btn" href="#/ayarlar" aria-label="Ayarlar">${I.gear}</a>`) +
    `<div class="page">
      ${banners.join('')}
      ${alerts.length ? `<section><h2 class="sec">Yaklaşan süreler</h2><div class="list">${alerts.map(a => a.h).join('')}</div></section>` : ''}
      <section>
        <div class="sec-row"><h2 class="sec">Dosyalar</h2><div class="seg">${seg('aktif', 'Aktif')}${seg('kapandi', 'Kapanan')}</div></div>
        <input class="search" id="q" type="search" placeholder="Unvan, dosya kodu veya VKN ara" value="${esc(S.q)}">
        <div id="mlist" class="list"></div>
      </section>
    </div>
    <button class="fab" data-act="newM">${I.plus}<span>Yeni dosya</span></button>`;
  $('#q').oninput = e => { S.q = e.target.value; drawMList(); };
  drawMList();
}
function drawMList() {
  const q = S.q.trim().toLocaleLowerCase('tr');
  const list = all('mukellef')
    .filter(m => (m.durum || 'aktif') === S.filter)
    .filter(m => !q || [m.unvan, m.kod, m.vkn, m.tckn].some(x => (x || '').toLocaleLowerCase('tr').includes(q)))
    .sort((a, b) => coll.compare(a.unvan, b.unvan));
  $('#mlist').innerHTML = list.map(m => {
    const lc = lastContact(m.id);
    const og = byM('gorev', m.id).filter(g => !g.bitti).length;
    return `<a class="row" href="#/m/${m.id}">
      <div class="row-main">
        <div class="row-title">${esc(m.unvan)}</div>
        <div class="row-sub">${esc([m.kod, m.vkn ? 'VKN ' + m.vkn : m.tckn && 'TCKN ' + m.tckn, m.donem].filter(Boolean).join(' · '))}</div>
        <div class="row-sub">${lc ? 'Son temas: ' + relPast(lc) : 'Henüz görüşme kaydı yok'}${og ? ` · ${og} açık süre` : ''}</div>
      </div><span class="chev">›</span></a>`;
  }).join('') || `<p class="empty">${q ? 'Eşleşen dosya yok.' : S.filter === 'aktif' ? 'Henüz dosya yok. Sağ alttaki <b>Yeni dosya</b> ile başla.' : 'Kapanan dosya yok.'}</p>`;
}

/* ---------- mükellef dosyası ---------- */
function renderDetail(id, tab) {
  const m = S.items.get(id);
  const nK = byM('kayit', id).length, nB = byM('belge', id).length, nG = byM('gorev', id).filter(g => !g.bitti).length;
  const tabs = [['ozet', 'Özet'], ['kayitlar', `Görüşmeler${nK ? ` (${nK})` : ''}`], ['belgeler', `Belgeler${nB ? ` (${nB})` : ''}`], ['sureler', `Süreler${nG ? ` (${nG})` : ''}`]];
  const body = { ozet: ozetHTML, kayitlar: kayitlarHTML, belgeler: belgelerHTML, sureler: surelerHTML }[tab]?.(m) ?? ozetHTML(m);
  const fab = {
    belgeler: `<button class="fab" data-act="newBelge" data-mid="${id}">${I.plus}<span>Belge ekle</span></button>`,
    sureler: `<button class="fab" data-act="newGorev" data-mid="${id}">${I.plus}<span>Süre / görev</span></button>`,
  }[tab] ?? `<button class="fab" data-act="newKayit" data-mid="${id}">${I.plus}<span>Görüşme notu</span></button>`;
  app.innerHTML = header(m.unvan,
    `<a class="icon-btn" href="#/" aria-label="Geri">${I.back}</a>`,
    `<button class="icon-btn" data-act="editM" data-id="${id}" aria-label="Düzenle">${I.edit}</button>`) +
    `<nav class="tabs">${tabs.map(([k, l]) => `<a href="#/m/${id}/${k}" class="${k === tab ? 'on' : ''}">${l}</a>`).join('')}</nav>
     <div class="page">${body}</div>${fab}`;
}

function ozetHTML(m) {
  const rows = [
    ['Dosya kodu', esc(m.kod)], ['VKN', esc(m.vkn)], ['TCKN', esc(m.tckn)], ['Vergi dairesi', esc(m.vergiDairesi)],
    ['Faaliyet', esc(m.faaliyet)],
    ['İnceleme', esc([INC_TUR[m.incelemeTuru], m.vergiTuru].filter(Boolean).join(' · '))], ['Dönem', esc(m.donem)],
    ['Gerekçe', esc(m.gerekce)],
    ['İş emri', esc([m.isEmriNo, fmtD(m.isEmriTarihi)].filter(Boolean).join(' · '))],
    ['Başlama', esc(fmtD(m.baslamaTarihi))],
    ['Bitiş süresi', m.bitisTarihi ? `${esc(fmtD(m.bitisTarihi))} ${isAktif(m) ? badge(m.bitisTarihi) : ''}` : ''],
    ['Adres', esc(m.adres)], ['Durum', isAktif(m) ? 'Aktif' : 'Kapandı'],
  ].filter(r => r[1]);
  const kisiler = m.kisiler || [];
  const lc = lastContact(m.id);
  return `
    <section class="card"><dl class="info">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl></section>
    <section>
      <div class="sec-row"><h2 class="sec">Kişiler</h2><button class="btn sm" data-act="kisi" data-mid="${m.id}">+ Ekle</button></div>
      <div class="list">${kisiler.map(k => `<div class="row">
        <button class="row-main plain" data-act="kisi" data-mid="${m.id}" data-kid="${k.id}">
          <div class="row-title">${esc(k.ad)}</div>
          <div class="row-sub">${esc([k.rol, k.tel, k.eposta].filter(Boolean).join(' · '))}</div>
        </button>
        ${k.tel ? `<a class="icon-btn tint" href="tel:${esc(telHref(k.tel))}" data-act="call" data-mid="${m.id}" data-kid="${k.id}" aria-label="Ara">${I.phone}</a>` : ''}
        ${k.eposta ? `<a class="icon-btn tint" href="mailto:${esc(k.eposta)}" aria-label="E-posta">${I.mail}</a>` : ''}
      </div>`).join('') || '<p class="empty">Mükellef, yetkili ve muhasebeci iletişim bilgilerini ekle. Buradan aradığında, görüşme bitince not alman hatırlatılır.</p>'}</div>
    </section>
    ${m.not ? `<section><h2 class="sec">Genel not</h2><div class="card pre">${esc(m.not)}</div></section>` : ''}
    <section class="card stats">
      <div><b>${byM('kayit', m.id).length}</b><span>görüşme</span></div>
      <div><b>${lc ? relPast(lc) : '—'}</b><span>son temas</span></div>
      <div><b>${byM('belge', m.id).length}</b><span>belge</span></div>
    </section>
    <div class="btn-row">
      <button class="btn" data-act="toggleDurum" data-id="${m.id}">${isAktif(m) ? 'Dosyayı kapat' : 'Dosyayı yeniden aç'}</button>
      <button class="btn danger-text" data-act="delM" data-id="${m.id}">Dosyayı sil</button>
    </div>`;
}

function mukellefSheet(m = null) {
  const v = m || { incelemeTuru: 'tam' };
  const docs = [];      // eklenecek belgeler: { file, tur }
  const foundKisi = []; // belgeden bulunan kişiler
  const form = openSheet(m ? 'Dosyayı düzenle' : 'Yeni dosya', `
    <div class="autofill">
      <button type="button" class="btn primary block" data-autofill>${I.doc} Belgeden doldur</button>
      <p class="hint">İş emri, beyanname vb. seç (PDF, taranmış belge ya da fotoğraf). Bilgiler telefonun içinde okunur, hiçbir yere gönderilmez. Seçilen belgeler dosyaya da eklenir.</p>
      <div class="af-status" aria-live="polite"></div>
    </div>
    ${field('Unvan / Ad Soyad', 'unvan', v.unvan, { required: true })}
    ${field('Dosya kodu', 'kod', v.kod, { placeholder: 'ör. 2026/14' })}
    <div class="row2">${field('VKN', 'vkn', v.vkn, { inputmode: 'numeric' })}${field('TCKN', 'tckn', v.tckn, { inputmode: 'numeric' })}</div>
    ${field('Vergi dairesi', 'vergiDairesi', v.vergiDairesi)}
    ${field('Faaliyet (işi)', 'faaliyet', v.faaliyet)}
    <div class="row2">${select('İnceleme türü', 'incelemeTuru', v.incelemeTuru, Object.entries(INC_TUR))}${field('İncelenen dönem', 'donem', v.donem, { placeholder: 'ör. 2024' })}</div>
    <div class="row2">${field('Vergi türü', 'vergiTuru', v.vergiTuru, { placeholder: 'ör. KDV' })}${field('Gerekçe', 'gerekce', v.gerekce)}</div>
    <div class="row2">${field('İş emri sayısı', 'isEmriNo', v.isEmriNo)}${field('İş emri tarihi', 'isEmriTarihi', v.isEmriTarihi, { type: 'date' })}</div>
    <div class="row2">${field('İncelemeye başlama', 'baslamaTarihi', v.baslamaTarihi, { type: 'date' })}${field('Bitiş süresi', 'bitisTarihi', v.bitisTarihi, { type: 'date' })}</div>
    <p class="hint">Bitiş süresi, başlama tarihine göre otomatik önerilir (VUK 140: tam inceleme 12 ay, sınırlı 6 ay; ek süre hariç). Mutlaka kontrol et.</p>
    ${textarea('Adres', 'adres', v.adres, 2)}
    ${textarea('Genel not', 'not', v.not, 3, { placeholder: 'Faaliyet konusu, dikkat edilecek hususlar…' })}
    <p class="hint">“Dosya kodu” takvime eklenen hatırlatmalarda unvan yerine kullanılır.</p>`,
  { onSubmit: async (f, fd) => {
    const item = m ? { ...m } : { id: uid(), kind: 'mukellef', durum: 'aktif', kisiler: [] };
    for (const k of ['unvan', 'kod', 'vkn', 'tckn', 'vergiDairesi', 'faaliyet', 'incelemeTuru', 'donem', 'vergiTuru', 'gerekce', 'isEmriNo', 'isEmriTarihi', 'baslamaTarihi', 'bitisTarihi', 'adres', 'not']) item[k] = String(fd.get(k) ?? '').trim();
    const kisiler = [...(item.kisiler || [])];
    for (const k of foundKisi) {
      // Mükellef ile SMMM aynı e-postayı kullanabilir: yalnızca aynı rol ya da aynı kişi birleşir
      const same = kisiler.find(x => fold(x.ad) === fold(k.ad) || (x.rol === k.rol && ((k.tel && telHref(x.tel) === telHref(k.tel)) || (k.eposta && x.eposta === k.eposta))));
      if (same) { same.tel ||= k.tel; same.eposta ||= k.eposta; } else kisiler.push({ id: uid(), ...k });
    }
    item.kisiler = kisiler;
    await save(item);
    for (const d of docs) {
      const fileId = uid();
      await saveFile(fileId, await d.file.arrayBuffer());
      await save({ id: uid(), kind: 'belge', mid: item.id, tur: d.tur, ad: d.file.name, mime: d.file.type || 'application/octet-stream', size: d.file.size, aciklama: d.baslik || '', fileId });
    }
    if (docs.length) toast(`${docs.length} belge dosyaya eklendi`);
    if (!m) location.hash = `#/m/${item.id}`;
  } });
  const e = form.elements;
  const status = form.querySelector('.af-status');
  const LABELS = { unvan: 'Unvan', vkn: 'VKN', tckn: 'TCKN', vergiDairesi: 'Vergi dairesi', faaliyet: 'Faaliyet', incelemeTuru: 'İnceleme türü', donem: 'Dönem', vergiTuru: 'Vergi türü', gerekce: 'Gerekçe', isEmriNo: 'İş emri sayısı', isEmriTarihi: 'İş emri tarihi', adres: 'Adres' };
  form.querySelector('[data-autofill]').onclick = async ev => {
    const btn = ev.currentTarget;
    const files = await pickFiles('application/pdf,image/*');
    if (!files.length) return;
    btn.disabled = true;
    const filled = new Set();
    try {
      // İş emri önce işlensin; ilk bulunan değer geçerli olur
      const results = [];
      for (const file of files) {
        status.textContent = `${file.name}: okunuyor…`;
        let text = '';
        try { text = await extractText(file, msg => { status.textContent = `${file.name}: ${msg}`; }); } catch (err) { console.error(err); }
        const r = parse(text);
        results.push(r);
        docs.push({ file, tur: r.tur || 'Diğer', baslik: r.baslik });
      }
      results.sort((a, b) => (b.tur === 'İş emri') - (a.tur === 'İş emri'));
      for (const r of results) {
        for (const [k, val] of Object.entries(r.fields)) {
          const el = e[k];
          if (!el || filled.has(k) || (el.value && !el.dataset.af && !(k === 'incelemeTuru' && !m))) continue;
          el.value = val; el.dataset.af = '1'; el.classList.add('filled'); filled.add(k);
          el.addEventListener('input', () => el.classList.remove('filled'), { once: true });
        }
        for (const k of r.kisiler) if (!foundKisi.some(x => x.ad === k.ad && x.rol === k.rol)) foundKisi.push(k);
      }
      auto();
      const kisiTxt = foundKisi.map(k => `${k.ad} (${k.rol}${k.tel ? ', ' + k.tel : ''}${k.eposta ? ', ' + k.eposta : ''})`).join('; ');
      status.innerHTML = filled.size || foundKisi.length
        ? `<b>Bulunanlar:</b> ${esc([...filled].map(k => LABELS[k]).join(', ') || '—')}${kisiTxt ? `<br><b>Kişiler:</b> ${esc(kisiTxt)}` : ''}<br><span class="muted">Fosforlu alanları belgeyle karşılaştırıp kontrol et. ${files.length} belge kaydedince dosyaya eklenecek.</span>`
        : `Belgeden bilgi okunamadı; alanları elle doldurabilirsin. ${files.length} belge yine de dosyaya eklenecek.`;
    } finally {
      btn.disabled = false;
    }
  };
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

/* ---------- belgeler ---------- */
function belgelerHTML(m) {
  const bs = byM('belge', m.id).sort((a, b) => b.created - a.created);
  if (!bs.length) return '<p class="empty">İş emri, beyannameler, tutanaklar ve yazışmaları PDF veya fotoğraf olarak ekle. Belgeler bu cihazda şifreli saklanır.</p>';
  return BELGE_TUR.map(t => {
    const g = bs.filter(b => (BELGE_TUR.includes(b.tur) ? b.tur : 'Diğer') === t);
    return g.length ? `<section><h2 class="sec">${esc(t)}</h2><div class="list">${g.map(b => `
      <button class="row" data-act="openBelge" data-id="${b.id}"><span class="row-icon">${I.doc}</span>
        <div class="row-main"><div class="row-title">${esc(b.aciklama || b.ad)}</div>
        <div class="row-sub">${esc(b.aciklama ? b.ad + ' · ' : '')}${fmtSize(b.size)} · ${fmtTs(b.created)}</div></div></button>`).join('')}</div></section>` : '';
  }).join('');
}
function belgeSheet(mid) {
  openSheet('Belge ekle', `
    ${select('Belge türü', 'tur', 'Beyanname', BELGE_TUR.map(t => [t, t]))}
    <label class="fld"><span>Dosya(lar)</span><input type="file" name="dosya" multiple required accept="application/pdf,image/*,.doc,.docx,.xls,.xlsx,.txt"></label>
    ${field('Açıklama (isteğe bağlı)', 'aciklama', '', { placeholder: 'ör. 2025 Ekim KDV beyannamesi' })}
    <p class="hint">Belgeyi kamerayla çekmek için dosya seçerken “Fotoğraf Çek” ya da “Belgeleri Tara” seçeneğini kullan.</p>`,
  { submitLabel: 'Ekle', onSubmit: async (f, fd) => {
    const files = fd.getAll('dosya').filter(x => x && x.size);
    if (!files.length) { toast('Dosya seç'); return false; }
    for (const file of files) {
      const fileId = uid();
      await saveFile(fileId, await file.arrayBuffer());
      await save({ id: uid(), kind: 'belge', mid, tur: fd.get('tur'), ad: file.name, mime: file.type || 'application/octet-stream', size: file.size, aciklama: fd.get('aciklama').trim(), fileId });
    }
    toast(`${files.length} belge eklendi`);
  } });
}
async function openBelge(id) {
  const b = S.items.get(id);
  const blob = await loadFile(b.fileId, b.mime);
  if (!blob) return toast('Dosya bulunamadı');
  const url = trackURL(blob);
  const view = b.mime.startsWith('image/') ? `<img class="viewer-img" src="${url}" alt="">`
    : b.mime === 'application/pdf' ? `<iframe class="viewer-pdf" src="${url}" title="PDF"></iframe>`
    : '<p class="empty">Bu dosya türü burada gösterilemiyor. “Aç / Paylaş” ile başka bir uygulamada açabilirsin.</p>';
  openSheet(b.aciklama || b.ad, `${view}
    <div class="btn-row">
      <button type="button" class="btn primary" data-act="shareBelge">Aç / Paylaş</button>
      <a class="btn" href="${url}" download="${esc(b.ad)}">İndir</a>
      <button type="button" class="btn danger-text" data-act="delBelge" data-id="${id}">Sil</button>
    </div>
    <p class="hint">“Paylaş” belgeyi uygulamanın dışına çıkarır; yalnızca güvendiğin yere kaydet.</p>`, { wide: true });
  S.viewerFile = new File([blob], b.ad, { type: b.mime });
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
      <div class="row-title${g.bitti ? ' strike' : ''}">${esc(g.baslik)}</div>
      <div class="row-sub">${fmtD(g.tarih)}${g.not ? ' · ' + esc(g.not) : ''}</div>
    </button>
    ${g.bitti ? '' : badge(g.tarih)}
    ${g.bitti ? '' : `<button class="icon-btn tint" data-act="icsGorev" data-id="${g.id}" aria-label="Takvime ekle">${I.cal}</button>`}
  </div>`;
  return `
    ${m.bitisTarihi ? `<section class="card bitis"><div><div class="muted">İnceleme bitiş süresi</div><b>${fmtD(m.bitisTarihi)}</b> ${isAktif(m) ? badge(m.bitisTarihi) : ''}</div>
      <button class="icon-btn tint" data-act="icsBitis" data-mid="${m.id}" aria-label="Takvime ekle">${I.cal}</button></section>` : ''}
    <section><h2 class="sec">Açık süreler ve görevler</h2><div class="list">${open.map(row).join('') || '<p class="empty">Açık süre yok. İbraz süresi, ek süre, cevap süreleri gibi tarihleri ekle; ana sayfada son 7 gün kala uyarı çıkar.</p>'}</div></section>
    ${done.length ? `<section><h2 class="sec">Tamamlananlar</h2><div class="list">${done.map(row).join('')}</div></section>` : ''}
    <p class="hint">📅 ile süreyi iPhone Takvimi'ne alarmlı ekleyebilirsin (bir gün önce ve aynı gün 09:00). Takvim kaydında mükellef unvanı değil, dosya kodu yazar.</p>`;
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
  const sw = (group, v, label) => `<button class="swatch${S.settings[group] === v ? ' on' : ''}" data-act="theme" data-g="${group}" data-v="${v}">
    <span class="swatch-paper" data-paper="${group === 'paper' ? v : S.settings.paper}" data-paper-color="${group === 'paperColor' ? v : S.settings.paperColor}"></span><span>${label}</span></button>`;
  app.innerHTML = header('Ayarlar', `<a class="icon-btn" href="#/" aria-label="Geri">${I.back}</a>`) + `<div class="page">
    <section class="card">
      <h2 class="sec">Sayfa görünümü</h2>
      <div class="swatches">${PAPERS.map(([v, l]) => sw('paper', v, l)).join('')}</div>
      <h2 class="sec sub">Kağıt rengi</h2>
      <div class="swatches">${PAPER_COLORS.map(([v, l]) => sw('paperColor', v, l)).join('')}</div>
    </section>
    <section class="card">
      <h2 class="sec">Yedekleme</h2>
      <p class="muted">Yedek dosyası şifrelidir; açmak için yedeği aldığın andaki şifren gerekir. Dosyayı “Dosyalar” uygulamasına ya da güvendiğin bir yere kaydet. Yeni telefona geçerken kilit ekranındaki “Yedekten geri yükle” ile aktarırsın.</p>
      <p>Son yedek: <b>${S.lastBackup ? fmtTs(S.lastBackup, true) : 'hiç alınmadı'}</b></p>
      <div class="btn-row"><button class="btn primary" data-act="exportBackup">Yedek al</button><button class="btn" data-act="importBackup">Yedekten geri yükle</button></div>
    </section>
    <section class="card">
      <h2 class="sec">Güvenlik</h2>
      ${select('Otomatik kilit', 'autolock', String(S.settings.autolock), [['1', '1 dakika'], ['3', '3 dakika'], ['5', '5 dakika'], ['10', '10 dakika'], ['30', '30 dakika']])}
      <div class="btn-row"><button class="btn" data-act="chpw">Şifreyi değiştir</button><button class="btn" data-act="lock">Şimdi kilitle</button></div>
    </section>
    <section class="card">
      <h2 class="sec">Depolama</h2>
      <p id="storeInfo" class="muted">Hesaplanıyor…</p>
    </section>
    <section class="card">
      <h2 class="sec">Gizlilik</h2>
      <p class="muted">Bu uygulama internete veri göndermez. Dosyalar, notlar, ses kayıtları ve belgeler bu cihazda AES-256 ile şifreli tutulur; şifre olmadan okunamaz. Uygulamanın kendisi yalnızca ilk yüklemede ve güncellemelerde indirilir, sonra internetsiz de çalışır.</p>
    </section>
    <section class="card">
      <h2 class="sec">Tehlikeli bölge</h2>
      <button class="btn danger-text" data-act="wipe">Bu cihazdaki tüm verileri sil</button>
    </section>
    <p class="muted center">El Defteri 1.2</p>
  </div>`;
  $('select[name=autolock]').onchange = e => { S.settings.autolock = +e.target.value; db.metaSet('settings', S.settings); toast('Kaydedildi'); };
  (async () => {
    const est = await navigator.storage?.estimate?.();
    const per = await navigator.storage?.persisted?.();
    const el = $('#storeInfo');
    if (!el) return;
    el.innerHTML = `${est ? `Kullanılan: <b>${fmtSize(est.usage || 0)}</b>. ` : ''}${isStandalone() ? 'Ana ekran uygulaması olarak çalışıyor.' : '<b>Ana ekrana eklenmemiş</b>: Safari → Paylaş → Ana Ekrana Ekle.'} ${per ? 'Kalıcı depolama açık.' : ''}`;
  })();
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
    ${S.vault ? '<p class="banner warn">Bu cihazdaki mevcut tüm veriler silinip yerine yedek yüklenecek.</p>' : ''}
    ${userField}
    ${field('Yedeğin şifresi', 'pw', '', { type: 'password', required: true, autocomplete: 'current-password' })}
    <p class="hint">Geri yüklemeden sonra uygulamanın şifresi, yedeği aldığın andaki şifre olur.</p>`,
  { submitLabel: 'Yükle', onSubmit: async (f, fd) => {
    const vault = cr.vaultFromJSON(obj.vault);
    const key = await cr.openVault(fd.get('pw'), vault);
    if (!key) { toast('Şifre yanlış'); return false; }
    await db.replaceAll(vault,
      obj.items.map(r => ({ id: r.id, kind: r.kind, iv: cr.unb64(r.iv), data: cr.unb64(r.data) })),
      obj.files.map(r => ({ id: r.id, iv: cr.unb64(r.iv), data: cr.unb64(r.data) })));
    S.vault = vault; S.key = key;
    S.lastBackup = Date.parse(obj.createdAt);
    await db.metaSet('lastBackup', S.lastBackup);
    await loadItems();
    S.lastActive = Date.now();
    location.hash = '#/';
    toast('Yedek yüklendi');
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
  theme: async d => { S.settings[d.g] = d.v; applyTheme(); await db.metaSet('settings', S.settings); renderSettings(); },
  lock: () => lock(),
  filter: d => { S.filter = d.v; renderHome(); },
  newM: () => mukellefSheet(),
  editM: d => mukellefSheet(S.items.get(d.id)),
  toggleDurum: async d => { const m = S.items.get(d.id); await save({ ...m, durum: isAktif(m) ? 'kapandi' : 'aktif' }); render(); },
  delM: async d => {
    const m = S.items.get(d.id);
    if (!confirm(`“${m.unvan}” dosyası ve içindeki tüm notlar, ses kayıtları, belgeler ve süreler silinsin mi? Bu işlem geri alınamaz.`)) return;
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
  newBelge: d => belgeSheet(d.mid),
  openBelge: d => openBelge(d.id),
  shareBelge: () => S.viewerFile && shareOrDownload(S.viewerFile),
  delBelge: async d => {
    if (!confirm('Belge silinsin mi?')) return;
    const b = S.items.get(d.id);
    await removeItems([b.id], [b.fileId]);
    closeSheet(); render();
  },
  newGorev: d => gorevSheet(d.mid),
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
  chpw: () => openSheet('Şifreyi değiştir', `${userField}
    ${field('Mevcut şifre', 'old', '', { type: 'password', required: true, autocomplete: 'current-password' })}
    ${field('Yeni şifre', 'p1', '', { type: 'password', required: true, autocomplete: 'new-password', extra: 'minlength="6"' })}
    ${field('Yeni şifre (tekrar)', 'p2', '', { type: 'password', required: true, autocomplete: 'new-password', extra: 'minlength="6"' })}
    <p class="hint">Daha önce aldığın yedekler, alındıkları andaki şifreyle açılmaya devam eder.</p>`,
  { onSubmit: async (f, fd) => {
    if (fd.get('p1') !== fd.get('p2')) { toast('Yeni şifreler aynı değil'); return false; }
    const k = await cr.openVault(fd.get('old'), S.vault, true);
    if (!k) { toast('Mevcut şifre yanlış'); return false; }
    const vault = await cr.wrapWith(k, fd.get('p1'));
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
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  S.vault = await db.metaGet('vault');
  S.settings = { ...S.settings, ...(await db.metaGet('settings')) };
  applyTheme();
  S.lastBackup = await db.metaGet('lastBackup');
  render();
}
init();
