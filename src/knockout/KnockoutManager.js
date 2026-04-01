export class KnockoutManager {
  /**
   * Initializes the knockout manager with multiple parsed replays.
   * @param {Object} beatmap - The parsed beatmap
   * @param {Array} parsedReplays - Array of replays from ReplayParser
   */
  constructor(beatmap, parsedReplays) {
    this.beatmap = beatmap;
    
    // Assign random colors and initialize states for each replay
    this.players = parsedReplays.map((pr, index) => {
      const hue = (index * 137.5) % 360; // Golden angle for distributed colors
      const color = this.hslToHex(hue, 80, 60);
      
      return {
        id: index,
        name: pr.playerName,
        frames: pr.frames,
        color: color,
        isDead: false,
        deathTime: Infinity,
        score: 0,
        combo: 0,
        ...this._createInterpolator(pr.frames)
      };
    });

    // 50-hit window typical approximation (-+ 150ms)
    this.hitWindowSize = 150; 
    
    // Pre-calculate hit checking for optimization
    this.objectIndex = 0;
  }

  // Pre-bake an interpolator for fast pos lookup per player
  _createInterpolator(frames) {
    let lastSearchIndex = 0;
    return {
      getPos: (time) => {
        if (!frames || frames.length === 0) return {x: 256, y: 192, keys: 0};
        
        let l = 0, r = frames.length - 1;
        while (l <= r) {
          const m = (l + r) >> 1;
          if (frames[m].time === time) return frames[m];
          if (frames[m].time < time) l = m + 1;
          else r = m - 1;
        }
        
        const idx1 = Math.max(0, r);
        const idx2 = Math.min(frames.length - 1, l);
        if (idx1 === idx2) return frames[idx1];
        
        const f1 = frames[idx1];
        const f2 = frames[idx2];
        const dt = f2.time - f1.time;
        const tNorm = dt === 0 ? 0 : (time - f1.time) / dt;
        return {
          x: f1.x + (f2.x - f1.x) * tNorm,
          y: f1.y + (f2.y - f1.y) * tNorm,
          keys: f1.keys
        };
      }
    };
  }

  update(currentTime, circleRadius) {
    if (!this.beatmap || this.objectIndex >= this.beatmap.hitObjects.length) return;

    // Check if the current time has bypassed the current object's hit window
    const obj = this.beatmap.hitObjects[this.objectIndex];
    if (currentTime > obj.time + this.hitWindowSize) {
      
      // Evaluate all alive players for this object
      for (const p of this.players) {
        if (p.isDead) continue;
        
        // Very basic aim + click simulation check for the time window
        const hit = this._simulateHit(p, obj, circleRadius);
        if (!hit) {
          p.isDead = true;
          p.deathTime = currentTime;
          console.log(`[Knockout] ${p.name} missed at ${currentTime}ms and was knocked out.`);
        } else {
          p.combo++;
          p.score += 300 * p.combo;
        }
      }
      
      this.objectIndex++;
    }
  }

  _simulateHit(player, obj, radius) {
    // If it's a spinner, we assume they hit it if they were alive and moving
    if (obj.objectType === 'spinner') return true;

    // Scan the frames within the hit window 
    // This is a naive implementation: if there is ANY frame in the hit window with keys > 0 and distance <= radius, it's a hit!
    const startT = obj.time - this.hitWindowSize;
    const endT = obj.time + this.hitWindowSize;
    
    // Find frames
    const startIndex = player.frames.findIndex(f => f.time >= startT);
    if (startIndex === -1) return false;

    for (let i = startIndex; i < player.frames.length; i++) {
      const f = player.frames[i];
      if (f.time > endT) break;
      
      // Check distance
      const dx = f.x - obj.x;
      const dy = f.y - obj.y;
      const distSq = dx*dx + dy*dy;
      
      if (distSq <= Math.pow(radius + 5, 2) && f.keys > 0) {
        return true; 
      }
    }
    return false;
  }

  getAliveCount() {
    return this.players.filter(p => !p.isDead).length;
  }

  getPlayers() {
    return this.players;
  }

  hslToHex(h, s, l) {
    l /= 100;
    const a = s * Math.min(l, 1 - l) / 100;
    const f = n => {
      const k = (n + h / 30) % 12;
      const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
      return Math.round(255 * color).toString(16).padStart(2, '0');
    };
    return parseInt(`0x${f(0)}${f(8)}${f(4)}`, 16);
  }
}
