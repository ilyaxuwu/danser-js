/** @typedef {'SKIN' | 'FALLBACK' | 'LOCAL'} SkinSource */

/** Priority: higher = more specific (danser-go style layering). */
export const SOURCE_RANK = /** @type {const} */ ({
  SKIN: 3,
  FALLBACK: 2,
  LOCAL: 1,
});

/** Default osu!-style skin.ini fallbacks (when key missing). */
export const SKIN_INI_DEFAULTS = {
  version: 2.7,
  animationFramerate: 60,
  layeredHitSounds: true,
  useColorsFromSkin: true,
  cursorCentre: true,
  cursorExpand: true,
  cursorRotate: false,
  defaultSkinFollowpointBehavior: 0,
  allowSliderBallTint: true,
  sliderBallFlip: true,
  sliderBorder: 0xffffff,
  sliderTrackOverride: null,
  sliderBall: null,
  hitCirclePrefix: 'default',
  hitCircleOverlap: -2,
  hitCircleOverlayAboveNumber: true,
  scorePrefix: 'score',
  scoreOverlap: 0,
  comboPrefix: 'score',
  comboOverlap: 0,
};

// Matches danser-go info.go newDefaultInfo() ComboColors exactly:
// color.NewIRGB(255,192,0), color.NewIRGB(0,202,0), color.NewIRGB(18,124,255), color.NewIRGB(242,24,57)
export const DEFAULT_OSU_COMBO_COLORS = Object.freeze([
  0xffc000, 0x00ca00, 0x127cff, 0xf21839,
]);
