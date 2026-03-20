// ─────────────────────────────────────────────
//  BeatmapParser.js  –  Parses .osu file text
// ─────────────────────────────────────────────
import { HitCircle, Slider, Spinner, HitObjectType } from './HitObject.js';
import { TimingPoint } from './TimingPoint.js';

export class Beatmap {
  constructor() {
    // [General]
    this.audioFilename     = '';
    this.audioLeadIn       = 0;
    this.previewTime       = -1;
    this.countdown         = 0;
    this.sampleSet         = 'Normal';
    this.stackLeniency     = 0.7;
    this.mode              = 0;  // 0 = osu!standard

    // [Metadata]
    this.title             = '';
    this.titleUnicode      = '';
    this.artist            = '';
    this.artistUnicode     = '';
    this.creator           = '';
    this.version           = '';
    this.source            = '';
    this.tags              = [];
    this.beatmapID         = 0;
    this.beatmapSetID      = 0;

    // [Difficulty]
    this.hpDrainRate       = 5;
    this.circleSize        = 5;
    this.overallDifficulty = 5;
    this.approachRate      = 5;
    this.sliderMultiplier  = 1.4;
    this.sliderTickRate    = 1;

    // Parsed data
    this.timingPoints      = [];  // TimingPoint[]
    this.hitObjects        = [];  // HitObject[]
    this.colours           = [];  // combo colours [{r,g,b}]
  }

  /** Returns the uninherited timing point active at `time` */
  getTimingPointAt(time) {
    let last = this.timingPoints[0];
    for (const tp of this.timingPoints) {
      if (tp.offset > time) break;
      if (tp.uninherited) last = tp;
    }
    return last;
  }

  /** Returns the active timing point (inherited or uninherited) at `time` */
  getActiveTimingPointAt(time) {
    let last = this.timingPoints[0];
    for (const tp of this.timingPoints) {
      if (tp.offset > time) break;
      last = tp;
    }
    return last;
  }

  /** Circle radius in osu! pixels */
  get circleRadius() {
    return 54.4 - 4.48 * this.circleSize;
  }

  /** Approach rate preempt time in ms */
  get approachPreempt() {
    const ar = this.approachRate;
    if (ar < 5) return 1200 + 600 * (5 - ar) / 5;
    if (ar > 5) return 1200 - 750 * (ar - 5) / 5;
    return 1200;
  }

  get duration() {
    if (!this.hitObjects.length) return 0;
    return this.hitObjects[this.hitObjects.length - 1].time;
  }
}

// ─────────────────────────────────────────────

export class BeatmapParser {
  /**
   * Parse the raw text of a .osu file.
   * @param {string} raw  Full text content of the .osu file
   * @returns {Beatmap}
   */
  static parse(raw) {
    const lines   = raw.split(/\r?\n/);
    const beatmap = new Beatmap();
    let section   = '';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || line.startsWith('//')) continue;

      // Section header
      if (line.startsWith('[') && line.endsWith(']')) {
        section = line.slice(1, -1);
        continue;
      }

