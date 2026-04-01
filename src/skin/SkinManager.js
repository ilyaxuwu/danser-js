// ─────────────────────────────────────────────
//  SkinManager — mirrors github.com/wieku/danser-go/app/skin/skin.go
//
//  Reference (Go):
//    • GetTextureSource / GetTexture — layer order SKIN → FALLBACK → LOCAL; if CurrentSkin
//      is "default", SKIN|FALLBACK masked (embedded assets only), see skin.go:190–196.
//    • loadTexture — try name@2x.png first; logical Width/Height = pixel/2 for @2x (351–370).
//    • GetSample — wav → ogg → mp3 per layer (468–481).
//    • tryLoadSkin — recursive fallback when skin folder missing (97–123).
//
//  JS-specific: dev server serves layered files via /api/skin/*; if that is unavailable
//  (static dist, file://), we fall back to Vite public copy at /skin-default/* (see
//  _tryPublicEmbeddedSkin).
// ─────────────────────────────────────────────

import * as PIXI from 'pixi.js';
import { DEFAULT_OSU_COMBO_COLORS, SOURCE_RANK } from './skinConstants.js';
import { parseSkinIni } from './SkinIniParser.js';
import { BitmapFontResolver } from './BitmapFontResolver.js';
import {
  resolveAudioSample,
  hitSoundFlagToSuffix,
  primaryHitSoundBase,
  sampleSetFallbackChain,
  AUDIO_EXT_ORDER,
} from './AudioSampleResolver.js';
import {
  TextureResolver,
  getLogicalPngCandidates,
  frameFileName,
  stripExtension,
  isSourceMoreSpecific,
} from './TextureResolver.js';
import { getComboColor as comboColorHelper } from './comboColors.js';

const PLACEHOLDER_MAX = 4;

/** @typedef {'SKIN' | 'FALLBACK' | 'LOCAL'} SkinSource */

/**
 * @typedef {object} ResolvedTextureEntry
 * @property {PIXI.Texture} texture
 * @property {SkinSource} source
 * @property {number} logicalWidth
 * @property {number} logicalHeight
 * @property {number} pixelWidth
 * @property {number} pixelHeight
 * @property {boolean} isHiRes
 */

export class SkinManager {
  constructor() {
    this._texResolver = new TextureResolver();
    /** @type {Map<string, AudioBuffer>} */
    this._audCache = new Map();
    /** Union of all skin filenames (lower-case) */
    this._skinFiles = new Set();
    /** @type {{ source: SkinSource, files: string[] }[] | null} */
    this._layerFiles = null;
    this._skinAvail = false;
    this._loaded = false;
    this._comboColors = [];
    this._ini = this._defaultIni();
    this._audioCtx = null;
    /** @type {BitmapFontResolver} */
    this._bitmap = new BitmapFontResolver(this._ini);
    /**
     * When set, textures/sounds load from `${BASE_URL}skin-default/` (Vite `public/skin-default`)
     * instead of `/api/skin/*`. Mirrors danser-go embedded `assets/default-skin/`.
     * @type {string | null}
     */
    this._publicFallbackBase = null;
  }

  set audioContext(ctx) {
    this._audioCtx = ctx;
  }

  _defaultIni() {
    return parseSkinIni('');
  }

  /** Normalized URL prefix for embedded default skin (respects Vite `base`). */
  _publicSkinBaseUrl() {
    const raw = typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL
      ? String(import.meta.env.BASE_URL)
      : '/';
    const withSlash = raw.endsWith('/') ? raw : `${raw}/`;
    return `${withSlash}skin-default/`;
  }

