// ─────────────────────────────────────────────
//  main.js  –  danser-js renderer v5
//  Real osu! look:
//    • Approach circles sized & timed correctly
//    • Combo numbers on every hit circle/slider head
//    • Hitsounds from skin (or fallback)
//    • Proper fade-in on approach
//    • Slider body + follow ball + follow circle
//    • Reverse arrows on repeated sliders
//    • Spinner with skin layers
// ─────────────────────────────────────────────

import * as PIXI          from 'pixi.js';
import { BeatmapParser }  from './parser/BeatmapParser.js';
import { SliderCurve }    from './parser/SliderCurve.js';
import { AudioEngine }    from './audio/AudioEngine.js';
import { CursorDancer }   from './dance/CursorDancer.js';
import { FlowerSettings, FlowerMover } from './dance/DanceAlgorithm.js';
import { config }         from './config/Config.js';
import { skin, logicalTextureSize } from './skin/SkinManager.js';
import { ReplayParser }   from './replay/ReplayParser.js';
import { KnockoutManager } from './knockout/KnockoutManager.js';
import { KnockoutRenderer } from './knockout/KnockoutRenderer.js';
import { StatsHUD } from './ui/StatsHUD.js';
// import { AITrainer } from './dance/AITrainer.js'; // REMOVED

import { PPCalculator } from './rulesets/osu/PPCalculator.js';

const OSU_W = 512, OSU_H = 384;

// ── State ──────────────────────────────────────
let beatmap   = null;
let getPos    = null;
let dancer    = null;
let useReplay = false;
let globalReplays = [];
let replayFrames = null;
let knockoutManager = null;
let knockoutRenderer = null;
let statsHUD = null;
let liveStats = { 
  score: 0, 
  combo: 0, 
  accuracy: 100, 
  hp: 1.0,
  count300: 0,
  count100: 0,
  count50: 0,
  countMiss: 0
};
let trailPts  = [];
let comboNums = [];   // per-object combo number (1-based, resets at new combo)
const sliderPaths = new Map();

function publishDanceDebug(report) {
  if (!report) return;
  try {
    window.dispatchEvent(new CustomEvent('cursordance-debug', { detail: report }));
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space') {
        window._skipIntro?.();
      }
    });
  } catch (_) {}
  if (report.notify) {
    console.warn('[cursordance-debug] 2B accuracy risk', report);
  }
}

// ── PIXI ───────────────────────────────────────
const app = new PIXI.Application({
  resizeTo: window,
  backgroundColor: 0x000000,
  antialias: true,
  autoDensity: true,
  resolution: window.devicePixelRatio || 1,
});
document.getElementById('canvas-container').appendChild(app.view);

// Layer order matters — sliders behind circles, approach on top of circles
const layerSliderBody  = new PIXI.Container();
const layerSliderDecal = new PIXI.Container();  // head/ball sprites
const layerCircles     = new PIXI.Container();
const layerApproach    = new PIXI.Container();
const layerSpinners    = new PIXI.Container();
const layerTrail       = new PIXI.Container();
const layerCursor      = new PIXI.Container();

const gfxBody    = new PIXI.Graphics();   // slider polylines (cleared each frame)
const gfxAppr    = new PIXI.Graphics();   // approach circles without texture
const gfxSpin    = new PIXI.Graphics();   // spinner fallback

layerSliderBody.addChild(gfxBody);
layerApproach.addChild(gfxAppr);
layerSpinners.addChild(gfxSpin);

const trailGfx  = new PIXI.Graphics();
const cursorGfx = new PIXI.Graphics();
layerTrail.addChild(trailGfx);
layerCursor.addChild(cursorGfx);

for (const l of [layerSliderBody, layerSliderDecal, layerCircles,
                  layerApproach, layerSpinners, layerTrail, layerCursor])
  app.stage.addChild(l);

const motionBlurFrag = `
  varying vec2 vTextureCoord;
  uniform sampler2D uSampler;
  uniform vec2 uVelocity;
  uniform float uStrength;
  const int SAMPLES = 12;

  void main(void) {
    vec4 color = vec4(0.0);
    vec2 offset = uVelocity * uStrength / float(SAMPLES);
    for (int i = 0; i < SAMPLES; i++) {
        color += texture2D(uSampler, vTextureCoord - offset * float(i));
    }
    gl_FragColor = color / float(SAMPLES);
  }
`;

const motionBlurFilter = new PIXI.Filter(null, motionBlurFrag, {
  uVelocity: new PIXI.Point(0, 0),
  uStrength: 1.0
});

layerTrail.filters = [motionBlurFilter];
layerCursor.filters = [motionBlurFilter];

let cursorSprite = null;

// ── Audio ──────────────────────────────────────
const audio = new AudioEngine();

// ── Transform helpers ──────────────────────────
function getTransform() {
  // IMPORTANT: use app.screen (CSS/logical pixels), NOT app.renderer.width (physical pixels)
  // With autoDensity=true, PIXI stage coordinates are in CSS-pixel space.
  // Using renderer.width would inflate scale by devicePixelRatio on HiDPI screens.
  const pw = app.screen.width, ph = app.screen.height;
  // Fit 640x480 standard viewport, keeping aspect ratio
  const scale = Math.min(pw / 640, ph / 480);
  // Center 512x384 playfield within the exact window
  const offX = (pw - 512 * scale) / 2;
  const offY = (ph - 384 * scale) / 2;
  return { scale, offX, offY };
}
function o2s(x, y) {
  const { scale, offX, offY } = getTransform();
  return { sx: offX + x * scale, sy: offY + y * scale, scale };
}
function hexNum(s) { return parseInt(String(s ?? '0').replace('#',''), 16); }

/**
 * Hit-object radius in **screen pixels** (osu! wiki: `r = 54.4 - 4.48 * CircleSize` in osu!px, then × viewport scale).
 * Skins ship fixed-size textures (e.g. 128×128 SD hitcircle); we draw them at diameter `2 * circleR()` so
 * everything (approach, circles, slider body, ticks, ball) tracks CS automatically.
 */
function circleR() {
  const scale = getTransform().scale;
  return logicalCircleR() * scale;
}
function logicalCircleR() {
  if (!beatmap) return (54.4 - 4.48 * 5);
  return beatmap.circleRadius;
}
// TimeFadeIn: how long (ms) the circle takes to fade from 0→1
// Mirrors danser-go's difficulty.TimeFadeIn calculation
function timeFadeIn() {
  if (!beatmap) return 400;
  const ar = beatmap.approachRate;
  if (ar < 5) return 1200 + 600 * (5 - ar) / 5;
  if (ar > 5) return 800 - 500 * (ar - 5) / 5;
  return 800;
}
function comboCol(obj) {
  const colors = skin.comboColors;
  const n = colors.length || 1;
  return colors[(obj.comboIndex ?? 0) % n];
}

