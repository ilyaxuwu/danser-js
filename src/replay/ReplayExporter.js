import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { CursorDancer, buildDanceQueue } from '../dance/CursorDancer.js';
import { FlowerSettings } from '../dance/DanceAlgorithm.js';
import { BeatmapParser } from '../parser/BeatmapParser.js';
import { SliderCurve } from '../parser/SliderCurve.js';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function getLzma() {
  try {
    return require('lzma');
  } catch (_) {
    throw new Error('Run npm install lzma first.');
  }
}

export async function exportReplay(opts) {
  const { beatmapPath, meta, settings: cfg, outDir, sampleRate = 16 } = opts;
  const lzma = await getLzma();

  if (!fs.existsSync(beatmapPath)) {
    throw new Error(`Beatmap not found: ${beatmapPath}`);
  }

  console.log('\n[replay] Building .osr...');

  const rawOsu = fs.readFileSync(beatmapPath, 'utf8');
  const beatmap = BeatmapParser.parse(rawOsu);
  const md5Map = crypto.createHash('md5').update(rawOsu).digest('hex');

  applySettings(cfg);

  const sliderDance = cfg.sliderDance ?? false;
  const dancer = new CursorDancer(1 / sampleRate, sliderDance);
  const getPos = dancer.buildPositionQuery(beatmap);
  const debugReport = dancer.getDebugReport?.();
  if (debugReport?.notify) {
    console.warn('[cursordance-debug] 2B accuracy risk in replay export', debugReport);
  }

  const keyEvents = buildKeyEvents(beatmap, cfg);
  const pathFrames = buildReplayFrames(beatmap, getPos, keyEvents, sampleRate);
  console.log(`  Path frames: ${pathFrames.length} (${sampleRate}ms base interval + key edges)`);

  const replayStr = buildReplayString(pathFrames, keyEvents);
  console.log(`  Replay frames: ${replayStr.split(',').length}`);

  const compressed = await compress(lzma, replayStr);
  console.log(`  Compressed: ${(compressed.length / 1024).toFixed(1)} KB`);

  const playerName = cfg.playerName ?? 'danser-js';
  const replayMd5 = crypto.createHash('md5')
    .update(md5Map + playerName + replayStr.length.toString())
    .digest('hex');

  const n = beatmap.hitObjects.length;
  const buf = writeOsr({
    mode: 0,
    version: 20231030,
    beatmapMd5: md5Map,
    playerName,
    replayMd5,
    count300: n,
    count100: 0,
    count50: 0,
    countGeki: 0,
    countKatu: 0,
    countMiss: 0,
    totalScore: 1000000,
    maxCombo: n,
    perfectCombo: 1,
    mods: 0,
    lifeBar: '',
    timestamp: dateToTicks(new Date()),
    replayData: compressed,
    onlineScoreId: 0n,
  });

  const st = (meta.title ?? 'replay').replace(/[^a-zA-Z0-9 _-]/g, '').trim().slice(0, 40);
  const sd = (meta.diff ?? '').replace(/[^a-zA-Z0-9 _-]/g, '').trim().slice(0, 30);
  const fn = `${st} [${sd}] (${playerName}).osr`;
  const op = path.join(outDir, fn);
  fs.writeFileSync(op, buf);
  console.log(`\nSaved: ${op} (${(fs.statSync(op).size / 1024).toFixed(1)} KB)\n`);
  return op;
}