  /**
   * If /api/skin-list is unavailable, use static files copied to dist with `public/skin-default/`.
   * @returns {Promise<boolean>}
   */
  async _tryPublicEmbeddedSkin() {
    const base = this._publicSkinBaseUrl();
    try {
      const probe = await fetch(`${base}hitcircle.png`, { method: 'GET', cache: 'no-store' });
      if (!probe.ok) return false;
    } catch (_) {
      return false;
    }

    this._publicFallbackBase = base;

    try {
      const ir = await fetch(`${base}skin.ini`);
      if (ir.ok) {
        this._ini = parseSkinIni(await ir.text());
        this._comboColors = [...(this._ini.comboColors ?? [])];
      }
    } catch (_) {}

    this._bitmap = new BitmapFontResolver(this._ini);

    for (const n of this._preloadTextureList()) {
      this._skinFiles.add(n.toLowerCase());
    }
    for (const b of this._preloadSoundList()) {
      for (const ext of AUDIO_EXT_ORDER) {
        this._skinFiles.add(`${b}${ext}`.toLowerCase());
      }
    }
    this._layerFiles = [{ source: 'LOCAL', files: [...this._skinFiles] }];
    this._skinAvail = true;
    console.info('[SkinManager] Using embedded public skin:', base);
    return true;
  }

  _unionHas(file) {
    return this._skinFiles.has(file.toLowerCase());
  }

  _layerHas(source, file) {
    const f = file.toLowerCase();
    if (this._layerFiles?.length) {
      const L = this._layerFiles.find((l) => l.source === source);
      return L ? L.files.includes(f) : false;
    }
    return this._unionHas(f);
  }

  /**
   * Logical PNG exists in any layer (@2x or 1×).
   * @param {string} logicalPng
   */
  _logicalPngExists(logicalPng) {
    for (const c of getLogicalPngCandidates(logicalPng.toLowerCase())) {
      if (this._unionHas(c)) return true;
    }
    return false;
  }

  /**
   * Which layer wins for a logical PNG (first candidate file in SKIN→FALLBACK→LOCAL order).
   * @param {string} logicalPng
   * @returns {SkinSource | null}
   */
  _resolveSourceForLogical(logicalPng) {
    const candidates = getLogicalPngCandidates(logicalPng.toLowerCase());
    for (const f of candidates) {
      for (const src of /** @type {SkinSource[]} */ (['SKIN', 'FALLBACK', 'LOCAL'])) {
        if (this._layerHas(src, f)) return src;
      }
    }
    return null;
  }

  /**
   * @param {string} logicalPng
   * @param {{ preferSource?: SkinSource | null }} [opts]
   */
  async _fetchTextureEntry(logicalPng, opts = {}) {
    const key = logicalPng.toLowerCase();
    const hit = this._texResolver.getCached(key);
    if (hit) return hit;

    if (this._publicFallbackBase) {
      return this._fetchTextureFromPublic(key, opts);
    }

    const q = new URLSearchParams();
    if (opts.preferSource) q.set('preferSource', opts.preferSource);
    const qs = q.toString();
    const url = `/api/skin/${encodeURIComponent(key)}${qs ? `?${qs}` : ''}`;

    const res = await fetch(url);
    if (!res.ok) return null;

    const source = /** @type {SkinSource} */ (res.headers.get('X-Skin-Source') ?? 'LOCAL');
    const resolvedName = (res.headers.get('X-Skin-Resolved-Name') ?? key).toLowerCase();
    return this._textureEntryFromImageResponse(key, source, resolvedName, await res.blob());
  }

  /**
   * danser-go loadTexture order: @2x then 1× (skin.go:354–370).
   */
  async _fetchTextureFromPublic(key, _opts) {
    const base = this._publicFallbackBase;
    if (!base) return null;

    const candidates = getLogicalPngCandidates(key);
    for (const cand of candidates) {
      const url = `${base}${encodeURIComponent(cand)}`;
      try {
        const res = await fetch(url);
        if (!res.ok) continue;
        const resolvedName = cand.toLowerCase();
        const entry = await this._textureEntryFromImageResponse(key, 'LOCAL', resolvedName, await res.blob());
        if (entry) return entry;
      } catch (_) {
        /* try next candidate */
      }
    }
    return null;
  }

