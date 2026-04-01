import { FlowerMover, FlowerSettings, MOVERS } from './DanceAlgorithm.js';
import { clamp, lerp, dist2, easeIO as ease, sampleBezier } from './DanceMath.js';
import { SliderCurve } from '../parser/SliderCurve.js';
import { config } from '../config/Config.js';

const OW = 512;
const OH = 384;

export class CursorDancer {
  constructor(sampleRate = 1 / 4, sliderDance = false) {
    this.sr = sampleRate;  // samples per ms
    this.sd = sliderDance;
    this._movers = {}; // Persistent mover instances
    this._restrictToPlayfield = !FlowerSettings.allowOutOfBounds;
    this._debugReport = this._makeDebugReport();
    this._streamSign = 1;
  }

  generate(beatmap) {
    this._restrictToPlayfield = !FlowerSettings.allowOutOfBounds;
    this._debugReport = this._makeDebugReport();
    this._circleRadius = beatmap?.circleRadius ?? 32;
    this._streamSign = 1;
    if (!this.sd && FlowerSettings.debugSkipNonDance !== false) {
      this._debugReport.skipped = true;
      this._debugReport.skipReason = 'sliderDance disabled';
    }

    // Reset all movers for a new map
    for (const key in this._movers) {
      this._movers[key].reset?.();
    }

    const queue = buildDanceQueue(beatmap, this.sd);
    this._debugReport.twoBConflictCount = count2BConflicts(beatmap.hitObjects);
    if (!queue.length) return [];

    const sld = new Map();
    for (const o of queue) {
      if (!isSliderLikeObject(o)) continue;
      const curve = SliderCurve.compute(o.curveType, o.curvePoints, o.length);
      const ticks = getSliderTicks(o, beatmap, curve);
      const endT = o.slides % 2 === 0 ? 0 : 1;
      const ep = SliderCurve.positionAt(curve, endT);
      const startAngle = SliderCurve.startAngle(curve);
      const endAngle = SliderCurve.tangentAngleAt(curve, endT);
      sld.set(o, { curve, ticks, ep, startAngle, endAngle });
      o._ex = ep.x;
      o._ey = ep.y;
    }

    const path = [];
    this._push(path, 0, queue[0].x, queue[0].y, !!queue[0]._isSliderDummy);

    for (let i = 0; i < queue.length; i++) {
      const cur = queue[i];
      const next = queue[i + 1] ?? null;
      const sdCur = sld.get(cur);

      if (cur.objectType === 'spinner') {
        this._moon(cur, path);
      } else {
        // Regular circle or Dummy point from slider/2B explosion
        this._push(path, cur.time, cur.x, cur.y, !!cur._isSliderDummy);
      }

      if (!next) break;

      const currentIsSliderDummy = !!cur._isSliderDummy;
      const ex = currentIsSliderDummy ? cur.x : (cur._ex ?? cur.endX ?? cur.x);
      const ey = currentIsSliderDummy ? cur.y : (cur._ey ?? cur.endY ?? cur.y);
      const t0 = currentIsSliderDummy ? cur.time : (cur.endTime ?? cur.time);
      const gap = next.time - t0;

      if (gap < 0) {
        this._push(path, t0, next.x, next.y, !!next._isSliderDummy);
        continue;
      }

      const conflictSliderChain = isConflictSliderChain(cur, next);
      if (conflictSliderChain) {
        const nextExternal = findNextExternalObject(queue, i + 2, cur._sliderSourceId);
        this._followConflictSliderSegment(cur, next, path, nextExternal);
        continue;
      }

      const sliderChainData = isSameSliderChain(cur, next) ? (sld.get(cur) ?? sld.get(next)) : null;
      if (sliderChainData) {
        const nextExternal = findNextExternalObject(queue, i + 2, cur._sliderSourceId);
        this._followSliderSegment(cur, next, sliderChainData, path, nextExternal);
        continue;
      }

      const nextSliderData = isSliderEntryObject(next) ? sld.get(next) : null;
      if (
        nextSliderData &&
        FlowerSettings.sliderEntryBehind !== false &&
        !hasEarlySliderStartConflict(this.bMap ?? beatmap, next)
      ) {
        this._toSliderEntry({ endX: ex, endY: ey }, next, nextSliderData, t0, gap, cur.objectType === 'spinner', path);
        continue;
      }

      if (gap >= (FlowerSettings.idleMs ?? 2000)) {
        this._wander({ endX: ex, endY: ey, endAngle: cur.endAngle ?? sdCur?.endAngle }, next, t0, t0 + gap, path);
      } else {
        const nextNext = queue[i + 2] ?? null;
        const nextData = sld.get(next);
        this._arc(
          { endX: ex, endY: ey, endAngle: cur.endAngle ?? sdCur?.endAngle },
          { ...next, startAngle: next.startAngle ?? nextData?.startAngle },
          t0, gap, cur.objectType === 'spinner', path, nextNext
        );
      }
    }

    return path;
  }

