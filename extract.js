// Belgeden bilgi çıkarma. Tamamen cihaz içinde çalışır; hiçbir veri dışarı gönderilmez.
// PDF'te metin katmanı varsa doğrudan okunur, yoksa (taranmış belge / fotoğraf) Türkçe OCR yapılır.

const base = new URL('vendor/', location.href).href;
let pdfLib = null;
let ocrWorker = null;
let ocrProgress = null;

function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = res;
    s.onerror = () => rej(new Error('Bileşen yüklenemedi: ' + src));
    document.head.append(s);
  });
}
async function pdfjs() {
  if (!pdfLib) {
    await loadScript(base + 'pdfjs/pdf.min.js');
    pdfLib = window.pdfjsLib;
    pdfLib.GlobalWorkerOptions.workerSrc = base + 'pdfjs/pdf.worker.min.js';
  }
  return pdfLib;
}
async function ocr() {
  if (!ocrWorker) {
    await loadScript(base + 'tesseract/tesseract.min.js');
    ocrWorker = await window.Tesseract.createWorker('tur', 1, {
      workerPath: base + 'tesseract/worker.min.js',
      corePath: base + 'tesseract',
      langPath: base + 'tesseract',
      workerBlobURL: false,
      cacheMethod: 'none',
      gzip: true,
      logger: m => ocrProgress?.(m),
    });
  }
  return ocrWorker;
}
async function ocrImage(img, onProgress) {
  ocrProgress = m => {
    if (m.status === 'recognizing text') onProgress?.(`Yazı tanınıyor… %${Math.round(m.progress * 100)}`);
    else if (m.status) onProgress?.('Yazı tanıma hazırlanıyor…');
  };
  const w = await ocr();
  const { data } = await w.recognize(img);
  return data.text;
}

// PDF metnini satırlara ayır (aynı yükseklikteki parçalar = bir satır)
function pageLines(tc) {
  const rows = [];
  for (const it of tc.items) {
    if (!it.str || !it.str.trim()) continue;
    const y = it.transform[5], x = it.transform[4];
    let r = rows.find(r => Math.abs(r.y - y) <= 3);
    if (!r) rows.push(r = { y, parts: [] });
    r.parts.push({ x, w: it.width || 0, s: it.str, h: Math.abs(it.transform[3]) || 10 });
  }
  rows.sort((a, b) => b.y - a.y);
  return rows.map(r => {
    r.parts.sort((a, b) => a.x - b.x);
    let out = '', end = null;
    for (const p of r.parts) {
      if (end !== null && p.x - end > p.h * 0.2 && !out.endsWith(' ')) out += ' ';
      out += p.s;
      end = p.x + p.w;
    }
    return out.replace(/\s+/g, ' ').trim();
  });
}

export async function extractText(file, onProgress) {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  if (!isPdf) {
    if (!file.type.startsWith('image/')) return '';
    return ocrImage(file, onProgress);
  }
  onProgress?.('PDF okunuyor…');
  const lib = await pdfjs();
  const doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false, disableFontFace: true }).promise;
  const pages = Math.min(doc.numPages, 6);
  const lines = [];
  for (let i = 1; i <= pages; i++) lines.push(...pageLines(await (await doc.getPage(i)).getTextContent()));
  let text = lines.join('\n');
  if (text.replace(/\s/g, '').length < 40) {
    // Taranmış PDF: sayfaları resme çevirip OCR uygula
    const parts = [];
    for (let i = 1; i <= Math.min(doc.numPages, 3); i++) {
      onProgress?.(`Taranmış sayfa ${i} hazırlanıyor…`);
      const page = await doc.getPage(i);
      const vp = page.getViewport({ scale: 2 });
      const c = document.createElement('canvas');
      c.width = vp.width; c.height = vp.height;
      await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
      parts.push(await ocrImage(c, onProgress));
      c.width = c.height = 0;
    }
    text = parts.join('\n');
  }
  doc.destroy();
  return text;
}

/* ---------- ayrıştırma ---------- */
const FOLD = { 'Ç': 'c', 'ç': 'c', 'Ğ': 'g', 'ğ': 'g', 'İ': 'i', 'I': 'i', 'ı': 'i', 'Ö': 'o', 'ö': 'o', 'Ş': 's', 'ş': 's', 'Ü': 'u', 'ü': 'u', 'Â': 'a', 'â': 'a', 'Î': 'i', 'î': 'i', 'Û': 'u', 'û': 'u' };
// Uzunluğu koruyarak küçük harfe ve aksansıza çevirir (eşleşme konumu orijinal metinde de geçerli olsun diye)
const fold = s => s.replace(/[\s\S]/g, c => { const f = FOLD[c] ?? c.toLowerCase(); return f.length === 1 ? f : c; });