function customSkinRequested() {
  const active = String(config.get('osu.activeSkin') ?? '').trim().toLowerCase();
  return active !== '' && active !== 'default';
}

function allowDefaultFallback() {
  return !skin.hasSkin && !customSkinRequested();
}

/**
 * Create a perfectly centred sprite scaled so its LONGEST side = diam.
 * blendMode: PIXI.BLEND_MODES.NORMAL | MULTIPLY | ADD  (default NORMAL)
 * tint: hex colour to tint (default 0xffffff = no tint)
 */
function spr(tex, x, y, diam, blendMode = PIXI.BLEND_MODES.NORMAL, tint = 0xffffff, fit = 'longest') {
  if (!tex) return null;
  const sp = new PIXI.Sprite(tex);
  const { w: lw, h: lh } = logicalTextureSize(tex);
  sp.anchor.set(0.5, 0.5);
  sp.position.set(x, y);
  if (fit === 'square') {
    // Use logical dimensions (accounts for @2x textures correctly)
    // danser-go: SetScale(CircleRadius/64) means texture_logical_px * scale = desired_diameter
    const longest = Math.max(lw, lh, 1);
    const s = diam / longest;
    sp.scale.set(s);
  } else {
    const longest = Math.max(lw, lh, 1);
    sp.scale.set(diam / longest);
  }
  sp.blendMode = blendMode;
  sp.tint      = (typeof tint === 'number' && !Number.isNaN(tint)) ? tint : 0xffffff;
  return sp;
}

/** Draw combo number(s) centred at (sx,sy) */
function drawComboNumber(sx, sy, r, num, alpha, container) {
  const digits = String(num).split('');
  const texs   = digits.map(d => skin.numTex(+d));
  if (texs.some(t => !t)) {
    // Always show a number when digit textures are missing (same partial-skin case as hitcircle).
    // Fallback: PIXI BitmapText-style drawn text
    const style = new PIXI.TextStyle({
      fontFamily: 'Arial', fontWeight: 'bold',
      fontSize:   Math.round(r * 1.1),
      fill:       0xffffff,
      dropShadow: true, dropShadowDistance: r * 0.06,
      dropShadowColor: 0x000000, dropShadowAlpha: 0.6,
    });
    const t = new PIXI.Text(String(num), style);
    t.anchor.set(0.5);
    t.position.set(sx, sy);
    t.alpha = alpha;
    container.addChild(t);
    return;
  }
  // Sprite-based number — lay digits side by side
  const numH   = r * 1.15;
  const widths = texs.map((t) => {
    const { w, h } = logicalTextureSize(t);
    return (w / Math.max(h, 1)) * numH;
  });
  const gap    = -(skin.hitCircleOverlap ?? -2);
  const total  = widths.reduce((a,b) => a+b, 0) + (digits.length - 1) * gap;
  let cx = sx - total / 2;
  for (let i = 0; i < texs.length; i++) {
    const sp = new PIXI.Sprite(texs[i]);
    sp.anchor.set(0, 0.5);
    sp.position.set(cx, sy);
    sp.height = numH;
    sp.width  = widths[i];
    sp.alpha  = alpha;
    container.addChild(sp);
    cx += widths[i] + gap;
  }
}

// ── Slider path cache ──────────────────────────
// Apply flower settings from config to the FlowerSettings singleton
function applyFlowerSettings() {
  const d = config.get('dance') ?? {};
  FlowerSettings.petAngle                 = Number(d.petAngle) || 1.57;
  FlowerSettings.angleRandom              = Number(d.angleRandom) || 0;
  FlowerSettings.distanceMult            = 0.666;
  FlowerSettings.streamAngle              = d.streamAngle ?? 0.5;
  FlowerSettings.streamMs                  = d.streamMs ?? d.streamThresh ?? 130;
  FlowerSettings.spinnerAngle              = d.spinnerAngle ?? 2.4;
  FlowerSettings.zigzag                    = d.zigzag !== false;
  FlowerSettings.idleMs                    = d.idleMs ?? 2000;
  FlowerSettings.sliderDanceAmplitude      = d.sliderDanceAmplitude ?? 42;
  FlowerSettings.sliderEntryBehind         = d.sliderEntryBehind !== false;
  FlowerSettings.sliderEntryBehindDistance = d.sliderEntryBehindDistance ?? d.sliderDanceAmplitude ?? 96;
  FlowerSettings.sliderEntryBehindSplit    = d.sliderEntryBehindSplit ?? 0.68;
  FlowerSettings.sliderEntryConflictWindowMs = d.sliderEntryConflictWindowMs ?? 100;
  FlowerSettings.sliderScoreSafe           = d.sliderScoreSafe !== false;
  FlowerSettings.smoothPath                = d.smoothPath !== false;
  FlowerSettings.smoothPathTension         = d.smoothPathTension ?? 0.35;
  FlowerSettings.allowOutOfBounds          = d.allowOutOfBounds !== false;
  FlowerSettings.sliderTickLeadMs          = d.sliderTickLeadMs ?? 20;
  FlowerSettings.sliderTickStayMs          = d.sliderTickStayMs ?? 20;
  FlowerSettings.sliderCriticalWindowMs    = d.sliderCriticalWindowMs ?? 28;
  FlowerSettings.sliderCriticalHoldMs      = d.sliderCriticalHoldMs ?? 100;
  FlowerSettings.samePositionDance         = d.samePositionDance !== false;
  FlowerSettings.samePositionRadius        = d.samePositionRadius ?? 90;
  FlowerSettings.samePositionTurns         = d.samePositionTurns ?? 1.0;
  FlowerSettings.spinnerRPM                = 2000;
  FlowerSettings.spinnerOuter              = d.spinnerOuter ?? 92;
  FlowerSettings.spinnerInner              = d.spinnerInner ?? 66;
  FlowerSettings.twoBUseDummyCircles       = d.twoBUseDummyCircles !== false;
  FlowerSettings.debugEnabled              = d.debugEnabled !== false;
  FlowerSettings.debugSkipNonDance         = d.debugSkipNonDance !== false;
  FlowerSettings.debugNotifyOn2BRisk       = d.debugNotifyOn2BRisk !== false;
  FlowerSettings.debugRiskDistancePx       = d.debugRiskDistancePx ?? 24;
  FlowerSettings.skipStackPointMs          = d.skipStackPointMs ?? 110;
}

