// ─────────────────────────────────────────────
//  BeatmapParser.js  –  Parses .osu file text
// ─────────────────────────────────────────────
import { SliderCurve } from './SliderCurve.js';
import { HitCircle, Slider, Spinner, HitObjectType, DummyCircle } from './HitObject.js';
import { TimingPoint } from './TimingPoint.js';

export class Beatmap {
  constructor() {
    this.audioFilename     = '';
    this.audioLeadIn       = 0;
    this.previewTime       = -1;
    this.countdown         = 0;
    this.sampleSet         = 'Normal';
    this.stackLeniency     = 0.7;
    this.mode              = 0;
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
    this.hpDrainRate       = 5;
    this.circleSize        = 5;
    this.overallDifficulty = 5;
    this.approachRate      = 5;
    
    this._baseHP = 5;
    this._baseCS = 5;
    this._baseOD = 5;
    this._baseAR = 5;

    this.sliderMultiplier  = 1.4;
    this.sliderTickRate    = 1;
    this.timingPoints      = [];
    this.hitObjects        = [];
    this.colours           = [];
  }

  getTimingPointAt(time) {
    let last = this.timingPoints[0];
    for (const tp of this.timingPoints) {
      if (tp.offset > time) break;
      if (tp.uninherited) last = tp;
    }
    return last;
  }

  getActiveTimingPointAt(time) {
    let last = this.timingPoints[0];
    for (const tp of this.timingPoints) {
      if (tp.offset > time) break;
      last = tp;
    }
    return last;
  }

  get circleRadius() {
    return 54.4 - 4.48 * this.circleSize;
  }

  get approachPreempt() {
    const ar = this.approachRate;
    let preempt = 1200;
    if (ar < 5) preempt = 1200 + 600 * (5 - ar) / 5;
    else if (ar > 5) preempt = 1200 - 750 * (ar - 5) / 5;
    
    if (this._clockRate) preempt /= this._clockRate;
    return preempt;
  }

  applyMods(mods) {
    this.mods = mods;
    const isHR = !!(mods & 16);
    const isEZ = !!(mods & 2);
    const isDT = !!(mods & 64) || !!(mods & 512);
    const isHT = !!(mods & 256);

    this._clockRate = isDT ? 1.5 : (isHT ? 0.75 : 1.0);

    // Reset to base
    this.approachRate      = this._baseAR;
    this.overallDifficulty = this._baseOD;
    this.circleSize        = this._baseCS;
    this.hpDrainRate       = this._baseHP;

    if (isHR) {
      this.approachRate      = Math.min(10, this.approachRate * 1.4);
      this.overallDifficulty = Math.min(10, this.overallDifficulty * 1.4);
      this.circleSize        = Math.min(10, this.circleSize * 1.3);
      this.hpDrainRate       = Math.min(10, this.hpDrainRate * 1.4);
    } else if (isEZ) {
      this.approachRate      *= 0.5;
      this.overallDifficulty *= 0.5;
      this.circleSize        *= 0.5;
      this.hpDrainRate       *= 0.5;
    }

    // HR Flipped Y logic
    for (const obj of this.hitObjects) {
      const flip = (y) => isHR ? 384 - y : y;
      obj.y = flip(obj._y);
      if (obj.endY !== undefined) obj.endY = flip(obj._endY);
      if (obj.curvePoints && obj._curvePointsY) {
        for (let i = 0; i < obj.curvePoints.length; i++) {
          obj.curvePoints[i].y = flip(obj._curvePointsY[i]);
        }
      }
      if (obj.ticks && obj._ticksY) {
        for (let i = 0; i < obj.ticks.length; i++) {
          obj.ticks[i].y = flip(obj._ticksY[i]);
        }
      }
      if (obj.repeats && obj._repeatsY) {
        for (let i = 0; i < obj.repeats.length; i++) {
          obj.repeats[i].y = flip(obj._repeatsY[i]);
        }
      }
    }
  }

  get duration() {
    if (!this.hitObjects.length) return 0;
    return (this.hitObjects[this.hitObjects.length - 1].endTime || this.hitObjects[this.hitObjects.length - 1].time) / (this._clockRate || 1);
  }

  get maxCombo() {
    return this.hitObjects.length; // Already exploded
  }