function applySettings(cfg) {
  if (!cfg) return;

  FlowerSettings.angle                     = cfg.angle ?? cfg.petAngle ?? FlowerSettings.angle;
  FlowerSettings.streamAngle               = cfg.streamAngle ?? FlowerSettings.streamAngle;
  FlowerSettings.streamMs                  = cfg.streamMs ?? cfg.streamThresh ?? FlowerSettings.streamMs;
  FlowerSettings.spinnerAngle              = cfg.spinnerAngle ?? FlowerSettings.spinnerAngle;
  FlowerSettings.zigzag                    = cfg.zigzag ?? FlowerSettings.zigzag;
  FlowerSettings.idleMs                    = cfg.idleMs ?? FlowerSettings.idleMs;
  FlowerSettings.sliderDanceAmplitude      = cfg.sliderDanceAmplitude ?? FlowerSettings.sliderDanceAmplitude;
  FlowerSettings.sliderEntryBehind         = cfg.sliderEntryBehind ?? FlowerSettings.sliderEntryBehind;
  FlowerSettings.sliderEntryBehindDistance = cfg.sliderEntryBehindDistance ?? cfg.sliderDanceAmplitude ?? FlowerSettings.sliderEntryBehindDistance;
  FlowerSettings.sliderEntryBehindSplit    = cfg.sliderEntryBehindSplit ?? FlowerSettings.sliderEntryBehindSplit;
  FlowerSettings.sliderEntryConflictWindowMs = cfg.sliderEntryConflictWindowMs ?? FlowerSettings.sliderEntryConflictWindowMs;
  FlowerSettings.sliderScoreSafe           = cfg.sliderScoreSafe ?? FlowerSettings.sliderScoreSafe;
  FlowerSettings.sliderTickLeadMs          = cfg.sliderTickLeadMs ?? FlowerSettings.sliderTickLeadMs;
  FlowerSettings.sliderTickStayMs          = cfg.sliderTickStayMs ?? FlowerSettings.sliderTickStayMs;
  FlowerSettings.sliderCriticalWindowMs    = cfg.sliderCriticalWindowMs ?? FlowerSettings.sliderCriticalWindowMs;
  FlowerSettings.sliderCriticalHoldMs      = cfg.sliderCriticalHoldMs ?? FlowerSettings.sliderCriticalHoldMs;
  FlowerSettings.samePositionDance         = cfg.samePositionDance ?? FlowerSettings.samePositionDance;
  FlowerSettings.samePositionRadius        = cfg.samePositionRadius ?? FlowerSettings.samePositionRadius;
  FlowerSettings.samePositionTurns         = cfg.samePositionTurns ?? FlowerSettings.samePositionTurns;
  FlowerSettings.twoBUseDummyCircles       = cfg.twoBUseDummyCircles ?? FlowerSettings.twoBUseDummyCircles;
  FlowerSettings.debugEnabled              = cfg.debugEnabled ?? FlowerSettings.debugEnabled;
  FlowerSettings.debugSkipNonDance         = cfg.debugSkipNonDance ?? FlowerSettings.debugSkipNonDance;
  FlowerSettings.debugNotifyOn2BRisk       = cfg.debugNotifyOn2BRisk ?? FlowerSettings.debugNotifyOn2BRisk;
  FlowerSettings.debugRiskDistancePx       = cfg.debugRiskDistancePx ?? FlowerSettings.debugRiskDistancePx;
  FlowerSettings.debugEvalWindowMs         = cfg.debugEvalWindowMs ?? FlowerSettings.debugEvalWindowMs;
  FlowerSettings.allowOutOfBounds          = cfg.allowOutOfBounds ?? FlowerSettings.allowOutOfBounds;
  FlowerSettings.smoothPath                = cfg.smoothPath ?? FlowerSettings.smoothPath;
  FlowerSettings.smoothPathTension         = cfg.smoothPathTension ?? FlowerSettings.smoothPathTension;
  FlowerSettings.spinnerRPM                = 2000;
  FlowerSettings.spinnerArms               = cfg.spinnerArms ?? FlowerSettings.spinnerArms;
  FlowerSettings.spinnerOuter              = cfg.spinnerOuter ?? FlowerSettings.spinnerOuter;
  FlowerSettings.spinnerInner              = cfg.spinnerInner ?? FlowerSettings.spinnerInner;

  console.log(`[dance] angle=${FlowerSettings.angle} sliderAmp=${FlowerSettings.sliderDanceAmplitude} spinnerRPM=${FlowerSettings.spinnerRPM}`);
}

