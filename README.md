# El Defteri

Vergi müfettişi için iPhone'da çalışan kişisel el defteri (PWA).

- **Görünüm:** iPhone (iOS) tasarımı. Büyük başlıklar, gruplu listeler ve alt sekme çubuğu var (Dosyalar · Süreler · Ayarlar). Açık, koyu ya da sistem teması Ayarlar → Görünüm'den seçilir.
- **Belgeden doldurma:** İş emri, beyanname, yoklama fişi (PDF, taranmış belge ya da ekran görüntüsü) seçilince künye bilgileri ve telefonlar doldurulur. Okuma cihazda yapılır (PDF.js, Türkçe Tesseract OCR); belgeler saklanmaz.
- **Bilgi isteme yazıları:** Mükellefe ya da başka mükelleflere (karşıt) yazılan yazılar dosyada tutulur: sayı, tarih, konu, tebliğ şekli ve tarihi (e-tebligatta gönderimi izleyen 5. günün sonu, VUK 107/A — kendiliğinden hesaplanır; elden/postada elle girilir), cevap süresi (varsayılan 15 gün), son cevap günü (hafta sonu ya da resmî tatile denk gelirse izleyen ilk iş günü, VUK 18; resmî tatiller ve 2024–2030 dinî bayramları dahil, arifeler uyarı olarak gösterilir; 1–20 Temmuz mali tatilinde biten süreler 27 Temmuz'a uzar, 5604 s. K.), kalan gün ve cevap durumu. Yazı PDF ya da fotoğraf olarak yüklenince sayı, tarih, konu, cevap süresi ve muhatap (unvan, VKN) cihazda okunur; yazı saklanmaz. Yaklaşan son günler ana sayfada ve Süreler sekmesinde görünür.
- **Süre hesabı:** Bütün sürelerde son gün hafta sonu ya da resmî tatile denk gelirse izleyen iş gününe alınır (VUK 18). Mali tatil (1–20 Temmuz) yalnızca mükellef sürelerine uygulanır: bilgi isteme cevap süreleri ve 'Mükellefin süresi' işaretli süreler (ibraz, cevap, ek süre, itiraz, izahat vb. başlıklarda kendiliğinden işaretlenir). İnceleme bitiş süresi ve idarenin işlerine (rapor teslimi, tutanak vb.) uygulanmaz. Kayma ve nedeni ekranda gösterilir.
- **Toplu yazı yükleme:** Ana sayfadaki "Bilgi isteme yazılarını yükle" ile birden çok yazı tek seferde seçilir. Her yazı okunup ait olduğu dosya bulunur: mükellefe yazılanlar VKN/TCKN'den, karşıt yazılar metindeki incelenen mükellefin adı ya da VKN'sinden. Kaydetmeden önce kontrol listesi gösterilir; eşleşmeyenler için dosya seçilir ya da atlanır, aynı sayılı yazılar tekrar kaydedilmez.
- **İnceleme verileri:** Ana sayfadaki "İnceleme verileri" kutusuyla sıkıştırılmış dosyalar (ZIP; RAR/7z yalnızca adla eşleşir) yüklenir. Arşivin içindeki dosya adları ve metin/CSV/XML/Excel/PDF içerikleri cihazda taranıp VKN/TCKN ya da unvana göre ilgili mükellef bulunur; kontrol listesinden sonra mükellefin dosyasında "İnceleme verileri" altında şifreli saklanır, buluta eşitlenir ve istenince cihaza indirilir. Dosya başına sınır 150 MB. Bu arşivler yedek dosyasına alınmaz (bulutta durur).
- **Mükellef dosyaları:** Unvan, VKN, vergi dairesi, inceleme türü ve dönemi, iş emri bilgileri, başlama tarihi, sistemdeki kalan gün sayısından hesaplanan bitiş tarihi (bitişe 15 gün kala "Ek süre iste" uyarısı, takvime hatırlatma), adres ve kişiler (tek dokunuşla arama ya da e-posta).
- **Görüşme günlüğü:** Tarih, tür, görüşülen kişi, konu, yazılı not ve sesli not. Not alırken isteğe bağlı takip süresi de eklenebilir. Uygulamadan bir kişi arandığında, uygulamaya dönünce “görüşmeni not al” hatırlatması çıkar.
- **Süreler:** Görev ve süre listesi. Ana sayfada son 7 gün kalan süreler ve son 30 gün kalan inceleme bitişleri görünür. Süreler alarmlı olarak iPhone Takvimi'ne (.ics) eklenebilir.
- **Yedekleme:** Şifreli tek dosya yedek alınır ve geri yüklenir.

## Hazır dosya paketi (`.eldefteri.json`)

İnceleme belgeleri Claude'a verilip okutulabilir. Claude künye bilgilerini, kişileri ve notları bu biçimde bir pakete yazar (belgeler saklanmaz), paket de uygulamada **Yeni dosya → 📦 Hazır paketi içe aktar** ile alınır. Aynı VKN ya da TCKN'ye sahip bir dosya varsa yeni dosya açılmaz, o dosya güncellenir: yalnızca boş alanlar doldurulur, yeni belge, kişi, not ve süreler eklenir, tekrar edenler atlanır.

```json
{
  "app": "el-defteri-paket", "v": 1,
  "mukellef": { "unvan": "", "kod": "", "vkn": "", "tckn": "", "vergiDairesi": "", "faaliyet": "",
                "incelemeTuru": "tam|sinirli", "donem": "", "vergiTuru": "", "gerekce": "",
                "isEmriNo": "", "isEmriTarihi": "YYYY-AA-GG", "baslamaTarihi": "YYYY-AA-GG", "bitisTarihi": "YYYY-AA-GG", "kalanGun": 90,
                "adres": "", "not": "" },
  "kisiler":  [{ "ad": "", "rol": "", "tel": "", "eposta": "" }],
  "kayitlar": [{ "tarih": "YYYY-AA-GGTSS:DD", "tur": "telefon|yuzyuze|yazi|eposta|diger", "kisi": "", "konu": "", "metin": "" }],
  "gorevler": [{ "baslik": "", "tarih": "YYYY-AA-GG", "not": "" }],
  "bilgiIstemeleri": [{ "muhatap": "mukellef|diger", "muhatapAd": "", "muhatapVkn": "", "sayi": "", "yaziTarihi": "YYYY-AA-GG",
                        "konu": "", "tebligSekli": "e|elden", "gonderimTarihi": "YYYY-AA-GG", "tebligTarihi": "YYYY-AA-GG", "sureGun": 15, "cevapTarihi": "", "cevapNot": "" }],
  "belgeler": [{ "ad": "dosya.pdf", "tur": "İş emri|Beyanname|Yoklama fişi|Tutanak|Yazışma / tebligat|Defter / kayıt|Fatura / banka|Diğer",
                 "aciklama": "", "mime": "application/pdf", "data": "<base64>" }]
}
```

Paket şifresizdir. Aktardıktan sonra paket dosyasını Dosyalar uygulamasından silmek gerekir.

## Google ile giriş ve bulut (uçtan uca şifreli)

- Giriş Google hesabıyla yapılır (Firebase Authentication). Yalnızca yöneticinin (`cloud.js` içindeki `ADMIN`) **Ayarlar → Üyeler** bölümüne eklediği Gmail adresleri girebilir.
- Her kullanıcının verisi Firestore'da `users/{uid}` altında durur. Kayıtlar ve dosyalar **cihazda şifrelenmiş hâliyle** gönderilir. Şifre anahtarı uygulama şifresiyle sarmalanır, sunucu içeriği okuyamaz.
- Uygulama önce cihazdaki veriyle çalışır (internetsiz de açılır), değişiklikleri arka planda eşitler. Çakışmada son değişiklik geçerli olur.
- Yeni cihazda Google ile giriş yapılır, ardından uygulama şifresi girilir ve veriler buluttan iner.
- Erişim kuralları `firestore.rules` dosyasında. Firebase Console → Firestore Database → Rules sekmesine yapıştırılıp yayınlanır.
- Firebase JS SDK 11.10.0 `vendor/firebase/` altında paketlidir (Apache-2.0).
- JSZip 3.10.1 `vendor/jszip/` altında (MIT).

## Gizlilik ve güvenlik

- Veriler cihazda (IndexedDB) şifreli tutulur. Bulut eşitlemesinde de yalnızca şifreli hâli gönderilir. CSP ayarı Google/Firebase dışındaki bağlantıları engeller.
- Tüm kayıtlar, ses kayıtları ve belgeler **AES-256-GCM** ile şifrelenir. Anahtar, şifreden PBKDF2-SHA256 (310.000 tur) ile türetilen bir anahtarla sarmalanır.
- Uygulama, ayarlanan süre boyunca kullanılmazsa otomatik kilitlenir.
- **Şifre unutulursa veriler kurtarılamaz.**

## Yayınlama

Uygulama statik dosyalardan oluşur, derleme gerekmez. Herhangi bir HTTPS statik barındırmada çalışır:
GitHub Pages, Netlify veya Vercel.

- Uygulama kodu herkese açık olabilir. İçinde hiçbir veri yoktur, veriler sadece senin telefonunda ve şifreli durur.
- Güncelleme yaparken `sw.js` içindeki `CACHE` sürümünü artır.

## iPhone'a kurulum

1. Safari'de uygulamanın adresini aç.
2. **Paylaş → Ana Ekrana Ekle**'ye dokun.
3. Uygulamayı ana ekrandaki simgeden aç ve şifreni belirle.

Ana ekrandan açılan uygulamanın verileri Safari sekmesindekinden ayrıdır. Her zaman ana ekran simgesini kullan.
Düzenli olarak **Ayarlar → Yedek al** ile yedeği Dosyalar uygulamasına kaydet.

## Yerelde deneme

```
python3 -m http.server 8000
# http://localhost:8000
```
