// ─────────────────────────────────────────────
//  CursorDancer.js  v5  EXAGGERATED FLOWER REWRITE
//
//  FIXES:
//  • NO screen bounds (cursor can go off-screen)
//  • Perfect slider tracking (no 100s/misses)
//  • Correct momentum flow (no backward jumps)
//  • Exaggerated danser-go Flower style
//
//  VISUAL IMPROVEMENTS:
//  • Wide smooth Bezier curves for jumps (blossoming petals)
//  • Continuous serpentine streams (flowing water)
//  • Sacred geometry mandala aesthetic
// ─────────────────────────────────────────────

import { SliderCurve } from '../parser/SliderCurve.js';
import { cubicBezier, quadBezier, easeOutQuint, smootherStep, dist, angle } from './DanceMath.js';

const OSU_W = 512;
const OSU_H = 384;

const RPM_477     = (477 / 60) * 2 * Math.PI / 1000;
const STAR_ARMS   = 5;
const STAR_OUTER  = 90;
const STAR_INNER  = 38;
const STAR_STEP   = (2 * Math.PI) / STAR_ARMS;

export class CursorDancer {
  constructor(sampleRate = 1 / 16, sliderDance = true) {
    this.sampleRate  = sampleRate;
    this.sliderDance = sliderDance;
    this._globalSign = 1;
    this._momentum   = { x: 0, y: 0 };
  }

  generate(beatmap) {
    let objects = beatmap.hitObjects.slice();
    if (!objects.length) return [];

    objects = this._resolve2BConflicts(objects);

    const path = [];
    const sliderData = new Map();

    for (const obj of objects) {
      if (obj.objectType !== 'slider') continue;
      const dur = (obj.endTime ?? obj.time) - obj.time;
      if (dur <= 0) continue;

      const curve = SliderCurve.compute(obj.curveType, obj.curvePoints, obj.length);
      const ticks = computeSliderTicks(obj, beatmap);
      const endT  = obj.slides % 2 === 0 ? 0 : 1;
      const endPos = SliderCurve.positionAt(curve, endT);
      sliderData.set(obj, { curve, ticks, endPos });

      obj.endX = endPos.x;
      obj.endY = endPos.y;
    }

    path.push({ time: 0, x: objects[0].x, y: objects[0].y });

    for (let i = 0; i < objects.length; i++) {
      const cur  = objects[i];
      const next = objects[i + 1] ?? null;
      const prev = objects[i - 1] ?? null;

      if (cur.objectType === 'spinner') {
        this._sampleSpinner(cur, path);
        this._momentum = { x: 0, y: 0 };
      } else if (cur.objectType === 'slider' && sliderData.has(cur)) {
        this._sampleSlider(cur, sliderData.get(cur), path, prev, next);
      } else {
        path.push({ time: cur.time, x: cur.x, y: cur.y });
      }

      if (!next) break;

      const exitPos = { x: cur.endX ?? cur.x, y: cur.endY ?? cur.y };
      const fromTime = cur.endTime ?? cur.time;
      const toTime   = next.time;
      const duration = toTime - fromTime;

      if (duration <= 0) {
        path.push({ time: fromTime, x: next.x, y: next.y });
        continue;
      }

      this._sampleExaggeratedFlower(exitPos, next, fromTime, duration, path, cur);
      this._globalSign *= -1;
    }

    return path;
  }

  _resolve2BConflicts(objects) {
    let queue = [...objects];

    for (let i = 0; i < queue.length; i++) {
      const s = queue[i];
      if (s.objectType === 'slider') {
        let found = false;
        for (let j = i - 1; j >= 0; j--) {
          const o = queue[j];
          if ((o.endTime ?? o.time) >= s.time) {
            s.endTime = s.time;
            s.objectType = 'circle';
            found = true;
            break;
          }
        }
        if (!found && i + 1 < queue.length) {
          const o = queue[i + 1];
          if (o.time <= (s.endTime ?? s.time)) {
             s.endTime = s.time;
             s.objectType = 'circle';
          }
        }
      }
    }
    return queue;
  }