  getDebugReport() {
    const r = { ...this._debugReport };
    r.notify = (
      r.enabled &&
      !r.skipped &&
      (FlowerSettings.debugNotifyOn2BRisk !== false) &&
      r.twoBConflictCount > 0 &&
      r.sliderRiskCount > 0
    );
    return r;
  }

  _makeDebugReport() {
    return {
      enabled: FlowerSettings.debugEnabled !== false,
      skipped: false,
      skipReason: '',
      twoBConflictCount: 0,
      sliderRiskCount: 0,
      sliderRiskDetails: [],
    };
  }

  buildPositionQuery(beatmap) {
    const path = this.generate(beatmap);
    return (ms) => {
      if (!path.length) return { x: 256, y: 192 };
      if (ms <= path[0].time) return path[0];
      const last = path[path.length - 1];
      if (ms >= last.time) return last;

      let lo = 0;
      let hi = path.length - 1;
      while (lo < hi - 1) {
        const mid = (lo + hi) >> 1;
        path[mid].time <= ms ? lo = mid : hi = mid;
      }

      const a = path[lo];
      const b = path[hi];
      const dt = b.time - a.time;
      if (dt <= 0) return { x: a.x, y: a.y };
      const t = (ms - a.time) / dt;

      if (FlowerSettings.smoothPath !== false && path.length > 3) {
        const p0 = path[Math.max(0, lo - 1)];
        const p1 = a;
        const p2 = b;
        const p3 = path[Math.min(path.length - 1, hi + 1)];
        const tension = clamp(FlowerSettings.smoothPathTension ?? 0.35, 0, 1);
        const k = (1 - tension) * 0.5;

        const t2 = t * t;
        const t3 = t2 * t;
        const h00 = 2 * t3 - 3 * t2 + 1;
        const h10 = t3 - 2 * t2 + t;
        const h01 = -2 * t3 + 3 * t2;
        const h11 = t3 - t2;

        const lockScaleA = a.lock ? 0.28 : 1;
        const lockScaleB = b.lock ? 0.28 : 1;
        const m1x = (p2.x - p0.x) * k * lockScaleA;
        const m1y = (p2.y - p0.y) * k * lockScaleA;
        const m2x = (p3.x - p1.x) * k * lockScaleB;
        const m2y = (p3.y - p1.y) * k * lockScaleB;

        let x = h00 * p1.x + h10 * m1x + h01 * p2.x + h11 * m2x;
        let y = h00 * p1.y + h10 * m1y + h01 * p2.y + h11 * m2y;
        if (this._restrictToPlayfield) {
          x = clamp(x, 0, OW);
          y = clamp(y, 0, OH);
        }
        return { x, y };
      }

      let x = a.x + (b.x - a.x) * t;
      let y = a.y + (b.y - a.y) * t;
      if (this._restrictToPlayfield) {
        x = clamp(x, 0, OW);
        y = clamp(y, 0, OH);
      }
      return { x, y };
    };
  }

  _arc(from, to, t0, gap, spinner, path, nextTarget = null) {
    if (gap <= 0) {
      this._push(path, t0, to.x, to.y, !!to._isSliderDummy);
      return;
    }

    const fx = from.endX ?? from.x;
    const fy = from.endY ?? from.y;
    const tx = to.x;
    const ty = to.y;

    if (FlowerSettings.samePositionDance && dist2(fx, fy, tx, ty) < 0.5) {
      this._samePositionDance(tx, ty, t0, gap, path);
      return;
    }

    if (isStreamTransition(from, to, nextTarget, gap, FlowerSettings.streamMs ?? 130)) {
      this._streamArc(fx, fy, tx, ty, t0, gap, path);
      return;
    }

    const algo = config.get('dance.algorithm') || 'flower';
    if (!this._movers[algo]) {
      const factory = MOVERS[algo] ?? MOVERS.flower;
      this._movers[algo] = factory();
    }
    const mover = this._movers[algo];

    // Pass metadata like angles and types if available
    mover.init(from, to, gap, spinner, nextTarget);

    // Smoothness Fix: Increase minimum steps for fast "Tempon" patterns
    const steps = Math.max(16, Math.ceil(gap * this.sr * 2.0));

    // Arrive slightly early on slider critical points so replay/input has time to settle.
    let actualGap = gap;
    let earlyHoldPoint = null;
    if (to._isSliderDummy && FlowerSettings.sliderScoreSafe !== false) {
      const lead = Math.min(
        Math.max(0, FlowerSettings.sliderTickLeadMs ?? 20),
        Math.max(0, gap - 1),
      );
      actualGap = Math.max(0, gap - lead);
      if (lead > 0) {
        earlyHoldPoint = { time: Math.round(t0 + actualGap), x: to.x, y: to.y };
      }
    }

    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const p = mover.getPositionAt(t);
      const sampleTime = Math.round(t0 + actualGap * t);
      if (sampleTime <= Math.round(t0) || sampleTime >= Math.round(t0 + actualGap)) continue;
      this._push(path, sampleTime, p.x, p.y, false);
    }

