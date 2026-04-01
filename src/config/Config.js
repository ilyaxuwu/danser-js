export const DEFAULTS = {
  osu: {
    songsPath: 'C:\\Users\\PC\\AppData\\Local\\osu!\\Songs',
    skinsPath: 'C:\\Users\\PC\\AppData\\Local\\osu!\\Skins',
    activeSkin: 'Default',
  },
  dance: {
    angle:                     2.0,
    streamAngle:               0.5,
    streamMs:                  130,
    spinnerAngle:              2.4,
    zigzag:                    true,
    idleMs:                    2000,
    sliderDance:               true,
    sliderDanceAmplitude:      42,
    sliderEntryBehind:         true,
    sliderEntryBehindDistance: 96,
    sliderEntryBehindSplit:    0.68,
    sliderEntryConflictWindowMs: 100,
    sliderScoreSafe:           true,
    sliderTickLeadMs:          20,
    sliderTickStayMs:          20,
    sliderCriticalWindowMs:    28,
    sliderCriticalHoldMs:      100,
    samePositionDance:         true,
    samePositionRadius:        90,
    samePositionTurns:         1.0,
    twoBUseDummyCircles:       true,
    debugEnabled:              true,
    debugSkipNonDance:         true,
    debugNotifyOn2BRisk:       true,
    debugRiskDistancePx:       24,
    debugEvalWindowMs:         24,
    allowOutOfBounds:          true,
    smoothPath:                true,
    smoothPathTension:         0.35,
    longJumpDist:              130,
    longJumpMult:              1,
    spinnerRPM:                2000,
    spinnerArms:               5,
    spinnerOuter:              92,
    spinnerInner:              66,
  },
  audio: {
    masterVolume: 0.8,
    musicVolume: 1.0,
    hitsoundVolume: 0.5,
    playbackRate: 1.0,
  },
  cursor: {
    size: 8,
    color: '#ffffff',
    trailLength: 120,
    trailColor: '#ff66aa',
    trailAlpha: 0.95,
  },
  display: {
    hitObjectOpacity: 0.45,
    approachCircles: true,
    sliderBodyColor: '#7777ff',
    spinnerColor: '#ff66aa',
    backgroundColor: '#000000',
    motionBlurStrength: 1.5,
  },
  stats: {
    mockScore: 0,
    mockCombo: 0,
    mockAcc: 0,
    mockHP: 0,
  },
};

const LS_KEY = 'danser-js:config';

export class Config {
  constructor() {
    this._data = structuredClone(DEFAULTS);
    this.load();
  }

  get(path) {
    return path.split('.').reduce((o, k) => o?.[k], this._data);
  }

  set(path, value) {
    const keys = path.split('.');
    let obj = this._data;
    for (let i = 0; i < keys.length - 1; i++) {
      obj = obj[keys[i]];
    }
    obj[keys[keys.length - 1]] = value;
    this.save();
  }

  section(name) {
    return { ...this._data[name] };
  }

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

  exportJSON() {
    const blob = new Blob([JSON.stringify(this._data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'config.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async importJSON(file) {
    const text = await file.text();
    const parsed = JSON.parse(text);
    this._data = this._deepMerge(DEFAULTS, parsed);
    this.save();
  }

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