const M1 = 1;
const M2 = 2;
const LEFT_MASK = M1;
const RIGHT_MASK = M2;

function buildKeyEvents(beatmap, cfg) {
  if (cfg.sliderDance) {
    return buildDanserStyleKeyEvents(beatmap, cfg);
  }

  const EARLY_PRESS = cfg.earlyPressMs ?? 16;
  const HOLD_CIRCLE = cfg.circleHoldMs ?? 36;
  const TAIL_EXTRA = cfg.sliderTailExtraMs ?? 18;
  const MIN_GAP = cfg.minGapMs ?? 10;
  const ALT_MS = cfg.altThresholdMs ?? 140;
  const SLIDER_LEAD = cfg.sliderTickLeadMs ?? 20;
  const SLIDER_STAY = cfg.sliderTickStayMs ?? 20;

  const objs = beatmap.hitObjects;
  if (!objs.length) return [];

  const rawEvents = [];
  const sliderCache = new Map();
  let altRight = false;

  for (let i = 0; i < objs.length; i++) {
    const obj = objs[i];
    const next = objs[i + 1];
    const gap = next ? next.time - obj.time : Infinity;
    const defaultKey = gap < ALT_MS
      ? (altRight ? RIGHT_MASK : LEFT_MASK)
      : LEFT_MASK;

    if (gap < ALT_MS) altRight = !altRight;
    else altRight = false;

    if (obj.objectType === 'spinner') {
      rawEvents.push({
        pressAt: Math.max(0, obj.time - EARLY_PRESS),
        releaseAt: obj.endTime,
        pressX: 256,
        pressY: 192,
        hitTime: obj.time,
        hitX: 256,
        hitY: 192,
        releaseX: 256,
        releaseY: 192,
        sourceType: 'spinner',
        priority: 3,
        preferredKey: defaultKey,
        groupId: `spinner:${i}`,
      });
      continue;
    }

    if (obj.objectType === 'slider' && hasOverlapConflict(objs, i)) {
      const scorePts = sliderScorePointsForReplay(obj, beatmap, sliderCache);
      const groupId = `slider:${i}`;

      for (let p = 0; p < scorePts.length; p++) {
        const pt = scorePts[p];
        const headLead = p === 0 ? Math.max(EARLY_PRESS, SLIDER_LEAD) : SLIDER_LEAD;
        const tailStay = p === scorePts.length - 1 ? Math.max(SLIDER_STAY, TAIL_EXTRA) : SLIDER_STAY;
        rawEvents.push({
          pressAt: Math.max(0, pt.time - headLead),
          releaseAt: pt.time + tailStay,
          pressX: pt.x,
          pressY: pt.y,
          hitTime: pt.time,
          hitX: pt.x,
          hitY: pt.y,
          releaseX: pt.x,
          releaseY: pt.y,
          sourceType: 'slider-critical',
          priority: p === 0 || p === scorePts.length - 1 ? 2.5 : 2.25,
          preferredKey: defaultKey,
          groupId,
        });
      }
      continue;
    }

    const releaseAt = obj.objectType === 'slider'
      ? (obj.endTime ?? obj.time) + TAIL_EXTRA
      : obj.time + HOLD_CIRCLE;

    rawEvents.push({
      pressAt: Math.max(0, obj.time - EARLY_PRESS),
      releaseAt,
      pressX: obj.x,
      pressY: obj.y,
      hitTime: obj.time,
      hitX: obj.x,
      hitY: obj.y,
      releaseX: obj.objectType === 'slider' ? (obj.endX ?? obj.x) : obj.x,
      releaseY: obj.objectType === 'slider' ? (obj.endY ?? obj.y) : obj.y,
      sourceType: obj.objectType,
      priority: obj.objectType === 'slider' ? 2 : 1,
      preferredKey: defaultKey,
      groupId: `${obj.objectType}:${i}`,
    });
  }

  const laneState = new Map([
    [LEFT_MASK, { busyUntil: -Infinity, lastPressAt: -Infinity }],
    [RIGHT_MASK, { busyUntil: -Infinity, lastPressAt: -Infinity }],
  ]);
  const groupLane = new Map();

  return rawEvents
    .sort((a, b) =>
    a.pressAt - b.pressAt ||
    (b.priority ?? 0) - (a.priority ?? 0) ||
    a.releaseAt - b.releaseAt
    )
    .map((event) => assignKey(event, laneState, groupLane, MIN_GAP));
}

