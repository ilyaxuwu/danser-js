# danser-js

Browser tabanli osu! beatmap player, replay exporter ve flower tabanli cursordance deneme projesi.

Bu proje klasik "birden fazla dance algo sec" yapisindan ziyade tek bir yone odaklanir:

- flower tabanli cursordance
- slider cursordance
- 2B resolving
- `.osr` replay export
- browser icinde canli izleme

## Durum

Su anda proje agirlikli olarak cursordance ve replay tarafina odaklanmistir.

Yapilan ana isler:

- slider cursordance yolu yeniden ele alindi
- 2B overlap queue mantigi iyilestirildi
- slider tick / repeat / tail kritik noktalari icin replay input sikilastirildi
- replay export `.osr` olarak uretiliyor
- spinner hareketi ay seklinde ve yuksek RPM ile donuyor
- cursor hareketi daha smooth hale getirilmeye calisildi
- stream hareketi icin `S` formuna yaklastiran ozel yol eklendi
- cursor jail mantigi gevsetildi, playfield disina cikabilen hareket destegi eklendi
- debug / risk notification tarafi eklendi

## Bilinen Sorunlar

Bu kisim onemli:

- skin sistemi su anda dogru calismiyor
- skin secilebilse bile hitobject / slider / approach circle goruntusu osu! veya danser-go ile birebir parity vermiyor
- skin fallback / default davranisi hala sorunlu olabilir
- bu yuzden proje su anda skin parity acisindan guvenilir degil

Kisaca:

`Skin support is currently broken / incomplete.`

## Kurulum

```bash
npm install
```

Ilk kurulumdan sonra bir kere browser arayuzunu ac:

```bash
npm run dev
```

Ardindan `ESC` ile ayarlari acip sunlari ayarla:

- `Songs path`
- `Skins path`

Ornek songs klasoru:

```text
C:\Users\PC\AppData\Local\osu!\Songs
```

Ayarlar `config.json` icine kaydedilir.

## Kullanim

```bash
node cli.js [options]
```

### Ornekler

```bash
# Baslik ile map ac
node cli.js --title="Sound Chimera"

# Baslik + difficulty
node cli.js --title="Sound Chimera" --diff="Chimera"

# Artist ile ara
node cli.js --artist="Camellia" --diff="Insane"

# Replay export et
node cli.js --title="Sound Chimera" --diff="Chimera" --replay="ilyax"

# Rate degistir
node cli.js --title="Ascension" --rate=1.5

# Eslesen mapleri listele
node cli.js --list --title="Chimera"

# Browser'i otomatik acmadan baslat
node cli.js --title="Chimera" --no-open
```

### Flagler

| Flag | Aciklama |
|------|----------|
| `--title=<str>` | Sarki basligi ile ara |
| `--artist=<str>` | Artist ile ara |
| `--diff=<str>` | Difficulty adi ile ara |
| `--skin=<str>` | Skin klasoru secimi. Su anda gorsel parity bozuk olabilir |
| `--rate=<num>` | Playback rate |
| `--port=<num>` | Dev server portu |
| `--no-open` | Browser'i otomatik acma |
| `--list` | Eslesen mapleri listele ve cik |
| `--replay=<name>` | `.osr` replay export et, replay icindeki oyuncu adini belirle |
| `--help` | Yardim yazdir |

Not:

- README tarafinda `algo` dokumante edilmez
- proje su anda flower yonelimli kullanilir

## Replay Export

Replay export modu:

```bash
node cli.js --title="Sound Chimera" --diff="Chimera" --replay="ilyax"
```

Bu modda sistem:

- beatmap'i bulur
- sesi bulur
- config ayarlarini okur
- cursordance yolunu uretir
- input timeline olusturur
- `.osr` dosyasi export eder

Replay tarafinda yapilan ana isler:

- slider point coverage iyilestirildi
- 2B slider input mantigi yeniden duzenlendi
- key hold / release zinciri sikilastirildi
- replay koordinatlari guvenli aralikta tutuldu

## Cursordance Notlari

Bu proje icinde hedeflenen davranis:

- normal slider ise slider body ustunde cursordance yapmak
- 2B slider overlap varsa onu conflict olarak ele almak
- stream bolumlerinde daha yumusak ve daha `S` benzeri hareket uretmek
- sert, kirik ve citirli gorunen donusleri azaltmak

Bu hedeflerin tamami her mapte birebir kusursuz degildir, fakat mevcut sistem bu yone dogru sekillendirilmistir.

## Nasil Calisiyor

```text
cli.js
  -> config.json okur
  -> Songs klasorunde .osu arar
  -> eslesen map ve audio dosyasini bulur
  -> __autoload.json yazar
  -> Vite server baslatir
  -> browser uzerinden player acilir

src/dance/
  -> flower tabanli hareket
  -> slider dance
  -> 2B queue / path mantigi

src/replay/
  -> replay frame generation
  -> key timeline
  -> .osr export
```

## Manual Browser Mode

```bash
npm run dev
```

Sonra:

- `http://localhost:5173` ac
- `.osu` ve ses dosyasini yukle
- `ESC` ile ayarlari ac
- oynat

## Uyari

Bu repo aktif deneme / iterasyon halindedir.

Ozellikle su kisimlar hala degisiyor:

- slider dance hissi
- 2B parity
- stream sekli
- skin rendering

Skin parity gerekiyorsa bu repo su an o amac icin hazir kabul edilmemelidir.
