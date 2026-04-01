Harika bir GitHub `README.md` dosyası olması için metnini standart Markdown yapısına uygun, okunabilir, ikonlarla zenginleştirilmiş ve GitHub'ın özel uyarı bloklarını (Alerts) kullanacak şekilde düzenledim. 

Aşağıdaki kodu kopyalayıp doğrudan `README.md` dosyanıza yapıştırabilirsiniz:

***

```markdown
# danser-js 🌸

Browser-based osu! beatmap player, replay exporter, and flower-based cursordance experimental project.

Unlike the classic "choose multiple dance algos" approach, this project focuses on a single direction:

- ✨ **Flower-based cursordance**
- 🛝 **Slider cursordance**
- 🥨 **2B resolving**
- 💾 **`.osr` replay export**
- 🌐 **Live viewing inside the browser**

---

## ⚠️ Known Issues

> [!WARNING]
> **Skin support is currently broken / incomplete.**
> - Skin system currently does not work correctly.
> - Even if a skin is selected, hitobject / slider / approach circle visuals do not match osu! or danser-go parity.
> - Skin fallback / default behavior may still be problematic.
> - **Therefore, skin parity is not reliable at the moment.**

---

## 🚀 Installation

First, install the dependencies:
```bash
npm install
```

After the first setup, start the dev server to open the browser interface:
```bash
npm run dev
```

Once the browser opens, press `ESC` to open settings and configure your paths:
- **Songs path** (Example: `C:\Users\PC\AppData\Local\osu!\Songs`)
- **Skins path**

*(Note: Settings are automatically saved into `config.json`.)*

---

## 💻 Usage

You can run the project via the CLI using various options.

**Basic Syntax:**
```bash
node cli.js [options]
```

### Examples
```bash
# Open map by title
node cli.js --title="Sound Chimera"

# Title + difficulty
node cli.js --title="Sound Chimera" --diff="Chimera"

# Search by artist
node cli.js --artist="Camellia" --diff="Insane"

# Export replay
node cli.js --title="Sound Chimera" --diff="Chimera" --replay="ilyax"

# Change playback rate
node cli.js --title="Ascension" --rate=1.5

# List matching maps
node cli.js --list --title="Chimera"

# Start without auto-opening browser
node cli.js --title="Chimera" --no-open
```

### 🏳️ Flags

| Flag | Description |
| :--- | :--- |
| `--title=<str>` | Search by song title |
| `--artist=<str>` | Search by artist |
| `--diff=<str>` | Search by difficulty name |
| `--skin=<str>` | Select skin folder. *(Visual parity currently broken)* |
| `--rate=<num>` | Playback rate |
| `--port=<num>` | Dev server port |
| `--no-open` | Do not auto-open browser |
| `--list` | List matching maps and exit |
| `--replay=<name>` | Export `.osr` replay, set player name inside replay |
| `--help` | Print help |

> **Note:** The dance algorithm is not documented in the README as the project is currently strictly **flower-oriented**.

---

## 🛠️ Current Status & Features

Currently, the project is mainly focused on **cursordance** and **replay logic**.

### Main Work Done:
- [x] Slider cursordance path reworked.
- [x] 2B overlap queue logic improved.
- [x] Replay input tightened for slider tick / repeat / tail critical points.
- [x] Replay export generated as `.osr`.
- [x] Spinner movement rotates in a moon shape with high RPM.
- [x] Cursor movement made smoother.
- [x] Special path added to approximate "S" form for stream movement.
- [x] Cursor jail loosened, allowing movement outside playfield.
- [x] Debug / risk notification added.

---

## 💾 Replay Export

To export a replay, use the `--replay` flag:
```bash
node cli.js --title="Sound Chimera" --diff="Chimera" --replay="ilyax"
```

**In this mode the system:**
1. Finds the beatmap & audio.
2. Reads config settings.
3. Generates the cursordance path.
4. Builds the input timeline.
5. Exports the `.osr` file.

**Replay specific improvements:**
- Improved slider point coverage.
- Restructured 2B slider input logic.
- Tightened key hold/release chain.
- Kept replay coordinates within a safe range.

---

## 💃 Cursordance Notes

Target behavior in this project:
- **Normal slider:** Cursordance on slider body.
- **2B slider overlap:** Treat as conflict.
- **Stream sections:** Smoother, more S-like movement.
- **General:** Reduce sharp, broken, jittery turns.

*These goals are not perfect for every map, but the system is shaped toward them.*

---

## ⚙️ How It Works

### Execution Flow
`cli.js` ➔ reads `config.json` ➔ searches `.osu` in Songs folder ➔ finds matching map and audio file ➔ writes `__autoload.json` ➔ starts Vite server ➔ opens player in browser.

### Directory Structure
- 📂 `src/dance/` — Flower-based movement, slider dance, 2B queue / path logic.
- 📂 `src/replay/` — Replay frame generation, key timeline, `.osr` export.

---

## 🌐 Manual Browser Mode

If you want to manually run the app without the CLI auto-loading a map:
```bash
npm run dev
```
Then:
1. Open `http://localhost:5173`
2. Upload `.osu` and audio file manually.
3. Press `ESC` to open settings.
4. Play.

---

## 🚧 Disclaimer

> This repo is in **active experimentation / iteration**.

Especially these parts are still changing:
- Slider dance feel
- 2B parity
- Stream shape
- Skin rendering

If skin parity is required, this repo should not be considered ready for that purpose.
```
