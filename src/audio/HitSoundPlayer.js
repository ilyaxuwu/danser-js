// ─────────────────────────────────────────────
//  HitSoundPlayer.js  –  Schedule hit sounds
//  for all hit objects in a beatmap.
// ─────────────────────────────────────────────

const SOUND_MAP = {
  0: 'normal-hitnormal',
  2: 'normal-hitwhistle',
  4: 'normal-hitfinish',
  8: 'normal-hitclap',
};

export class HitSoundPlayer {
  /**
   * @param {import('../audio/AudioEngine.js').AudioEngine} audioEngine
   */
  constructor(audioEngine) {
    this.audio = audioEngine;
  }

  /**
   * Schedule all hit sounds for the beatmap.
   * Should be called right before play() starts.
   * @param {import('../parser/BeatmapParser.js').Beatmap} beatmap
   * @param {number} fromMs  Only schedule sounds at or after this time
   */
  scheduleAll(beatmap, fromMs = 0) {
    for (const obj of beatmap.hitObjects) {
      if (obj.time < fromMs) continue;

      const soundName = this._resolveSoundName(obj.hitSound);
      const tp = beatmap.getActiveTimingPointAt(obj.time);
      const volume = tp ? tp.volume / 100 : 1;

      this.audio.scheduleHitSound(soundName, obj.time, volume);

      // Also schedule the slider end / repeat sounds
      if (obj.objectType === 'slider') {
        this.audio.scheduleHitSound(soundName, obj.endTime, volume);
      }
    }
  }

  /** Immediately fire the sound for a hit object (for live preview) */
  playNow(hitObject, beatmap) {
    const soundName = this._resolveSoundName(hitObject.hitSound);
    const tp = beatmap.getActiveTimingPointAt(hitObject.time);
    const volume = tp ? tp.volume / 100 : 1;
    this.audio.playHitSoundNow(soundName, volume);
  }

  _resolveSoundName(hitSound) {
    if (hitSound & 8) return SOUND_MAP[8];
    if (hitSound & 4) return SOUND_MAP[4];
    if (hitSound & 2) return SOUND_MAP[2];
    return SOUND_MAP[0];
  }
}
