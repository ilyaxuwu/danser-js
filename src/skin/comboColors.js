import { DEFAULT_OSU_COMBO_COLORS } from './skinConstants.js';

/**
 * Combo colour resolution (danser-go–style).
 *
 * @param {object} o
 * @param {boolean} o.useColorsFromSkin — skin.ini / renderer flag
 * @param {boolean} o.beatmapComboColorsActive — beatmap provides Combo colours
 * @param {number[]} o.comboSet — skin Combo1..Combo8 (parsed)
 * @param {number[]} o.comboSetHax — beatmap combo colours when override active
 * @param {number} o.comboIndex — 0-based colour index for this object
 * @param {number | null} [o.objectComboColor] — per-object override from editor
 * @param {number} [o.baseColor] — fallback tint
 */
export function getComboColor({
  useColorsFromSkin,
  beatmapComboColorsActive,
  comboSet,
  comboSetHax,
  comboIndex,
  objectComboColor,
  baseColor = 0xffffff,
}) {
  const idx = Math.max(0, comboIndex | 0);

  if (useColorsFromSkin) {
    const src = beatmapComboColorsActive && comboSetHax?.length
      ? comboSetHax
      : comboSet;
    if (src?.length) return src[idx % src.length];
  }

  if (objectComboColor != null) return objectComboColor;

  const fallback = comboSet?.length ? comboSet : DEFAULT_OSU_COMBO_COLORS;
  return fallback[idx % fallback.length] ?? baseColor;
}
