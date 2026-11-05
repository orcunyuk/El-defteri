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
// OCR öncesi görüntü iyileştirme: uygun boyuta büyüt, gri tonla, bölgesel eşikle siyah-beyaz yap.
// Renkli tablo zeminleri, filigran ve fotoğraftaki gölgeler böylece silinir.
async function prepare(img) {
  const src = img instanceof HTMLCanvasElement ? img : await createImageBitmap(img);
  const scale = Math.min(3, Math.max(1, 2000 / src.width));
  const w = Math.round(src.width * scale), h = Math.round(src.height * scale);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.imageSmoothingQuality = 'high';
  x.drawImage(src, 0, 0, w, h);
  src.close?.();
  const d = x.getImageData(0, 0, w, h), a = d.data;
  const g = new Uint8ClampedArray(w * h);
  for (let i = 0, j = 0; j < g.length; i += 4, j++) g[j] = 0.299 * a[i] + 0.587 * a[i + 1] + 0.114 * a[i + 2];
  // İntegral görüntü ile pencere ortalaması
  const I = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let xx = 0; xx < w; xx++) { row += g[y * w + xx]; I[(y + 1) * (w + 1) + xx + 1] = I[y * (w + 1) + xx + 1] + row; }
  }
  const r = Math.max(12, Math.round(w / 80));
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
    for (let xx = 0; xx < w; xx++) {
      const x0 = Math.max(0, xx - r), x1 = Math.min(w, xx + r + 1);
      const sum = I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0];
      const mean = sum / ((x1 - x0) * (y1 - y0));
      const v = g[y * w + xx];
      const k = (y * w + xx) * 4;
      a[k] = a[k + 1] = a[k + 2] = (v < mean * 0.88 && v < 200) ? 0 : 255;
    }
  }
  x.putImageData(d, 0, 0);
  return c;
}
async function ocrImage(img, onProgress) {
  ocrProgress = m => {
    if (m.status === 'recognizing text') onProgress?.(`Yazı tanınıyor… %${Math.round(m.progress * 100)}`);
    else if (m.status) onProgress?.('Yazı tanıma hazırlanıyor…');
  };
  const w = await ocr();
  onProgress?.('Görüntü hazırlanıyor…');
  const c = await prepare(img);
  await w.setParameters({ preserve_interword_spaces: '1' });
  const { data } = await w.recognize(c);
  c.width = c.height = 0;
  // 3+ boşluk = sütun aralığı (PDF'teki \t gibi)
  return data.text.split('\n').map(l => l.replace(/ {3,}/g, '\t').replace(/\s*\|\s*/g, '\t').trim()).join('\n');
}

