# El Defteri

Vergi müfettişi için iPhone'da çalışan kişisel el defteri (PWA).

- **Mükellef dosyaları:** Unvan, VKN, vergi dairesi, inceleme türü ve dönemi, iş emri bilgileri, başlama ve bitiş süresi (VUK 140'a göre öneri), adres ve kişiler (tek dokunuşla arama ya da e-posta).
- **Görüşme günlüğü:** Tarih, tür, görüşülen kişi, konu, yazılı not ve sesli not. Not alırken isteğe bağlı takip süresi de eklenebilir. Uygulamadan bir kişi arandığında, uygulamaya dönünce “görüşmeni not al” hatırlatması çıkar.
- **Belgeler:** İş emri, beyanname, tutanak ve yazışmalar PDF ya da fotoğraf olarak eklenir, uygulama içinde görüntülenir.
- **Süreler:** Görev ve süre listesi. Ana sayfada son 7 gün kalan süreler ve son 30 gün kalan inceleme bitişleri görünür. Süreler alarmlı olarak iPhone Takvimi'ne (.ics) eklenebilir.
- **Yedekleme:** Şifreli tek dosya yedek alınır ve geri yüklenir.

## Gizlilik ve güvenlik

- Veriler **yalnızca cihazda** (IndexedDB) tutulur. Sunucu, bulut ya da analitik yoktur. CSP ayarı dışarıya bağlantıyı engeller.
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