function buildSliderPaths() {
  sliderPaths.clear();
  if (!beatmap) return;
  for (const obj of beatmap.hitObjects) {
    if (obj.objectType !== 'slider') continue;
    const p = SliderCurve.compute(obj.curveType, obj.curvePoints, obj.length);
    sliderPaths.set(obj, p);
    const endPos = SliderCurve.positionAt(p, obj.slides % 2 === 0 ? 0 : 1);
    obj.endX = endPos.x; obj.endY = endPos.y;

    // Pre-compute tick positions (sliderscorepoint.png rendering)
    obj._tickPositions = computeSliderTicks(obj, beatmap, p);
  }
}

function computeSliderTicks(obj, bm, curvePath) {
  if (Array.isArray(obj.ticks) && obj.ticks.length > 0) {
    return obj.ticks.map((tick) => ({ time: Math.round(tick.time), x: tick.x, y: tick.y }));
  }

  const ticks  = [];
  const tp     = bm.getTimingPointAt(obj.time);
  const atp    = bm.getActiveTimingPointAt(obj.time);
  if (!tp) return ticks;
  const svMult   = atp.uninherited ? 1 : atp.svMultiplier;
  const pxPerBeat = bm.sliderMultiplier * 100 * svMult;
  const velocityPxPerMs = pxPerBeat / Math.max(1, tp.beatLength);
  const minDistanceFromEnd = velocityPxPerMs * 10;
  let tickDist  = pxPerBeat / (bm.sliderTickRate || 1);
  const dur       = obj.endTime - obj.time;
  if (obj.length > 0 && tickDist > obj.length) {
    tickDist = obj.length;
  }
  if (tickDist <= 0 || obj.length <= 0) return ticks;

  for (let rep = 0; rep < obj.slides; rep++) {
    const reversed = rep % 2 === 1;
    for (let d = tickDist; d < obj.length; d += tickDist) {
      if (d >= obj.length - minDistanceFromEnd) break;
      const tNorm   = reversed ? 1 - d / obj.length : d / obj.length;
      const pos     = SliderCurve.positionAt(curvePath, Math.max(0, Math.min(1, tNorm)));
      const repProg = (rep + d / obj.length) / obj.slides;
      ticks.push({ time: Math.round(obj.time + dur * repProg), x: pos.x, y: pos.y });
    }
  }
  ticks.sort((a, b) => a.time - b.time);
  return ticks;
}

function assignCombos() {
  if (!beatmap) return;
  const colors = skin.comboColors;
  // idx=-1 so first new-combo sets it to 0 (matching danser-go's ComboSet=0 start)
  let idx = -1, num = 0;
  for (const obj of beatmap.hitObjects) {
    if (obj.objectType === 'spinner') {
      // Spinners reset combo but don't show a number
      idx += 1 + (obj.comboSkip ?? 0);
      num = 0;
      obj.comboIndex  = idx % colors.length;
      obj.comboNumber = null;
      continue;
    }
    if (obj.newCombo) {
      // New combo: increment colour index + any skips, reset counter
      idx += 1 + (obj.comboSkip ?? 0);
      num = 0;
    }
    num++;
    obj.comboIndex  = Math.max(0, idx) % colors.length;
    obj.comboNumber = num;
  }
}

// ══════════════════════════════════════════════
//  DRAW HELPERS
// ══════════════════════════════════════════════

/**
 * Draw a hit circle face (base tinted + overlay + combo number).
 * Uses Graphics when hitcircle.png is a placeholder.
 */
function drawCircleFace(container, sx, sy, r, col, comboNum, alpha,
    baseTexName = 'hitcircle.png', overlayTexName = 'hitcircleoverlay.png') {

  const hcTex = baseTexName
    ? (skin.tex(baseTexName) ?? (baseTexName === 'hitcircle.png' ? null : skin.tex('hitcircle.png')))
    : skin.tex('hitcircle.png');
  const ovTex = overlayTexName === null
    ? null
    : (skin.tex(overlayTexName) ?? (overlayTexName === 'hitcircleoverlay.png' ? null : skin.tex('hitcircleoverlay.png')));

  if (hcTex) {
    // hitcircle.png → wiki “Multiplicative”: osu! multiplies texture by combo colour (Pixi: tint + NORMAL on dark BG)
    const b = spr(hcTex, sx, sy, r * 2, PIXI.BLEND_MODES.NORMAL, col, 'square');
    if (b) { b.alpha = alpha; container.addChild(b); }

    // overlay → Normal blend, NOT tinted (osu! wiki)
    if (!skin.hitCircleOverlayAboveNumber && ovTex) {
      const o = spr(ovTex, sx, sy, r * 2, PIXI.BLEND_MODES.NORMAL, 0xffffff, 'square');
      if (o) { o.alpha = alpha; container.addChild(o); }
    }
  } else {
    // Missing hitcircle in skin — always draw placeholder (custom skin with partial assets used to bail out here
    // while approachcircle still drew, so only “approach rate” was visible).
    const g = new PIXI.Graphics();
    g.lineStyle(r * 0.11, 0xffffff, alpha * 0.95);
    g.beginFill(col, alpha * 0.26);
    g.drawCircle(sx, sy, r);
    g.endFill();
    g.lineStyle(r * 0.035, 0x000000, alpha * 0.28);
    g.drawCircle(sx, sy, r * 0.82);
    container.addChild(g);
  }

  // Combo number: downscaled 0.8× per osu! skinning wiki
  if (comboNum != null) drawComboNumber(sx, sy, r * 0.8, comboNum, alpha, container);
  if (hcTex && skin.hitCircleOverlayAboveNumber && ovTex) {
    const o = spr(ovTex, sx, sy, r * 2, PIXI.BLEND_MODES.NORMAL, 0xffffff, 'square');
    if (o) { o.alpha = alpha; container.addChild(o); }
  }
}