    this._push(path, Math.round(t0 + actualGap), to.x, to.y, !!to._isSliderDummy);

    if (earlyHoldPoint) {
      this._push(path, earlyHoldPoint.time, earlyHoldPoint.x, earlyHoldPoint.y, true);
    }

    // Fill the gap if lead logic was applied to maintain timeline
    if (actualGap < gap) {
      this._push(path, Math.round(t0 + gap), to.x, to.y, !!to._isSliderDummy);
    }
  }

  _samePositionDance(x, y, t0, gap, path) {
    const steps = Math.max(3, Math.round(gap * this.sr));
    const radius = Math.max(4, FlowerSettings.samePositionRadius ?? 90);
    const turns = Math.max(0.25, FlowerSettings.samePositionTurns ?? 1.0);
    const sign = FlowerMover._zs;
    const base = FlowerMover._prev ?? 0;

    if (FlowerSettings.zigzag) FlowerMover._zs *= -1;

    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const e = ease(t);
      const r = radius * Math.sin(Math.PI * t);
      const a = base + sign * e * turns * Math.PI * 2;
      this._push(path, Math.round(t0 + gap * t), x + Math.cos(a) * r, y + Math.sin(a) * r, false);
    }

    FlowerMover._prev = base + sign * turns * Math.PI * 2 + sign * (Math.PI / 2);
  }

  _streamArc(fx, fy, tx, ty, t0, gap, path) {
    const distance = Math.hypot(tx - fx, ty - fy);
    if (distance < 0.001 || gap <= 0) {
      this._push(path, Math.round(t0 + gap), tx, ty, false);
      return;
    }

    this._streamSign *= -1;
    const sign = this._streamSign;
    const nx = -(ty - fy) / distance;
    const ny = (tx - fx) / distance;
    const amplitude = clamp(distance * 0.36, 14, 72);
    const ctrl1 = {
      x: fx + (tx - fx) * 0.24 + nx * amplitude * sign,
      y: fy + (ty - fy) * 0.24 + ny * amplitude * sign,
    };
    const ctrl2 = {
      x: fx + (tx - fx) * 0.76 - nx * amplitude * sign,
      y: fy + (ty - fy) * 0.76 - ny * amplitude * sign,
    };
    const bezier = [
      { x: fx, y: fy },
      ctrl1,
      ctrl2,
      { x: tx, y: ty },
    ];

    const firstSample = Math.floor(t0) + 1;
    const lastSample = Math.ceil(t0 + gap) - 1;
    for (let sampleTime = firstSample; sampleTime <= lastSample; sampleTime++) {
      const t = (sampleTime - t0) / Math.max(1, gap);
      const p = sampleBezier(bezier, t);
      this._push(path, sampleTime, p.x, p.y, false);
    }

    this._push(path, Math.round(t0 + gap), tx, ty, false);
  }

  _wander(from, to, t0, t1, path) {
    const gap = t1 - t0;
    const fx = from.endX;
    const fy = from.endY;

    const wx = this._restrictToPlayfield
      ? clamp(fx < OW / 2 ? OW - 60 : 60, 30, OW - 30)
      : (fx < OW / 2 ? OW + 90 : -90);
    const wy = this._restrictToPlayfield
      ? clamp(fy < OH / 2 ? OH - 60 : 60, 30, OH - 30)
      : (fy < OH / 2 ? OH + 90 : -90);

    const drift = gap * 0.5;
    const ret = gap - drift;

    const ds = Math.max(2, Math.round(drift * this.sr));
    for (let s = 1; s <= ds; s++) {
      const t = s / ds;
      const e = 1 - (1 - t) ** 2;
      this._push(path, Math.round(t0 + drift * t), lerp(fx, wx, e), lerp(fy, wy, e), false);
    }

    this._arc({ endX: wx, endY: wy }, to, t0 + drift, ret, false, path);
  }

  _toSliderEntry(from, sliderObj, sliderData, t0, gap, spinner, path) {
    if (gap <= 0) {
      this._push(path, t0, sliderObj.x, sliderObj.y, true);
      return;
    }

    const split = clamp(FlowerSettings.sliderEntryBehindSplit ?? 0.68, 0.2, 0.9);
    const behindDist = Math.max(
      0,
      FlowerSettings.sliderEntryBehindDistance
      ?? FlowerSettings.sliderDanceAmplitude
      ?? 300
    );
    const tang = sliderData.startAngle ?? SliderCurve.startAngle(sliderData.curve);

    let bx = sliderObj.x - Math.cos(tang) * behindDist;
    let by = sliderObj.y - Math.sin(tang) * behindDist;
    if (this._restrictToPlayfield) {
      bx = clamp(bx, 0, OW);
      by = clamp(by, 0, OH);
    }

    const firstGap = Math.max(1, Math.round(gap * split));
    const secondGap = Math.max(0, gap - firstGap);
    this._arc(from, { x: bx, y: by }, t0, firstGap, spinner, path);

    if (secondGap > 0) {
      this._arc({ endX: bx, endY: by }, { ...sliderObj, startAngle: tang }, t0 + firstGap, secondGap, false, path);
    } else {
      this._push(path, t0 + gap, sliderObj.x, sliderObj.y, true);
    }
  }

  _followSliderSegment(from, to, sliderData, path, nextExternal = null) {
    const startTime = from.time;
    const endTime = to.time;
    const gap = endTime - startTime;
    if (gap <= 0) {
      this._push(path, endTime, to.x, to.y, true);
      return;
    }

    const lead = Math.min(
      Math.max(0, FlowerSettings.sliderTickLeadMs ?? 20),
      Math.max(0, gap - 1),
    );
    const travelEndTime = Math.max(startTime, endTime - lead);
    const travelGap = Math.max(0, travelEndTime - startTime);
    const spanDist = Math.hypot(to.x - from.x, to.y - from.y);
    const rawAmp = Math.max(0, FlowerSettings.sliderDanceAmplitude ?? 42);
    const amplitude = Math.min(
      rawAmp * 0.1,
      (this._circleRadius ?? 32) * 0.4,
      spanDist * 0.18,
    );
    const sign = ((Math.floor(startTime) + Math.floor(endTime)) & 1) === 0 ? 1 : -1;

    if (travelGap <= 0) {
      this._push(path, endTime, to.x, to.y, true);
      return;
    }

    const firstSample = Math.floor(startTime) + 1;
    const lastSample = Math.ceil(travelEndTime) - 1;
    for (let sampleTime = firstSample; sampleTime <= lastSample; sampleTime++) {
      const t = (sampleTime - startTime) / Math.max(1, travelGap);
      const ms = sampleTime;
      const base = sliderPositionAtTime(from, sliderData.curve, ms);
      const tang = sliderTangentAtTime(from, sliderData.curve, ms);
      const off = Math.sin(Math.PI * t) * amplitude * sign;
      const x = base.x - Math.sin(tang) * off;
      const y = base.y + Math.cos(tang) * off;
      this._push(path, sampleTime, x, y, false);
    }

    this._push(path, Math.round(travelEndTime), to.x, to.y, true);
    this._push(path, Math.round(endTime), to.x, to.y, true);
  }

  _followConflictSliderSegment(from, to, path, nextExternal = null) {
    const startTime = from.time;
    const endTime = to.time;
    const gap = endTime - startTime;
    if (gap <= 0) {
      this._push(path, endTime, to.x, to.y, true);
      return;
    }

    const criticalHoldMs = Math.max(0, FlowerSettings.sliderCriticalHoldMs ?? 100);
    const nextExternalGap = nextExternal ? (nextExternal.time - endTime) : Infinity;
    const shouldParkOnCritical = !to.sliderPointStart && nextExternalGap > criticalHoldMs;
    const boundedCriticalLead = Math.min(
      criticalHoldMs,
      Math.max(0, gap * 0.4),
    );
    const lead = Math.min(
      shouldParkOnCritical
        ? boundedCriticalLead
        : Math.max(0, FlowerSettings.sliderTickLeadMs ?? 20),
      Math.max(0, gap - 1),
    );
    const travelEndTime = Math.max(startTime, endTime - lead);
    const travelGap = Math.max(0, travelEndTime - startTime);
    const distance = Math.hypot((to.x ?? 0) - (from.x ?? 0), (to.y ?? 0) - (from.y ?? 0));
    const dx = (to.x ?? 0) - (from.x ?? 0);
    const dy = (to.y ?? 0) - (from.y ?? 0);
    const invDist = distance > 0.001 ? 1 / distance : 0;
    const nx = -dy * invDist;
    const ny = dx * invDist;
    const amplitude = Math.min(
      Math.max(3, distance * 0.16),
      (this._circleRadius ?? 32) * 0.22,
      16,
    );
    const sign = ((Math.floor(startTime) + Math.floor(endTime)) & 1) === 0 ? 1 : -1;

    const firstSample = Math.floor(startTime) + 1;
    const lastSample = Math.ceil(travelEndTime) - 1;
    for (let sampleTime = firstSample; sampleTime <= lastSample; sampleTime++) {
      const t = (sampleTime - startTime) / Math.max(1, travelGap);
      const lift = Math.sin(Math.PI * t) * amplitude * sign;
      const x = lerp(from.x, to.x, t) + nx * lift;
      const y = lerp(from.y, to.y, t) + ny * lift;
      this._push(path, sampleTime, x, y, false);
    }

    this._push(path, Math.round(travelEndTime), to.x, to.y, true);
    this._push(path, Math.round(endTime), to.x, to.y, true);

    if (shouldParkOnCritical) {
      const postHold = Math.max(
        0,
        Math.min(
          criticalHoldMs,
          Number.isFinite(nextExternalGap) ? Math.max(0, nextExternalGap - 1) : criticalHoldMs,
        ),
      );
      if (postHold > 0) {
        this._push(path, Math.round(endTime + postHold), to.x, to.y, true);
      }
    }
  }

  _moon(obj, path) {
    const scx = 256;
    const scy = 192;
    const dur = (obj.endTime ?? obj.time) - obj.time;
    if (dur <= 0) {
      this._push(path, obj.time, scx, scy, false);
      return;
    }

    const steps = Math.max(64, Math.round(dur * this.sr * 6));
    const rpm = FlowerSettings.spinnerRPM ?? 2000;
    const outer = Math.max(72, FlowerSettings.spinnerOuter ?? 92);
    const innerRequested = FlowerSettings.spinnerInner ?? outer * 0.72;
    const inner = clamp(innerRequested, outer * 0.58, outer * 0.82);
    const offset = clamp(outer * 0.78, Math.abs(outer - inner) + 2, outer + inner - 2);
    const baseRotation = -Math.PI / 2;

    const intersectionX = (outer * outer - inner * inner + offset * offset) / (2 * offset);
    const intersectionY = Math.sqrt(Math.max(1, outer * outer - intersectionX * intersectionX));
    const outerStart = Math.atan2(intersectionY, intersectionX);
    const outerEnd = 2 * Math.PI - outerStart;
    let innerStart = Math.atan2(-intersectionY, intersectionX - offset);
    let innerEnd = Math.atan2(intersectionY, intersectionX - offset);
    if (innerEnd <= innerStart) innerEnd += 2 * Math.PI;

    const outerSpan = outerEnd - outerStart;
    const innerSpan = innerEnd - innerStart;
    const totalSpan = outerSpan + innerSpan;

    for (let s = 0; s <= steps; s++) {
      const ms = dur * (s / steps);
      const phase = ((ms * rpm) / 60000) % 1;
      const travel = phase * totalSpan;

      let px;
      let py;
      if (travel <= outerSpan) {
        const angle = outerStart + travel;
        px = Math.cos(angle) * outer;
        py = Math.sin(angle) * outer;
      } else {
        const angle = innerStart + (travel - outerSpan);
        px = offset + Math.cos(angle) * inner;
        py = Math.sin(angle) * inner;
      }

      const rx = px * Math.cos(baseRotation) - py * Math.sin(baseRotation);
      const ry = px * Math.sin(baseRotation) + py * Math.cos(baseRotation);
      this._push(path, Math.round(obj.time + ms), scx + rx, scy + ry, false);
    }
  }

  _push(path, time, x, y, lock = false) {
    if (this._restrictToPlayfield) {
      x = clamp(x, 0, OW);
      y = clamp(y, 0, OH);
    }

    if (path.length > 0) {
      const last = path[path.length - 1];
      if (time < last.time) {
        time = last.time;
      }

      if (time === last.time && Math.abs(last.x - x) < 0.001 && Math.abs(last.y - y) < 0.001 && last.lock === lock) {
        return;
      }
    }

    path.push({ time, x, y, lock });
  }
}

