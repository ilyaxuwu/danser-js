// ─────────────────────────────────────────────
//  ReplayExporter.js
//
//  Uses CursorDancer (the exact same code the
//  browser uses) to generate the cursor path,
//  then layers M1/M2 key presses on top.
//  Result: replay is identical to what you see
//  in the browser renderer.
// ─────────────────────────────────────────────

import fs     from 'node:fs';
import path   from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// Import the same CursorDancer + FlowerSettings the browser uses
import { CursorDancer }  from '../dance/CursorDancer.js';
import { FlowerSettings } from '../dance/DanceAlgorithm.js';
import { BeatmapParser }  from '../parser/BeatmapParser.js';

const require   = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function getLzma() {
  try { return require('lzma'); }
  catch (_) { throw new Error('Run  npm install lzma  first.'); }
}

// ══════════════════════════════════════════════
//  PUBLIC
// ══════════════════════════════════════════════

export async function exportReplay(opts) {
  const { beatmapPath, meta, settings: cfg, outDir, sampleRate = 16 } = opts;
  const lzma = await getLzma();

  if (!fs.existsSync(beatmapPath))
    throw new Error(`Beatmap not found: ${beatmapPath}`);

  console.log('\n🎮  Building .osr replay…');

  // ── 1. Parse beatmap (same parser as browser) ──────────────────────────
  const rawOsu  = fs.readFileSync(beatmapPath, 'utf8');
  const beatmap = BeatmapParser.parse(rawOsu);
  const md5Map  = crypto.createHash('md5').update(rawOsu).digest('hex');

  // ── 2. Apply flower settings from cfg ─────────────────────────────────
  applySettings(cfg);

  // ── 3. Generate cursor path using the SAME CursorDancer as the browser ─
  const sliderDance = cfg.sliderDance ?? false;
  const dancer      = new CursorDancer(1 / sampleRate, sliderDance);
  const getPos      = dancer.buildPositionQuery(beatmap);

  // Sample path at sampleRate ms intervals across the whole map
  const firstTime = beatmap.hitObjects[0]?.time ?? 0;
  const lastObj   = beatmap.hitObjects[beatmap.hitObjects.length - 1];
  const lastTime  = (lastObj?.endTime ?? lastObj?.time ?? 0) + 1000;

  const pathFrames = [];
  for (let t = Math.max(0, firstTime - beatmap.approachPreempt); t <= lastTime; t += sampleRate) {
    const p = getPos(t);
    pathFrames.push({ t, x: p.x, y: p.y });
  }

  console.log(`    Path: ${pathFrames.length} frames (${sampleRate}ms interval)`);

  // ── 4. Build key events (M1/M2, guaranteed hits) ──────────────────────
  const replayStr = buildReplayString(pathFrames, beatmap, cfg);
  console.log(`    Serialised: ${replayStr.split(',').length} replay frames`);

  // ── 5. LZMA compress ──────────────────────────────────────────────────
  const compressed = await compress(lzma, replayStr);
  console.log(`    Compressed: ${(compressed.length / 1024).toFixed(1)} KB`);

  // ── 6. Write .osr ─────────────────────────────────────────────────────
  const playerName = cfg.playerName ?? 'danser-js';
  const replayMd5  = crypto.createHash('md5')
    .update(md5Map + playerName + replayStr.length.toString())
    .digest('hex');

  const n = beatmap.hitObjects.length;
  const buf = writeOsr({
    mode: 0, version: 20231030,
    beatmapMd5: md5Map, playerName, replayMd5,
    count300: n, count100: 0, count50: 0,
    countGeki: 0, countKatu: 0, countMiss: 0,
    totalScore: 1000000, maxCombo: n, perfectCombo: 1,
    mods: 0, lifeBar: '',
    timestamp: dateToTicks(new Date()),
    replayData: compressed,
    onlineScoreId: 0n,
  });

  const st = (meta.title ?? 'replay').replace(/[^a-zA-Z0-9 _-]/g,'').trim().slice(0,40);
  const sd = (meta.diff  ?? '').replace(/[^a-zA-Z0-9 _-]/g,'').trim().slice(0,30);
  const fn = `${st} [${sd}] (${playerName}).osr`;
  const op = path.join(outDir, fn);
  fs.writeFileSync(op, buf);
  console.log(`\n✅  Saved → ${op}  (${(fs.statSync(op).size/1024).toFixed(1)} KB)\n`);
  return op;
}

