import * as PIXI from 'pixi.js';

export class KnockoutRenderer {
  constructor(app, manager, config, getTransform) {
    this.app = app;
    this.manager = manager;
    this.config = config;
    this.getTransform = getTransform;

    this.layer = new PIXI.Container();
    app.stage.addChild(this.layer);
    
    this.cursors = new Map(); // playerId -> { sprite, graphics, text, trails }
  }

  _o2s(x, y) {
    const { scale, offX, offY } = this.getTransform();
    return { sx: offX + x * scale, sy: offY + y * scale, scale };
  }

  update(now) {
    const players = this.manager.getPlayers();
    const trailLen = this.config.get('cursor.trailLength') ?? 120;
    
    for (const p of players) {
      if (!this.cursors.has(p.id)) {
        this._initCursorElements(p);
      }
      
      const elements = this.cursors.get(p.id);
      
      // If dead, fade out
      if (p.isDead) {
        const timeSinceDeath = now - p.deathTime;
        const fade = Math.max(0, 1 - timeSinceDeath / 1000);
        elements.container.alpha = fade;
        if (fade === 0) continue;
      }
      
      const pos = p.getPos(now);
      const { sx, sy } = this._o2s(pos.x, pos.y);
      
      elements.sprite.position.set(sx, sy);
      elements.text.position.set(sx, sy - 20);

      const tPts = elements.trails;
      if (tPts.length > 0) {
        const last = tPts[tPts.length - 1];
        const dx = sx-last.x, dy = sy-last.y;
        const d  = Math.sqrt(dx*dx+dy*dy);
        const sub = Math.min(4, Math.ceil(d/6));
        for (let s = 1; s < sub; s++) {
          const t = s/sub;
          tPts.push({x: last.x+dx*t, y: last.y+dy*t});
          if (tPts.length > trailLen) tPts.shift();
        }
      }
      tPts.push({x: sx, y: sy});
      if (tPts.length > trailLen) tPts.shift();
      
      this._drawTrail(elements.trailGfx, tPts, p.color);
    }
  }

  _drawTrail(gfx, tPts, color) {
    gfx.clear();
    if (tPts.length < 2) return;
    const alp = this.config.get('cursor.trailAlpha') ?? 0.8;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 1; i < tPts.length; i++) {
        const dx = tPts[i].x - tPts[i-1].x;
        const dy = tPts[i].y - tPts[i-1].y;
        if (dx*dx+dy*dy > 180*180) continue; // too far, skip line
        const f = i / tPts.length;
        gfx.lineStyle({
          width: pass === 0 ? 14*f : 4*f,
          color: color,
          alpha: pass === 0 ? alp*f*0.18 : alp*f*f,
          cap: PIXI.LINE_CAP.ROUND
        });
        gfx.moveTo(tPts[i-1].x, tPts[i-1].y);
        gfx.lineTo(tPts[i].x, tPts[i].y);
      }
    }
  }

  _initCursorElements(player) {
    const container = new PIXI.Container();
    
    // Trail
    const trailGfx = new PIXI.Graphics();
    container.addChild(trailGfx);
    
    // Fallback cursor shape tinted with player color
    const sprite = new PIXI.Graphics();
    const size = this.config.get('cursor.size') ?? 8;
    for (const { r, a } of [
      {r: size*4.0, a: 0.07}, {r: size*2.8, a: 0.13}, {r: size*1.9, a: 0.22},
    ]) {
      sprite.lineStyle(0); sprite.beginFill(player.color, a);
      sprite.drawCircle(0, 0, r); sprite.endFill();
    }
    sprite.lineStyle(0); sprite.beginFill(0xffffff, 1);
    sprite.drawCircle(0, 0, size * 0.55); sprite.endFill();
    sprite.lineStyle(1.5, player.color, 0.9);
    sprite.drawCircle(0, 0, size * 1.1);
    
    container.addChild(sprite);
    
    // Player Name Text
    const text = new PIXI.Text(player.name, {
      fontFamily: 'Arial',
      fontSize: 12,
      fill: player.color,
      stroke: 0x000000,
      strokeThickness: 3,
      fontWeight: 'bold'
    });
    text.anchor.set(0.5, 1);
    container.addChild(text);
    
    this.layer.addChild(container);
    
    this.cursors.set(player.id, {
      container,
      sprite,
      trailGfx,
      text,
      trails: []
    });
  }

  clear() {
    this.layer.removeChildren();
    this.cursors.clear();
  }
}