const L = {
  unvan: [/soyadi\s*\(unvani\)/, /adi\s*soyadi\s*[/,]?\s*\(?unvani\)?/, /mukellefin\s+(?:adi\s+soyadi|unvani|adi)(?:\s*[/,]\s*unvani)?/, /ticaret\s+unvani/, /^unvani?\b/, /\bunvani\b/],
  unvanDevam: [/adi\s*\(unvanin\s+devami\)/],
  vkn: [/vergi\s+kimlik\s+(?:no|numarasi)\b/, /\bv\.?\s?k\.?\s?n\.?\b/],
  tckn: [/t\.?\s?c\.?\s+kimlik\s+(?:no|numarasi)\b/, /\btckn\b/],
  vd: [/vergi\s+dairesi(?:\s+mudurlugu)?(?:nun\s+adi|\s+adi)?\s*[:]/, /^vergi\s+dairesi\b/, /\bbagli\s+oldugu\s+vergi\s+dairesi\b/],
  donem: [/incelenecek\s+(?:donem|yil)(?:ler)?(?:i)?\b/, /inceleme(?:ye\s+tabi)?\s+donem(?:i|leri)?\b/, /^(?:vergilendirme\s+)?donemi?\b(?!\s*tipi)/],
  yil: [/^yili?\b/, /\byil\s*[:]/],
  ay: [/^ayi?\b/, /\bay\s*[:]/],
  isEmriNo: [/is\s+emri(?:nin)?\s+(?:no|numarasi|sayisi)\b/, /^sayi(?:si)?\b/],
  isEmriTarihi: [/is\s+emri(?:nin)?\s+tarihi\b/, /^tarih(?:i)?\b/, /\btarih(?:i)?\s*:/],
  adres: [/is\s*yeri\s+adresi\b/, /ikametgah\s+adresi\b/, /^adres(?:i)?\b/, /\badresi\s*[:]/],
  tel: [/(?:cep\s+)?telefon(?:\s+(?:no|numarasi))?\b/, /^tel\b/, /\btel\s*[:]/],
};
const ALL_LABELS = Object.values(L).flat().map(r => new RegExp(r.source.replace(/^\^/, '\\s'), r.flags));

