#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────
//  danser-js CLI
//
//  Usage:
//    node cli.js --title="Sound Chimera"
//    node cli.js --title="Sound Chimera" --diff="Chimera" --skin="Whitecat"
//    node cli.js --artist="Camellia" --diff="Chimera" --algo=gd
//    node cli.js --help
//
//  Flags:
//    --title=<str>    Song title (partial match, case-insensitive)
//    --artist=<str>   Artist name (partial match)
//    --diff=<str>     Difficulty name (partial, e.g. "Insane")
//    --skin=<str>     Skin folder name inside skinsPath
//    --algo=<str>     Dance algorithm: gd|pippi|bezier|flower|linear
//    --rate=<num>     Playback rate (e.g. 1.5 for DT, 0.75 for HT)
//    --port=<num>     Dev server port (default: 5173)
//    --no-open        Don't open browser automatically
//    --list           List all found beatmaps matching filters, then exit
// ─────────────────────────────────────────────────────────────────

import fs   from 'node:fs';
import { exportReplay } from './src/replay/ReplayExporter.js';
import path from 'node:path';
import { execSync, spawn } from 'node:child_process';
import { createServer }    from 'node:http';
import { fileURLToPath }   from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Parse arguments ──────────────────────────────────────────────
const args = {};
for (const raw of process.argv.slice(2)) {
  if (raw === '--help' || raw === '-h') { printHelp(); process.exit(0); }
  if (raw.startsWith('--')) {
    const eq  = raw.indexOf('=');
    const key = eq === -1 ? raw.slice(2) : raw.slice(2, eq);
    const val = eq === -1 ? true : raw.slice(eq + 1);
    args[key] = val;
  }
}

// ── Load config.json ─────────────────────────────────────────────
const configPath = path.join(__dirname, 'config.json');
if (!fs.existsSync(configPath)) {
  die(`config.json not found at ${configPath}\nRun 'npm run dev' first and configure paths via ESC → Settings.`);
}