// PDF metnini satırlara ayır (aynı yükseklikteki parçalar = bir satır)
function pageLines(tc, pageWidth) {
  const mid = pageWidth / 2;
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
    // Büyük boşluk = sütun sınırı (\t); beyannamelerde yan yana iki sütun olur
    let out = '', end = null;
    for (const p of r.parts) {
      const gap = end === null ? 0 : p.x - end;
      // ‖ = sayfanın sol yarısından sağ yarısına geçiş (iki sütunlu bölümler)
      if (end !== null && end < mid && p.x >= mid * 0.97 && gap > p.h) out = out.trimEnd() + '‖';
      else if (gap > p.h * 2.5) out = out.trimEnd() + '\t';
      else if (gap > p.h * 0.2 && !/\s$/.test(out)) out += ' ';
      out += p.s;
      end = p.x + p.w;
    }
    return out.replace(/[ \u00a0]+/g, ' ').replace(/ ?([\t‖]) ?/g, '$1').trim();
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
  for (let i = 1; i <= pages; i++) { const pg = await doc.getPage(i); lines.push(...pageLines(await pg.getTextContent(), pg.getViewport({ scale: 1 }).width)); }
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
// Satırlarda \t = sütun boşluğu, ‖ = sayfanın sol/sağ yarısı sınırı (yalnızca metinli PDF'lerde)
const FOLD = { 'Ç': 'c', 'ç': 'c', 'Ğ': 'g', 'ğ': 'g', 'İ': 'i', 'I': 'i', 'ı': 'i', 'Ö': 'o', 'ö': 'o', 'Ş': 's', 'ş': 's', 'Ü': 'u', 'ü': 'u', 'Â': 'a', 'â': 'a', 'Î': 'i', 'î': 'i', 'Û': 'u', 'û': 'u' };
// Uzunluğu koruyarak küçük harfe ve aksansıza çevirir (eşleşme konumu orijinal metinde de geçerli olsun diye)
const fold = s => s.replace(/[\s\S]/g, c => { const f = FOLD[c] ?? c.toLowerCase(); return f.length === 1 ? f : c; });
const COL = /[\t‖]/;
const JUNK = /^[\s‖:.,\-–—=|;_!'"“”‘’]+/;

const L = {
  unvan: [/^adi\s*\/\s*unvani\b/, /^ad\s*-?\s*soyad\s*\/\s*unvan\b/, /mukellefin\s+(?:adi\s+soyadi|unvani|adi)(?:\s*[/,]\s*unvani)?/, /adi\s*soyadi\s*[/,]?\s*\(?unvani\)?/, /^soyadi\s*\(unvani\)/, /ticaret\s+unvani/, /^unvani?\b/],
  unvanDevam: [/^adi\s*\(unvanin\s+devami\)/],
  konu: [/^konu\b/],
  vknTckn: [/^vkn\s*[/i1l|]?\s*tckn\b/],
  vkn: [/vergi\s+kimlik\s+(?:no|numarasi)\b(?:\s*\(t\.?c\.?\s*kimlik\s+no\))?/, /^v\.?\s?k\.?\s?n\.?\b/, /\bvkn\s*:/],
  tckn: [/t\.?\s?c\.?\s+kimlik\s+(?:no|numarasi)\b/, /\btckn\b/],
  vd: [/vergi\s+dairesi(?:\s+mudurlugu)?\s*:/, /bagli\s+oldugu\s+vergi\s+dairesi\b/, /^vergi\s+dairesi(?=[\t‖])/],
  donem: [/incelenecek\s+(?:donem|yil)(?:ler)?(?:i)?\b/, /inceleme(?:ye\s+tabi)?\s+donem(?:i|leri)?\b/, /^(?:vergilendirme\s+)?donemi\b/],
  kapsam: [/^kapsami?\b/, /inceleme(?:nin)?\s+(?:kapsami|turu|sekli)\b/],
  vergiTuru: [/^vergi\s+turu\b/, /incelenecek\s+vergi\s+turu\b/],
  faaliyet: [/^isi\b/, /^faaliyet\s+konusu\b/, /faaliyet\s+konusu\s*:/, /^meslegi\b/],
  gerekce: [/^(?:incelemenin\s+)?gerekcesi\b/],
  isEmriNo: [/is\s+emri(?:nin)?\s+(?:no|numarasi|sayisi)\b/, /^sayi(?:si)?\b/],
  isEmriTarihi: [/is\s+emri(?:nin)?\s+tarihi\b/, /^tarih(?:i)?\b/, /\btarih(?:i)?\s*:/],
  adres: [/is\s*yeri\s+adresi\b/, /ikametgah\s+adresi\b/, /^adres(?:i)?\s*:/, /^(?:is\s*yeri\s+)?adres(?:i)?\b(?!\s*(?:no|bilgi|kodu))/],
  tel: [/irtibat\s+tel(?:efon)?(?:\s+no)?/, /(?:cep\s+)?telefon(?:u|\s+(?:no|numarasi))?\b/, /^tel\b/, /\btel\s*:/],
  eposta: [/e-?\s?posta(?:\s+adresi)?/],
};
const ALL_LABELS = Object.values(L).flat().map(r => new RegExp(r.source.replace(/^\^/, '(?:^|\\s)'), r.flags));

function cutAtNextLabel(v) {
  const f = fold(v);
  let cut = v.length;
  for (const re of ALL_LABELS) { const m = re.exec(f); if (m && m.index > 0 && m.index < cut) cut = m.index; }
  return v.slice(0, cut).trim();
}
// Etiketten sonraki değeri bulur: aynı satırda (sonraki sütuna kadar) ya da alt satırda
function after(lines, res, { nextLine = true } = {}) {
  for (const re of res) {
    for (let i = 0; i < lines.length; i++) {
      const m = re.exec(fold(lines[i]));
      if (!m) continue;
      let v = lines[i].slice(m.index + m[0].length).replace(JUNK, '').split(COL)[0];
      // OCR, ':' işaretini çoğu zaman '1', 'l' ya da '|' olarak okur
      v = cutAtNextLabel(v.replace(/^[1lI](?=\d{2}[./]\d{2}[./]\d{4})/, '').replace(/^[1lI|](?=\s)/, '').trim());
      if (!v && nextLine && lines[i + 1] && !ALL_LABELS.some(r => r.test(fold(lines[i + 1])))) {
        v = lines[i + 1].split('‖')[0].replace(/\t/g, ' ').replace(JUNK, '').trim();
      }
      if (v) return v;
    }
  }
  return '';
}
// Uzun bir değer alt satıra taştıysa (alt satır etiket/sütun içermiyorsa) birleştir
function afterLong(lines, res) {
  const v = after(lines, res);
  if (!v) return v;
  const i = lines.findIndex(l => l.includes(v));
  const next = lines[i + 1];
  if (i >= 0 && lines[i].length >= 90 && next && !COL.test(next) && !ALL_LABELS.some(r => r.test(fold(next))) && next.length < 120) return v + ' ' + next;
  return v;
}
// VKN ve TCKN kontrol haneleri (OCR hatalarını ayıklamak için)
function validVKN(n) {
  if (!/^\d{10}$/.test(n)) return false;
  const d = [...n].map(Number);
  let sum = 0;
  for (let i = 0; i < 9; i++) { const t = (d[i] + 9 - i) % 10; let v = (t * 2 ** (9 - i)) % 9; if (t && !v) v = 9; sum += v; }
  return (10 - (sum % 10)) % 10 === d[9];
}
function validTCKN(n) {
  if (!/^[1-9]\d{10}$/.test(n)) return false;
  const d = [...n].map(Number);
  const a = ((d[0] + d[2] + d[4] + d[6] + d[8]) * 7 - (d[1] + d[3] + d[5] + d[7])) % 10;
  return (a + 10) % 10 === d[9] && d.slice(0, 10).reduce((x, y) => x + y) % 10 === d[10];
}
// Metindeki kimlik numarasını bulur; OCR'ın karıştırdığı/eklediği karakteri kontrol hanesiyle düzeltir
function idNumber(raw) {
  const mapped = raw.replace(/[Oo]/g, '0').replace(/[Il|]/g, '1').replace(/B/g, '8').replace(/S/g, '5').replace(/Z/g, '2');
  for (const s of [raw, mapped]) {
    const d = s.replace(/\D/g, '');
    if (validVKN(d)) return d;
    if (validTCKN(d)) return d;
    if (d.length === 11 || d.length === 12) for (let i = 0; i < d.length; i++) {
      const c = d.slice(0, i) + d.slice(i + 1);
      if (c.length === 10 && validVKN(c)) return c;
      if (c.length === 11 && validTCKN(c)) return c;
    }
  }
  const d = raw.replace(/\D/g, '');
  return d.length === 10 || d.length === 11 ? d : '';
}
function toISO(s) {
  const m = /(?<![\d.\-/])(\d{1,2})[./](\d{1,2})[./](\d{4})(?!\d)/.exec(s || '');
  if (!m) return '';
  const [d, mo, y] = [+m[1], +m[2], +m[3]];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 1990 || y > 2100) return '';
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
const clean = s => (s || '').replace(/[\t‖]/g, ' ').replace(/\s+/g, ' ').replace(/^[\s:.,;|_—–!'"“”-]+|[\s:,;|_—–-]+$/g, '').trim();
const hasWord = s => s && /[A-Za-zÇĞİÖŞÜçğıöşü]{2}/.test(s);
const title = s => s.toLocaleLowerCase('tr').replace(/(^|[\s(/-])(\S)/g, (m, a, c) => a + c.toLocaleUpperCase('tr'));
const sentence = s => { const l = s.toLocaleLowerCase('tr'); return l.charAt(0).toLocaleUpperCase('tr') + l.slice(1); };
const isUpper = s => s === s.toLocaleUpperCase('tr');
const isCompany = s => /\b(?:ltd|sti|a\.?\s?s|anonim|limited|tic|san|koop|kooperatif|vakf|dernek|holding|ortakligi|sirketi)\b/.test(fold(s));
// Beyannamelerde gerçek kişiler "SOYADI ADI" sırasıyla yazılır → "ADI SOYADI"
function personFromSoyadAdi(s) {
  s = clean(s);
  if (!s || isCompany(s)) return s;
  const w = s.split(' ');
  return w.length >= 2 ? [...w.slice(1), w[0]].join(' ') : s;
}
function phone(s) {
  const m = /(?:\+?90)?[\s(]*0?\s*\(?[2-5]\d{2}\)?[\s-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}/.exec(s || '');
  if (!m) return '';
  let d = m[0].replace(/\D/g, '');
  if (d.startsWith('90') && d.length === 12) d = d.slice(2);
  if (d.length === 10) d = '0' + d;
  return d.length === 11 ? `${d.slice(0, 4)} ${d.slice(4, 7)} ${d.slice(7, 9)} ${d.slice(9)}` : '';
}
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/;
const officialMail = e => /(?:kep\.tr|gov\.tr)$/i.test(e);
function email(lines) {
  const v = (after(lines, L.eposta).match(EMAIL) || [])[0];
  if (v && !officialMail(v)) return v;
  return (lines.join(' ').match(new RegExp(EMAIL, 'g')) || []).find(e => !officialMail(e)) || '';
}
const VERGI_TURU = { gelgecv: 'Gelir Geçici Vergisi', kurgecv: 'Kurumlar Geçici Vergisi', gelv: 'Gelir Vergisi', gelirv: 'Gelir Vergisi', kurv: 'Kurumlar Vergisi', kdv: 'KDV', katmadegerv: 'KDV', otv: 'ÖTV', damgav: 'Damga Vergisi', muhgelv: 'Muhtasar', muhtasar: 'Muhtasar' };
const vergiTuru = s => s.split(/\s*[,;+]\s*|\s+ve\s+/).map(x => VERGI_TURU[fold(x).replace(/[^a-z]/g, '')] || x.trim()).filter(Boolean).join(', ');
function vergiDairesi(s) {
  s = clean(s.replace(/^\d+\s*-\s*/, '').replace(/vergi\s+dairesi\s+müdürlüğü/i, ''));
  if (!hasWord(s) || s.length > 60) return '';
  if (isUpper(s)) s = title(s);
  return s.replace(/\bDkm\b/, 'DKM').replace(/\bMalmd\.?(?=\s|$)/i, 'Malmüdürlüğü').replace(/\b(?:Vd|V\.d)\.?(?=\s|$)/, 'Vergi Dairesi');
}

export function parse(text) {
  // Satır başındaki tablo çizgisi artıklarını (— / | “ .) temizle
  let lines = text.split(/\r?\n/).map(l => l.replace(/[ ]+/g, ' ').trim().replace(/^[\s—–\-_/|.,;:'"“”‘’]+(?=[A-Za-zÇĞİÖŞÜçğıöşü0-9])/, '')).filter(Boolean);
  // Antet/altbilgi (imza, doğrulama, kurum adresi, KEP) mükellef bilgisi değildir
  const sig = lines.findIndex(l => /bu belge,?\s+guvenli\s+elektronik\s+imza/.test(fold(l)));
  if (sig > 0) lines = lines.slice(0, sig);
  lines = lines.filter(l => !/belge\s+dogrulama|kep\s+adresi|internet\s+adresi|faks\s+no|bilgi\s+icin|www\./.test(fold(l)));
  const F = fold(lines.join('\n'));
  const isEmri = /is\s+emri|inceleme\s+emri/.test(F) || (/vergi\s+denetim\s+kurulu/.test(F) && /nezdinde|incelemenin|incelenmesi/.test(F));
  const yoklama = /yoklama\s+fisi|e-?yoklama/.test(F);
  const tur = isEmri ? 'İş emri' : yoklama ? 'Yoklama fişi' : /beyanname/.test(F) ? 'Beyanname' : /tutanak/.test(F) ? 'Tutanak' : null;

  // Beyannamelerde "Beyannameyi düzenleyen" bölümü: sol yarı mükellef, sağ yarı SMMM
  let main = lines, smmm = [];
  const sec = lines.findIndex(l => /beyannameyi\s+duzenleyen|\bhazirlayan(?:in)?\b|\bduzenleyenin\b/.test(fold(l)));
  if (sec >= 3) {
    let end = lines.findIndex((l, i) => i > sec && /^(?:ekler|ayrintili|bilanco)\b/.test(fold(l)));
    if (end < 0) end = Math.min(lines.length, sec + 14);
    const block = lines.slice(sec + 1, end);
    main = [...lines.slice(0, sec), ...block.map(l => l.split('‖')[0]), ...lines.slice(end)];
    smmm = block.filter(l => l.includes('‖')).map(l => l.split('‖').slice(1).join(' '));
    // İki sütunlu değilse bölümün tamamı düzenleyene aittir
    if (!smmm.length) { main = [...lines.slice(0, sec), ...lines.slice(end)]; smmm = block; }
  }
  const head = main.slice(0, 12);
  const out = {};

  // Unvan / ad soyad
  let unvan = clean(after(main, L.unvan));
  const devam = clean(after(main, L.unvanDevam));
  if (unvan && devam && !unvan.includes(devam)) unvan = isCompany(unvan + ' ' + devam) ? `${unvan} ${devam}` : `${devam} ${unvan}`;
  if (!hasWord(unvan)) unvan = clean(after(main, L.konu));
  if (hasWord(unvan) && unvan.length <= 160) out.unvan = unvan;

  // VKN (10 hane) ve TCKN (11 hane) ayrı tutulur
  // Yoklama fişi: "VKN/TCKN : 966-005-1082 / 177-829-767-82"
  for (const part of after(main, L.vknTckn).split('/')) {
    const n = idNumber(part);
    if (n.length === 10) out.vkn ??= n;
    if (n.length === 11) out.tckn ??= n;
  }
  const tcLabel = /vergi\s+kimlik\s+(?:no|numarasi)\s*\(t\.?\s?c/.test(F);
  [[after(main, L.vkn), true], [after(main, L.tckn), false]].forEach(([v, vknLabel]) => {
    const n = idNumber(v.replace(/\s/g, '').match(/[\dOoIlBSZ|]{10,12}/)?.[0] || '');
    if (n?.length === 10) out.vkn ??= n;
    if (n?.length === 11) {
      // VKN etiketinin altında '1' ile başlayan 11 hane: OCR'ın ':' işaretini '1' okuması
      if (vknLabel && !tcLabel && n.startsWith('1')) out.vkn ??= n.slice(1);
      else out.tckn ??= n;
    }
  });

  // Vergi dairesi: "Vergi Dairesi : 012345 - ÖRNEKKÖY MALMD." ya da başlıktaki "ÖRNEKTEPE VD"
  let vd = vergiDairesi(after(main, L.vd));
  if (!vd) for (const l of head) { const m = /^(.+?)\s+v\.?\s?d\.?(?=[\s\t‖]|$)/.exec(fold(l)); if (m) { vd = vergiDairesi(l.slice(0, m[1].length) + ' VD'); break; } }
  if (!vd) { const m = /([a-z]+(?: [a-z]+)?) vergi dairesi\b/.exec(F); if (m) vd = vergiDairesi(lines.join('\n').slice(m.index, m.index + m[1].length) + ' VD'); }
  // Yoklama fişindeki DKM, yoklamayı yapan birimdir; mükellefin vergi dairesi değil
  if (vd && !(yoklama && /\bdkm\b|denetim/i.test(vd))) out.vergiDairesi = vd;

  // Dönem: iş emrinde "Dönemi : 2024"; beyannamede başlıktaki "Yıl 2024" (+ "Ay Ekim")
  let donem = clean(after(main, L.donem));
  if (!/\d{4}/.test(donem)) {
    const hf = fold(head.join('\n'));
    const y = /\byil[\s\t:]+((?:19|20)\d{2})\b/.exec(hf)?.[1];
    const a = /\bay[\s\t:]+([a-z]{3,})/.exec(hf);
    const ay = a ? head.join('\n').slice(a.index + a[0].length - a[1].length, a.index + a[0].length) : '';
    donem = y ? (ay && !/yillik|aylik/.test(fold(ay)) ? title(ay) + ' ' : '') + y : '';
  }
  if (donem && donem.length < 60) out.donem = donem;

  const kapsam = fold(after(main, L.kapsam));
  if (/sinirli/.test(kapsam)) out.incelemeTuru = 'sinirli';
  else if (/\btam\b/.test(kapsam)) out.incelemeTuru = 'tam';
  else if (/sinirli\s+(?:inceleme|olarak)/.test(F)) out.incelemeTuru = 'sinirli';
  else if (/tam\s+(?:inceleme|olarak)/.test(F)) out.incelemeTuru = 'tam';

  const vt = clean(after(main, L.vergiTuru));
  if (hasWord(vt) && vt.length < 80) out.vergiTuru = vergiTuru(vt);
  const is = clean(afterLong(main, L.faaliyet).replace(/^\d{6}\s*-\s*/, ''));
  if (hasWord(is) && is.length < 300) out.faaliyet = isUpper(is) ? sentence(is) : is;
  const ger = clean(after(main, L.gerekce));
  if (hasWord(ger) && ger.length < 120) out.gerekce = isUpper(ger) ? sentence(ger) : ger;

  if (tur === 'İş emri') {
    const no = clean(after(main, L.isEmriNo)).split(' ')[0];
    if (no && /\d/.test(no) && no.length < 60) out.isEmriNo = no;
    const sayiLine = main.find(l => /^sayi\b/.test(fold(l))) || '';
    const t = toISO(sayiLine) || toISO(after(main, L.isEmriTarihi)) || toISO(head.join(' '));
    if (t) out.isEmriTarihi = t;
  }

  let adres = clean(afterLong(main, L.adres)).replace(/\s+(?=[,/])|(?<=[/])\s+/g, '').replace(/\s*İ[çÇ] KAPI NO:\s*(?=\S*\/|$)/i, ' ').trim();
  if (isUpper(adres)) adres = title(adres).replace(/\bNo\b:?/g, 'No:').replace(/:\s*/g, ': ');
  if (adres.length > 8 && adres.length < 250 && !/http|dogrulama/.test(fold(adres))) out.adres = adres;

  // Kişiler
  const kisiler = [];
  const tel = phone(after(main, L.tel));
  const mail = email(main);
  if (tel || mail) kisiler.push({ ad: out.unvan || 'Mükellef', rol: 'Mükellef', tel, eposta: mail });
  if (smmm.length) {
    const ad = personFromSoyadAdi(after(smmm, [/soyadi\s*,?\s*adi\s*\(?unvani\)?/, /adi\s*soyadi/, /unvani/]));
    const st = phone(after(smmm, L.tel));
    const sm = email(smmm);
    const sifat = fold(lines[sec] + ' ' + (lines[sec + 1] || ''));
    const rol = /yeminli/.test(sifat) ? 'YMM' : 'SMMM / muhasebeci';
    if (hasWord(ad) || st || sm) kisiler.push({ ad: hasWord(ad) ? ad : 'Mali müşavir', rol, tel: st, eposta: sm });
  }

  // Belge için kısa açıklama
  let baslik = '';
  if (tur === 'Yoklama fişi') {
    const t = /(?:bitis\s+zamani|gorev\s+bitis)[^\n]*?(\d{2}[./]\d{2}[./]\d{4})/.exec(F)?.[1] || (F.match(/\d{2}[./]\d{2}[./]\d{4}/) || [])[0];
    baslik = ['Yoklama fişi', t?.replace(/\//g, '.')].filter(Boolean).join(' · ');
  } else if (tur === 'İş emri') baslik = ['İş emri', out.vergiTuru, out.donem].filter(Boolean).join(' · ');
  else if (tur === 'Beyanname') {
    const t = lines.find(l => /beyannamesi\b/.test(fold(l)));
    if (t) baslik = [sentence(clean(t.split(COL)[0])), out.donem].filter(Boolean).join(' · ');
  }
  return { tur, baslik, fields: out, kisiler };
}
