# PulseDesk — yerel ürün demosu

> 11 Kasım 2026 tarihli ilk yerel inceleme kaydıdır. Güncel recruiter incelemesi, yeni görseller ve tam test sonuçları için [doğrulama](verification.md) ve [güncel demo senaryosu](demo-script.md) belgelerine bakın. Aşağıdaki işlem, kapsam ve sayılar ilk inceleme anına aittir.

Bu paket yalnızca yerel portföy incelemesi içindir; canlı demo veya production onayı değildir. Ekranlar çalışan uygulamadan alınmıştır. Sayılar gerçek yerel demo kayıtlarından hesaplanır; kullanıcı, müşteri ve şirket kimlikleri kurgusaldır.

## Yerel ortam

İnceleme Node.js **25.1.0**, pnpm **10.28.2** ile yapıldı. Projenin hedefi Node 24 olmaya devam eder. Paket ve lock dosyaları değiştirilmedi.

Mevcut Compose dosyası, `pulsedesk-portfolio` proje adıyla ve yalnız portları değiştiren `docs/portfolio.compose.yml` override dosyası ile kullanıldı: PostgreSQL `127.0.0.1:15432`, Redis `127.0.0.1:16379`. Ayrı named volume'lar kullanıldı; eski volume veya veri silinmedi. Normal geliştirici portları olan 5432/6379 değiştirilmedi.

Ayrı demo servislerini yeniden başlatma:

```sh
docker compose -p pulsedesk-portfolio -f docker-compose.yml -f docs/portfolio.compose.yml up -d --wait
```

Bu komut veri silmez. Yerel environment dosyalarının demo portlarına işaret ettiğinden emin olun. Servisleri durdurmak gerektiğinde aynı dosyalarla `docker compose ... stop` kullanın; volume silen seçenek kullanmayın.

Yerel web: <http://localhost:3000/login>. API: <http://localhost:4000/health> ve <http://localhost:4000/ready>. Worker ayrı süreçtir; readiness endpoint'i worker sağlığını tek başına kanıtlamaz.

Bu Mac'te `pnpm dev` dosya izleme sınırına (`EMFILE`, FSEvent) takıldı. README'deki alternatif build yöntemi kullanıldı:

```sh
pnpm build
pnpm --filter @pulsedesk/api start
pnpm worker
pnpm --filter @pulsedesk/web start --hostname 127.0.0.1
```

Son üç komut ayrı terminallerde çalışır. Migrate ve seed komutları yalnız ayrı yerel demo veritabanına uygulandı. Environment dosyaları ve servis kimlik bilgileri bu belgeye dahil değildir.

## Demo rolleri

| Rol     | Yerel demo hesabı       | Doğrulanan yetki                                                    |
| ------- | ----------------------- | ------------------------------------------------------------------- |
| OWNER   | owner@pulsedesk.local   | Operasyonlar, SLA yazma, owner-only kontrolü                        |
| ADMIN   | admin@pulsedesk.local   | Operasyonlar ve SLA yazma; owner-only kontrolü reddedilir           |
| MANAGER | manager@pulsedesk.local | Operasyon ve ekip yönetimi; SLA yazamaz                             |
| AGENT   | agent@pulsedesk.local   | Yetkili talepler üzerinde çalışma ve yorum; ekip/atama yönetimi yok |
| VIEWER  | viewer@pulsedesk.local  | Salt okunur; ticket veya SLA oluşturma/düzenleme yok                |

Yalnız yerel kullanım için mevcut seed parola tanımını `apps/api/src/demo/manifest.ts` içindeki `DEMO_PASSWORD` alanından kullanın. Bu hesapları veya parolayı internete açık bir ortamda kullanmayın. Parola, token veya ortam dosyası bu rapora eklenmedi.

Kaynak seed: 5 hesap, 2 ekip, 3 kurgusal müşteri, 6 ticket senaryosu, 4 öncelikte SLA politikası ve başlangıçta 5 bildirim. Gerçek demo akışında yedinci ticket UI üzerinden oluşturulup kapatıldı. Worker çalıştıkça süreler ve bildirim sayıları doğal olarak değişir. Seed tekrar çalıştığında mevcut demo düzenlemelerini korur; güncel SLA sürelerini sıfırlayan bir reset akışı yoktur.

## Gerçek ekran görüntüleri

Kaydedilen masaüstü görselleri: 1425 × 990; mobil: 375 × 812. Tarayıcı viewport testleri 1440 × 1000, 390 × 844 ve 320 piksel genişlikte yapıldı; görüntü dışa aktarımı kaydırma çubuğu alanını hariç tutar. Bunlar tarayıcı araç çubuğu içermeyen gerçek viewport görüntüleridir. Gizli değer veya gerçek müşteri bilgisi içermezler.

| Ekran                         | Görsel                                                          |
| ----------------------------- | --------------------------------------------------------------- |
| Dashboard                     | [dashboard.jpg](assets/screenshots/dashboard.jpg)               |
| Ticket listesi                | [tickets.jpg](assets/screenshots/tickets.jpg)                   |
| Ticket detay / geçmiş         | [ticket-detail.jpg](assets/screenshots/ticket-detail.jpg)       |
| Müşteri yönetimi              | [customers.jpg](assets/screenshots/customers.jpg)               |
| Ekip üyeleri ve mevcut roller | [team-roles.jpg](assets/screenshots/team-roles.jpg)             |
| SLA politikaları              | [sla-policies.jpg](assets/screenshots/sla-policies.jpg)         |
| Mobil dashboard               | [mobile-dashboard.jpg](assets/screenshots/mobile-dashboard.jpg) |

## 85 saniyelik demo senaryosu