let cfg;
try {
  cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch (e) {
  die(`Failed to parse config.json: ${e.message}`);
}

const songsPath = cfg.osu?.songsPath;
const skinsPath = cfg.osu?.skinsPath;

if (!songsPath || !fs.existsSync(songsPath)) {
  die(`Songs path not found: "${songsPath}"\nSet it via ESC → Settings in the browser.`);
}

// ── Search beatmaps ──────────────────────────────────────────────
console.log(`\n🔍  Scanning: ${songsPath}`);

const osuFiles = findOsuFiles(songsPath);
console.log(`    Found ${osuFiles.length} .osu files`);

const filter = {
  title:  args.title  ? norm(args.title)  : null,
  artist: args.artist ? norm(args.artist) : null,
  diff:   args.diff   ? norm(args.diff)   : null,
};

const noFilter = !filter.title && !filter.artist && !filter.diff;
if (noFilter) {
  console.warn('\n⚠️  No filters given — picking the first available beatmap.');
  console.warn('    Use --title=, --artist=, --diff= to target a specific map.\n');
}

// Read only the metadata header of each .osu (fast — stops after [HitObjects])
const matches = [];
for (const file of osuFiles) {
  const meta = readOsuMeta(file);
  if (!meta) continue;

  const titleOk  = !filter.title  || norm(meta.title).includes(filter.title);
  const artistOk = !filter.artist || norm(meta.artist).includes(filter.artist);
  const diffOk   = !filter.diff   || norm(meta.diff).includes(filter.diff);

  if (titleOk && artistOk && diffOk) {
    matches.push({ file, meta });
  }
}

if (matches.length === 0) {
  die([
    `No beatmap found matching:`,
    filter.title  ? `  title  = "${args.title}"`  : '',
    filter.artist ? `  artist = "${args.artist}"` : '',
    filter.diff   ? `  diff   = "${args.diff}"`   : '',
    '',
    `Check the filters or run without arguments to see all maps.`,
  ].filter(Boolean).join('\n'));
}

// --list mode: print all matches and exit
if (args.list) {
  console.log(`\n📋  ${matches.length} match(es):\n`);
  for (const { meta, file } of matches) {
    console.log(`  [${meta.artist}] ${meta.title} — ${meta.diff}`);
    console.log(`    ${file}\n`);
  }
  process.exit(0);
}

// Pick first match (or warn if multiple)
const chosen = matches[0];
if (matches.length > 1) {
  console.warn(`\n⚠️  ${matches.length} matches found — using first:`);
  for (const { meta } of matches.slice(0, 5))
    console.warn(`   · ${meta.artist} – ${meta.title} [${meta.diff}]`);
  if (matches.length > 5) console.warn(`   … and ${matches.length - 5} more`);
}

console.log(`\n🎵  ${chosen.meta.artist} – ${chosen.meta.title} [${chosen.meta.diff}]`);
console.log(`    ${chosen.file}`);

// ── Find audio file ───────────────────────────────────────────────
const mapDir    = path.dirname(chosen.file);
const audioFile = findAudio(mapDir, chosen.meta.audioFilename);
if (!audioFile) {
  die(`Audio file not found in: ${mapDir}\n(expected: ${chosen.meta.audioFilename})`);
}
console.log(`🎧  ${path.basename(audioFile)}`);

// ── Find skin ────────────────────────────────────────────────────
let skinDir = null;
const skinName = args.skin ?? cfg.osu?.activeSkin;
if (skinName && skinName !== 'Default' && skinsPath && fs.existsSync(skinsPath)) {
  const candidate = path.join(skinsPath, skinName);
  if (fs.existsSync(candidate)) {
    skinDir = candidate;
    console.log(`🎨  Skin: ${skinName}`);
  } else {
    // Partial match
    const entries = fs.readdirSync(skinsPath);
    const hit = entries.find(e => norm(e).includes(norm(skinName)));
    if (hit) {
      skinDir = path.join(skinsPath, hit);
      console.log(`🎨  Skin: ${hit} (matched "${skinName}")`);
    } else {
      console.warn(`⚠️  Skin "${skinName}" not found in ${skinsPath} — using default`);
    }
  }
}

// ── Write autoload manifest ───────────────────────────────────────
// Vite plugin reads this to serve files via /api/* endpoints
const manifest = {
  beatmapPath: chosen.file,
  audioPath:   audioFile,
  skinPath:    skinDir,
  meta:        chosen.meta,
  // Override settings from CLI flags
  algo:        args.algo   ?? args.algorithm ?? cfg.dance?.algorithm ?? 'gd',
  rate:        args.rate   ? parseFloat(args.rate)  : (cfg.audio?.playbackRate ?? 1.0),
};

const manifestPath = path.join(__dirname, '__autoload.json');
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
console.log(`\n✅  Manifest written. Launching renderer…\n`);

// ── Replay export mode ───────────────────────────────────────────
if (args.replay !== undefined) {
  // --replay=<name> sets the player name shown in osu! replay screen
  // Any value is valid — e.g. --replay="ilyax-js" or --replay="danser-js"
  const playerName = String(args.replay).trim() || 'danser-js';
  console.log(`\n👤  Player name: ${playerName}`);
  try {
    // Merge ALL config.json sections into one flat settings object
    // Order matters: dance → replay → runtime overrides (last wins)
    const replayCfg = {
      // 1. All flower dance settings (petAngle, longJumpMult, sliderDance etc.)
      ...( cfg.dance ?? {} ),
      // 2. Replay timing settings (circleHoldMs, altThresholdMs, sampleRateMs etc.)
      ...( cfg.replay ?? {} ),
      // 3. Runtime values (always win)
      playerName,                                            // from --replay="name"
      sliderDance:  !!(cfg.dance?.sliderDance),             // explicit bool
      rate:         cfg.audio?.playbackRate  ?? 1.0,
      skin:         skinName ?? cfg.osu?.activeSkin ?? 'Default',
    };
    console.log(`  📖 Config loaded: petAngle=${replayCfg.petAngle} sliderDance=${replayCfg.sliderDance} sampleRateMs=${replayCfg.sampleRateMs}`);
    await exportReplay({
      beatmapPath: chosen.file,
      meta:        { ...chosen.meta, audioFilename: chosen.meta.audioFilename },
      settings:    replayCfg,
      outDir:      __dirname,
      sampleRate:  cfg.replay?.sampleRateMs ?? 4,
    });
  } catch (e) {
    console.error('❌  Replay export failed:', e.message);
    process.exit(1);
  }
  try { fs.unlinkSync(manifestPath); } catch(_) {}
  process.exit(0);
}

// ── Build query string for browser URL ───────────────────────────
const qs = new URLSearchParams({
  autoload: '1',
  title:    chosen.meta.title,
  diff:     chosen.meta.diff,
});

// ── Spawn Vite dev server ────────────────────────────────────────
const port     = parseInt(args.port ?? '5173');
const noOpen   = args['no-open'] === true;
const viteArgs = ['vite', '--port', String(port)];
const vite     = spawn('npx', viteArgs, {
  cwd:   __dirname,
  stdio: 'inherit',
  shell: true,
});

vite.on('error', (e) => die(`Vite failed to start: ${e.message}`));

// Give Vite a moment to start then open the browser
if (!noOpen) {
  setTimeout(() => {
    const url = `http://localhost:${port}/?${qs}`;
    console.log(`\n🌐  Opening: ${url}\n`);
    openBrowser(url);
  }, 1800);
}

// Clean up manifest on exit
const cleanup = () => {
  try { fs.unlinkSync(manifestPath); } catch(_) {}
  vite.kill();
};
process.on('exit',    cleanup);
process.on('SIGINT',  () => { cleanup(); process.exit(0); });
process.on('SIGTERM', () => { cleanup(); process.exit(0); });

// ── Helpers ───────────────────────────────────────────────────────

function norm(s) {
  return String(s).toLowerCase().trim();
}

/** Recursively find all .osu files under a directory */
function findOsuFiles(dir, found = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch (_) { return found; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) findOsuFiles(full, found);
    else if (e.name.endsWith('.osu')) found.push(full);
  }
  return found;
}