function buildDanserStyleKeyEvents(beatmap, cfg = {}) {
  const queue = buildDanceQueue(beatmap, true).map((obj) => ({ ...obj }));
  const speed = beatmap?._clockRate || 1;
  const singleTapThreshold = 140;
  const minGap = cfg.minGapMs ?? 10;
  const earlyPress = Math.max(0, cfg.earlyPressMs ?? 16);
  const sliderLead = Math.max(earlyPress, cfg.sliderTickLeadMs ?? 20);
  const sliderStay = Math.max(0, cfg.sliderTickStayMs ?? 20);
  const sliderTailExtra = Math.max(sliderStay, cfg.sliderTailExtraMs ?? 18);
  const sliderSourceEndTimes = new Map();
  const rawEvents = [];

  let wasLeftBefore = false;
  let previousEnd = 0;

  for (const obj of queue) {
    if (!obj?._sliderSourceId) continue;
    sliderSourceEndTimes.set(
      obj._sliderSourceId,
      Math.max(sliderSourceEndTimes.get(obj._sliderSourceId) ?? -Infinity, obj._sliderEndTime ?? obj.endTime ?? obj.time),
    );
  }

  for (let i = 0; i < queue.length; i++) {
    const current = queue[i];
    const isDoubleClick = !!current.doubleClick;
    const startTime = current.time;
    let endTime = current.endTime ?? current.time;
    const isConflictSliderPoint = !!current._sliderSourceId && !!current._disableSliderPathFollow;
    let releaseAt = isConflictSliderPoint ? endTime + sliderStay : endTime + 50;
    let releaseX = current.x;
    let releaseY = current.y;

    let nextIndex = i + 1;
    for (; nextIndex < queue.length; nextIndex++) {
      const next = queue[nextIndex];
      if (
        !isConflictSliderPoint &&
        next?.objectType === 'circle' &&
        next.sliderPoint &&
        !next.sliderPointStart &&
        next._sliderSourceId === current._sliderSourceId
      ) {
        endTime = next.endTime ?? next.time;
        releaseAt = endTime + 50;
        releaseX = next.x;
        releaseY = next.y;
      } else {
        break;
      }
    }

    if (nextIndex < queue.length) {
      let lookahead = null;
      if (isDoubleClick || queue[nextIndex]?.doubleClick) {
        lookahead = queue[nextIndex];
      } else if (nextIndex + 1 < queue.length) {
        lookahead = queue[nextIndex + 1];
      }

      if (lookahead) {
        releaseAt = clampNumber(lookahead.time - 1, endTime + 1, releaseAt);
      }
    }

    const shouldBeLeft = !wasLeftBefore && (startTime - previousEnd) < singleTapThreshold * speed;
    const pressLead = current.sliderPoint ? sliderLead : earlyPress;
    const pressAt = Math.max(0, startTime - pressLead);
    const sliderGroupId = current._sliderSourceId && !isConflictSliderPoint ? `slider:${current._sliderSourceId}` : null;
    if (sliderGroupId) {
      releaseAt = Math.max(
        releaseAt,
        (sliderSourceEndTimes.get(current._sliderSourceId) ?? endTime) + sliderTailExtra,
      );
    }

    const baseEvent = {
      pressAt,
      releaseAt,
      pressX: current.x,
      pressY: current.y,
      hitTime: startTime,
      hitX: current.x,
      hitY: current.y,
      releaseX,
      releaseY,
      sourceType: 'danser-queue',
      priority: sliderGroupId ? 5 : 4,
      preferredKey: shouldBeLeft ? LEFT_MASK : RIGHT_MASK,
      groupId: sliderGroupId,
    };

    if (isDoubleClick) {
      rawEvents.push({ ...baseEvent, fixedKey: LEFT_MASK, groupId: null });
      rawEvents.push({ ...baseEvent, fixedKey: RIGHT_MASK, groupId: null });
    } else {
      rawEvents.push(baseEvent);
    }

    wasLeftBefore = shouldBeLeft;
    previousEnd = endTime;
    i = nextIndex - 1;
  }

  const laneState = new Map([
    [LEFT_MASK, { busyUntil: -Infinity, lastPressAt: -Infinity }],
    [RIGHT_MASK, { busyUntil: -Infinity, lastPressAt: -Infinity }],
  ]);
  const groupLane = new Map();

  return rawEvents
    .sort((a, b) =>
      a.pressAt - b.pressAt ||
      (b.priority ?? 0) - (a.priority ?? 0) ||
      a.releaseAt - b.releaseAt
    )
    .map((event) =>
      event.fixedKey != null
        ? assignFixedKey(event, laneState, groupLane)
        : assignKey(event, laneState, groupLane, minGap),
    )
    .sort((a, b) =>
      a.pressAt - b.pressAt ||
      a.releaseAt - b.releaseAt ||
      a.key - b.key
    );
}