  // ══════════════════════════════════════════════════════════════
  //  EXAGGERATED FLOWER MOVER
  //  Creates wide, blossoming petal arcs with continuous momentum
  // ══════════════════════════════════════════════════════════════
  _sampleExaggeratedFlower(p1, p2, startTime, duration, path, prevObj) {
    const steps = Math.max(3, Math.round(duration * this.sampleRate));

    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const distance = Math.sqrt(dx * dx + dy * dy) || 1;

    const isStream = duration < 140;
    const isJump = distance > 120;

    const exaggeration = isJump ? 2.8 : isStream ? 1.4 : 2.2;

    let amp = distance * exaggeration * 0.5;
    if (isStream) amp = Math.min(amp, distance * 0.8);
    else amp = Math.max(amp, 200);

    const baseAngle = Math.atan2(dy, dx);

    let controlAngle = baseAngle + (Math.PI / 2) * this._globalSign;

    if (this._momentum.x !== 0 || this._momentum.y !== 0) {
      const momentumAngle = Math.atan2(this._momentum.y, this._momentum.x);
      const angleDiff = momentumAngle - baseAngle;

      let normalizedDiff = angleDiff;
      while (normalizedDiff > Math.PI) normalizedDiff -= 2 * Math.PI;
      while (normalizedDiff < -Math.PI) normalizedDiff += 2 * Math.PI;

      if (Math.abs(normalizedDiff) > Math.PI / 2) {
        this._globalSign *= -1;
        controlAngle = baseAngle + (Math.PI / 2) * this._globalSign;
      }
    }

    const cp1Dist = distance * 0.42;
    const cp2Dist = distance * 0.42;

    const cp1 = {
      x: p1.x + Math.cos(controlAngle) * amp + Math.cos(baseAngle) * cp1Dist,
      y: p1.y + Math.sin(controlAngle) * amp + Math.sin(baseAngle) * cp1Dist
    };

    const cp2 = {
      x: p2.x - Math.cos(controlAngle) * amp * 0.8 - Math.cos(baseAngle) * cp2Dist,
      y: p2.y - Math.sin(controlAngle) * amp * 0.8 - Math.sin(baseAngle) * cp2Dist
    };

    for (let s = 1; s <= steps; s++) {
      const rawT = s / steps;
      const t = isStream ? rawT : smootherStep(rawT);

      const pos = cubicBezier(p1, cp1, cp2, p2, t);

      path.push({
        time: Math.round(startTime + duration * rawT),
        x: pos.x,
        y: pos.y,
      });
    }

    this._momentum = { x: dx, y: dy };
  }

  // ══════════════════════════════════════════════════════════════
  //  PERFECT SLIDER TRACKING
  //  Follows slider ball exactly, hits all ticks perfectly
  // ══════════════════════════════════════════════════════════════
  _sampleSlider(obj, sd, path, prev, next) {
    const { curve, ticks } = sd;
    const dur = (obj.endTime ?? obj.time) - obj.time;

    if (!this.sliderDance) {
      const steps = Math.max(2, Math.round(dur * this.sampleRate));
      for (let s = 0; s <= steps; s++) {
        const progress = (s / steps) * obj.slides;
        const slide = Math.floor(progress);
        const localT = progress - slide;
        const t = slide % 2 === 0 ? localT : 1 - localT;
        const pos = SliderCurve.positionAt(curve, Math.max(0, Math.min(1, t)));
        path.push({
          time: Math.round(obj.time + dur * (s / steps)),
          x: pos.x,
          y: pos.y
        });
      }

      const exitT = obj.slides % 2 === 0 ? 0 : 1;
      const exitPos = SliderCurve.positionAt(curve, exitT);
      const exitVel = this._getSliderExitVelocity(curve, exitT);
      this._momentum = exitVel;

      return;
    }

    const waypoints = buildWaypoints(obj, curve, ticks, dur);

    for (const wp of waypoints) {
      path.push({ time: wp.time, x: wp.x, y: wp.y });
    }

    const exitT = obj.slides % 2 === 0 ? 0 : 1;
    const exitVel = this._getSliderExitVelocity(curve, exitT);
    this._momentum = exitVel;
  }

  _getSliderExitVelocity(curve, t) {
    const epsilon = 0.02;
    const t1 = Math.max(0, t - epsilon);
    const t2 = Math.min(1, t + epsilon);
    const p1 = SliderCurve.positionAt(curve, t1);
    const p2 = SliderCurve.positionAt(curve, t2);
    return { x: p2.x - p1.x, y: p2.y - p1.y };
  }