function isSliderLikeObject(obj) {
  return !!obj && Array.isArray(obj.curvePoints) && obj.curvePoints.length >= 2 && Number.isFinite(obj.length);
}

function isSliderEntryObject(obj) {
  return isSliderLikeObject(obj) &&
    !obj?._disableSliderPathFollow &&
    (obj.objectType === 'slider' || (obj._isSliderDummy && obj._isStart));
}

function getSliderTicks(obj, beatmap, curve = null) {
  if (Array.isArray(obj.ticks) && obj.ticks.length > 0) return obj.ticks;
  if (!isSliderLikeObject(obj)) return [];

  const path = curve ?? SliderCurve.compute(obj.curveType, obj.curvePoints, obj.length);
  const tp = beatmap.getTimingPointAt?.(obj.time);
  const atp = beatmap.getActiveTimingPointAt?.(obj.time);
  if (!tp) return [];

  const svMult = atp?.uninherited ? 1 : (atp?.svMultiplier ?? 1);
  const pxPerBeat = (beatmap.sliderMultiplier ?? 1.4) * 100 * svMult;
  const velocityPxPerMs = pxPerBeat / Math.max(1, tp.beatLength);
  const minDistanceFromEnd = velocityPxPerMs * 10;
  let tickDist = pxPerBeat / (beatmap.sliderTickRate || 1);
  const dur = (obj.endTime ?? obj.time) - obj.time;
  const ticks = [];
  if (!(tickDist > 0) || !(obj.length > 0) || !(dur > 0)) return ticks;
  if (tickDist > obj.length) tickDist = obj.length;

  for (let rep = 0; rep < (obj.slides ?? 1); rep++) {
    const reversed = rep % 2 === 1;
    for (let d = tickDist; d < obj.length; d += tickDist) {
      if (d >= obj.length - minDistanceFromEnd) break;
      const tNorm = reversed ? 1 - d / obj.length : d / obj.length;
      const pos = SliderCurve.positionAt(path, Math.max(0, Math.min(1, tNorm)));
      ticks.push({
        time: Math.round(obj.time + dur * ((rep + d / obj.length) / (obj.slides ?? 1))),
        x: pos.x,
        y: pos.y,
      });
    }
  }

  ticks.sort((a, b) => a.time - b.time);
  return ticks;
}