function cutAtNextLabel(v) {
  const f = fold(v);
  let cut = v.length;
  for (const re of ALL_LABELS) { const m = re.exec(f); if (m && m.index > 0 && m.index < cut) cut = m.index; }
  return v.slice(0, cut).trim();
}
function after(lines, res, { nextLine = true, raw = false } = {}) {
  for (const re of res) {
    for (let i = 0; i < lines.length; i++) {
      const m = re.exec(fold(lines[i]));
      if (!m) continue;
      let v = lines[i].slice(m.index + m[0].length).replace(/^[\s:.\-–—=|;_!'"“”]+/, '').trim();
      v = v.replace(/^[1lI](?=\d{2}[./]\d{2}[./]\d{4})/, '');
      if (!raw) v = cutAtNextLabel(v);
      if (!v && nextLine && lines[i + 1]) v = raw ? lines[i + 1].trim() : cutAtNextLabel(lines[i + 1].trim());
      if (v) return v;
    }
  }
  return '';
}
const PHONE = /(?:\+?90[\s-]?)?\(?0?\s?[2-5]\d{2}\)?[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}/;
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/;
function toISO(s) {
  const m = /(?<![\d.\-/])(\d{1,2})[./](\d{1,2})[./](\d{4})(?!\d)/.exec(s || '');
  if (!m) return '';
  const [d, mo, y] = [+m[1], +m[2], +m[3]];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 1990 || y > 2100) return '';
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
const clean = s => s.replace(/\s+/g, ' ').replace(/^[\s:.,;|_—–!'"“”-]+|[\s:,;|_—–-]+$/g, '').trim();
const titleish = s => s && /[A-Za-zÇĞİÖŞÜçğıöşü]{2}/.test(s) && s.length <= 160;

export function parse(text) {
  const lines = text.split(/\r?\n/).map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const F = fold(lines.join('\n'));
  const tur = /is\s+emri|inceleme\s+emri/.test(F) ? 'İş emri' : /beyanname/.test(F) ? 'Beyanname' : /tutanak/.test(F) ? 'Tutanak' : null;

  // Beyannamelerde mali müşavir bölümünü ayır
  let split = lines.findIndex(l => /\b(?:hazirlayan|duzenleyen|hazirlayanin|duzenleyenin)\b/.test(fold(l)));
  if (split < 3) split = -1;
  const main = split > 0 ? lines.slice(0, split) : lines;
  const smmm = split > 0 ? lines.slice(split) : [];

  const out = {};
  let unvan = after(main, L.unvan);
  const devam = after(main, L.unvanDevam);
  if (unvan && devam && !unvan.includes(devam)) unvan += ' ' + devam;
  if (titleish(clean(unvan))) out.unvan = clean(unvan);

  const vknRaw = after(main, L.vkn);
  const vkn = (vknRaw.match(/\b\d{10}\b/) || vknRaw.match(/\b[1l](\d{10})\b/)?.slice(1) || [])[0];
  const tckn = (after(main, L.tckn).match(/\b\d{11}\b/) || [])[0];
  if (vkn || tckn) out.vkn = vkn || tckn;

  let vd = after(main, L.vd);
  if (!vd) { const m = /([a-zcgiosu]+(?: [a-zcgiosu]+)?) vergi dairesi(?: mudurlugu)?\b/.exec(F); if (m) vd = lines.join('\n').slice(m.index, m.index + m[1].length); }
  vd = clean(vd.replace(/vergi\s+dairesi.*$/i, '').replace(/müdürlüğü/i, ''));
  if (titleish(vd) && vd.length < 60) out.vergiDairesi = vd.toLocaleUpperCase('tr') === vd ? vd.toLocaleLowerCase('tr').replace(/(^|\s)\S/g, c => c.toLocaleUpperCase('tr')) : vd;

  let donem = clean(after(main, L.donem));
  if (!donem) {
    const y = (after(main, L.yil).match(/\b(19|20)\d{2}\b/) || [])[0];
    const a = clean(after(main, L.ay)).split(' ')[0];
    if (y) donem = (a && /^[A-Za-zÇĞİÖŞÜçğıöşü]{3,}$/.test(a) ? a + ' ' : '') + y;
  }
  if (donem && donem.length < 60 && /\d{4}/.test(donem)) out.donem = donem;

  if (/sinirli\s+(?:inceleme|olarak)/.test(F)) out.incelemeTuru = 'sinirli';
  else if (/tam\s+(?:inceleme|olarak)/.test(F)) out.incelemeTuru = 'tam';

  if (tur === 'İş emri') {
    const no = clean(after(main, L.isEmriNo)).split(' ')[0];
    if (no && /\d/.test(no) && no.length < 40) out.isEmriNo = no;
    const t = toISO(after(main, L.isEmriTarihi)) || toISO(lines.slice(0, 15).join(' '));
    if (t) out.isEmriTarihi = t;
  }

  const adres = clean(after(main, L.adres));
  if (adres.length > 8 && adres.length < 200) out.adres = adres;

  const kisiler = [];
  const tel = (after(main, L.tel, { raw: true }).match(PHONE) || [])[0];
  const mail = (main.join(' ').match(EMAIL) || [])[0];
  if (tel || mail) kisiler.push({ ad: out.unvan || 'Mükellef', rol: 'Mükellef', tel: tel ? clean(tel) : '', eposta: mail || '' });
  if (smmm.length) {
    let ad = after(smmm, [/soyadi\s*,?\s*adi\s*\(?unvani\)?/, /adi\s*soyadi/, /soyadi\s*\(unvani\)/, /unvani/]);
    const adDevam = after(smmm, [/^adi\b/, /adi\s*\(unvanin\s+devami\)/]);
    if (ad && adDevam && !ad.includes(adDevam)) ad = adDevam + ' ' + ad;
    const st = (after(smmm, L.tel, { raw: true }).match(PHONE) || [])[0];
    const sm = (smmm.join(' ').match(EMAIL) || [])[0];
    if (titleish(clean(ad)) || st || sm) kisiler.push({ ad: titleish(clean(ad)) ? clean(ad) : 'Mali müşavir', rol: 'SMMM / muhasebeci', tel: st ? clean(st) : '', eposta: sm || '' });
  }
  return { tur, fields: out, kisiler };
}