// ── Apply cfg → FlowerSettings (same as main.js does) ─────────────────
function applySettings(cfg) {
  if (!cfg) return;
  // All flower dance settings — directly maps from config.json dance section
  if (cfg.petAngle       != null) FlowerSettings.petAngle       = cfg.petAngle;
  if (cfg.angleRandom    != null) FlowerSettings.angleRandom    = cfg.angleRandom;
  if (cfg.zigzag         != null) FlowerSettings.zigzag         = cfg.zigzag;
  if (cfg.flowDir        != null) FlowerSettings.flowDir        = cfg.flowDir;
  if (cfg.longJump       != null) FlowerSettings.longJump       = cfg.longJump;
  if (cfg.longJumpDist   != null) FlowerSettings.longJumpDist   = cfg.longJumpDist;
  if (cfg.longJumpAngle  != null) FlowerSettings.longJumpAngle  = cfg.longJumpAngle;
  if (cfg.longJumpMult   != null) FlowerSettings.longJumpMult   = cfg.longJumpMult;
  if (cfg.streamAngle    != null) FlowerSettings.streamAngle    = cfg.streamAngle;
  if (cfg.streamThresh   != null) FlowerSettings.streamThresh   = cfg.streamThresh;
  if (cfg.skipStackAngle != null) FlowerSettings.skipStackAngle = cfg.skipStackAngle;
  if (cfg.spinnerMult    != null) FlowerSettings.spinnerMult    = cfg.spinnerMult;
  if (cfg.spinnerRPM     != null) FlowerSettings.spinnerRPM     = cfg.spinnerRPM;
  if (cfg.spinnerArms    != null) FlowerSettings.spinnerArms    = cfg.spinnerArms;
  if (cfg.spinnerOuter   != null) FlowerSettings.spinnerOuter   = cfg.spinnerOuter;
  if (cfg.spinnerInner   != null) FlowerSettings.spinnerInner   = cfg.spinnerInner;
  console.log(`  🌸 petAngle=${FlowerSettings.petAngle} longJumpMult=${FlowerSettings.longJumpMult} longJumpDist=${FlowerSettings.longJumpDist} sliderDance=${cfg.sliderDance}`);
}

// ══════════════════════════════════════════════
//  KEY EVENT BUILDER
//
//  Takes the pre-generated cursor path and
//  adds M1/M2 key presses at the right times.
//
//  Rule: at pressAt, the cursor path already
//  has the cursor on or very near the note
//  (because CursorDancer puts it there).
//  We just need to turn the key on/off.
// ══════════════════════════════════════════════

const M1 = 1, M2 = 2;

