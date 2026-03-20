// ─────────────────────────────────────────────
//  Config.js  –  Persistent settings manager
//
//  Saves to localStorage as JSON. Provides
//  export/import of config.json for portability.
// ─────────────────────────────────────────────

export const DEFAULTS = {
  osu: {
    songsPath: 'C:\\Users\\PC\\AppData\\Local\\osu!\\Songs',
    skinsPath:  'C:\\Users\\PC\\AppData\\Local\\osu!\\Skins',
    activeSkin: 'Default',
  },
  dance: {
    // ── Flower mover settings ──────────────────
    petAngle:       0.45,   // base petal arc angle (radians)
    angleRandom:    0.20,   // randomness ± added to petAngle each move
    longJump:       true,   // enable dramatic arc on long distances
    longJumpDist:   250,    // osu!px distance threshold for long jump
    longJumpAngle:  1.80,   // arc angle used for long jumps (radians)
    streamAngle:    0.20,   // smaller angle used during streams
    streamThresh:   110,    // ms gap below which stream mode activates
    zigzag:         true,   // alternate petal L/R direction every move
    sliderDance:    false,  // weave through slider ticks
    // ── Spinner ────────────────────────────────
    spinnerRPM:     477,
    spinnerArms:    5,
    spinnerOuter:   90,
    spinnerInner:   38,
  },
  audio: {
    masterVolume:   0.8,
    musicVolume:    1.0,
    hitsoundVolume: 0.5,
    playbackRate:   1.0,   // 0.75 = HT, 1.5 = DT
  },
  cursor: {
    size:        8,
    color:       '#ffffff',
    trailLength: 120,
    trailColor:  '#ff66aa',
    trailAlpha:  0.95,
  },
  display: {
    hitObjectOpacity:  0.45,
    approachCircles:   true,
    sliderBodyColor:   '#7777ff',
    spinnerColor:      '#ff66aa',
    backgroundColor:   '#000000',
  },
};

const LS_KEY = 'danser-js:config';

export class Config {
  constructor() {
    this._data = structuredClone(DEFAULTS);
    this.load();
  }

  /** Deep-get: config.get('audio.masterVolume') */
  get(path) {
    return path.split('.').reduce((o, k) => o?.[k], this._data);
  }

  /** Deep-set: config.set('audio.masterVolume', 0.5) */
  set(path, value) {
    const keys = path.split('.');
    let obj = this._data;
    for (let i = 0; i < keys.length - 1; i++) {
      obj = obj[keys[i]];
    }
    obj[keys[keys.length - 1]] = value;
    this.save();
  }

  /** Returns a shallow clone of a section */
  section(name) {
    return { ...this._data[name] };
  }

  /** Merge a full section at once */
  mergeSection(name, values) {
    Object.assign(this._data[name], values);
    this.save();
  }

  save() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(this._data));
    } catch (_) {}
  }

  load() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      this._data = this._deepMerge(DEFAULTS, saved);
    } catch (_) {
      this._data = structuredClone(DEFAULTS);
    }
  }

  /** Export current config as a downloadable config.json */
  exportJSON() {
    const blob = new Blob([JSON.stringify(this._data, null, 2)], { type: 'application/json' });
    const a    = document.createElement('a');
    a.href     = URL.createObjectURL(blob);
    a.download = 'config.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  /** Import config from a File object (.json) */
  async importJSON(file) {
    const text   = await file.text();
    const parsed = JSON.parse(text);
    this._data   = this._deepMerge(DEFAULTS, parsed);
    this.save();
  }

  /** Reset everything to defaults */
  reset() {
    this._data = structuredClone(DEFAULTS);
    this.save();
  }

  _deepMerge(base, override) {
    const result = structuredClone(base);
    for (const key of Object.keys(override)) {
      if (
        key in result &&
        typeof result[key] === 'object' &&
        !Array.isArray(result[key]) &&
        typeof override[key] === 'object'
      ) {
        result[key] = this._deepMerge(result[key], override[key]);
      } else {
        result[key] = override[key];
      }
    }
    return result;
  }
}

export const config = new Config();
