export class PPCalculator {
  /**
   * Calculate live PP based on current stats.
   * Based on danser-go/osu!standard PP formula (simplified for live use).
   */
  static calculate(beatmap, stats, sr = null) {
    if (!beatmap) return 0;

    const totalHits = (stats.count300 || 0) + (stats.count100 || 0) + (stats.count50 || 0) + (stats.countMiss || 0);
    if (totalHits === 0 && stats.combo === 0) return 0;

    // 1. Accuracy
    const acc = stats.accuracy / 100;
    
    // 2. Star Rating (SR) estimation if not provided
    // In a real scenario, SR should come from a difficulty calculator.
    // For live HUD without pre-calculated SR, we use a slightly better fallback.
    let starRating = sr || beatmap.starRating || 5.0;

    // 3. Aim Value
    let aimValue = Math.pow(5.0 * Math.max(1.0, starRating / 0.0675) - 4.0, 3.0) / 100000.0;
    
    // Length bonus
    const totalObjects = beatmap.hitObjects?.length || 1;
    let lengthBonus = 0.95 + 0.4 * Math.min(1.0, totalObjects / 2000.0);
    if (totalObjects > 2000) lengthBonus += Math.log10(totalObjects / 2000.0) * 0.5;
    aimValue *= lengthBonus;

    // Miss penalty
    if (stats.countMiss > 0) {
      aimValue *= 0.97 * Math.pow(1.0 - Math.pow(stats.countMiss / totalHits, 0.775), stats.countMiss);
    }

    // Combo scaling
    const maxCombo = beatmap.maxCombo || 1;
    aimValue *= Math.min(Math.pow(stats.combo, 0.8) / Math.pow(maxCombo, 0.8), 1.0);

    // AR Bonus (Simplified)
    const ar = beatmap.approachRate || 9;
    let arBonus = 0;
    if (ar > 10.33) arBonus += 0.3 * (ar - 10.33);
    else if (ar < 8.0) arBonus += 0.01 * (8.0 - ar);
    aimValue *= 1.0 + arBonus * lengthBonus;

    // Accuracy scaling for aim
    aimValue *= 0.5 + acc / 2.0;
    aimValue *= 0.98 + Math.pow(beatmap.overallDifficulty || 5, 2) / 2500;

    // 4. Speed Value
    let speedValue = Math.pow(5.0 * Math.max(1.0, starRating / 0.0675) - 4.0, 3.0) / 100000.0;
    speedValue *= lengthBonus;
    if (stats.countMiss > 0) {
      speedValue *= 0.97 * Math.pow(1.0 - Math.pow(stats.countMiss / totalHits, 0.775), Math.pow(stats.countMiss, 0.875));
    }
    speedValue *= Math.min(Math.pow(stats.combo, 0.8) / Math.pow(maxCombo, 0.8), 1.0);
    speedValue *= 1.0 + arBonus * lengthBonus;
    
    // Speed Acc scaling
    const od = beatmap.overallDifficulty || 5;
    speedValue *= (0.95 + Math.pow(od, 2) / 750) * Math.pow(acc, (14.5 - od) / 2);

    // 5. Accuracy Value
    let accValue = Math.pow(1.52163, od) * Math.pow(acc, 24) * 2.83;
    accValue *= Math.min(1.15, Math.pow(totalObjects / 1000, 0.3));

    // 6. Total PP
    const multiplier = 1.15; // PerformanceBaseMultiplier
    
    const totalPP = Math.pow(
      Math.pow(aimValue, 1.1) +
      Math.pow(speedValue, 1.1) +
      Math.pow(accValue, 1.1),
      1.0 / 1.1
    ) * multiplier;

    return Math.max(0, totalPP);
  }
}
