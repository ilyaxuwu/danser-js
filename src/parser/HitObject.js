// ─────────────────────────────────────────────
//  HitObject.js  –  Data models for osu! objects
// ─────────────────────────────────────────────

export const HitObjectType = {
  CIRCLE:  1,
  SLIDER:  2,
  SPINNER: 8,
};

export const HitSound = {
  NORMAL:  0,
  WHISTLE: 2,
  FINISH:  4,
  CLAP:    8,
};

// ── Base ──────────────────────────────────────
export class HitObject {
  constructor({ x, y, time, type, hitSound, newCombo, comboSkip }) {
    this.x         = x;
    this.y         = y;
    this.time      = time;       // ms
    this.type      = type;
    this.hitSound  = hitSound;
    this.newCombo  = !!newCombo;          // true = first note of new combo
    this.comboSkip = comboSkip ?? 0;      // 0-7 extra colour skips
  }

  get position() {
    return { x: this.x, y: this.y };
  }
}

// ── Circle ────────────────────────────────────
export class HitCircle extends HitObject {
  constructor(data) {
    super(data);
    this.objectType = 'circle';
  }
}

// ── Slider ────────────────────────────────────
export class Slider extends HitObject {
  constructor(data) {
    super(data);
    this.objectType   = 'slider';
    this.curveType    = data.curveType;    // B, C, L, P
    this.curvePoints  = data.curvePoints;  // [{x,y}, ...]
    this.slides       = data.slides;       // repeat count
    this.length       = data.length;       // px
    this.duration     = 0;                 // filled in by parser
    this.endTime      = 0;                 // filled in by parser
    this.endX         = 0;
    this.endY         = 0;
    this.ticks        = [];  // [{time, x, y}]
    this.repeats      = [];  // [{time, x, y}]
  }
}

// ── Dummy Circle (Exploded Slider Parts / 2B) ─
export class DummyCircle extends HitCircle {
  constructor(data) {
    super(data);
    this._isSliderDummy = true;
    this._isStart = !!data._isStart;
    this._isEnd = !!data._isEnd;
    this.sliderPoint = data.sliderPoint !== false;
    this.sliderPointStart = !!data.sliderPointStart;
    this.sliderPointEnd = !!data.sliderPointEnd;
    this.endAngle = data.endAngle;
  }
}

// ── Spinner ───────────────────────────────────
export class Spinner extends HitObject {
  constructor(data) {
    super(data);
    this.objectType = 'spinner';
    this.endTime    = data.endTime;
    this.duration   = data.endTime - data.time;
  }
}
