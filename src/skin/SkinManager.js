// ─────────────────────────────────────────────
//  SkinManager.js  v3
// ─────────────────────────────────────────────

import * as PIXI from 'pixi.js';

const PLACEHOLDER_MAX = 4;   // textures ≤ 4×4 px are transparent placeholders

export class SkinManager {
  constructor() {
    this._texCache  = new Map();
    this._audCache  = new Map();   // name → AudioBuffer (decoded)
    this._skinFiles = new Set();
    this._skinAvail = false;
    this._loaded    = false;
    this._comboColors   = [];
    this._audioCtx  = null;        // set by caller after user gesture
  }

  // ── Public ─────────────────────────────────

  set audioContext(ctx) { this._audioCtx = ctx; }

  async load() {
    this._texCache.clear();
    this._audCache.clear();
    this._skinFiles.clear();
    this._skinAvail   = false;
    this._loaded      = false;
    this._comboColors = [];

    try {
      const r = await fetch('/api/skin-list');
      if (r.ok) {
        const files = await r.json();
        if (Array.isArray(files) && files.length > 0) {
          for (const f of files) this._skinFiles.add(f.toLowerCase());
          this._skinAvail = true;
        }
      }
    } catch (_) {}

    if (!this._skinAvail) { this._loaded = true; return; }

    // ── Textures ──────────────────────────────
    const textures = [
      // Cursor
      'cursor.png', 'cursortrail.png',
      // Hit circles — hitcircle=Multiplicative(tinted), overlay=Normal(untinted)
      'hitcircle.png', 'hitcircleoverlay.png',
      // Slider-specific circle overrides
      'sliderstartcircle.png', 'sliderstartcircleoverlay.png',
      'sliderendcircle.png',   'sliderendcircleoverlay.png',
      // Approach circle — Multiplicative(tinted), 126x126
      'approachcircle.png',
      // Slider ball — Multiplicative(tinted), animated as sliderb0/sliderb1...
      'sliderb.png', 'sliderb0.png',
      // Follow circle — Normal blend, 256x256
      'sliderfollowcircle.png',
      // Reverse arrow — Normal blend, rotated to path direction
      'reversearrow.png',
      // Slider tick — Normal blend, 16x16
      'sliderscorepoint.png',
      // Spinner (new style layers — order: glow→bottom→top→middle2→middle)
      'spinner-glow.png',           // Additive blend, lowest layer
      'spinner-bottom.png',         // Normal, rotates slowest
      'spinner-top.png',            // Normal, rotates medium
      'spinner-middle2.png',        // Normal, rotates fastest
      'spinner-middle.png',         // Multiplicative, tinted red (time indicator)
      'spinner-approachcircle.png', // Normal, shrinks to centre
      // Combo numbers — downscaled 0.8× of circle size
      ...Array.from({length:10}, (_,i) => `default-${i}.png`),
    ];
    await Promise.all(textures.map(n => this._loadTex(n)));

    // ── Audio ──────────────────────────────────
    const sounds = [
      'normal-hitnormal.ogg','normal-hitwhistle.ogg',
      'normal-hitfinish.ogg','normal-hitclap.ogg',
      'soft-hitnormal.ogg',  'soft-hitwhistle.ogg',
      'soft-hitfinish.ogg',  'soft-hitclap.ogg',
      'drum-hitnormal.ogg',  'drum-hitwhistle.ogg',
      'drum-hitfinish.ogg',  'drum-hitclap.ogg',
    ];
    await Promise.all(sounds.map(n => this._loadAud(n)));

    if (this._skinFiles.has('skin.ini'))
      this._comboColors = await this._parseColors();

    this._loaded = true;
    const tc = [...this._texCache.values()].filter(t => t && t.width > PLACEHOLDER_MAX).length;
    const ac = this._audCache.size;
    console.log(`[SkinManager] ${tc} textures, ${ac} sounds`);
  }

