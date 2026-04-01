import { SKIN_INI_DEFAULTS } from './skinConstants.js';

function parseBool(v, defaultVal) {
  if (v == null || v === '') return defaultVal;
  const s = String(v).trim().toLowerCase();
  if (s === '1' || s === 'true' || s === 'yes' || s === '-1') return true;
  if (s === '0' || s === 'false' || s === 'no') return false;
  return defaultVal;
}

function parseIntSafe(v, def) {
  const n = Number.parseInt(String(v ?? '').trim(), 10);
  return Number.isFinite(n) ? n : def;
}

function parseFloatSafe(v, def) {
  const n = Number.parseFloat(String(v ?? '').trim());
  return Number.isFinite(n) ? n : def;
}

function parseColorTriplet(value) {
  const parts = String(value ?? '').split(',').map((x) => Number.parseInt(x.trim(), 10));
  if (parts.length < 3 || parts.some((n) => Number.isNaN(n))) return null;
  return (parts[0] << 16) | (parts[1] << 8) | parts[2];
}

function parseVersion(val) {
  const s = String(val ?? '').trim().toLowerCase();
  if (s === 'latest') return 2.7;
  const n = parseFloatSafe(s, SKIN_INI_DEFAULTS.version);
  return Number.isFinite(n) ? n : SKIN_INI_DEFAULTS.version;
}

/**
 * Parse osu! skin.ini text into a structured object with defaults.
 * @param {string} text
 */
export function parseSkinIni(text) {
  /** @type {any} */
  const ini = {
    ...SKIN_INI_DEFAULTS,
    comboColors: /** @type {number[]} */ ([]),
  };

  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.replace(/\/\/.*$/, '').trim();
    if (!line || line.startsWith('[')) continue;

    const sep = line.indexOf(':');
    if (sep === -1) continue;

    const key = line.slice(0, sep).trim().toLowerCase();
    const val = line.slice(sep + 1).trim();

    if (/^combo\d+$/.test(key)) {
      const col = parseColorTriplet(val);
      if (col != null) ini.comboColors.push(col);
      continue;
    }

    switch (key) {
      case 'version':
        ini.version = parseVersion(val);
        break;
      case 'animationframerate':
        ini.animationFramerate = Math.max(1, parseIntSafe(val, SKIN_INI_DEFAULTS.animationFramerate));
        break;
      case 'layeredhitsounds':
        ini.layeredHitSounds = parseBool(val, SKIN_INI_DEFAULTS.layeredHitSounds);
        break;
      case 'usecolorsfromskin':
        ini.useColorsFromSkin = parseBool(val, SKIN_INI_DEFAULTS.useColorsFromSkin);
        break;
      case 'cursorcentre':
        ini.cursorCentre = parseBool(val, SKIN_INI_DEFAULTS.cursorCentre);
        break;
      case 'cursorexpand':
        ini.cursorExpand = parseBool(val, SKIN_INI_DEFAULTS.cursorExpand);
        break;
      case 'cursorrotate':
        ini.cursorRotate = parseBool(val, SKIN_INI_DEFAULTS.cursorRotate);
        break;
      case 'defaultskinfollowpointbehavior':
        ini.defaultSkinFollowpointBehavior = parseIntSafe(val, SKIN_INI_DEFAULTS.defaultSkinFollowpointBehavior);
        break;
      case 'allowsliderballtint':
        ini.allowSliderBallTint = parseBool(val, SKIN_INI_DEFAULTS.allowSliderBallTint);
        break;
      case 'sliderballflip':
        ini.sliderBallFlip = parseBool(val, SKIN_INI_DEFAULTS.sliderBallFlip);
        break;
      case 'sliderborder':
        ini.sliderBorder = parseColorTriplet(val) ?? SKIN_INI_DEFAULTS.sliderBorder;
        break;
      case 'slidertrackoverride':
        ini.sliderTrackOverride = parseColorTriplet(val);
        break;
      case 'sliderball':
        ini.sliderBall = parseColorTriplet(val);
        break;
      case 'hitcircleprefix':
        ini.hitCirclePrefix = val || SKIN_INI_DEFAULTS.hitCirclePrefix;
        break;
      case 'hitcircleoverlap':
        ini.hitCircleOverlap = parseIntSafe(val, SKIN_INI_DEFAULTS.hitCircleOverlap);
        break;
      case 'hitcircleoverlayabovenumber':
      case 'hitcircleoverlayabovenumer':
        ini.hitCircleOverlayAboveNumber = parseBool(val, SKIN_INI_DEFAULTS.hitCircleOverlayAboveNumber);
        break;
      case 'scoreprefix':
        ini.scorePrefix = val || SKIN_INI_DEFAULTS.scorePrefix;
        break;
      case 'scoreoverlap':
        ini.scoreOverlap = parseIntSafe(val, SKIN_INI_DEFAULTS.scoreOverlap);
        break;
      case 'comboprefix':
        ini.comboPrefix = val || SKIN_INI_DEFAULTS.comboPrefix;
        break;
      case 'combooverlap':
        ini.comboOverlap = parseIntSafe(val, SKIN_INI_DEFAULTS.comboOverlap);
        break;
      default:
        break;
    }
  }

  return ini;
}

export class SkinIniParser {
  /**
   * @param {string} text
   */
  static parse(text) {
    return parseSkinIni(text);
  }
}