function getSliderScorePoints(obj, beatmap, curve = null) {
  const path = curve ?? SliderCurve.compute(obj.curveType, obj.curvePoints, obj.length);
  const ticks = getSliderTicks(obj, beatmap, path);
  const slides = Math.max(1, obj.slides ?? 1);
  const dur = (obj.endTime ?? obj.time) - obj.time;
  const span = dur / Math.max(1, slides);

  const points = [];
  for (let rep = 0; rep < slides; rep++) {
    const repStart = rep * span;
    const repEnd = (rep + 1) * span;
    const rev = rep % 2 === 1;

    for (const t of ticks) {
      const relTime = t.time - obj.time;
      if (relTime <= repStart || relTime >= repEnd) continue;
      const tLen = (relTime - repStart) / Math.max(1, span);
      const normT = rev ? 1 - tLen : tLen;
      const ang = SliderCurve.tangentAngleAt(path, normT);
      points.push({
        time: Math.round(t.time),
        x: t.x,
        y: t.y,
        endAngle: rev ? ang + Math.PI : ang,
        sliderPoint: true,
        sliderPointStart: false,
        sliderPointEnd: false,
      });
    }

    const time = Math.round(obj.time + (rep + 1) * span);
    const tEnd = (rep + 1) % 2;
    const pos = SliderCurve.positionAt(path, tEnd);
    const ang = SliderCurve.tangentAngleAt(path, tEnd);
    points.push({
      time,
      x: pos.x,
      y: pos.y,
      endAngle: tEnd === 0 ? ang : ang + Math.PI,
      sliderPoint: true,
      sliderPointStart: false,
      sliderPointEnd: rep === slides - 1,
    });
  }

  points.sort((a, b) => a.time - b.time);
  return points;
}