| Süre     | Ekran / işlem                                            | Anlatım                                                                                                                                                              |
| -------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0–8 sn   | Giriş                                                    | “Destek talepleri farklı yerlerde kaldığında sahiplik ve yanıt süreleri belirsizleşir. PulseDesk bu akışı tek çalışma alanında toplar.”                              |
| 8–18 sn  | OWNER ile giriş, çalışma alanı, dashboard                | “Buradaki sayılar kurgusal demo kayıtlarından gelir. Açık talepleri, atanmamış işleri ve SLA durumlarını birlikte görüyoruz.”                                        |
| 18–32 sn | Talepler → Yeni Talep; Demo Müşteri A; yeni konu; Yüksek | “Yeni talebi müşteri ve önceliğiyle kaydediyorum. Geçerli politika ilk yanıt ve çözüm hedeflerini oluşturuyor.”                                                      |
| 32–43 sn | İncele → Ata → Customer Support / Demo Agent             | “Talebin sorumlusu belirleniyor; atama geçmişe kaydediliyor.”                                                                                                        |
| 43–57 sn | Önceden açılmış AGENT oturumu → Başlat → Dahili Not      | “Agent yalnız yetkili olduğu taleplerde çalışır. Başka oturumdaki durum ve yorum değişikliği yenilemeden görünür.”                                                   |
| 57–68 sn | Müşteriye Yanıt; owner ekranı / bildirimler              | “Bu uygulama içindeki müşteri yanıtı ilk yanıt hedefini tamamlıyor. E-posta gönderildiğini iddia etmiyoruz. Kalıcı SLA bildirimlerini ayrı ekrandan takip ediyoruz.” |
| 68–78 sn | Ticket SLA paneli → Çöz → yönetici ile Kapat             | “Hedef süreler ve bütün durum geçmişi talebin yanında kalır. Çözüm ve kapanış ayrı adımlardır.”                                                                      |
| 78–85 sn | Dashboard / mobil                                        | “PulseDesk, müşteri talebini sorumlusu, geçmişi ve hizmet hedefleriyle görünür kılar. Bu gösterim yerel demodur.”                                                    |

Kayıttan önce iki rol oturumunu hazırlayın. Her kayıt için yeni konu kullanın; eski kayıtları silmeyin. Seed'i tekrar çalıştırmak süreleri tazelemez. SLA eşiği geçen kayıtları sağlıklıymış gibi sunmayın. Bildirim yalnız gerçekten oluştuysa gösterin; atamanın otomatik bildirim ürettiğini varsaymayın.

## Doğrulananlar ve sınırlar

- API liveness/readiness 200; PostgreSQL/Redis sağlıklı; Redis PONG; outbox kayıtları işleniyor, başarısız kayıt gözlenmedi.
- OWNER/AGENT arasında oluşturma, inceleme, atama, başlatma ve yorum; ADMIN ile çözüm/kapanış; OWNER ekranına canlı yansıma.
- VIEWER UI'da ticket oluşturma ve SLA düzenleme butonları yok. ADMIN UI'da dört SLA politika düzenleyicisi açılıyor.
- Beş rolün API okuma, owner-only ve yazma sınırları geçerli. Yazma guard kontrolleri geçersiz boş gövdelerle yapıldı; bu kontroller kayıt değiştirmedi.
- 390 ve 320 pikselde yedi ana ekran, veriler yüklendikten sonra mobil menü ile denetlendi; yatay sayfa taşması gözlenmedi.
- Giriş alan doğrulaması, liste boş sonucu, loading ve kontrollü API kesintisindeki hata ekranı görüldü. API döndüğünde canlı bağlantı ekranı otomatik toparladı; manuel “Tekrar Dene” tıklaması toparlanma sonrasında buton kaybolduğu için doğrulanmış sayılmıyor.
- İki tarayıcı oturumunun son konsol kontrolünde hata kaydı yok. Ayrı bir HAR kaydı alınmadı; API ve canlı bağlantı kontrolleri tam network audit yerine geçmez.
- Mevcut seed testleri ayrı `pulsedesk_portfolio_smoke` veritabanında 14/14 geçti. ADMIN'in ek SLA bildirimi nedeniyle eski 4 bildirim beklentisi 5 olarak güncellendi ve ADMIN alıcısı ayrıca kontrol edildi. Var olan testler yeniden yazılmadı.
- Tam regresyon paketi bu tur yeniden çalıştırılmadı. Node 24 doğrulaması yapılmadı.
- Arayüzde doğrulanmış taşma/kırık kontrol bulunmadığından CSS veya komponent değişikliği yapılmadı. Önce/sonra görüntüleri, aynı tasarımın demo iş akışı öncesi/sonrası durumlarıdır; yeniden tasarım iddiası değildir.

## Canlıya almadan önce

HTTPS ve güvenli oturum saklama stratejisi; secret yönetimi ve demo hesaplarının ayrılması; Node 24 ve tam DB/Redis entegrasyon kontrolleri; yedekleme/geri yükleme, izleme ve worker health kontrolü; mevcut tek API instance realtime sınırı değerlendirilmelidir. API'nin mevcut başlatma kodu tüm arayüzleri dinler; bu çalışmada port yönlendirme veya public deployment yapılmadı. İnternete açmadan önce erişim/bind yapılandırması gözden geçirilmeli.

Tam kullanıcı daveti veya rol değiştirme yönetimi, ayrı raporlama, incident yönetimi, ekler ve e-posta gönderimi bu demo kapsamında sunulmuyor. Ekip üyeliği ve mevcut rol gösterimi, tam kullanıcı yönetimi olarak tanıtılmamalıdır.