/** Read only the metadata section of a .osu file (fast) */
function readOsuMeta(filePath) {
  let text;
  try { text = fs.readFileSync(filePath, 'utf8'); } catch(_) { return null; }

  const meta = { title: '', artist: '', diff: '', audioFilename: '' };
  let inGeneral = false, inMeta = false;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '[General]')  { inGeneral = true;  inMeta = false; continue; }
    if (line === '[Metadata]') { inMeta = true; inGeneral = false; continue; }
    if (line === '[HitObjects]') break;  // stop early

    if (inGeneral) {
      if (line.startsWith('AudioFilename:'))
        meta.audioFilename = line.split(':').slice(1).join(':').trim();
    }
    if (inMeta) {
      if (line.startsWith('Title:'))   meta.title  = line.slice('Title:'.length).trim();
      if (line.startsWith('Artist:'))  meta.artist = line.slice('Artist:'.length).trim();
      if (line.startsWith('Version:')) meta.diff   = line.slice('Version:'.length).trim();
    }
  }
  return meta.title || meta.artist ? meta : null;
}

/** Find the audio file in the map directory */
function findAudio(dir, filename) {
  const exts = ['.mp3', '.ogg', '.wav', '.flac', '.m4a'];
  let entries;
  try { entries = fs.readdirSync(dir); } catch(_) { return null; }

  // Try exact match first, then case-insensitive match
  if (filename) {
    const exact = entries.find(e => e === filename);
    if (exact) return path.join(dir, exact);
    const ci = entries.find(e => e.toLowerCase() === filename.toLowerCase());
    if (ci) return path.join(dir, ci);
  }

  // Fallback: first audio file in the folder
  const fallback = entries.find(e => exts.some(x => e.toLowerCase().endsWith(x)));
  return fallback ? path.join(dir, fallback) : null;
}

/** Cross-platform browser open */
function openBrowser(url) {
  const cmds = {
    win32:  ['cmd', ['/c', 'start', '', url]],
    darwin: ['open', [url]],
    linux:  ['xdg-open', [url]],
  };
  const [cmd, cArgs] = cmds[process.platform] ?? cmds.linux;
  spawn(cmd, cArgs, { detached: true, stdio: 'ignore' }).unref();
}

function die(msg) {
  console.error('\n❌  ' + msg + '\n');
  process.exit(1);
}

function printHelp() {
  console.log(`
danser-js — osu! cursor dancer

Usage:
  node cli.js [options]

Options:
  --title=<str>    Song title (partial, case-insensitive)
  --artist=<str>   Artist name (partial)
  --diff=<str>     Difficulty name (partial, e.g. "Insane")
  --skin=<str>     Skin folder name inside your skins path
  --algo=<str>     Dance algorithm: gd | pippi | bezier | flower | linear
  --rate=<num>     Playback rate  (1.5 = DT, 0.75 = HT)
  --port=<num>     Dev server port (default: 5173)
  --no-open        Don't auto-open the browser
  --list           List matching beatmaps and exit
  --help           Show this help

Examples:
  node cli.js --title="Sound Chimera" --diff="Chimera" --skin="Whitecat"
  node cli.js --artist="Camellia" --algo=pippi --rate=1.5
  node cli.js --list --title="Chimera"
  node cli.js --title="Sound Chimera" --replay="danser-js"
  node cli.js --title="Sound Chimera" --replay="danser-js" --algo=gd --no-open

Options (replay-specific):
  --replay=<name>  Export a .osr replay file openable in osu!.
                   The value becomes the player name shown in the replay screen.
                   e.g. --replay="ilyax-js"  or  --replay="danser-js"
                   Written to the project root. Browser will NOT open.
`);
}