// ── Approach circle ─────────────────────────────────────────────────────────
// In real osu! the approach circle starts at 3× the hit circle radius and
// shrinks linearly to 1×.  We draw it AFTER the circle face so it sits on top.
function drawApproach(obj, now, container) {
  if (!config.get('display.approachCircles')) return;

  const objOp = Number(config.get('display.hitObjectOpacity') ?? 1);
  if (!Number.isFinite(objOp) || objOp < 0.01) return;

  const preempt  = beatmap.approachPreempt;
  const fadeIn   = timeFadeIn();
  const spawnTime = obj.time - preempt;   // when circle first appears
  const hitTime   = obj.time;

  // Outside visible window
  if (now < spawnTime || now >= hitTime) return;

  const r   = circleR();
  const { sx, sy } = o2s(obj.x, obj.y);
  const col = comboCol(obj);

  // danser-go: scale linear 4.0 → 1.0 from spawnTime → hitTime
  const tScale = (now - spawnTime) / (hitTime - spawnTime); // 0 → 1
  const scale  = 4 - 3 * tScale;   // 4 → 1
  const radius = r * scale;

  // danser-go: alpha linear 0 → 0.9 from spawnTime → min(hitTime, spawnTime + fadeIn*2)
  const fadeEnd = Math.min(hitTime, spawnTime + fadeIn * 2);
  const tAlpha  = Math.min(1, (now - spawnTime) / Math.max(1, fadeEnd - spawnTime));
  let alp     = tAlpha * 0.9 * objOp;
  if (alp <= 0.005) return;

  // approachcircle.png → same tint model as hitcircle (wiki: Multiplicative × combo colour)
  const acTex = skin.tex('approachcircle.png');
  if (acTex) {
    const sp = spr(acTex, sx, sy, radius * 2, PIXI.BLEND_MODES.NORMAL, col, 'square');
    if (sp) { sp.alpha = Math.max(alp, 0.18); container.addChild(sp); }
  } else {
    if (!allowDefaultFallback()) return;
    gfxAppr.lineStyle(Math.max(1.5, r * 0.08), col, alp);
    gfxAppr.drawCircle(sx, sy, radius);
  }
}

// ── Slider ──────────────────────────────────────
function drawSlider(obj, now) {
  const path = sliderPaths.get(obj);
  if (!path || path.length < 2) return;

  // Slider body fades in just like hit circles
  const spawnTime = obj.time - beatmap.approachPreempt;
  const fadeInA   = timeFadeIn();
  const fadeProgress = Math.min(1, (now - spawnTime) / Math.max(1, fadeInA));
  const alpha = config.get('display.hitObjectOpacity') * fadeProgress;
  if (alpha < 0.01) return;
  const r     = circleR();
  const col   = comboCol(obj);
  const trackCol = skin.sliderTrackOverride ?? col;
  const borderCol = skin.sliderBorder ?? 0x000000;
  const sc    = path.map(p => o2s(p.x, p.y));

  // ── Body ──
  gfxBody.lineStyle({ width: r * 2.2, color: borderCol, alpha: alpha * 0.75,
    cap: PIXI.LINE_CAP.ROUND, join: PIXI.LINE_JOIN.ROUND });
  gfxBody.moveTo(sc[0].sx, sc[0].sy);
  for (let i = 1; i < sc.length; i++) gfxBody.lineTo(sc[i].sx, sc[i].sy);

  gfxBody.lineStyle({ width: r * 1.78, color: trackCol, alpha: alpha * 0.9,
    cap: PIXI.LINE_CAP.ROUND, join: PIXI.LINE_JOIN.ROUND });
  gfxBody.moveTo(sc[0].sx, sc[0].sy);
  for (let i = 1; i < sc.length; i++) gfxBody.lineTo(sc[i].sx, sc[i].sy);

  gfxBody.lineStyle({ width: r * 0.6, color: 0xffffff, alpha: alpha * 0.16,
    cap: PIXI.LINE_CAP.ROUND, join: PIXI.LINE_JOIN.ROUND });
  gfxBody.moveTo(sc[0].sx, sc[0].sy);
  for (let i = 1; i < sc.length; i++) gfxBody.lineTo(sc[i].sx, sc[i].sy);

  // ── End cap ──
  const pEnd = sc[sc.length - 1];
  gfxBody.lineStyle(r * 0.12, 0xffffff, alpha * 0.5);
  gfxBody.beginFill(trackCol, alpha * 0.9);
  gfxBody.drawCircle(pEnd.sx, pEnd.sy, r);
  gfxBody.endFill();

  // ── Slider ticks (sliderscorepoint.png, 16x16, Normal blend) ──
  if (now < obj.endTime) {
    const tickTex = skin.tex('sliderscorepoint.png');
    const tickPts = obj._tickPositions;
    if (tickPts && tickPts.length > 0) {
      const tickR = r * 0.22;   // ticks are small relative to circle radius
      for (const tp of tickPts) {
        // Only show ticks that haven't been passed yet
        if (tp.time <= now) continue;
        const { sx: tx, sy: ty } = o2s(tp.x, tp.y);
        if (tickTex) {
          const ts = spr(tickTex, tx, ty, tickR * 2, PIXI.BLEND_MODES.NORMAL, 0xffffff, 'square');
          if (ts) { ts.alpha = alpha; layerSliderDecal.addChild(ts); }
        } else {
          if (!allowDefaultFallback()) continue;
          // Fallback: small white dot
          gfxBody.lineStyle(0);
          gfxBody.beginFill(0xffffff, alpha * 0.85);
          gfxBody.drawCircle(tx, ty, tickR);
          gfxBody.endFill();
        }
      }
    }
  }

  // ── Reverse arrows ──
  if (obj.slides > 1) _drawRevArrow(pEnd.sx, pEnd.sy, r, path, true);
  if (obj.slides > 2) _drawRevArrow(sc[0].sx, sc[0].sy, r, path, false);

  // ── Head — danser-go-style circle texture priority (see SkinManager.pickCircleTextures)
  {
    const spawnTime  = obj.time - beatmap.approachPreempt;
    const fadeIn     = timeFadeIn();
    const headAlpha  = Math.min(1, (now - spawnTime) / Math.max(1, fadeIn)) * alpha;
    if (headAlpha > 0.01) {
      const picked = skin.pickCircleTextures('sliderstart');
      drawCircleFace(layerSliderDecal, sc[0].sx, sc[0].sy, r, col, obj.comboNumber, headAlpha,
        picked.base, picked.overlay);
    }
  }

  // ── Follow ball ──
  if (now >= obj.time && now <= obj.endTime) {
    const progress = (now - obj.time) / (obj.endTime - obj.time);
    const si       = Math.floor(progress * obj.slides);
    const localT   = progress * obj.slides - si;
    const t        = si % 2 === 0 ? localT : 1 - localT;
    const bp       = SliderCurve.positionAt(path, Math.max(0, Math.min(1, t)));
    const { sx: bx, sy: by } = o2s(bp.x, bp.y);

    // sliderfollowcircle.png → Normal blend, larger than ball (osu! wiki: 256x256)
    const fcT = skin.tex('sliderfollowcircle.png');
    if (fcT) {
      const fc = spr(fcT, bx, by, r * 2.8, PIXI.BLEND_MODES.NORMAL, 0xffffff, 'square');
      if (fc) layerSliderDecal.addChild(fc);
    } else {
      if (allowDefaultFallback()) {
        gfxBody.lineStyle(0); gfxBody.beginFill(0xffffff, 0.08);
        gfxBody.drawCircle(bx, by, r * 2); gfxBody.endFill();
      }
    }

    // sliderb.png → Multiplicative blend + tinted by combo colour (osu! wiki)
    const bT = skin.sliderBallTex;
    if (bT) {
      const ballTint = skin.sliderBallTint ?? (skin.allowSliderBallTint ? col : 0xffffff);
      const bs = spr(bT, bx, by, r * 2.1, PIXI.BLEND_MODES.NORMAL, ballTint, 'square');
      if (bs) layerSliderDecal.addChild(bs);
    } else {
      if (allowDefaultFallback()) {
        gfxBody.lineStyle(3, 0xffffff, 1); gfxBody.beginFill(col, 0.95);
        gfxBody.drawCircle(bx, by, r * 1.1); gfxBody.endFill();
      }
    }
  }
}