  /**
   * @param {string} cacheKey
   * @param {SkinSource} source
   * @param {string} resolvedNameLower
   * @param {Blob} blob
   */
  async _textureEntryFromImageResponse(cacheKey, source, resolvedNameLower, blob) {
    const bmp = await createImageBitmap(blob);
    const texture = PIXI.Texture.from(bmp);

    const w = texture.width;
    const h = texture.height;
    if (w <= PLACEHOLDER_MAX || h <= PLACEHOLDER_MAX) return null;

    const isHiRes = resolvedNameLower.includes('@2x');
    const logicalW = isHiRes ? w / 2 : w;
    const logicalH = isHiRes ? h / 2 : h;

    /** @type {ResolvedTextureEntry} */
    const entry = {
      texture,
      source,
      logicalWidth: logicalW,
      logicalHeight: logicalH,
      pixelWidth: w,
      pixelHeight: h,
      isHiRes,
    };
    this._attachLogicalSize(texture, entry);
    this._texResolver.setCached(cacheKey, entry);
    return entry;
  }

  /**
   * @param {PIXI.Texture} texture
   * @param {ResolvedTextureEntry} entry
   */
  _attachLogicalSize(texture, entry) {
    const t = /** @type {any} */ (texture);
    t._skinLogicalW = entry.logicalWidth;
    t._skinLogicalH = entry.logicalHeight;
    t._skinSource = entry.source;
  }

  /**
   * Public: load (or cache) logical texture.
   * @param {string} logicalName — e.g. `hitcircle.png`
   * @param {{ preferSource?: SkinSource | null }} [opts]
   * @returns {Promise<ResolvedTextureEntry | null>}
   */
  async ensureTexture(logicalName, opts = {}) {
    return this._fetchTextureEntry(logicalName, opts);
  }

  /**
   * Dependent asset (e.g. particle300) prefers the same layer as anchor (hit300).
   * @param {string} dependentLogical
   * @param {string} anchorLogical
   */
  async ensureTextureFromAnchor(dependentLogical, anchorLogical) {
    const anchor = await this.ensureTexture(anchorLogical);
    const pref = anchor?.source ?? this._resolveSourceForLogical(anchorLogical);
    if (!pref) return this.ensureTexture(dependentLogical);
    const hit = await this.ensureTexture(dependentLogical, { preferSource: pref });
    if (hit) return hit;
    return this.ensureTexture(dependentLogical);
  }

  /**
   * Synchronous texture access (preload required). Returns null if missing.
   * @param {string} name
   */
  tex(name) {
    const key = name.toLowerCase();
    const e = this._texResolver.getCached(key);
    if (!e?.texture) return null;
    if (e.pixelWidth <= PLACEHOLDER_MAX || e.pixelHeight <= PLACEHOLDER_MAX) return null;
    return e.texture;
  }

  /**
   * @param {string} name
   */
  getTextureSource(name) {
    return this._texResolver.getCached(name.toLowerCase())?.source ?? null;
  }

  /**
   * @param {string} baseName — e.g. `sliderb` or `sliderb.png`
   * @param {boolean} useDash
   * @returns {Promise<PIXI.Texture[]>}
   */
  async getFrames(baseName, useDash) {
    const base = stripExtension(baseName);
    const single = `${base}.png`;
    const sSrc = this._resolveSourceForLogical(single);
    const f0 = frameFileName(base, useDash, 0);
    const f0Src = this._resolveSourceForLogical(f0);

    if (f0Src && sSrc) {
      if (isSourceMoreSpecific(f0Src, sSrc)) {
        return await this._loadFrameSeries(base, useDash);
      }
      const t = await this.ensureTexture(single);
      return t?.texture ? [t.texture] : [];
    }
    if (f0Src) return await this._loadFrameSeries(base, useDash);
    if (sSrc) {
      const t = await this.ensureTexture(single);
      return t?.texture ? [t.texture] : [];
    }
    return [];
  }

  /**
   * @param {string} base
   * @param {boolean} useDash
   */
  async _loadFrameSeries(base, useDash) {
    /** @type {PIXI.Texture[]} */
    const out = [];
    for (let i = 0; i < 1024; i++) {
      const fn = frameFileName(base, useDash, i);
      if (!this._logicalPngExists(fn)) break;
      const e = await this.ensureTexture(fn);
      if (!e?.texture) break;
      out.push(e.texture);
    }
    return out;
  }

  has(name) {
    return this._logicalPngExists(name);
  }

  get hasSkin() {
    return this._skinAvail;
  }

  get isLoaded() {
    return this._loaded;
  }

  get ini() {
    return this._ini;
  }