function explodeSliderToDummies(obj, beatmap, options = {}) {
  const curve = SliderCurve.compute(obj.curveType, obj.curvePoints, obj.length);
  const steps = [];
  const sliderSourceId = `${obj.time}:${obj.x}:${obj.y}:${obj.length}:${obj.slides}`;
  const disableSliderPathFollow = !!options.disableSliderPathFollow;

  steps.push({
    ...obj,
    objectType: 'circle',
    duration: 0,
    endTime: obj.time,
    _sliderSourceId: sliderSourceId,
    _sliderStartTime: obj.time,
    _sliderEndTime: obj.endTime,
    _disableSliderPathFollow: disableSliderPathFollow,
    _isSliderDummy: true,
    _isStart: true,
    _isEnd: false,
    sliderPoint: true,
    sliderPointStart: true,
    sliderPointEnd: false,
    endAngle: SliderCurve.startAngle(curve),
  });

  const scorePoints = getSliderScorePoints(obj, beatmap, curve);
  for (const pt of scorePoints) {
    steps.push({
      ...obj,
      objectType: 'circle',
      duration: 0,
      endTime: pt.time,
      _sliderSourceId: sliderSourceId,
      _sliderStartTime: obj.time,
      _sliderEndTime: obj.endTime,
      _disableSliderPathFollow: disableSliderPathFollow,
      time: pt.time,
      x: pt.x,
      y: pt.y,
      _isSliderDummy: true,
      _isStart: false,
      _isEnd: !!pt.sliderPointEnd,
      sliderPoint: true,
      sliderPointStart: false,
      sliderPointEnd: !!pt.sliderPointEnd,
      endAngle: pt.endAngle,
    });
  }

  return steps;
}

