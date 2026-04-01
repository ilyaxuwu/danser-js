import { SOURCE_RANK } from './skinConstants.js';

/** @typedef {'SKIN' | 'FALLBACK' | 'LOCAL'} SkinSource */

/**
 * `hitcircle.png` → try `hitcircle@2x.png`, then `hitcircle.png`
 * @param {string} logicalPng — lower-case file name ending in .png
 */
export function getLogicalPngCandidates(logicalPng) {
  const ln = logicalPng.toLowerCase();
  if (!ln.endsWith('.png')) return [ln];
  const base = ln.replace(/\.png$/i, '');
  return [`${base}@2x.png`, `${base}.png`];
}

/**
 * @param {string} baseName — without extension, e.g. `sliderfollowcircle`
 * @param {boolean} useDash — `name-0` vs `name0`
 * @param {number} index
 */
export function frameFileName(baseName, useDash, index) {
  const b = baseName.replace(/\.png$/i, '');
  return useDash ? `${b}-${index}.png` : `${b}${index}.png`;
}

export function stripExtension(name) {
  return name.replace(/\.png$/i, '');
}

/**
 * @param {SkinSource | null | undefined} a
 * @param {SkinSource | null | undefined} b
 */
export function isSourceMoreSpecific(a, b) {
  const ra = a ? SOURCE_RANK[a] ?? 0 : 0;
  const rb = b ? SOURCE_RANK[b] ?? 0 : 0;
  return ra > rb;
}

/**
 * Caches resolved textures + metadata per logical name.
 */
export class TextureResolver {
  constructor() {
    /** @type {Map<string, { texture: *, source: SkinSource, logicalWidth: number, logicalHeight: number }>} */
    this.cache = new Map();
  }

  clear() {
    this.cache.clear();
  }

  /**
   * @param {string} logicalKey — canonical logical name lower-case `foo.png`
   */
  getCached(logicalKey) {
    return this.cache.get(logicalKey.toLowerCase()) ?? null;
  }

  /**
   * @param {string} logicalKey
   * @param {object} entry
   */
  setCached(logicalKey, entry) {
    this.cache.set(logicalKey.toLowerCase(), entry);
  }
}