  get bitmap() {
    return this._bitmap;
  }

  get comboColors() {
    if (this._comboColors.length > 0) return this._comboColors;
    return [...DEFAULT_OSU_COMBO_COLORS];
  }

  get hitCircleOverlap() {
    return this._ini.hitCircleOverlap ?? -2;
  }

  get hitCircleOverlayAboveNumber() {
    return this._ini.hitCircleOverlayAboveNumber !== false;
  }

  get sliderTrackOverride() {
    return this._ini.sliderTrackOverride ?? null;
  }

  get sliderBorder() {
    const v = this._ini.sliderBorder;
    return v == null ? 0x000000 : v;
  }

  get sliderBallTint() {
    return this._ini.sliderBall ?? null;
  }

  get allowSliderBallTint() {
    return this._ini.allowSliderBallTint !== false;
  }

  get sliderBallFlip() {
    return this._ini.sliderBallFlip !== false;
  }

  get layeredHitSounds() {
    return this._ini.layeredHitSounds !== false;
  }

  get cursorCentre() {
    return this._ini.cursorCentre !== false;
  }

  get cursorExpand() {
    return this._ini.cursorExpand !== false;
  }

  get cursorRotate() {
    return this._ini.cursorRotate === true;
  }

  get animationFramerate() {
    return this._ini.animationFramerate ?? 60;
  }

  get useColorsFromSkin() {
    return this._ini.useColorsFromSkin !== false;
  }

  /**
   * Circle texture names for object kinds (osu! priority).
   * @param {'hitcircle' | 'sliderstart' | 'sliderend'} kind
   * @returns {{ base: string, overlay: string | null, usedSpecific: boolean }}
   */
  pickCircleTextures(kind) {
    const map = {
      hitcircle: { base: 'hitcircle.png', overlay: 'hitcircleoverlay.png' },
      sliderstart: { base: 'sliderstartcircle.png', overlay: 'sliderstartcircleoverlay.png' },
      sliderend: { base: 'sliderendcircle.png', overlay: 'sliderendcircleoverlay.png' },
    };
    const sp = map[kind] ?? map.hitcircle;
    const specSrc = this._resolveSourceForLogical(sp.base);
    const genSrc = this._resolveSourceForLogical('hitcircle.png');

    if (!specSrc) {
      return {
        base: 'hitcircle.png',
        overlay: this._logicalPngExists('hitcircleoverlay.png') ? 'hitcircleoverlay.png' : null,
        usedSpecific: false,
      };
    }

    if (kind !== 'hitcircle' && genSrc && isSourceMoreSpecific(genSrc, specSrc)) {
      return {
        base: 'hitcircle.png',
        overlay: this._logicalPngExists('hitcircleoverlay.png') ? 'hitcircleoverlay.png' : null,
        usedSpecific: false,
      };
    }

    let ov = sp.overlay;
    if (!this._logicalPngExists(sp.overlay)) {
      ov = this._logicalPngExists('hitcircleoverlay.png') ? 'hitcircleoverlay.png' : null;
    }

    return { base: sp.base, overlay: ov, usedSpecific: true };
  }

  /**
   * Slider ball: frames or single.
   */
  get sliderBallTex() {
    return this.tex('sliderb.png') ?? this.tex('sliderb0.png');
  }

  /**
   * @param {number} n 0–9 — hit-circle bitmap font
   */
  numTex(n) {
    const f = this._bitmap.digitFileHitCircle(n);
    return this.tex(f) ?? this.tex(`default-${n}.png`);
  }

  /**
   * Combo colour helper (skin + beatmap aware).
   */
  getComboColor(opts) {
    const skinCombo = this._comboColors.length ? this._comboColors : (this._ini.comboColors ?? []);
    return comboColorHelper({
      useColorsFromSkin: opts.useColorsFromSkin ?? this.useColorsFromSkin,
      beatmapComboColorsActive: !!opts.beatmapComboColorsActive,
      comboSet: skinCombo.length ? skinCombo : [...DEFAULT_OSU_COMBO_COLORS],
      comboSetHax: opts.comboSetHax ?? [],
      comboIndex: opts.comboIndex ?? 0,
      objectComboColor: opts.objectComboColor ?? null,
      baseColor: opts.baseColor ?? 0xffffff,
    });
  }