  // 100% Parity Explosion (Slider Explosion + 2B Resolution)
  explode() {
    let queue = [...this.hitObjects];

    // 1. Slider & Spinner Explosion
    const exploded = [];
    for (const obj of queue) {
      if (obj.objectType === 'slider') {
        const curve = SliderCurve.compute(obj.curveType, obj.curvePoints, obj.length);
        const steps = [];

        // Head
        steps.push(new DummyCircle({ ...obj, _isStart: true, endAngle: SliderCurve.startAngle(curve) }));

        const dur = obj.duration;
        const span = dur / obj.slides;

        for (let rep = 0; rep < obj.slides; rep++) {
          const rev = rep % 2 === 1;

          // Ticks
          for (const t of obj.ticks) {
            const relTime = t.time - obj.time;
            if (relTime > rep * span && relTime < (rep + 1) * span) {
              const tLen = (relTime - rep * span) / span;
              const normT = rev ? 1 - tLen : tLen;
              const ang = SliderCurve.tangentAngleAt(curve, normT);
              steps.push(new DummyCircle({ ...obj, time: t.time, x: t.x, y: t.y, endAngle: rev ? ang + Math.PI : ang }));
            }
          }

          // Repeat / Tail
          const time = obj.time + (rep + 1) * span;
          const tEnd = (rep + 1) % 2;
          const p = SliderCurve.positionAt(curve, tEnd);
          const ang = SliderCurve.tangentAngleAt(curve, tEnd);
          steps.push(new DummyCircle({
            ...obj, time: Math.round(time), x: p.x, y: p.y,
            endAngle: (tEnd === 0) ? ang : ang + Math.PI,
            _isEnd: (rep === obj.slides - 1)
          }));
        }
        exploded.push(...steps);
      } else {
        exploded.push(obj);
      }
    }
    queue = exploded.sort((a, b) => a.time - b.time);

    // 2. 2B Resolution: Double Tap Merge (danser-go generic.go parity)
    const radius = this.circleRadius;
    const finalQueue = [];
    for (let i = 0; i < queue.length; i++) {
      const cur = queue[i];
      const next = queue[i + 1];

      if (next && Math.abs(next.time - cur.time) <= 3) {
        const dx = next.x - cur.x;
        const dy = next.y - cur.y;
        if (Math.sqrt(dx * dx + dy * dy) <= radius * 2) {
          // Merge into double-click circle
          cur.doubleClick = true;
          cur.time = Math.round((cur.time + next.time) / 2);
          finalQueue.push(cur);
          i++; // Skip next
          continue;
        }
      }
      finalQueue.push(cur);
    }

    // 3. 2B Resolution: Spread overlaps (ensure distinct processing order)
    for (let i = 0; i < finalQueue.length - 1; i++) {
      const cur = finalQueue[i];
      const next = finalQueue[i + 1];
      if (cur.time >= next.time) {
        next.time = cur.time + 1; // 1ms offset parity
      }
    }

    this.hitObjects = finalQueue.sort((a, b) => a.time - b.time);
  }
}

