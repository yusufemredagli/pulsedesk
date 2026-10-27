# Phase 7 — Müşteri, ekip, SLA ve ayarlar

Ana menüdeki bütün modüller çalışır durumdadır. Yeni ekranlar mevcut oturum sağlayıcısını, organizasyon doğrulamasını, API istemcisini, modal/form bileşenlerini ve grafit/camgöbeği görsel sistemi kullanır. Metinler Türkçe, tarih/saat gösterimleri `tr-TR` biçimindedir. Yeni tablo veya migration eklenmez.

## Rotalar ve iş akışları

| Rota                          | İçerik                                                                                                                                                               |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/app/customers`              | Sunucuda arama, ad/oluşturulma tarihine göre sıralama, 20 kayıtlık sayfalar, iletişim bilgileri ve talep istatistikleri; müşteri oluşturma.                          |
| `/app/customers/[customerId]` | İletişim bilgileri, notlar, oluşturulma tarihi, toplam/açık/işlemdeki talepler, son aktivite ve sayfalı talep geçmişi; düzenleme ve müşterisi seçili yeni talep.     |
| `/app/teams`                  | Sayfalı ekip araması; üye sayısı ve gerçek iş yükünü gösteren kompakt ekip kartları; ekip oluşturma.                                                                 |
| `/app/teams/[teamId]`         | Ekip güncelleme, sayfalı/aranabilir üyeler, çalışma alanı rolleri, hesap etkinliği, üye ekleme/çıkarma ve ekibe atanmış talepler.                                    |
| `/app/sla-policies`           | Dört öncelik için ayrı, sayfalı politika grupları; süreler, etkinlik ve güncelleme tarihi; eksik politika oluşturma, düzenleme ve etkinleştirme/devre dışı bırakma.  |
| `/app/settings`               | Çalışma alanı kimliği/rolü, hesap bilgileri ve gerçek çıkış işlemi. Yetkili kullanıcılar çalışma alanı adını; tüm geçerli üyeler kendi görünen adını değiştirebilir. |

Kısa ad ve e-posta salt okunurdur. Oturum anahtarları, tokenlar, parola hashleri veya ham oturum kimlikleri gösterilmez. Çalışma alanı UUID'si, kullanıcı tarafından istenen kimlik bilgisi olarak ayarlarda gösterilir.

## Yetkiler ve tenant sınırı

| İşlem                                                   | OWNER / ADMIN | MANAGER | AGENT                                | VIEWER |
| ------------------------------------------------------- | ------------- | ------- | ------------------------------------ | ------ |
| Müşteri/ekip dizinlerini okuma                          | Evet          | Evet    | Mevcut backend okuma yetkisi korunur | Evet   |
| Müşteri/ekip oluşturma-düzenleme, ekip üyeliği yönetimi | Evet          | Evet    | Hayır                                | Hayır  |
| Müşteriden yeni talep açma                              | Evet          | Evet    | Evet                                 | Hayır  |
| SLA politikası okuma                                    | Evet          | Evet    | Evet                                 | Evet   |
| SLA politikası ve çalışma alanı adı yönetimi            | Evet          | Hayır   | Hayır                                | Hayır  |
| Kendi görünen adını değiştirme / çıkış                  | Evet          | Evet    | Evet                                 | Evet   |

Buton gizleme bir güvenlik sınırı değildir. Bütün uçlar `OrganizationAccess` ile mevcut kullanıcı/organizasyon üyeliğini doğrular. Yazımlar `DomainTransaction` içindeki güncel rol/etkinlik kontrollerini ve atomik audit kaydını kullanır. Ekip üyesi ekleme, hedef üye ve kullanıcının etkinliğini aynı transaction'da kilitleyerek doğrular; yabancı organizasyon veya etkin olmayan hesaplar reddedilir. Tekrarlanan üyelik veritabanı unique kısıtıyla 409 döner. Üye çıkarma, kişinin organizasyon üyeliğini veya doğrudan talep atamalarını silmez.

Müşteri/ekip temel okuma izinleri genişletilmedi. AGENT'ın talep listeleri ve bütün talep istatistikleri mevcut kişisel atama/ekip üyeliği politikasıyla filtrelenir. Bir kaydın temel bilgilerine erişmek, o kayda bağlı bütün talepleri görme yetkisi vermez. Yabancı tenant kaynak ID'leri mevcut sözleşmeye göre 404, yetkisiz organizasyon bağlamı 403 döner.

## İstatistikler ve veri erişimi

İstatistikler yalnızca istenen sayfadaki müşteri/ekip kimlikleri için toplu veritabanı sorgularıyla hesaplanır; tarayıcı tüm talepleri indirip filtrelemez. Sayfa verisi, toplam ve istatistikler repeatable-read transaction'ında tutarlı okunur. `totalTickets` erişilebilir tüm talepleri, `openTickets` RESOLVED/CLOSED/CANCELLED dışındakileri, `activeTickets` IN_PROGRESS durumundakileri sayar.

Son aktivite, erişilebilir taleplerin son güncellemesi ile yorum oluşturulma tarihinin en yenisidir. Yorumlar talebin workflow sürümünü/tarih alanını değiştirmediği için bu tarih ayrıca, toplu SQL aggregate ile hesaplanır. SQL aggregate aynı organizasyon ve AGENT kişisel/ekip görünürlük koşullarını uygular; yetki politikası değişirse bu aggregate de aynı şekilde güncellenmelidir. HTTP testleri görünür/gizli talep yorumlarıyla bu sınırı doğrular.

Ekip üye sayısı mevcut üyelikleri içerir; sonradan devre dışı kalan hesaplar listede açıkça belirtilir. Seçim dizini ise yalnızca aynı organizasyonun etkin hesaplarını getirir. Üye listesi 100 kayıtlık eski detay projeksiyonuna bağlı değildir; ayrı uçtan 20'lik sayfalara ayrılır.

## API ekleri ve eşzamanlı düzenleme

Mevcut `/customers`, `/teams`, `/sla/policies`, `/organization/members` ve `/tickets` aileleri yeniden kullanılır. Yeni uçlar yalnızca şunlardır:

- `GET /teams/:id/members`: sayfalı/aranabilir, rol ve hesap etkinliği içeren ekip üye listesi.
- `GET /settings`: güvenli çalışma alanı/hesap projeksiyonları ve mevcut rol.
- `PATCH /settings/workspace`: OWNER/ADMIN için yalnızca organizasyon adı.
- `PATCH /settings/account`: doğrulanmış kullanıcının yalnızca kendi görünen adı.

Müşteri listesine `sort=name:asc|name:desc|createdAt:asc|createdAt:desc`, politika listesine `priority`, talep listesine `activeOnly=true|false` eklenmiştir. `activeOnly=true` çözüm bekleyen talepleri getirir; false mevcut tüm-durum davranışıdır. Dizin üyelerine güvenli rol alanı; müşteri/ekip yanıtlarına istatistikler eklenmiştir. CORS, mevcut yetkili ekipten çıkarma DELETE işleminin tarayıcıda kullanılmasına izin verir.

Yeni düzenleme formları, açıldıklarında aldıkları `updatedAt` değerini `expectedUpdatedAt` olarak gönderir. Aynı milisaniyede bile zaman damgası monoton ilerler. Müşteri/ekip/politika ve organizasyon adları transaction içi satır kilidiyle; hesap adı koşullu güncellemeyle korunur. Uyumsuz token 409 verir, HTTP veri yeniden okunur ve kullanıcı güncel kaydı tekrar açar. Sessiz otomatik tekrar veya yeni token ile körlemesine yazma yoktur. Üye ekleme/çıkarma da ekip zaman damgasını ilerletir; modal açıkken başka bir üyelik değişmişse çakışma yakalanır.

Müşteri/ekip/politika uçlarında token eski istemcilerle uyum için opsiyoneldir; yeni arayüz her düzenlemede gönderir. Eski istemcilerin tokensız güncelleme sözleşmesi korunmuştur. Yeni ayar uçlarında token zorunludur. Bütün DTO'lar izin verilmeyen alanları reddeder; organizasyon, kullanıcı, rol, etkinlik veya e-posta değişikliği ad güncellemesiyle gönderilemez.

## SLA ve realtime

Süre girişleri dakika veya saat kabul eder ve tam dakikaya normalize edilir; mevcut 1–525.600 dakika sınırı korunur. Saniye alanı veya yeni SLA durumu eklenmez. Politika değişikliği mevcut `SlaEvent.dueAt`, completion veya breach kayıtlarını değiştirmez. Yeni talepler oluşturulurken o andaki etkin politika seçilir. Aynı öncelikte tek etkin politika kısıtı korunur; politikayı devre dışı bırakmak eski taleplerin hedeflerini iptal etmez.

Müşteri/ekip istatistikleri mevcut ticket olaylarından sonra 200 ms debounce ile HTTP üzerinden yeniden okunur. Kısmi socket payload'ı istatistik veya detay kaydına birleştirilmez. Tenant değişiminde sorgu sonuçları, filtreler ve açık formlar temizlenir. SLA/ayar ekranları için yeni socket olayları eklenmez; yerel kayıt sonrası ve açık Yenile eylemiyle güncellenirler.

## Görsel ve işlevsel doğrulama

Masaüstünde tablolar, ekip kartları ve dört öncelik için politika panelleri; mobilde müşteri/talep kartları ve tek kolon ayar/politika düzeni kullanılır. Modallar native dialog ile odak/kapatma davranışını, formlar mevcut etiket ve hata bileşenlerini kullanır. Token veya backend stack trace gösterilmez.

`pnpm test`, yeni PostgreSQL HTTP testleriyle müşteri/ekip işlemleri, arama/sayfalama/sıralama, yabancı tenant reddi, rol sınırları, zaman damgası çakışmaları, istatistik kapsamı, SLA geçmişinin korunması ve güvenli ayar güncellemelerini çalıştırır. Veritabanı suite'i yalnızca açıkça verilen izole `TEST_DATABASE_URL` ile etkinleşir ve sadece takip ettiği fixture'ları temizler.

`pnpm --filter @pulsedesk/web test:browser:management` ayrı Chromium regresyonudur. Mevcut browser testleriyle aynı kurulum gerekir: derlenmiş API/web, çalışan worker, PostgreSQL/Redis; eşleşen izole `DATABASE_URL`/`TEST_DATABASE_URL`; açıkça çalıştırılmış demo seed; varsayılan API 4400/web 3400 veya `BROWSER_API_URL`/`BROWSER_WEB_URL`. Runner dört demo rolünü, gerçek form işlemlerini, canlı HTTP uzlaştırmasını, çakışmayı, tenant değişimini ve altı yeni rotayı 1440/1024/768/430/390/375/320 genişliklerinde denetler. Kendi fixture'larını temizler; seed kaydında test ettiği ad/politika alanlarını geri yükler. Ana veritabanına veya ortak geliştirme ortamına karşı çalıştırılmamalıdır.

Faturalama, abonelik, ödeme, e-posta doğrulama/değiştirme, parola sıfırlama, portal, bilgi bankası, yapay zekâ, kapsamlı analitik, özel roller, audit görüntüleyici ve webhook'lar kapsam dışındadır. Bu aşamada müşteri/ekip silme, çalışma alanı slug düzenleme veya organizasyon üyeliği rol değiştirme akışı eklenmez.
