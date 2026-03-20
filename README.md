# danser-js

osu! cursor visualiser — browser renderer with CLI launcher.

## Setup

```bash
npm install
```

Make sure to open the browser once via `npm run dev`, press **ESC**, and set your
**Songs path** and **Skins path** (e.g. `C:\Users\PC\AppData\Local\osu!\Songs`).
Settings are saved to `config.json` automatically.

---

## CLI Usage

```bash
node cli.js [options]
```

### Examples

```bash
# Play a map by title
node cli.js --title="Sound Chimera"

# Narrow by difficulty name
node cli.js --title="Sound Chimera" --diff="Chimera"

# Full combo — title + difficulty + skin + dance algorithm
node cli.js --title="Sound Chimera" --diff="Chimera" --skin="Whitecat"

# Search by artist
node cli.js --artist="Camellia" --diff="Insane"

# List all maps matching a filter (no playback)
node cli.js --list --title="Chimera"

# Launch on a different port, don't open browser automatically
node cli.js --title="Chimera" --port=3000 --no-open

# title + difficulty also writes a replay file to render it on any platform such as danser-go, manual osu!
node cli.js --title="Sound Chimera" --diff="Chimera" --replay="ilyax"
```

### All flags

| Flag | Description | Default |
|------|-------------|---------|
| `--title=<str>` | Song title (partial, case-insensitive) | — |
| `--artist=<str>` | Artist name (partial) | — |
| `--diff=<str>` | Difficulty name (partial, e.g. `Insane`) | — |
| `--skin=<str>` | Skin folder name inside your skins path | From config | (Buggy)
| `--port=<num>` | Dev server port | Default: `5173` |
| `--no-open` | Don't auto-open browser | — |
| `--list` | Print matching beatmaps and exit | — |
| `--replay=<str>` | Saves the replay file to your computer. | — |
| `--help` | Show help | — |

---

## How it works

```
cli.js
  ├─ Reads config.json (songs/skins paths)
  ├─ Scans Songs folder for .osu files matching your filters
  ├─ Finds the matching audio file in the same folder
  ├─ Finds the skin folder
  ├─ Writes __autoload.json (temp manifest)
  ├─ Spawns `vite` dev server
  └─ Opens browser → http://localhost:5173/?autoload=1

vite.config.js (danser-api plugin)
  ├─ GET /api/autoload   → returns __autoload.json
  ├─ GET /api/beatmap    → streams the .osu file
  ├─ GET /api/audio      → streams the audio file (range-request aware)
  └─ GET /api/skin/<f>   → streams a skin file

index.html
  └─ Detects ?autoload=1, fetches /api/beatmap + /api/audio, plays automatically
```

---

## Manual (browser) mode

```bash
npm run dev
```

Open `http://localhost:5173`, drop in your `.osu` and audio files, pick a dance
algorithm, and press **Play**. Press **ESC** at any time to open settings.

There are a lot of bugs, so don’t expect anything. The reason I recoded this osu is just to test my own JavaScript skills. 
Most likely, I won’t be working much on this project. So if you want an up-to-date osu!standard visualization, 
you can just use [danser-go](https://github.com/Wieku/danser-go) instead.