  // ── Loading ─────────────────────────────────

  async load() {
    this._texResolver.clear();
    this._audCache.clear();
    this._skinFiles.clear();
    this._layerFiles = null;
    this._skinAvail = false;
    this._publicFallbackBase = null;
    this._loaded = false;
    this._comboColors = [];
    this._ini = this._defaultIni();

    try {
      const r = await fetch('/api/skin-list');
      if (r.ok) {
        const j = await r.json();
        if (Array.isArray(j)) {
          for (const f of j) this._skinFiles.add(String(f).toLowerCase());
        } else {
          for (const f of j.files ?? []) this._skinFiles.add(String(f).toLowerCase());
          this._layerFiles = j.layers ?? null;
        }
        if (this._skinFiles.size > 0) this._skinAvail = true;
      }
    } catch (_) {}

    if (!this._skinAvail) {
      await this._tryPublicEmbeddedSkin();
    }

    this._bitmap = new BitmapFontResolver(this._ini);

    if (!this._skinAvail) {
      this._loaded = true;
      return;
    }

    if (!this._publicFallbackBase) {
      try {
        const ir = await fetch('/api/skin/skin.ini');
        if (ir.ok) {
          this._ini = parseSkinIni(await ir.text());
          this._bitmap = new BitmapFontResolver(this._ini);
          this._comboColors = [...(this._ini.comboColors ?? [])];
        }
      } catch (_) {}
    }

    const preload = this._preloadTextureList();
    await Promise.all(preload.map((n) => this._fetchTextureEntry(n)));

    const soundBases = this._preloadSoundList();
    await Promise.all(soundBases.map((b) => this._loadAudResolved(b)));

    this._loaded = true;
    const tc = [...this._texResolver.cache.values()].filter(
      (t) => t.pixelWidth > PLACEHOLDER_MAX,
    ).length;
    console.log(`[SkinManager] ${tc} textures, ${this._audCache.size} sounds`);
  }

  _preloadTextureList() {
    return [
      'cursor.png',
      'cursortrail.png',
      'cursormiddle.png',
      'hitcircle.png',
      'hitcircleoverlay.png',
      'sliderstartcircle.png',
      'sliderstartcircleoverlay.png',
      'sliderendcircle.png',
      'sliderendcircleoverlay.png',
      'approachcircle.png',
      'sliderb.png',
      'sliderb0.png',
      'sliderb-nd.png',
      'sliderb-spec.png',
      'sliderfollowcircle.png',
      'reversearrow.png',
      'sliderscorepoint.png',
      'followpoint-0.png',
      'followpoint-1.png',
      'followpoint-2.png',
      'lighting.png',
      'comboburst.png',
      'particle50.png',
      'particle100.png',
      'particle300.png',
      'hit50.png',
      'hit100.png',
      'hit300.png',
      'hit300g.png',
      'hit300k.png',
      'sliderendmiss.png',
      'slidertickmiss.png',
      'spinner-glow.png',
      'spinner-bottom.png',
      'spinner-top.png',
      'spinner-middle2.png',
      'spinner-middle.png',
      'spinner-approachcircle.png',
      'spinner-clear.png',
      'spinner-spin.png',
      'scorebar-colour.png',
      'scorebar-marker.png',
      'scorebar-ki.png',
      'scorebar-kidanger.png',
      'scorebar-kidanger2.png',
      ...Array.from({ length: 10 }, (_, i) => `default-${i}.png`),
      ...Array.from({ length: 10 }, (_, i) => {
        const p = this._ini.hitCirclePrefix || 'default';
        return `${p}-${i}.png`;
      }),
    ];
  }

  _preloadSoundList() {
    const sets = ['normal', 'soft', 'drum'];
    const parts = ['hitnormal', 'hitwhistle', 'hitfinish', 'hitclap', 'slidertick', 'sliderslide', 'sliderwhistle'];
    const out = [];
    for (const s of sets) {
      for (const p of parts) {
        out.push(`${s}-${p}`.toLowerCase());
      }
    }
    return out;
  }