export function buildDanceQueue(beatmap, sliderDance) {
  const sourceQueue = [...(beatmap?.hitObjects ?? [])];
  let queue = [...sourceQueue];
  const circleRadius = beatmap?.circleRadius ?? 32;
  const conflictSliders = new WeakSet();

  for (let i = 0; i < sourceQueue.length; i++) {
    const obj = sourceQueue[i];
    if (obj?.objectType === 'slider' && hasSlider2BConflict(sourceQueue, i)) {
      conflictSliders.add(obj);
    }
  }

  if (sliderDance) {
    const exploded = [];
    for (const obj of queue) {
      if (obj.objectType === 'slider' && isSliderLikeObject(obj)) {
        exploded.push(...explodeSliderToDummies(obj, beatmap, {
          disableSliderPathFollow: conflictSliders.has(obj),
        }));
      } else {
        exploded.push(obj);
      }
    }
    queue = exploded;
  }

  queue.sort((a, b) => (a.time - b.time) || ((a.endTime ?? a.time) - (b.endTime ?? b.time)));

  // danser-go controller.go second 2B pass:
  // split spinners into sub-spinners around overlapping objects so they don't block the whole queue.
  for (let i = 0; i < queue.length; i++) {
    const spinner = queue[i];
    if (spinner?.objectType !== 'spinner') continue;

    const subSpinners = [];
    let startTime = spinner.time;

    for (let j = i + 1; j < queue.length; j++) {
      const obj = queue[j];
      if (obj.time >= (spinner.endTime ?? spinner.time)) break;

      const segmentEnd = obj.time - 30;
      if (segmentEnd > startTime) {
        subSpinners.push(createDummySpinner(startTime, segmentEnd, spinner));
      }

      startTime = Math.max(startTime, (obj.endTime ?? obj.time) + 30);
    }

    if (subSpinners.length > 0) {
      if ((spinner.endTime ?? spinner.time) > startTime) {
        subSpinners.push(createDummySpinner(startTime, spinner.endTime ?? spinner.time, spinner));
      }

      queue = [
        ...queue.slice(0, i),
        ...subSpinners,
        ...queue.slice(i + 1),
      ];
      queue.sort((a, b) => (a.time - b.time) || ((a.endTime ?? a.time) - (b.endTime ?? b.time)));
      i--;
    }
  }

  // danser-like double-tap merge for overlapping nearby circles.
  for (let i = 0; i < queue.length - 1; i++) {
    const current = queue[i];
    const next = queue[i + 1];
    if (!isMergeable2BCircle(current) || !isMergeable2BCircle(next)) continue;

    const dst = Math.hypot((current.x ?? 0) - (next.x ?? 0), (current.y ?? 0) - (next.y ?? 0));
    if (dst <= circleRadius * 1.995 && (next.time - (current.endTime ?? current.time)) <= 3) {
      queue[i] = {
        ...current,
        x: ((current.x ?? 0) + (next.x ?? 0)) * 0.5,
        y: ((current.y ?? 0) + (next.y ?? 0)) * 0.5,
        time: Math.round(((current.endTime ?? current.time) + next.time) * 0.5),
        endTime: Math.round(((current.endTime ?? current.time) + next.time) * 0.5),
        doubleClick: true,
      };
      queue.splice(i + 1, 1);
      i--;
    }
  }

  // Spread overlaps like danser-go so 2B stacks don't collapse into one timing slot.
  for (let i = 0; i < queue.length - 1; i++) {
    const current = queue[i];
    const currentEnd = current.endTime ?? current.time;
    for (let j = i + 1; j < queue.length; j++) {
      const obj = queue[j];
      if (currentEnd < obj.time) break;
      if (obj.objectType === 'circle' && (!obj.sliderPoint || obj.sliderPointStart)) {
        queue[j] = { ...obj, time: Math.max(obj.time, currentEnd + 1), endTime: Math.max(obj.endTime ?? obj.time, currentEnd + 1) };
      }
    }
  }

  // Keep ordering deterministic after overlap adjustments.
  for (let i = 1; i < queue.length; i++) {
    if (queue[i].time <= queue[i - 1].time) {
      const shiftedTime = queue[i - 1].time + 1;
      queue[i] = {
        ...queue[i],
        time: shiftedTime,
        endTime: Math.max(queue[i].endTime ?? queue[i].time, shiftedTime),
      };
    }
  }

  return queue;
}

function isSameSliderChain(a, b) {
  return !!a?._isSliderDummy &&
    !!b?._isSliderDummy &&
    !a?._disableSliderPathFollow &&
    !b?._disableSliderPathFollow &&
    a._sliderSourceId &&
    a._sliderSourceId === b._sliderSourceId;
}

