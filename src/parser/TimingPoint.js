// ─────────────────────────────────────────────
//  TimingPoint.js  –  BPM / SV / volume data
// ─────────────────────────────────────────────

export class TimingPoint {
  /**
   * @param {number} offset       Start time in ms
   * @param {number} beatLength   ms per beat (>0 = uninherited, <0 = inherited/SV multiplier)
   * @param {number} meter        Beats per measure
   * @param {number} sampleSet    0-3
   * @param {number} sampleIndex  0 = default
   * @param {number} volume       0–100
   * @param {boolean} uninherited True if this sets a new BPM
   * @param {number} effects      Kiai / omit barline flags
   */
  constructor({ offset, beatLength, meter, sampleSet, sampleIndex, volume, uninherited, effects }) {
    this.offset      = offset;
    this.beatLength  = beatLength;
    this.meter       = meter;
    this.sampleSet   = sampleSet;
    this.sampleIndex = sampleIndex;
    this.volume      = volume;
    this.uninherited = uninherited;
    this.effects     = effects;
  }

  /** BPM (only meaningful for uninherited points) */
  get bpm() {
    return this.uninherited ? 60_000 / this.beatLength : null;
  }

  /** Slider velocity multiplier (for inherited points, beatLength is negative) */
  get svMultiplier() {
    return this.uninherited ? 1 : -100 / this.beatLength;
  }

  get isKiai() {
    return (this.effects & 1) !== 0;
  }
}