  /**
   * @param {string} baseLower — without extension
   */
  async _loadAudResolved(baseLower) {
    const hit = resolveAudioSample(baseLower, (f) => this._unionHas(f), {
      layerHas: (s, f) => this._layerHas(s, f),
    });
    if (!hit) return;
    await this._loadAudFile(hit.file);
  }

  /**
   * @param {string} file — with extension
   */
  async _loadAudFile(file) {
    const key = file.toLowerCase().replace(/\.(wav|ogg|mp3)$/i, '');
    if (this._audCache.has(key)) return;
    try {
      const base = this._publicFallbackBase;
      const url = base
        ? `${base}${encodeURIComponent(file)}`
        : `/api/skin/${encodeURIComponent(file)}`;
      const r = await fetch(url);
      if (!r.ok) return;
      const ab = await r.arrayBuffer();
      if (!this._audioCtx) return;
      const decoded = await this._audioCtx.decodeAudioData(ab);
      this._audCache.set(key, decoded);
    } catch (_) {}
  }

  /**
   * @param {string} sampleSet
   * @param {number} hitSoundFlag
   * @param {number} volume
   */
  playHitSound(sampleSet, hitSoundFlag, volume = 1) {
    if (!this._audioCtx) return;

    const layered = this.layeredHitSounds;

    if (!layered) {
      const one = this._resolveSingleHit(sampleSet, hitSoundFlag);
      if (one) this._playBufferKey(one.base, volume);
      return;
    }

    const bases = [];
    bases.push(primaryHitSoundBase(sampleSet, 0));
    if (hitSoundFlag & 2) bases.push(primaryHitSoundBase(sampleSet, 2));
    if (hitSoundFlag & 4) bases.push(primaryHitSoundBase(sampleSet, 4));
    if (hitSoundFlag & 8) bases.push(primaryHitSoundBase(sampleSet, 8));

    const seen = new Set();
    for (const b of bases) {
      if (seen.has(b)) continue;
      seen.add(b);
      const hit = resolveAudioSample(b, (f) => this._unionHas(f), {
        layerHas: (s, f) => this._layerHas(s, f),
      });
      if (hit) this._playBufferKey(hit.file.replace(/\.(wav|ogg|mp3)$/i, ''), volume);
    }
  }

  /**
   * Non-layered: pick highest-priority component (clap > finish > whistle > normal).
   * @param {string} sampleSet
   * @param {number} flag
   */
  _resolveSingleHit(sampleSet, flag) {
    const suffix = hitSoundFlagToSuffix(flag);
    const chain = sampleSetFallbackChain(sampleSet);
    for (const s of chain) {
      const base = `${s}-${suffix}`.toLowerCase();
      const hit = resolveAudioSample(base, (f) => this._unionHas(f), {
        layerHas: (src, f) => this._layerHas(s, f),
      });
      if (hit) return { base: hit.file.replace(/\.(wav|ogg|mp3)$/i, ''), source: hit.source };
    }
    return null;
  }

  /**
   * @param {string} key — cache key without extension
   */
  _playBufferKey(key, volume) {
    const buf = this._audCache.get(key.toLowerCase());
    if (!buf) return;
    const src = this._audioCtx.createBufferSource();
    const gain = this._audioCtx.createGain();
    src.buffer = buf;
    gain.gain.value = Math.max(0, Math.min(1, volume));
    src.connect(gain);
    gain.connect(this._audioCtx.destination);
    src.start();
  }

  /**
   * Expose source rank for debugging / UI.
   * @param {SkinSource} s
   */
  static sourceRank(s) {
    return SOURCE_RANK[s] ?? 0;
  }
}

/**
 * Pixel dimensions of a loaded skin texture in osu! logical space
 * (@2x assets report half the pixel width/height, matching danser-go).
 * @param {PIXI.Texture | null | undefined} tex
 * @returns {{ w: number, h: number }}
 */
export function logicalTextureSize(tex) {
  if (!tex) return { w: 0, h: 0 };
  const t = /** @type {any} */ (tex);
  return {
    w: t._skinLogicalW ?? tex.width,
    h: t._skinLogicalH ?? tex.height,
  };
}

export const skin = new SkinManager();