function buildReplayString(pathFrames, beatmap, cfg) {
  // All timing values read from config.json replay section
  const HOLD_CIRCLE = cfg.circleHoldMs        ?? 36;
  const TAIL_EXTRA  = cfg.sliderTailExtraMs   ?? 18;
  const MIN_GAP     = cfg.minGapMs            ?? 10;
  const ALT_MS      = cfg.altThresholdMs      ?? 140;

  const objs = beatmap.hitObjects;
  if (!objs.length) return '-12345|256|192|0,-12345|0|0|0';

  // Build key-press schedule
  const events = [];
  let useM2 = false;

  for (let i = 0; i < objs.length; i++) {
    const obj  = objs[i];
    const next = objs[i + 1];
    const gap  = next ? next.time - obj.time : Infinity;

    if (obj.objectType === 'spinner') {
      events.push({ pressAt: obj.time, releaseAt: obj.endTime, key: M1 });
      useM2 = false;
      continue;
    }

    const key = gap < ALT_MS ? (useM2 ? M2 : M1) : M1;
    if (gap < ALT_MS) useM2 = !useM2; else useM2 = false;

    if (obj.objectType === 'slider') {
      events.push({ pressAt: obj.time, releaseAt: (obj.endTime ?? obj.time) + TAIL_EXTRA, key });
    } else {
      events.push({ pressAt: obj.time, releaseAt: obj.time + HOLD_CIRCLE, key });
    }
  }

  // Enforce minimum silence between presses
  for (let i = 0; i < events.length - 1; i++) {
    const maxRel = events[i + 1].pressAt - MIN_GAP;
    if (events[i].releaseAt > maxRel)
      events[i].releaseAt = Math.max(events[i].pressAt + 4, maxRel);
  }

  // Map path frames to key state
  const parts = ['-12345|256|192|0'];
  let prevT  = 0;
  let evIdx  = 0;

  for (const f of pathFrames) {
    // Advance past fully-ended events
    while (evIdx < events.length && events[evIdx].releaseAt < f.t) evIdx++;

    // Find active key at this time
    let keys = 0;
    for (let i = evIdx; i < events.length; i++) {
      const ev = events[i];
      if (ev.pressAt > f.t) break;
      if (f.t >= ev.pressAt && f.t <= ev.releaseAt) { keys = ev.key; break; }
    }

    const delta = Math.max(0, f.t - prevT);
    parts.push(`${delta}|${f.x.toFixed(2)}|${f.y.toFixed(2)}|${keys}`);
    prevT = f.t;
  }

  parts.push('-12345|0|0|0');
  return parts.join(',');
}

// ══════════════════════════════════════════════
//  BINARY .OSR WRITER
// ══════════════════════════════════════════════

function writeOsr(r) {
  const b = [];
  b.push(u8(r.mode));          b.push(i32(r.version));
  b.push(osuStr(r.beatmapMd5)); b.push(osuStr(r.playerName)); b.push(osuStr(r.replayMd5));
  b.push(i16(r.count300));     b.push(i16(r.count100));    b.push(i16(r.count50));
  b.push(i16(r.countGeki));    b.push(i16(r.countKatu));   b.push(i16(r.countMiss));
  b.push(i32(r.totalScore));   b.push(i16(r.maxCombo));    b.push(u8(r.perfectCombo));
  b.push(i32(r.mods));         b.push(osuStr(r.lifeBar));  b.push(i64(r.timestamp));
  b.push(i32(r.replayData.length));
  b.push(Buffer.from(r.replayData));
  b.push(i64(r.onlineScoreId));
  return Buffer.concat(b);
}

function u8(n)  { const b=Buffer.alloc(1); b.writeUInt8(n,0); return b; }
function i16(n) { const b=Buffer.alloc(2); b.writeInt16LE(n,0); return b; }
function i32(n) { const b=Buffer.alloc(4); b.writeInt32LE(n,0); return b; }
function i64(n) { const b=Buffer.alloc(8); b.writeBigInt64LE(typeof n==='bigint'?n:BigInt(Math.floor(n)),0); return b; }

function osuStr(s) {
  if (!s) return Buffer.from([0x00]);
  const u = Buffer.from(s, 'utf8');
  return Buffer.concat([Buffer.from([0x0b]), uleb128(u.length), u]);
}
function uleb128(v) {
  const o=[];
  do { let b=v&0x7f; v>>>=7; if(v)b|=0x80; o.push(b); } while(v);
  return Buffer.from(o);
}
function dateToTicks(d) { return BigInt(d.getTime())*10000n+116444736000000000n; }
function compress(lzma, str) {
  return new Promise((res,rej) => {
    lzma.compress(Buffer.from(str,'utf8'), 1, (result,err) => {
      if (err) return rej(err);
      res(Buffer.from(result));
    });
  });
}
