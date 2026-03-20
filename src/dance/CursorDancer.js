// ─────────────────────────────────────────────
//  CursorDancer.js  v4 (Danser-Go Inspired & Enhanced)
//
//  • Advanced 2B Conflict Resolution (from danser-go)
//  • Cubic Bezier Looping Flower Algorithm
//  • Smooth Bezier Slider Tick Weaving
//  • 477 RPM star-pattern spinner
// ─────────────────────────────────────────────

import { SliderCurve } from '../parser/SliderCurve.js';

const OSU_W = 512;
const OSU_H = 384;

// ── 477 RPM star constants ─────────────────
const RPM_477     = (477 / 60) * 2 * Math.PI / 1000;
const STAR_ARMS   = 5;
const STAR_OUTER  = 90;
const STAR_INNER  = 38;
const STAR_STEP   = (2 * Math.PI) / STAR_ARMS;

export class CursorDancer {
  constructor(sampleRate = 1 / 4, sliderDance = true) {
    this.sampleRate  = sampleRate;
    this.sliderDance = sliderDance;
    this._globalSign = 1; // Çiçek kavislerinin yönünü değiştirmek için
  }

  generate(beatmap) {
    let objects = beatmap.hitObjects.slice(); // Kopyasını al
    if (!objects.length) return[];

    // 1. AŞAMA: 2B (Aynı anda çıkan objeler) Çakışmalarını Çöz (Danser-Go Mantığı)
    objects = this._resolve2BConflicts(objects);

    const path =[];
    const sliderData = new Map();

    // 2. AŞAMA: Slider verilerini önceden hesapla
    for (const obj of objects) {
      if (obj.objectType !== 'slider') continue;
      // Retarded sliders (0ms) pass geçilebilir
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

    // 3. AŞAMA: Cursor yollarını oluştur
    for (let i = 0; i < objects.length; i++) {
      const cur  = objects[i];
      const next = objects[i + 1] ?? null;

      // Objeyi işle
      if (cur.objectType === 'spinner') {
        this._sampleSpinner(cur, path);
      } else if (cur.objectType === 'slider' && sliderData.has(cur)) {
        this._sampleSlider(cur, sliderData.get(cur), path);
      } else {
        path.push({ time: cur.time, x: cur.x, y: cur.y });
      }

      if (!next) break;

      // Objedan objeye geçiş (Advanced Flower Mover)
      const exitPos = { x: cur.endX ?? cur.x, y: cur.endY ?? cur.y };
      const fromTime = cur.endTime ?? cur.time;
      const toTime   = next.time;
      const duration = toTime - fromTime;

      if (duration <= 0) {
        path.push({ time: fromTime, x: next.x, y: next.y });
        continue;
      }

      this._sampleFlowerMover(exitPos, next, fromTime, duration, path);
      this._globalSign *= -1; // Bir sonraki harekette çiçeğin yönünü ters çevir
    }

    return path;
  }

  // ══════════════════════════════════════════
  //  2B CONFLICT RESOLUTION (Danser-Go Port)
  // ══════════════════════════════════════════
  _resolve2BConflicts(objects) {
    let queue = [...objects];

    // Slider'lar arası 2B (Aynı anda basılan) çakışmaları
    for (let i = 0; i < queue.length; i++) {
      const s = queue[i];
      if (s.objectType === 'slider') {
        let found = false;
        // Geçmişe doğru bakarak aradaki circle'ları atlayan spinner çakışmalarını bul
        for (let j = i - 1; j >= 0; j--) {
          const o = queue[j];
          if ((o.endTime ?? o.time) >= s.time) {
            // Danser-Go burada slider'ı pseudo-circle'a (sadece başı olan nota) çeviriyor
            s.endTime = s.time;
            s.objectType = 'circle';
            found = true;
            break;
          }
        }
        // İleriye dönük çakışma
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

  // ══════════════════════════════════════════
  //  ADVANCED FLOWER MOVER (Cubic Bezier Loop)
  // ══════════════════════════════════════════
  _sampleFlowerMover(p1, p2, startTime, duration, path) {
    const steps = Math.max(2, Math.round(duration * this.sampleRate));
    
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    
    // Yön vektörü ve dik vektör
    const nx = dx / dist;
    const ny = dy / dist;
    const perpX = -ny * this._globalSign;
    const perpY = nx * this._globalSign;

    // Çiçek yaprağı (Loop) efekti oluşturmak için kontrol noktaları hesaplama
    // Uzaklığa ve süreye bağlı olarak çiçeğin kavis genişliğini (amp) ayarla
    let amp = Math.min(dist * 0.6, 120); 
    if (duration < 150) amp *= (duration / 150); // Hızlı geçişlerde kavisi küçült

    // Kontrol noktaları: İki nokta arasında çaprazlama yaparak ilmek (loop) atar
    const cp1 = {
      x: p1.x + nx * (dist * 0.3) + perpX * amp,
      y: p1.y + ny * (dist * 0.3) + perpY * amp
    };
    const cp2 = {
      x: p2.x - nx * (dist * 0.3) + perpX * amp, // Çapraz için nx'i eksi alıyoruz
      y: p2.y - ny * (dist * 0.3) + perpY * amp
    };

    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      // Kübik Bezier Formülü
      const u = 1 - t;
      const tt = t * t;
      const uu = u * u;
      const uuu = uu * u;
      const ttt = tt * t;

      let bx = uuu * p1.x + 3 * uu * t * cp1.x + 3 * u * tt * cp2.x + ttt * p2.x;
      let by = uuu * p1.y + 3 * uu * t * cp1.y + 3 * u * tt * cp2.y + ttt * p2.y;

      path.push({
        time: Math.round(startTime + duration * t),
        x: clamp(bx, 0, OSU_W),
        y: clamp(by, 0, OSU_H),
      });
    }
  }

  // ══════════════════════════════════════════
  //  SLIDER  — Smooth Bezier Weaving
  // ══════════════════════════════════════════
  _sampleSlider(obj, sd, path) {
    const { curve, ticks } = sd;
    const dur  = (obj.endTime ?? obj.time) - obj.time;

    if (!this.sliderDance) {
      // Normal takip
      const steps = Math.max(1, Math.round(dur * this.sampleRate));
      for (let s = 0; s <= steps; s++) {
        const progress = (s / steps) * obj.slides;
        const slide    = Math.floor(progress);
        const t        = slide % 2 === 0 ? progress - slide : 1 - (progress - slide);
        const pos      = SliderCurve.positionAt(curve, clamp(t, 0, 1));
        path.push({ time: Math.round(obj.time + dur * (s / steps)), x: pos.x, y: pos.y });
      }
      return;
    }

    // ── DANCE MODE: Bezier Weave ──
    const waypoints = buildWaypoints(obj, curve, ticks, dur);
    let waveSign = 1;

    for (let wi = 0; wi < waypoints.length - 1; wi++) {
      const wA = waypoints[wi];
      const wB = waypoints[wi + 1];
      const segDur = wB.time - wA.time;
      if (segDur <= 0) continue;

      const steps = Math.max(1, Math.round(segDur * this.sampleRate));

      const dx = wB.x - wA.x, dy = wB.y - wA.y;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const perpX = -dy / len, perpY = dx / len;
      
      // Eğimin keskinliği (tick arasına yumuşak kavis atar)
      const amp = clamp(len * 0.4, 10, 45); 

      // Orta kontrol noktası (ikinci dereceden bezier için)
      const midX = (wA.x + wB.x) / 2 + perpX * amp * waveSign;
      const midY = (wA.y + wB.y) / 2 + perpY * amp * waveSign;

      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        // Quadratic Bezier (Yumuşak sinüs dalgası hissi verir ama matematiği daha pürüzsüzdür)
        const u = 1 - t;
        const bx = u * u * wA.x + 2 * u * t * midX + t * t * wB.x;
        const by = u * u * wA.y + 2 * u * t * midY + t * t * wB.y;

        path.push({
          time: Math.round(wA.time + segDur * t),
          x: clamp(bx, 0, OSU_W),
          y: clamp(by, 0, OSU_H),
        });
      }
      waveSign *= -1; // Yılan gibi kıvrılması için yön değiştir
    }
  }

  // ══════════════════════════════════════════
  //  SPINNER
  // ══════════════════════════════════════════
  _sampleSpinner(obj, path) {
    const cx  = 256, cy = 192;
    const dur = (obj.endTime ?? obj.time) - obj.time;
    if (dur <= 0) { path.push({ time: obj.time, x: cx, y: cy }); return; }

    const steps = Math.max(4, Math.round(dur * this.sampleRate));

    for (let s = 0; s <= steps; s++) {
      const t   = s / steps;
      const ms  = dur * t;
      const baseAngle = ms * RPM_477;

      const stepsPerRot = STAR_ARMS * 2;
      const posInStar   = (baseAngle / (2 * Math.PI)) * stepsPerRot;
      const armFrac     = posInStar % 2; 

      let r = armFrac <= 1 
          ? lerp(STAR_OUTER, STAR_INNER, armFrac)
          : lerp(STAR_INNER, STAR_OUTER, armFrac - 1);

      const armIndex  = Math.floor(posInStar / 2);      
      const halfIndex = Math.floor(posInStar) % 2;       
      const starAngle = armIndex * STAR_STEP
                      + halfIndex * (STAR_STEP / 2)
                      + (posInStar % 1) * (STAR_STEP / 2)
                      - Math.PI / 2;

      path.push({
        time: Math.round(obj.time + ms),
        x: clamp(cx + Math.cos(starAngle) * r, 0, OSU_W),
        y: clamp(cy + Math.sin(starAngle) * r, 0, OSU_H),
      });
    }
  }

  buildPositionQuery(beatmap) {
    const path = this.generate(beatmap);
    return function getPositionAt(timeMs) {
      if (!path.length) return { x: 256, y: 192 };
      if (timeMs <= path[0].time) return { x: path[0].x, y: path[0].y };
      if (timeMs >= path[path.length - 1].time) return { x: path[path.length - 1].x, y: path[path.length - 1].y };

      let lo = 0, hi = path.length - 1;
      while (lo < hi - 1) {
        const mid = (lo + hi) >> 1;
        if (path[mid].time <= timeMs) lo = mid; else hi = mid;
      }
      const a = path[lo], b = path[hi];
      const t = (timeMs - a.time) / (b.time - a.time);
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    };
  }
}

// ── Helpers ──────────────────────────────────
function computeSliderTicks(obj, beatmap) {
  const ticks =[];
  const tp   = beatmap.getTimingPointAt(obj.time);
  const atp  = beatmap.getActiveTimingPointAt(obj.time);
  if (!tp) return ticks;

  const svMult     = atp.uninherited ? 1 : atp.svMultiplier;
  const pxPerBeat  = beatmap.sliderMultiplier * 100 * svMult;
  const tickDist   = pxPerBeat / (beatmap.sliderTickRate || 1);

  const dur        = obj.endTime - obj.time;
  const totalPx    = obj.length;

  for (let repeat = 0; repeat < obj.slides; repeat++) {
    const reversed = repeat % 2 === 1;
    for (let d = tickDist; d < totalPx - 1; d += tickDist) {
      const tNorm = reversed ? 1 - d / totalPx : d / totalPx;
      const pos = SliderCurve.positionAt(
        SliderCurve.compute(obj.curveType, obj.curvePoints, obj.length), clamp(tNorm, 0, 1)
      );
      const tickTime = Math.round(obj.time + dur * ((repeat + d / totalPx) / obj.slides));
      ticks.push({ time: tickTime, x: pos.x, y: pos.y });
    }
    if (repeat < obj.slides - 1) {
      const revT = reversed ? 0 : 1;
      const revPos = SliderCurve.positionAt(
        SliderCurve.compute(obj.curveType, obj.curvePoints, obj.length), revT
      );
      const revTime = Math.round(obj.time + dur * (repeat + 1) / obj.slides);
      ticks.push({ time: revTime, x: revPos.x, y: revPos.y });
    }
  }
  ticks.sort((a, b) => a.time - b.time);
  return ticks;
}

function buildWaypoints(obj, curve, ticks, dur) {
  const wp =