function _drawRevArrow(sx, sy, r, path, atEnd) {
  const tA = SliderCurve.positionAt(path, atEnd ? 0.96 : 0.04);
  const tB = SliderCurve.positionAt(path, atEnd ? 1.00 : 0.00);
  const dx  = atEnd ? tA.x - tB.x : tB.x - tA.x;
  const dy  = atEnd ? tA.y - tB.y : tB.y - tA.y;
  const ang = Math.atan2(dy, dx);

  const raTex = skin.tex('reversearrow.png');
  if (raTex) {
    const sp = spr(raTex, sx, sy, r * 1.5, PIXI.BLEND_MODES.NORMAL, 0xffffff, 'square');
    if (sp) { sp.rotation = ang; layerSliderDecal.addChild(sp); }
  } else {
    if (!allowDefaultFallback()) return;
    const len = r * 0.85, wid = r * 0.5;
    const c = Math.cos(ang), s2 = Math.sin(ang);
    gfxBody.lineStyle(0); gfxBody.beginFill(0xffffff, 0.9);
    gfxBody.drawPolygon([
      sx + c*len,           sy + s2*len,
      sx - c*wid - s2*wid,  sy - s2*wid + c*wid,
      sx - c*wid + s2*wid,  sy - s2*wid - c*wid,
    ]);
    gfxBody.endFill();
  }
}

// ── Hit circle ──────────────────────────────────
function drawHitCircle(obj, now) {
  const preempt   = beatmap.approachPreempt;
  const fadeIn    = timeFadeIn();
  const spawnTime = obj.time - preempt;
  const hitTime   = obj.time;
  const age       = now - hitTime;

  // Outside any visible window
  if (now < spawnTime || age > 300) return;

  // danser-go: fade 0→1 linearly from spawnTime to spawnTime+fadeIn
  let alpha;
  if (now <= hitTime) {
    alpha = Math.min(1, (now - spawnTime) / Math.max(1, fadeIn));
  } else {
    // After hit time: quick fade-out (danser-go: endTime → endTime+60 for miss)
    alpha = Math.max(0, 1 - age / 200);
  }

  const objOp = Number(config.get('display.hitObjectOpacity') ?? 1);
  if (!Number.isFinite(objOp) || objOp < 0.01) return;
  alpha *= objOp;
  if (alpha < 0.01) return;

  const r = circleR();
  const { sx, sy } = o2s(obj.x, obj.y);
  drawCircleFace(layerCircles, sx, sy, r, comboCol(obj), obj.comboNumber, alpha);
}

// ── Spinner ─────────────────────────────────────
function drawSpinner(obj, now) {
  if (now < obj.time || now > obj.endTime + 400) return;
  const progress = Math.max(0, Math.min(1, (now - obj.time) / obj.duration));
  const rpm      = config.get('dance.spinnerRPM') ?? 477;
  const angle    = now * (rpm / 60000) * (Math.PI * 2);
  const { sx, sy } = o2s(OSU_W / 2, OSU_H / 2);
  const maxR = Math.min(app.renderer.width, app.renderer.height) * 0.27;
  const fade = now > obj.endTime ? Math.max(0, 1 - (now - obj.endTime) / 400) : 1;

  const botT = skin.tex('spinner-bottom.png');
  const topT = skin.tex('spinner-top.png');

  if (botT || topT) {
    // Layer order (osu! wiki): glow(ADD) → bottom(NORMAL) → top(NORMAL) → middle2(NORMAL) → middle(MULTIPLY)
    const glowT = skin.tex('spinner-glow.png');
    if (glowT) {
      // spinner-glow = Additive blend, tinted cyan, scale grows with progress
      const glowScale = 0.8 + Math.min(1, progress) * 0.2;
      const gl = spr(glowT, sx, sy, maxR * 2 * glowScale, PIXI.BLEND_MODES.ADD, 0x00ccff);
      if (gl) { gl.alpha = Math.min(1, progress) * fade; layerSpinners.addChild(gl); }
    }
    if (botT) {
      // spinner-bottom = Normal blend, no tint, rotates slowest (÷3)
      const b = spr(botT, sx, sy, maxR * 2, PIXI.BLEND_MODES.NORMAL, 0xffffff);
      if (b) { b.rotation = angle / 3; b.alpha = fade; layerSpinners.addChild(b); }
    }
    if (topT) {
      // spinner-top = Normal blend, no tint, medium speed (÷2)
      const t = spr(topT, sx, sy, maxR * 2, PIXI.BLEND_MODES.NORMAL, 0xffffff);
      if (t) { t.rotation = angle / 2; t.alpha = fade; layerSpinners.addChild(t); }
    }
    const m2T = skin.tex('spinner-middle2.png');
    if (m2T) {
      // spinner-middle2 = Normal blend, rotates fastest (×1)
      const m2 = spr(m2T, sx, sy, maxR * 0.5, PIXI.BLEND_MODES.NORMAL, 0xffffff);
      if (m2) { m2.rotation = angle; m2.alpha = fade; layerSpinners.addChild(m2); }
    }
    const mT = skin.tex('spinner-middle.png');
    if (mT) {
      // spinner-middle = Multiplicative blend, tinted red over time (time indicator)
      const redAmount = Math.floor(progress * 255);
      const midTint   = (redAmount << 16) | ((255 - redAmount) << 8) | 0;
      const m = spr(mT, sx, sy, maxR * 0.22, PIXI.BLEND_MODES.NORMAL, midTint || 0xffffff);
      if (m) { m.alpha = fade; layerSpinners.addChild(m); }
    }
    // spinner-approachcircle = shrinks from outer to centre as progress grows
    const acT = skin.tex('spinner-approachcircle.png');
    if (acT) {
      const acR = maxR * Math.max(0.05, 1.9 - progress * 1.8);
      const ac  = spr(acT, sx, sy, acR * 2, PIXI.BLEND_MODES.NORMAL, 0xffffff);
      if (ac) { ac.alpha = fade; layerSpinners.addChild(ac); }
    }
  } else {
    if (!allowDefaultFallback()) return;
    // Graphics fallback
    const col = hexNum(config.get('display.spinnerColor'));
    gfxSpin.lineStyle(3, col, 0.4 * fade); gfxSpin.drawCircle(sx, sy, maxR);
    gfxSpin.lineStyle(1, 0xffffff, 0.15 * fade); gfxSpin.drawCircle(sx, sy, maxR * 0.5);
    const sw = progress * Math.PI * 2;
    if (sw > 0.01) {
      const steps = Math.max(4, Math.ceil(sw * 24));
      gfxSpin.lineStyle(5, col, 0.95 * fade);
      const sa = -Math.PI / 2;
      gfxSpin.moveTo(sx + Math.cos(sa)*maxR, sy + Math.sin(sa)*maxR);
      for (let i=1;i<=steps;i++){
        const a = sa + sw*(i/steps);
        gfxSpin.lineTo(sx+Math.cos(a)*maxR, sy+Math.sin(a)*maxR);
      }
    }
    gfxSpin.lineStyle(0); gfxSpin.beginFill(col, 0.9*fade);
    gfxSpin.drawCircle(sx, sy, 8); gfxSpin.endFill();
  }
}