function buildReplayFrames(beatmap, getPos, keyEvents, sampleRate) {
  const firstTime = beatmap.hitObjects[0]?.time ?? 0;
  const lastObj = beatmap.hitObjects[beatmap.hitObjects.length - 1];
  const lastTime = (lastObj?.endTime ?? lastObj?.time ?? 0) + 1000;
  const startTime = Math.max(0, firstTime - beatmap.approachPreempt);

  const times = new Set();
  const overrides = new Map();
  const sliderCache = new Map();
  for (let t = startTime; t <= lastTime; t += sampleRate) {
    times.add(Math.round(t));
  }
  for (const ev of keyEvents) {
    times.add(Math.round(ev.pressAt));
    times.add(Math.round(ev.hitTime));
    times.add(Math.round(ev.releaseAt));
    addOverride(overrides, Math.round(ev.pressAt), ev.pressX, ev.pressY);
    addOverride(overrides, Math.round(ev.hitTime), ev.hitX, ev.hitY);
    addOverride(overrides, Math.round(ev.releaseAt), ev.releaseX, ev.releaseY);
  }

  for (const obj of beatmap.hitObjects) {
    if (obj.objectType !== 'slider') continue;
    const criticalPoints = sliderScorePointsForReplay(obj, beatmap, sliderCache);
    for (const pt of criticalPoints) {
      const time = Math.round(pt.time);
      times.add(time);
      addOverride(overrides, time, pt.x, pt.y);
    }
  }

  return [...times]
    .sort((a, b) => a - b)
    .map((t) => {
      const p = overrides.get(t) ?? getPos(t);
      return { t, ...clampReplayPoint(p.x, p.y) };
    });
}

function buildReplayString(pathFrames, keyEvents) {
  if (!pathFrames.length) return '-12345|256|192|0,-12345|0|0|0';

  const parts = ['-12345|256|192|0'];
  let prevT = 0;
  let pressIdx = 0;
  const byPress = [...keyEvents].sort((a, b) => a.pressAt - b.pressAt);
  const releaseUntil = new Map();

  for (const f of pathFrames) {
    while (pressIdx < byPress.length && byPress[pressIdx].pressAt <= f.t) {
      const event = byPress[pressIdx];
      const key = event.key;
      // danser-go style input uses one release deadline per key.
      // A newer press on the same key replaces the previous deadline
      // instead of stacking "active counts", which would over-hold 2B sliders.
      releaseUntil.set(key, event.releaseAt);
      pressIdx++;
    }

    let keys = 0;
    for (const [key, until] of releaseUntil.entries()) {
      if (f.t < until) keys |= key;
    }

    const delta = Math.max(0, f.t - prevT);
    parts.push(`${delta}|${f.x.toFixed(2)}|${f.y.toFixed(2)}|${keys}`);
    prevT = f.t;
  }

  parts.push('-12345|0|0|0');
  return parts.join(',');
}

