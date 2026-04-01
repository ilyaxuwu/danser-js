/**
 * Resolves osu! bitmap font texture names from skin.ini prefixes.
 */
export class BitmapFontResolver {
  /**
   * @param {{ hitCirclePrefix?: string, scorePrefix?: string, comboPrefix?: string }} ini
   */
  constructor(ini = {}) {
    this.hitCirclePrefix = ini.hitCirclePrefix ?? 'default';
    this.scorePrefix = ini.scorePrefix ?? 'score';
    this.comboPrefix = ini.comboPrefix ?? 'score';
  }

  /** @param {number} d 0–9 */
  digitFileHitCircle(d) {
    return `${this.hitCirclePrefix}-${d}.png`.toLowerCase();
  }

  /** @param {number} d 0–9 */
  digitFileScore(d) {
    return `${this.scorePrefix}-${d}.png`.toLowerCase();
  }

  /** @param {number} d 0–9 */
  digitFileCombo(d) {
    return `${this.comboPrefix}-${d}.png`.toLowerCase();
  }

  /**
   * @param {'hit' | 'score' | 'combo'} kind
   * @param {string} sym — 'comma' | 'dot' | 'percent' | 'x' | digit char
   */
  symbolFile(kind, sym) {
    const p =
      kind === 'hit'
        ? this.hitCirclePrefix
        : kind === 'score'
          ? this.scorePrefix
          : this.comboPrefix;
    return `${p}-${sym}.png`.toLowerCase();
  }

  /**
   * String → ordered list of texture base names (without path) for rendering.
   * @param {'hit' | 'score' | 'combo'} kind
   * @param {string} text
   */
  tokenize(kind, text) {
    const out = [];
    for (const ch of String(text)) {
      if (ch >= '0' && ch <= '9') {
        out.push(this._digit(kind, ch));
        continue;
      }
      if (ch === ',') {
        out.push(this.symbolFile(kind, 'comma'));
        continue;
      }
      if (ch === '.') {
        out.push(this.symbolFile(kind, 'dot'));
        continue;
      }
      if (ch === '%') {
        out.push(this.symbolFile(kind, 'percent'));
        continue;
      }
      if (ch.toLowerCase() === 'x') {
        out.push(this.symbolFile(kind, 'x'));
        continue;
      }
    }
    return out;
  }

  /** @param {'hit' | 'score' | 'combo'} kind */
  _digit(kind, ch) {
    const d = +ch;
    if (kind === 'hit') return this.digitFileHitCircle(d);
    if (kind === 'score') return this.digitFileScore(d);
    return this.digitFileCombo(d);
  }
}