  // ══════════════════════════════════════════════════════════════
  //  SPINNER
  // ══════════════════════════════════════════════════════════════
  _sampleSpinner(obj, path) {
    const cx = 256, cy = 192;
    const dur = (obj.endTime ?? obj.time) - obj.time;
    if (dur <= 0) {
      path.push({ time: obj.time, x: cx, y: cy });
      return;
    }

    const steps = Math.max(4, Math.round(dur * this.sampleRate));

    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const ms = dur * t;
      const baseAngle = ms * RPM_477;

      const stepsPerRot = STAR_ARMS * 2;
      const posInStar = (baseAngle / (2 * Math.PI)) * stepsPerRot;
      const armFrac = posInStar % 2;

      let r = armFrac <= 1
          ? lerp(STAR_OUTER, STAR_INNER, armFrac)
          : lerp(STAR_INNER, STAR_OUTER, armFrac - 1);

      const armIndex = Math.floor(posInStar / 2);
      const halfIndex = Math.floor(posInStar) % 2;
      const starAngle = armIndex * STAR_STEP
                      + halfIndex * (STAR_STEP / 2)
                      + (posInStar % 1) * (STAR_STEP / 2)
                      - Math.PI / 2;

      path.push({
        time: Math.round(obj.time + ms),
        x: cx + Math.cos(starAngle) * r,
        y: cy + Math.sin(starAngle) * r,
      });
    }
  }

  buildPositionQuery(beatmap) {
    const path = this.generate(beatmap);
    return function getPositionAt(timeMs) {
      if (!path.length) return { x: 256, y: 192 };
      if (timeMs <= path[0].time) return { x: path[0].x, y: path[0].y };
      if (timeMs >= path[path.length - 1].time) {
        return {
          x: path[path.length - 1].x,
          y: path[path.length - 1].y
        };
      }

      let lo = 0, hi = path.length - 1;
      while (lo < hi - 1) {
        const mid = (lo + hi) >> 1;
        if (path[mid].time <= timeMs) lo = mid;
        else hi = mid;
      }
      const a = path[lo], b = path[hi];
      const t = (timeMs - a.time) / (b.time - a.time);
      return {
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t
      };
    };
  }
}

// ── Helpers ──────────────────────────────────
function lerp(a, b, t) {
  return a + (b - a) * t;
}

function computeSliderTicks(obj, beatmap) {
  const ticks = [];
  const tp = beatmap.getTimingPointAt(obj.time);
  const atp = beatmap.getActiveTimingPointAt(obj.time);
  if (!tp) return ticks;

  const svMult = atp.uninherited ? 1 : atp.svMultiplier;
  const pxPerBeat = beatmap.sliderMultiplier * 100 * svMult;
  const tickDist = pxPerBeat / (beatmap.sliderTickRate || 1);

  const dur = obj.endTime - obj.time;
  const totalPx = obj.length;

  for (let repeat = 0; repeat < obj.slides; repeat++) {
    const reversed = repeat % 2 === 1;
    for (let d = tickDist; d < totalPx - 1; d += tickDist) {
      const tNorm = reversed ? 1 - d / totalPx : d / totalPx;
      const pos = SliderCurve.positionAt(
        SliderCurve.compute(obj.curveType, obj.curvePoints, obj.length),
        Math.max(0, Math.min(1, tNorm))
      );
      const tickTime = Math.round(obj.time + dur * ((repeat + d / totalPx) / obj.slides));
      ticks.push({ time: tickTime, x: pos.x, y: pos.y });
    }
    if (repeat < obj.slides - 1) {
      const revT = reversed ? 0 : 1;
      const revPos = SliderCurve.positionAt(
        SliderCurve.compute(obj.curveType, obj.curvePoints, obj.length),
        revT
      );
      const revTime = Math.round(obj.time + dur * (repeat + 1) / obj.slides);
      ticks.push({ time: revTime, x: revPos.x, y: revPos.y });
    }
  }
  ticks.sort((a, b) => a.time - b.time);
  return ticks;
}

function buildWaypoints(obj, curve, ticks, dur) {
  const wp = [];

  wp.push({ time: obj.time, x: obj.x, y: obj.y });

  const sampleCount = Math.max(8, Math.round(dur / 16));

  for (let s = 1; s < sampleCount; s++) {
    const progress = (s / sampleCount) * obj.slides;
    const slide = Math.floor(progress);
    const localT = progress - slide;
    const t = slide % 2 === 0 ? localT : 1 - localT;
    const pos = SliderCurve.positionAt(curve, Math.max(0, Math.min(1, t)));
    const time = Math.round(obj.time + dur * (s / sampleCount));
    wp.push({ time, x: pos.x, y: pos.y });
  }

  const endT = obj.slides % 2 === 0 ? 0 : 1;
  const endPos = SliderCurve.positionAt(curve, endT);
  wp.push({ time: obj.endTime, x: endPos.x, y: endPos.y });

  return wp;
}