  /**
   * Returns the texture for `name`, or null if:
   *  - not in the custom skin folder
   *  - the file is a placeholder (≤4×4 px)
   *  - loading failed
   * Callers must always check for null and render via Graphics fallback.
   * Custom skin assets are NEVER overridden by defaults.
   */
  tex(name) {
    const t = this._texCache.get(name.toLowerCase());
    if (!t) return null;
    if (t.width <= PLACEHOLDER_MAX || t.height <= PLACEHOLDER_MAX) return null;
    return t;
  }

  has(name) { return !!this.tex(name); }

  get hasSkin()  { return this._skinAvail; }
  get isLoaded() { return this._loaded; }

  /** Best slider ball texture */
  get sliderBallTex() {
    return this.tex('sliderb.png') ?? this.tex('sliderb0.png');
  }

  /** Combo number texture (0–9), null if missing */
  numTex(n) { return this.tex(`default-${n}.png`); }

  /** Combo colours from skin.ini or default palette */
  get comboColors() {
    if (this._comboColors.length > 0) return this._comboColors;
    return [0xff6688, 0x66aaff, 0xffcc33, 0x44ffaa, 0xff8833, 0xcc44ff];
  }

  /**
   * Play a hit sound immediately.
   * sampleSet: 'normal' | 'soft' | 'drum'
   * hitSound flag: 0=normal,2=whistle,4=finish,8=clap
   * volume: 0–1
   */
  playHitSound(sampleSet, hitSoundFlag, volume = 1) {
    if (!this._audioCtx) return;
    const name = this._resolveSound(sampleSet, hitSoundFlag);
    const buf  = this._audCache.get(name);
    if (!buf) return;
    const src  = this._audioCtx.createBufferSource();
    const gain = this._audioCtx.createGain();
    src.buffer      = buf;
    gain.gain.value = Math.max(0, Math.min(1, volume));
    src.connect(gain);
    gain.connect(this._audioCtx.destination);
    src.start();
  }

  // ── Internals ───────────────────────────────

  async _loadTex(name) {
    const key = name.toLowerCase();
    if (this._texCache.has(key)) return;   // already loaded, never overwrite

    // Prefer @2x HD variant over 1x
    const hd = key.replace('.png', '@2x.png');
    const url = this._skinFiles.has(hd)
      ? `/api/skin/${encodeURIComponent(hd)}`
      : this._skinFiles.has(key)
        ? `/api/skin/${encodeURIComponent(key)}`
        : null;

    if (!url) return;   // file not in custom skin — leave missing, caller falls back to Graphics

    try {
      const t = await PIXI.Assets.load(url);
      if (!t) return;

      // Reject placeholder textures (≤4×4 px transparent PNGs used as
      // "disabled" markers in some skins like WhiteCat)
      if (t.width <= 4 && t.height <= 4) return;

      this._texCache.set(key, t);
    } catch (_) {}
  }

  async _loadAud(name) {
    const key = name.toLowerCase();
    if (!this._skinFiles.has(key)) return;
    try {
      const r   = await fetch(`/api/skin/${encodeURIComponent(key)}`);
      const buf = await r.arrayBuffer();
      if (!this._audioCtx) return;
      const decoded = await this._audioCtx.decodeAudioData(buf);
      this._audCache.set(key, decoded);
    } catch (_) {}
  }

  _resolveSound(sampleSet, flag) {
    const set  = (sampleSet ?? 'normal').toLowerCase();
    let suffix = 'hitnormal';
    if (flag & 8) suffix = 'hitclap';
    else if (flag & 4) suffix = 'hitfinish';
    else if (flag & 2) suffix = 'hitwhistle';
    return `${set}-${suffix}.ogg`;
  }

  async _parseColors() {
    try {
      const r    = await fetch('/api/skin/skin.ini');
      const text = await r.text();
      const out  = [];
      for (const line of text.split(/\r?\n/)) {
        const m = line.match(/Combo\d+\s*:\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
        if (m) out.push((+m[1] << 16) | (+m[2] << 8) | +m[3]);
      }
      return out;
    } catch (_) { return []; }
  }
}

export const skin = new SkinManager();