function isConflictSliderChain(a, b) {
  return !!a?._isSliderDummy &&
    !!b?._isSliderDummy &&
    !!a?._disableSliderPathFollow &&
    !!b?._disableSliderPathFollow &&
    a._sliderSourceId &&
    a._sliderSourceId === b._sliderSourceId;
}

function sliderPathProgressAtTime(obj, time) {
  const sliderStartTime = obj._sliderStartTime ?? obj.time;
  const sliderEndTime = obj._sliderEndTime ?? obj.endTime ?? obj.time;
  const duration = Math.max(1, sliderEndTime - sliderStartTime);
  const slides = Math.max(1, obj.slides ?? 1);
  if (time <= sliderStartTime) return 0;
  if (time >= sliderEndTime) return slides % 2 === 0 ? 0 : 1;

  const progress = ((time - sliderStartTime) / duration) * slides;
  const span = Math.min(slides - 1, Math.floor(progress));
  const local = progress - span;
  return span % 2 === 0 ? local : 1 - local;
}

function sliderPositionAtTime(obj, curve, time) {
  return SliderCurve.positionAt(curve, sliderPathProgressAtTime(obj, time));
}

function sliderTangentAtTime(obj, curve, time) {
  return SliderCurve.tangentAngleAt(curve, sliderPathProgressAtTime(obj, time));
}

function count2BConflicts(objects) {
  let count = 0;
  for (let i = 0; i < objects.length; i++) {
    const cur = objects[i];
    const curEnd = cur.endTime ?? cur.time;
    for (let j = i + 1; j < objects.length; j++) {
      const next = objects[j];
      if (next.time > curEnd) break;
      count++;
    }
  }
  return count;
}

function isMergeable2BCircle(obj) {
  return obj?.objectType === 'circle' && (!obj.sliderPoint || obj.sliderPointStart || obj.sliderPointEnd);
}

function hasSlider2BConflict(queue, index) {
  const slider = queue[index];
  if (slider?.objectType !== 'slider') return false;

  const startTime = slider.time;
  const endTime = slider.endTime ?? slider.time;

  for (let i = 0; i < queue.length; i++) {
    if (i === index) continue;
    const other = queue[i];
    const otherStart = other.time;
    const otherEnd = other.endTime ?? other.time;

    if (otherEnd < startTime || otherStart > endTime) continue;
    return true;
  }

  return false;
}

function createDummySpinner(startTime, endTime, sourceSpinner) {
  return {
    ...sourceSpinner,
    objectType: 'spinner',
    time: startTime,
    endTime,
    duration: Math.max(0, endTime - startTime),
    x: 256,
    y: 192,
    _isSubSpinner: true,
  };
}

function findNextExternalObject(queue, startIndex, sliderSourceId) {
  for (let i = startIndex; i < queue.length; i++) {
    const obj = queue[i];
    if (obj?._sliderSourceId && obj._sliderSourceId === sliderSourceId) continue;
    return obj;
  }

  return null;
}

function hasEarlySliderStartConflict(beatmap, sliderObj) {
  const objects = beatmap?.hitObjects ?? [];
  const windowMs = Math.max(0, FlowerSettings.sliderEntryConflictWindowMs ?? 100);
  const sliderStart = sliderObj?._sliderStartTime ?? sliderObj?.time ?? 0;
  const sourceId = sliderObj?._sliderSourceId ?? buildSliderSourceId(sliderObj);

  for (const other of objects) {
    if (buildSliderSourceId(other) === sourceId) continue;
    if (other.time < sliderStart) continue;
    if (other.time > sliderStart + windowMs) break;
    return true;
  }

  return false;
}

function buildSliderSourceId(obj) {
  if (!obj || obj.objectType !== 'slider') return null;
  return `${obj.time}:${obj.x}:${obj.y}:${obj.length}:${obj.slides}`;
}

function isPlainCircleObject(obj) {
  return !!obj &&
    obj.objectType === 'circle' &&
    !obj._isSliderDummy &&
    !obj.sliderPoint &&
    !obj.doubleClick;
}

function isStreamTransition(from, to, nextTarget, gap, streamMs) {
  if (!isPlainCircleObject(from) || !isPlainCircleObject(to) || !isPlainCircleObject(nextTarget)) {
    return false;
  }

  if (!(gap > 0) || gap > streamMs) {
    return false;
  }

  const nextGap = (nextTarget.time ?? Infinity) - (to.time ?? 0);
  if (!(nextGap > 0) || nextGap > streamMs * 1.2) {
    return false;
  }

  const d1 = Math.hypot((to.x ?? 0) - (from.x ?? 0), (to.y ?? 0) - (from.y ?? 0));
  const d2 = Math.hypot((nextTarget.x ?? 0) - (to.x ?? 0), (nextTarget.y ?? 0) - (to.y ?? 0));
  return d1 > 6 && d2 > 6;
}