// ── Cursor ──────────────────────────────────────
function drawCursor(sx, sy) {
  if (cursorSprite) {
    cursorSprite.position.set(sx, sy);
    return;
  }
  const col  = hexNum(config.get('cursor.color'));
  const size = config.get('cursor.size');
  cursorGfx.clear();
  for (const { r, a } of [
    {r: size*5.5, a: 0.04}, {r: size*4.0, a: 0.07},
    {r: size*2.8, a: 0.13}, {r: size*1.9, a: 0.22},
  ]) {
    cursorGfx.lineStyle(0); cursorGfx.beginFill(col, a);
    cursorGfx.drawCircle(sx, sy, r); cursorGfx.endFill();
  }
  cursorGfx.lineStyle(0); cursorGfx.beginFill(0xffffff, 1);
  cursorGfx.drawCircle(sx, sy, size * 0.55); cursorGfx.endFill();
  cursorGfx.lineStyle(1.5, col, 0.9);
  cursorGfx.drawCircle(sx, sy, size * 1.1);
}

const TRAIL_TP = 180;
function drawTrail() {
  const col = hexNum(config.get('cursor.trailColor'));
  const alp = config.get('cursor.trailAlpha');
  trailGfx.clear();
  if (trailPts.length < 2) return;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 1; i < trailPts.length; i++) {
      const dx = trailPts[i].x - trailPts[i-1].x;
      const dy = trailPts[i].y - trailPts[i-1].y;
      if (dx*dx+dy*dy > TRAIL_TP*TRAIL_TP) continue;
      const f = i / trailPts.length;
      trailGfx.lineStyle({
        width: pass === 0 ? 14*f : 4*f,
        color: col,
        alpha: pass === 0 ? alp*f*0.18 : alp*f*f,
        cap:   PIXI.LINE_CAP.ROUND,
      });
      trailGfx.moveTo(trailPts[i-1].x, trailPts[i-1].y);
      trailGfx.lineTo(trailPts[i].x,   trailPts[i].y);
    }
  }
}

// ── Hitsound scheduling ─────────────────────────
// Schedule skin hitsounds for all upcoming objects
let _lastScheduledTime = -Infinity;
const _hitsoundTimers = [];

function clearHitsoundTimers() {
  while (_hitsoundTimers.length) {
    clearTimeout(_hitsoundTimers.pop());
  }
}
function scheduleHitsounds(fromMs) {
  if (!beatmap) return;
  clearHitsoundTimers();
  _lastScheduledTime = fromMs;
  for (const obj of beatmap.hitObjects) {
    if (obj.time < fromMs) continue;
    const tp        = beatmap.getActiveTimingPointAt(obj.time);
    const vol       = tp ? tp.volume / 100 : 0.5;
    const rawSet = tp ? ['auto', 'normal', 'soft', 'drum'][tp.sampleSet] ?? 'normal' : 'normal';
    const sampleSet = rawSet === 'auto' ? 'normal' : rawSet;
    const hitSound  = obj.hitSound ?? 0;
    const delay     = obj.time - audio.currentTimeMs;
    if (delay < 0) continue;
    const rate = Math.max(0.01, Number(config.get('audio.playbackRate') ?? 1));
    const timerId = setTimeout(() => {
      skin.playHitSound(sampleSet, hitSound, vol * config.get('audio.hitsoundVolume'));
    }, delay / rate);
    _hitsoundTimers.push(timerId);
  }
}