      switch (section) {
        case 'General':    BeatmapParser._parseGeneral(line, beatmap);    break;
        case 'Metadata':   BeatmapParser._parseMetadata(line, beatmap);   break;
        case 'Difficulty': BeatmapParser._parseDifficulty(line, beatmap); break;
        case 'TimingPoints': BeatmapParser._parseTimingPoint(line, beatmap); break;
        case 'HitObjects': BeatmapParser._parseHitObject(line, beatmap);  break;
        case 'Colours':    BeatmapParser._parseColour(line, beatmap);     break;
        default: break;
      }
    }

    BeatmapParser._finalizeSliders(beatmap);
    return beatmap;
  }

  // ── Sections ────────────────────────────────

  static _parseGeneral(line, beatmap) {
    const [key, ...rest] = line.split(':');
    const val = rest.join(':').trim();
    switch (key.trim()) {
      case 'AudioFilename':  beatmap.audioFilename  = val;          break;
      case 'AudioLeadIn':    beatmap.audioLeadIn    = parseInt(val); break;
      case 'PreviewTime':    beatmap.previewTime    = parseInt(val); break;
      case 'Countdown':      beatmap.countdown      = parseInt(val); break;
      case 'SampleSet':      beatmap.sampleSet      = val;           break;
      case 'StackLeniency':  beatmap.stackLeniency  = parseFloat(val); break;
      case 'Mode':           beatmap.mode           = parseInt(val); break;
    }
  }

  static _parseMetadata(line, beatmap) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) return;
    const key = line.slice(0, colonIdx).trim();
    const val = line.slice(colonIdx + 1).trim();
    switch (key) {
      case 'Title':          beatmap.title          = val; break;
      case 'TitleUnicode':   beatmap.titleUnicode   = val; break;
      case 'Artist':         beatmap.artist         = val; break;
      case 'ArtistUnicode':  beatmap.artistUnicode  = val; break;
      case 'Creator':        beatmap.creator        = val; break;
      case 'Version':        beatmap.version        = val; break;
      case 'Source':         beatmap.source         = val; break;
      case 'Tags':           beatmap.tags           = val.split(' '); break;
      case 'BeatmapID':      beatmap.beatmapID      = parseInt(val); break;
      case 'BeatmapSetID':   beatmap.beatmapSetID   = parseInt(val); break;
    }
  }

  static _parseDifficulty(line, beatmap) {
    const [key, val] = line.split(':').map(s => s.trim());
    switch (key) {
      case 'HPDrainRate':       beatmap.hpDrainRate       = parseFloat(val); break;
      case 'CircleSize':        beatmap.circleSize        = parseFloat(val); break;
      case 'OverallDifficulty': beatmap.overallDifficulty = parseFloat(val); break;
      case 'ApproachRate':      beatmap.approachRate      = parseFloat(val); break;
      case 'SliderMultiplier':  beatmap.sliderMultiplier  = parseFloat(val); break;
      case 'SliderTickRate':    beatmap.sliderTickRate    = parseFloat(val); break;
    }
  }

  static _parseTimingPoint(line, beatmap) {
    const p = line.split(',');
    if (p.length < 2) return;
    beatmap.timingPoints.push(new TimingPoint({
      offset:      parseFloat(p[0]),
      beatLength:  parseFloat(p[1]),
      meter:       parseInt(p[2]) || 4,
      sampleSet:   parseInt(p[3]) || 0,
      sampleIndex: parseInt(p[4]) || 0,
      volume:      parseInt(p[5]) || 100,
      uninherited: parseInt(p[6]) === 1,
      effects:     parseInt(p[7]) || 0,
    }));
  }

  static _parseHitObject(line, beatmap) {
    const p = line.split(',');
    if (p.length < 4) return;

    const x        = parseInt(p[0]);
    const y        = parseInt(p[1]);
    const time     = parseInt(p[2]);
    const typeFlag = parseInt(p[3]);
    const hitSound = parseInt(p[4]) || 0;

    const newCombo   = !!(typeFlag & 4);
    const comboSkip  = (typeFlag >> 4) & 0x7;   // 0–7 combos to skip
    const baseData = { x, y, time, type: typeFlag, hitSound, newCombo, comboSkip };

    if (typeFlag & HitObjectType.SPINNER) {
      beatmap.hitObjects.push(new Spinner({ ...baseData, endTime: parseInt(p[5]) }));
      return;
    }

    if (typeFlag & HitObjectType.SLIDER) {
      const curvePart  = p[5].split('|');
      const curveType  = curvePart[0];           // B, C, L, P
      const rawPoints  = curvePart.slice(1);
      const curvePoints = rawPoints.map(pt => {
        const [cx, cy] = pt.split(':').map(Number);
        return { x: cx, y: cy };
      });
      beatmap.hitObjects.push(new Slider({
        ...baseData,
        curveType,
        curvePoints: [{ x, y }, ...curvePoints],  // include head
        slides:      parseInt(p[6]) || 1,
        length:      parseFloat(p[7]) || 0,
      }));
      return;
    }

    // Default: circle
    beatmap.hitObjects.push(new HitCircle(baseData));
  }

  static _parseColour(line, beatmap) {
    const match = line.match(/Combo\d+\s*:\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (match) {
      beatmap.colours.push({ r: +match[1], g: +match[2], b: +match[3] });
    }
  }

  // ── Post-process sliders (compute endTime, endX, endY) ──

  static _finalizeSliders(beatmap) {
    for (const obj of beatmap.hitObjects) {
      if (obj.objectType !== 'slider') continue;

      const tp = beatmap.getTimingPointAt(obj.time);
      if (!tp) continue;

      const baseSV     = beatmap.sliderMultiplier;
      const activeTp   = beatmap.getActiveTimingPointAt(obj.time);
      const svMult     = activeTp.uninherited ? 1 : activeTp.svMultiplier;
      const pxPerBeat  = baseSV * 100 * svMult;
      const beatDuration = tp.beatLength;

      obj.duration = (obj.length / pxPerBeat) * beatDuration * obj.slides;
      obj.endTime  = Math.round(obj.time + obj.duration);

      // Approximate end position (last curve point, accounting for odd slides)
      const pts = obj.curvePoints;
      if (obj.slides % 2 === 0) {
        // even slides → ends at start
        obj.endX = obj.x;
        obj.endY = obj.y;
      } else {
        const last = pts[pts.length - 1];
        obj.endX = last.x;
        obj.endY = last.y;
      }
    }
  }
}
