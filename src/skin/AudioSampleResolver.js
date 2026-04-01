/** @typedef {'SKIN' | 'FALLBACK' | 'LOCAL'} SkinSource */

/** Extension try order (osu! / danser-go style). */
export const AUDIO_EXT_ORDER = /** @type {const} */ (['.wav', '.ogg', '.mp3']);

/**
 * Logical base name like `normal-hitnormal` → first existing filename in layers.
 * @param {string} baseLower — e.g. `normal-hitnormal`
 * @param {(name: string) => boolean} existsInUnion
 * @param {{ preferSource?: SkinSource | null, layerHas?: (source: SkinSource, file: string) => boolean }} [opts]
 * @returns {{ file: string, source: SkinSource } | null}
 */
export function resolveAudioSample(
  baseLower,
  existsInUnion,
  opts = {},
) {
  const { preferSource, layerHas } = opts;

  const layerOrder = preferSource
    ? [preferSource, ...(['SKIN', 'FALLBACK', 'LOCAL'].filter((s) => s !== preferSource))]
    : ['SKIN', 'FALLBACK', 'LOCAL'];

  if (layerHas) {
    for (const src of layerOrder) {
      for (const ext of AUDIO_EXT_ORDER) {
        const file = `${baseLower}${ext}`;
        if (layerHas(src, file)) return { file, source: src };
      }
    }
    return null;
  }

  for (const ext of AUDIO_EXT_ORDER) {
    const file = `${baseLower}${ext}`;
    if (existsInUnion(file)) return { file, source: 'SKIN' };
  }
  return null;
}

/**
 * Hit sound flag → base name suffix (osu!).
 * @param {number} hitSoundFlag
 */
export function hitSoundFlagToSuffix(hitSoundFlag) {
  const f = hitSoundFlag | 0;
  if (f & 8) return 'hitclap';
  if (f & 4) return 'hitfinish';
  if (f & 2) return 'hitwhistle';
  return 'hitnormal';
}

/**
 * @param {string} sampleSet — normal | soft | drum
 * @param {number} hitSoundFlag
 */
export function primaryHitSoundBase(sampleSet, hitSoundFlag) {
  const set = (sampleSet ?? 'normal').toLowerCase();
  const suf = hitSoundFlagToSuffix(hitSoundFlag);
  return `${set}-${suf}`.toLowerCase();
}

/**
 * Ordered fallback sample sets when a sample is missing (osu! behaviour).
 * @param {string} sampleSet
 */
export function sampleSetFallbackChain(sampleSet) {
  const set = (sampleSet ?? 'normal').toLowerCase();
  const out = [set, 'normal', 'soft', 'drum'];
  return [...new Set(out)];
}

export class AudioSampleResolver {
  /**
   * @param {(name: string) => boolean} existsInUnion
   * @param {(source: SkinSource, file: string) => boolean} [layerHas]
   */
  constructor(existsInUnion, layerHas) {
    this.existsInUnion = existsInUnion;
    this.layerHas = layerHas;
  }

  /**
   * @param {string} sampleSet
   * @param {number} hitSoundFlag
   * @param {{ anchorBase?: string | null }} [opts] — if set, prefer same source as anchor (e.g. hit300 → particle)
   */
  resolveHitSound(sampleSet, hitSoundFlag, opts = {}) {
    const suffix = hitSoundFlagToSuffix(hitSoundFlag);
    const chain = sampleSetFallbackChain(sampleSet);
    let preferSource = null;
    if (opts.anchorBase) {
      const a = resolveAudioSample(opts.anchorBase.toLowerCase(), this.existsInUnion, {
        layerHas: this.layerHas,
      });
      preferSource = a?.source ?? null;
    }

    for (const s of chain) {
      const base = `${s}-${suffix}`.toLowerCase();
      const hit = resolveAudioSample(base, this.existsInUnion, {
        preferSource: preferSource ?? undefined,
        layerHas: this.layerHas,
      });
      if (hit) return hit;
    }
    return null;
  }

  /** Slider tick / slide / whistle — timing sample names */
  resolveSliderComponent(sampleSet, kind) {
    const chain = sampleSetFallbackChain(sampleSet);
    const kinds = {
      tick: 'slidertick',
      slide: 'sliderslide',
      whistle: 'sliderwhistle',
    };
    const suf = kinds[kind] ?? 'sliderslide';
    for (const s of chain) {
      const base = `${s}-${suf}`.toLowerCase();
      const hit = resolveAudioSample(base, this.existsInUnion, {
        layerHas: this.layerHas,
      });
      if (hit) return hit;
    }
    return null;
  }
}