// ── Main ticker ─────────────────────────────────
app.ticker.add(() => {
  // Clear per-frame graphics
  gfxBody.clear();
  gfxAppr.clear();
  gfxSpin.clear();

  // Clear sprite containers (keep persistent Graphics children)
  while (layerSliderDecal.children.length) layerSliderDecal.removeChildAt(0);
  while (layerCircles.children.length)     layerCircles.removeChildAt(0);
  while (layerApproach.children.length > 1) // keep gfxAppr at 0
    layerApproach.removeChildAt(layerApproach.children.length - 1);
  while (layerSpinners.children.length > 1)
    layerSpinners.removeChildAt(layerSpinners.children.length - 1);

  if (!beatmap || (!getPos && !knockoutManager)) {
    cursorGfx.clear(); trailGfx.clear(); return;
  }

  const now     = audio.currentTimeMs;
  const preempt = beatmap.approachPreempt;

  // Draw objects in reverse order so earlier notes are on top
  const visible = beatmap.hitObjects.filter(obj => {
    const from = obj.time - preempt;
    const to   = (obj.endTime ?? obj.time) + 500;
    return now >= from && now <= to;
  });

  // Sliders first (body behind everything)
  for (let i = visible.length - 1; i >= 0; i--) {
    const obj = visible[i];
    if (obj.objectType === 'slider') drawSlider(obj, now);
  }

  // Then circles + spinners
  for (let i = visible.length - 1; i >= 0; i--) {
    const obj = visible[i];
    if (obj.objectType === 'spinner') drawSpinner(obj, now);
    else if (obj.objectType === 'circle') drawHitCircle(obj, now);
  }

  // Approach circles on top of everything except cursor
  for (let i = visible.length - 1; i >= 0; i--) {
    const obj = visible[i];
    if (obj.objectType !== 'spinner') drawApproach(obj, now, layerApproach);
  }

  // Cursor (only in single-player/auto mode)
  if (getPos) {
    const pos        = getPos(now);
    const { sx, sy } = o2s(pos.x, pos.y);
    const trailLen   = config.get('cursor.trailLength');

    if (trailPts.length > 0) {
      const last = trailPts[trailPts.length - 1];
      const dx = sx-last.x, dy = sy-last.y;
      const d  = Math.sqrt(dx*dx+dy*dy);
      const sub = Math.min(4, Math.ceil(d/6));
      for (let s = 1; s < sub; s++) {
        const t = s/sub;
        trailPts.push({x: last.x+dx*t, y: last.y+dy*t});
        if (trailPts.length > trailLen) trailPts.shift();
      }
    }
      trailPts.push({x: sx, y: sy});
      if (trailPts.length > trailLen) trailPts.shift();
      drawTrail();
      drawCursor(sx, sy);

      // Update Motion Blur velocity
      if (trailPts.length >= 2) {
        const p1 = trailPts[trailPts.length-2];
        const p2 = trailPts[trailPts.length-1];
        motionBlurFilter.uniforms.uVelocity.x = (p2.x - p1.x) / app.screen.width;
        motionBlurFilter.uniforms.uVelocity.y = (p2.y - p1.y) / app.screen.height;
        motionBlurFilter.uniforms.uStrength = config.get('display.motionBlurStrength') ?? 1.5;
      }
    }
  
    if (knockoutManager && knockoutRenderer) {
      knockoutManager.update(now, logicalCircleR());
      knockoutRenderer.update(now);
    }

    if (statsHUD) {
      if (!useReplay && beatmap) {
        // Optimized hit object processing: only check objects near current time
        const preempt = beatmap.approachPreempt;
        for (let i = 0; i < beatmap.hitObjects.length; i++) {
          const obj = beatmap.hitObjects[i];
          if (obj.time > now + 100) break; // Optimization: stop if we're too far ahead
          
          // Standard osu! score formula
          const diffMult = (beatmap.drainRate + beatmap.circleSize + beatmap.overallDifficulty) / 10;

          // HitCircle / Slider Head / Tick / Repeat / Tail (All normalized as circles)
          if (obj.time <= now && !obj._scored) {
            obj._scored = true;
            liveStats.combo++;
            liveStats.count300++;
            liveStats.score += 300 + Math.floor(300 * liveStats.combo * diffMult / 25);
            liveStats.hp = Math.min(1.0, liveStats.hp + 0.04);
          }
        }
        
        // Update Accuracy
        const total = liveStats.count300 + liveStats.count100 + liveStats.count50 + liveStats.countMiss;
        if (total > 0) {
          liveStats.accuracy = (liveStats.count300 * 300 + liveStats.count100 * 100 + liveStats.count50 * 50) / (total * 300) * 100;
        }
      } else if (useReplay && globalReplays.length === 1) {
        const parsed = globalReplays[0];
        
        // For replays, we interpolate the stats based on current time
        const duration = beatmap ? (beatmap.hitObjects[beatmap.hitObjects.length - 1].endTime ?? beatmap.hitObjects[beatmap.hitObjects.length - 1].time) : 1;
        const progress = Math.min(1, now / duration);
        
        liveStats.score = Math.floor(parsed.totalScore * progress);
        liveStats.combo = Math.floor(parsed.maxCombo * progress); // Approximation of live combo
        
        liveStats.count300 = Math.floor(parsed.count300 * progress);
        liveStats.count100 = Math.floor(parsed.count100 * progress);
        liveStats.count50 = Math.floor(parsed.count50 * progress);
        liveStats.countMiss = Math.floor(parsed.countMiss * progress);
        
        const total = liveStats.count300 + liveStats.count100 + liveStats.count50 + liveStats.countMiss;
        liveStats.accuracy = total > 0 ? (liveStats.count300 * 300 + liveStats.count100 * 100 + liveStats.count50 * 50) / (total * 300) * 100 : 100;
      }
      liveStats.pp = PPCalculator.calculate(beatmap, liveStats);
      statsHUD.update(liveStats);
    }
});

// ── Skin setup ──────────────────────────────────
async function setupSkin() {
  let skinsPath = String(config.get('osu.skinsPath') ?? '').trim();
  let activeSkin = String(config.get('osu.activeSkin') ?? 'Default').trim() || 'Default';
  let directSkinPath = '';
  let selected = null;

  // Prefer explicit CLI-selected skin path when provided.
  try {
    const m = await fetch('/api/autoload').then((r) => (r.ok ? r.json() : null));
    if (m?.skinPath) directSkinPath = String(m.skinPath).trim();
  } catch (_) {}

  // If browser localStorage still says Default, read workspace config fallback.
  if (!directSkinPath && activeSkin.toLowerCase() === 'default') {
    try {
      const cfg = await fetch('/api/config').then((r) => (r.ok ? r.json() : null));
      const wsSkin = String(cfg?.osu?.activeSkin ?? '').trim();
      const wsPath = String(cfg?.osu?.skinsPath ?? '').trim();
      if (wsSkin && wsSkin.toLowerCase() !== 'default') {
        activeSkin = wsSkin;
        if (wsPath) skinsPath = wsPath;
      }
    } catch (_) {}
  }

  try {
    const params = new URLSearchParams(directSkinPath
      ? { path: directSkinPath }
      : { skinsPath, skin: activeSkin });
    const r = await fetch(`/api/skin-select?${params.toString()}`);
    if (r.ok) selected = await r.json();
  } catch (_) {}

  await skin.load();
  console.log('[skin]', {
    requested: activeSkin,
    skinsPath,
    selectedPath: selected?.skinPath ?? null,
    hasSkin: skin.hasSkin,
  });
  if (customSkinRequested() && !skin.hasSkin) {
    console.warn('[skin] Custom skin requested but not loaded; fallback rendering is disabled.');
  }

  layerCursor.removeChildren();
  cursorSprite = null;
  layerCursor.addChild(cursorGfx);
  cursorGfx.clear();

  const cTex = skin.tex('cursor.png');
  if (cTex) {
    cursorSprite = new PIXI.Sprite(cTex);
    cursorSprite.anchor.set(skin.cursorCentre ? 0.5 : 0);
    
    // danser-go cursor scaling:
    // The cursor texture logical size represents its native resolution.
    // We scale it so that at cursor.size=1.0 the cursor is rendered at 
    // its natural logical size relative to the playfield.
    const userSize = Number(config.get('cursor.size')) || 1;
    const logical = logicalTextureSize(cTex);
    const { scale: vpScale } = getTransform();
    // Scale: logical→osu!px (1:1), then osu!px→screen via viewport scale
    // @2x textures have logicalW = pixelW/2, so this naturally handles them
    const pixelScale = logical.w / Math.max(1, cTex.width);  // 1 for SD, 0.5 for @2x
    const resolvedScale = pixelScale * userSize * vpScale * 0.07; // 0.07 normalises to typical osu! cursor size
    
    cursorSprite.scale.set(resolvedScale);
    layerCursor.addChild(cursorSprite);
  }
}