function addOverride(map, time, x, y) {
  map.set(time, clampReplayPoint(x, y));
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function clampReplayPoint(x, y) {
  return {
    x: Math.min(512, Math.max(0, x)),
    y: Math.min(384, Math.max(0, y)),
  };
}

function assignKey(event, laneState, groupLane, minGap) {
  const preferred = event.preferredKey ?? LEFT_MASK;
  const other = preferred === LEFT_MASK ? RIGHT_MASK : LEFT_MASK;
  const existingLane = event.groupId ? groupLane.get(event.groupId) : null;

  let key = existingLane ?? preferred;
  if (existingLane == null) {
    if (!laneIsFree(laneState.get(preferred), event.pressAt, minGap)) {
      if (laneIsFree(laneState.get(other), event.pressAt, minGap)) {
        key = other;
      } else {
        key = chooseLessBusyLane(laneState, preferred, other);
      }
    }
  }

  if (event.groupId) groupLane.set(event.groupId, key);
  const lane = laneState.get(key);
  lane.busyUntil = Math.max(lane.busyUntil, event.releaseAt);
  lane.lastPressAt = event.pressAt;

  return { ...event, key };
}

function assignFixedKey(event, laneState) {
  const lane = laneState.get(event.fixedKey);
  lane.busyUntil = Math.max(lane.busyUntil, event.releaseAt);
  lane.lastPressAt = event.pressAt;
  return { ...event, key: event.fixedKey };
}

function laneIsFree(lane, pressAt, minGap) {
  return (lane?.busyUntil ?? -Infinity) + minGap <= pressAt;
}

function chooseLessBusyLane(laneState, preferred, other) {
  const prefBusy = laneState.get(preferred)?.busyUntil ?? -Infinity;
  const otherBusy = laneState.get(other)?.busyUntil ?? -Infinity;
  return prefBusy <= otherBusy ? preferred : other;
}

function hasOverlapConflict(objects, index) {
  const obj = objects[index];
  const start = obj.time;
  const end = obj.endTime ?? obj.time;

  for (let i = index - 1; i >= 0; i--) {
    const prev = objects[i];
    const prevEnd = prev.endTime ?? prev.time;
    if (prevEnd < start) break;
    return true;
  }

  for (let i = index + 1; i < objects.length; i++) {
    const next = objects[i];
    if (next.time > end) break;
    return true;
  }

  return false;
}

function sliderScorePointsForReplay(obj, beatmap, sliderCache) {
  let cached = sliderCache.get(obj);
  if (!cached) {
    const curve = SliderCurve.compute(obj.curveType, obj.curvePoints, obj.length);
    const endT = obj.slides % 2 === 0 ? 0 : 1;
    const tail = SliderCurve.positionAt(curve, endT);
    const ticks = Array.isArray(obj.ticks) ? obj.ticks : replaySliderTicks(obj, beatmap, curve);
    const repeats = Array.isArray(obj.repeats) ? obj.repeats : [];
    const pts = [{ time: obj.time, x: obj.x, y: obj.y }, ...ticks, ...repeats, { time: obj.endTime, x: tail.x, y: tail.y }];
    pts.sort((a, b) => a.time - b.time);

    const seen = new Set();
    cached = pts.filter((pt) => {
      if (seen.has(pt.time)) return false;
      seen.add(pt.time);
      return true;
    });
    sliderCache.set(obj, cached);
  }
  return cached;
}

function replaySliderTicks(obj, beatmap, curve) {
  const ticks = [];
  const tp = beatmap.getTimingPointAt?.(obj.time);
  const atp = beatmap.getActiveTimingPointAt?.(obj.time);
  if (!tp) return ticks;

  const sv = atp?.uninherited ? 1 : (atp?.svMultiplier ?? 1);
  const pxPerBeat = (beatmap.sliderMultiplier ?? 1.4) * 100 * sv;
  const velocityPxPerMs = pxPerBeat / Math.max(1, tp.beatLength);
  const minDistanceFromEnd = velocityPxPerMs * 10;
  let tickDist = pxPerBeat / (beatmap.sliderTickRate ?? 1);
  const dur = (obj.endTime ?? obj.time) - obj.time;
  if (tickDist > obj.length) tickDist = obj.length;
  if (tickDist <= 0 || obj.length <= 0 || dur <= 0) return ticks;

  for (let rep = 0; rep < obj.slides; rep++) {
    const rev = rep % 2 === 1;
    for (let d = tickDist; d < obj.length; d += tickDist) {
      if (d >= obj.length - minDistanceFromEnd) break;
      const tn = rev ? 1 - d / obj.length : d / obj.length;
      const pos = SliderCurve.positionAt(curve, Math.max(0, Math.min(1, tn)));
      ticks.push({
        time: Math.round(obj.time + dur * (rep + d / obj.length) / obj.slides),
        x: pos.x,
        y: pos.y,
      });
    }

    if (rep < obj.slides - 1) {
      const rpt = SliderCurve.positionAt(curve, rev ? 0 : 1);
      ticks.push({
        time: Math.round(obj.time + dur * (rep + 1) / obj.slides),
        x: rpt.x,
        y: rpt.y,
      });
    }
  }

  ticks.sort((a, b) => a.time - b.time);
  return ticks;
}

function writeOsr(r) {
  const b = [];
  b.push(u8(r.mode));
  b.push(i32(r.version));
  b.push(osuStr(r.beatmapMd5));
  b.push(osuStr(r.playerName));
  b.push(osuStr(r.replayMd5));
  b.push(i16(r.count300));
  b.push(i16(r.count100));
  b.push(i16(r.count50));
  b.push(i16(r.countGeki));
  b.push(i16(r.countKatu));
  b.push(i16(r.countMiss));
  b.push(i32(r.totalScore));
  b.push(i16(r.maxCombo));
  b.push(u8(r.perfectCombo));
  b.push(i32(r.mods));
  b.push(osuStr(r.lifeBar));
  b.push(i64(r.timestamp));
  b.push(i32(r.replayData.length));
  b.push(Buffer.from(r.replayData));
  b.push(i64(r.onlineScoreId));
  return Buffer.concat(b);
}

function u8(n) {
  const b = Buffer.alloc(1);
  b.writeUInt8(n, 0);
  return b;
}
function i16(n) {
  const b = Buffer.alloc(2);
  b.writeInt16LE(n, 0);
  return b;
}
function i32(n) {
  const b = Buffer.alloc(4);
  b.writeInt32LE(n, 0);
  return b;
}
function i64(n) {
  const b = Buffer.alloc(8);
  b.writeBigInt64LE(typeof n === 'bigint' ? n : BigInt(Math.floor(n)), 0);
  return b;
}

function osuStr(s) {
  if (!s) return Buffer.from([0x00]);
  const u = Buffer.from(s, 'utf8');
  return Buffer.concat([Buffer.from([0x0b]), uleb128(u.length), u]);
}

function uleb128(v) {
  const o = [];
  do {
    let b = v & 0x7f;
    v >>>= 7;
    if (v) b |= 0x80;
    o.push(b);
  } while (v);
  return Buffer.from(o);
}

function dateToTicks(d) {
  return BigInt(d.getTime()) * 10000n + 116444736000000000n;
}

function compress(lzma, str) {
  return new Promise((res, rej) => {
    lzma.compress(Buffer.from(str, 'utf8'), 1, (result, err) => {
      if (err) return rej(err);
      res(Buffer.from(result));
    });
  });
}