export class BeatmapParser {
  static parse(raw) {
    const lines   = raw.split(/\r?\n/);
    const beatmap = new Beatmap();
    let section   = '';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || line.startsWith('//')) continue;
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
      }
    }
    // Store original Y for HR flip
    for (const obj of beatmap.hitObjects) {
      obj._y = obj.y;
      if (obj.curvePoints) obj._curvePointsY = obj.curvePoints.map(p => p.y);
      if (obj.ticks) obj._ticksY = obj.ticks.map(t => t.y);
      if (obj.repeats) obj._repeatsY = obj.repeats.map(r => r.y);
      if (obj.endY !== undefined) obj._endY = obj.endY;
    }
    BeatmapParser._finalizeSliders(beatmap);
    return beatmap;
  }

  static _parseGeneral(line, beatmap) {
    const [key, ...rest] = line.split(':');
    const val = rest.join(':').trim();
    switch (key.trim()) {
      case 'AudioFilename': beatmap.audioFilename = val; break;
      case 'AudioLeadIn':   beatmap.audioLeadIn   = parseInt(val); break;
      case 'PreviewTime':   beatmap.previewTime   = parseInt(val); break;
      case 'Countdown':     beatmap.countdown     = parseInt(val); break;
      case 'SampleSet':     beatmap.sampleSet     = val; break;
      case 'StackLeniency': beatmap.stackLeniency = parseFloat(val); break;
      case 'Mode':          beatmap.mode          = parseInt(val); break;
    }
  }

  static _parseMetadata(line, beatmap) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) return;
    const key = line.slice(0, colonIdx).trim();
    const val = line.slice(colonIdx + 1).trim();
    switch (key) {
      case 'Title':         beatmap.title = val; break;
      case 'TitleUnicode':  beatmap.titleUnicode = val; break;
      case 'Artist':        beatmap.artist = val; break;
      case 'ArtistUnicode': beatmap.artistUnicode = val; break;
      case 'Creator':       beatmap.creator = val; break;
      case 'Version':       beatmap.version = val; break;
      case 'Source':        beatmap.source = val; break;
      case 'Tags':          beatmap.tags = val.split(' '); break;
      case 'BeatmapID':     beatmap.beatmapID = parseInt(val); break;
      case 'BeatmapSetID':  beatmap.beatmapSetID = parseInt(val); break;
    }
  }

  static _parseDifficulty(line, beatmap) {
    const [key, val] = line.split(':').map(s => s.trim());
    const n = parseFloat(val);
    switch (key) {
      case 'HPDrainRate':       beatmap.hpDrainRate = beatmap._baseHP = n; break;
      case 'CircleSize':        beatmap.circleSize  = beatmap._baseCS = n; break;
      case 'OverallDifficulty': beatmap.overallDifficulty = beatmap._baseOD = n; break;
      case 'ApproachRate':      beatmap.approachRate = beatmap._baseAR = n; break;
      case 'SliderMultiplier':  beatmap.sliderMultiplier = n; break;
      case 'SliderTickRate':    beatmap.sliderTickRate = n; break;
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
    const x = parseInt(p[0]), y = parseInt(p[1]), time = parseInt(p[2]);
    const typeFlag = parseInt(p[3]), hitSound = parseInt(p[4]) || 0;
    const newCombo = !!(typeFlag & 4), comboSkip = (typeFlag >> 4) & 0x7;
    const baseData = { x, y, time, type: typeFlag, hitSound, newCombo, comboSkip };

    if (typeFlag & HitObjectType.SPINNER) {
      beatmap.hitObjects.push(new Spinner({ ...baseData, endTime: parseInt(p[5]) }));
      return;
    }
    if (typeFlag & HitObjectType.SLIDER) {
      const curvePart = p[5].split('|'), curveType = curvePart[0];
      const curvePoints = curvePart.slice(1).map(pt => {
        const [cx, cy] = pt.split(':').map(Number);
        return { x: cx, y: cy };
      });
      beatmap.hitObjects.push(new Slider({
        ...baseData, curveType, curvePoints: [{ x, y }, ...curvePoints],
        slides: parseInt(p[6]) || 1, length: parseFloat(p[7]) || 0,
      }));
      return;
    }
    beatmap.hitObjects.push(new HitCircle(baseData));
  }

  static _parseColour(line, beatmap) {
    const match = line.match(/Combo\d+\s*:\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (match) beatmap.colours.push({ r: +match[1], g: +match[2], b: +match[3] });
  }

  static _finalizeSliders(beatmap) {
    for (const obj of beatmap.hitObjects) {
      if (obj.objectType !== 'slider') continue;
      const tp = beatmap.getTimingPointAt(obj.time);
      if (!tp) continue;
      const baseSV = beatmap.sliderMultiplier;
      const activeTp = beatmap.getActiveTimingPointAt(obj.time);
      const svMult = activeTp.uninherited ? 1 : activeTp.svMultiplier;
      const pxPerBeat = baseSV * 100 * svMult;
      const beatDuration = tp.beatLength;
      obj.duration = (obj.length / pxPerBeat) * beatDuration * obj.slides;
      obj.endTime = Math.round(obj.time + obj.duration);

      const curve = SliderCurve.compute(obj.curveType, obj.curvePoints, obj.length);
      obj.ticks = [];
      obj.repeats = [];

      for (let i = 1; i < obj.slides; i++) {
        const time = obj.time + (obj.duration / obj.slides) * i;
        const pos = SliderCurve.positionAt(curve, i % 2 === 0 ? 0 : 1);
        obj.repeats.push({ time, ...pos });
      }

      const slides = Math.max(1, obj.slides);
      const spanDuration = obj.duration / slides;
      const velocityPxPerMs = pxPerBeat / Math.max(1, beatDuration);
      const minDistanceFromEnd = velocityPxPerMs * 10;
      let tickDistance = pxPerBeat / Math.max(1, beatmap.sliderTickRate);
      if (obj.length > 0 && tickDistance > obj.length) {
        tickDistance = obj.length;
      }

      for (let span = 0; span < slides; span++) {
        const reversed = span % 2 === 1;
        for (let d = tickDistance; d < obj.length; d += tickDistance) {
          if (d >= obj.length - minDistanceFromEnd) break;
          const curveT = reversed ? 1 - d / obj.length : d / obj.length;
          const time = obj.time + spanDuration * (span + d / obj.length);
          const pos = SliderCurve.positionAt(curve, curveT);
          obj.ticks.push({ time: Math.round(time), ...pos });
        }
      }

      const finalPos = SliderCurve.positionAt(curve, obj.slides % 2 === 0 ? 0 : 1);
      obj.endX = finalPos.x; obj.endY = finalPos.y;
    }
  }
}