// ── Public API ──────────────────────────────────

window._loadBeatmap = async (file) => {
  const text = await file.text();
  beatmap    = BeatmapParser.parse(text);
  buildSliderPaths();
  assignCombos();
  applyFlowerSettings();   // ← must happen before buildPositionQuery
  
  // Clear scoring flags
  if (beatmap) {
    for (const obj of beatmap.hitObjects) delete obj._scored;
  }
  
  // AITrainer training removed

  const slide = config.get('dance.sliderDance') ?? false;
  dancer      = new CursorDancer(1/4, slide);
  if (!useReplay) {
    getPos = dancer.buildPositionQuery(beatmap);
    statsHUD = new StatsHUD(app, getTransform);
    liveStats = { 
      score: 0, 
      combo: 0, 
      accuracy: 100, 
      hp: 1.0,
      count300: 0,
      count100: 0,
      count50: 0,
      countMiss: 0
    };
  } else if (globalReplays.length > 1) {
    if (knockoutRenderer) knockoutRenderer.clear();
    knockoutManager = new KnockoutManager(beatmap, globalReplays);
    knockoutRenderer = new KnockoutRenderer(app, knockoutManager, config, getTransform);
    getPos = null;
    cursorGfx.clear(); trailGfx.clear();
  }
  publishDanceDebug(dancer.getDebugReport?.());
  trailPts    = [];
  return `${beatmap.artist} – ${beatmap.title} [${beatmap.version}]`;
};

window._loadReplay = async (files) => {
  const arr = Array.isArray(files) || files instanceof FileList ? Array.from(files) : [files];
  const parsedReplays = [];
  for (const f of arr) {
    const buf = await f.arrayBuffer();
    parsedReplays.push(await ReplayParser.parse(buf));
  }
  
  globalReplays = parsedReplays;
  useReplay = true;

  if (globalReplays.length === 1) {
    if (knockoutRenderer) { knockoutRenderer.clear(); knockoutRenderer = null; }
    knockoutManager = null;
    const parsed = globalReplays[0];
    replayFrames = parsed.frames;

    getPos = (time) => {
      if (!replayFrames || replayFrames.length === 0) return {x: 256, y: 192, keys: 0};
      let l = 0, r = replayFrames.length - 1;
      while (l <= r) {
        const m = (l + r) >> 1;
        if (replayFrames[m].time === time) return replayFrames[m];
        if (replayFrames[m].time < time) l = m + 1;
        else r = m - 1;
      }
      const idx1 = Math.max(0, r);
      const idx2 = Math.min(replayFrames.length - 1, l);
      if (idx1 === idx2) return replayFrames[idx1];
      
      const f1 = replayFrames[idx1];
      const f2 = replayFrames[idx2];
      const dt = f2.time - f1.time;
      const tNorm = dt === 0 ? 0 : (time - f1.time) / dt;
      return {
        x: f1.x + (f2.x - f1.x) * tNorm,
        y: f1.y + (f2.y - f1.y) * tNorm,
        keys: f1.keys
      };
    };

    trailPts = [];
    return `${parsed.playerName} | ${parsed.totalScore.toLocaleString()} pts`;
  } else {
    // Knockout Mode
    if (beatmap) {
      if (knockoutRenderer) knockoutRenderer.clear();
      knockoutManager = new KnockoutManager(beatmap, globalReplays);
      knockoutRenderer = new KnockoutRenderer(app, knockoutManager, config, getTransform);
    }
    getPos = null;
    cursorGfx.clear(); trailGfx.clear();
    return `Knockout: ${globalReplays.length} players`;
  }
};

window._loadAudio = async (file) => {
  const buf = await file.arrayBuffer();
  await audio.init();
  await audio.loadSong(buf);
  // Give skin manager the audio context for hitsounds
  skin.audioContext = audio.ctx;
  // Decode skin sounds now that we have an audio context
  if (skin.hasSkin) await skin.load();
};

window._play = async () => {
  if (!beatmap) return;
  await audio.init();
  skin.audioContext = audio.ctx;
  if (!audio.isPlaying) {
    audio.play(audio.currentTimeMs);
    scheduleHitsounds(audio.currentTimeMs);
  }
};

window._pause        = () => { audio.pause(); clearHitsoundTimers(); };
window._resume       = () => { audio.resume(); scheduleHitsounds(audio.currentTimeMs); };
window._toggle       = () => audio.isPlaying ? audio.pause() : window._resume();
window._getIsPlaying = () => audio.isPlaying;
window._skipIntro    = () => {
  if (!beatmap || !beatmap.hitObjects.length) return;
  const firstTime = beatmap.hitObjects[0].time;
  const skipTo = Math.max(0, firstTime - 1500);
  if (audio.currentTimeMs < skipTo) {
    audio.seek(skipTo);
    console.log('[main] Skipped to', skipTo);
  }
};


window._applyConfig = () => {
  const volume = Number(config.get('audio.masterVolume'));
  const rate   = Number(config.get('audio.playbackRate'));
  audio.volume       = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 1;
  audio.playbackRate = Number.isFinite(rate) && rate > 0 ? rate : 1;
  const bg = config.get('display.backgroundColor');
  app.renderer.background.color = bg ? hexNum(bg) : 0x000000;
  trailPts = [];
  if (beatmap) {
    const slide = config.get('dance.sliderDance') ?? false;
    applyFlowerSettings();
    if (beatmap) {
      if (!useReplay) {
        beatmap.applyMods(config.get('dance.mods') || 0);
      } else if (globalReplays.length === 1) {
        beatmap.applyMods(globalReplays[0].mods || 0);
      }

      // Sync audio playback rate
      if (audio) {
        audio.playbackRate = beatmap._clockRate || 1.0;
      }

      dancer = new CursorDancer(1/4, slide);
      getPos = dancer.buildPositionQuery(beatmap);
      publishDanceDebug(dancer.getDebugReport?.());
    }
  }
};

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    window._skipIntro?.();
  }
});

window._reloadSkin = async () => {
  await setupSkin();
  if (beatmap) assignCombos();
};

setupSkin();
applyFlowerSettings();
