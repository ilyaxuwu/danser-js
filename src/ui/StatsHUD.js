import * as PIXI from 'pixi.js';
import { config } from '../config/Config.js';

export class StatsHUD {
  constructor(app, getTransform) {
    this.app = app;
    this.getTransform = getTransform;
    this.container = new PIXI.Container();
    app.stage.addChild(this.container);

    this.score = 0;
    this.combo = 0;
    this.accuracy = 100;
    this.hp = 1.0; // 0 to 1

    this._setupHUD();
  }

  _setupHUD() {
    const style = new PIXI.TextStyle({
      fontFamily: 'Syne, sans-serif',
      fontSize: 24,
      fill: '#ffffff',
      fontWeight: '800',
      dropShadow: true,
      dropShadowColor: '#000000',
      dropShadowBlur: 4,
      dropShadowDistance: 2
    });

    this.scoreText = new PIXI.Text('000000000', { ...style, fontSize: 32 });
    this.comboText = new PIXI.Text('0x', { ...style, fontSize: 48 });
    this.accText   = new PIXI.Text('100.00%', { ...style, fontSize: 20 });
    this.ppText    = new PIXI.Text('0pp', { ...style, fontSize: 32, fill: '#ffcc00' }); // Gold for PP

    // Health Bar
    this.hpBg = new PIXI.Graphics();
    this.hpFill = new PIXI.Graphics();

    this.container.addChild(this.scoreText, this.comboText, this.accText, this.ppText, this.hpBg, this.hpFill);
  }

  update(stats) {
    // If config overrides are set, use them
    const mockScore = config.get('stats.mockScore');
    const mockCombo = config.get('stats.mockCombo');
    const mockAcc = config.get('stats.mockAcc');
    const mockHP = config.get('stats.mockHP');

    this.score = (mockScore > 0) ? mockScore : (stats.score ?? 0);
    this.combo = (mockCombo > 0) ? mockCombo : (stats.combo ?? 0);
    this.accuracy = (mockAcc > 0) ? mockAcc : (stats.accuracy ?? 100);
    this.hp = (mockHP > 0) ? mockHP : (stats.hp ?? 1.0);

    this.scoreText.text = String(Math.floor(this.score)).padStart(9, '0');
    this.comboText.text = `${this.combo}x`;
    this.accText.text   = `${this.accuracy.toFixed(2)}%`;
    this.ppText.text    = `${Math.floor(stats.pp || 0)}pp`;

    const { scale, offX, offY } = this.getTransform();
    const pw = this.app.screen.width;
    const ph = this.app.screen.height;

    // Position (Top Right)
    this.scoreText.position.set(pw - this.scoreText.width - 40, 20);
    this.accText.position.set(pw - this.accText.width - 40, 60);
    this.ppText.position.set(pw - this.ppText.width - 40, 95);

    // Position Combo (Bottom Left)
    this.comboText.position.set(40, ph - this.comboText.height - 40);

    // Position HP Bar (Top Leftish)
    const barW = 300 * scale;
    const barH = 12 * scale;
    const bx = 40, by = 40;

    this.hpBg.clear();
    this.hpBg.beginFill(0x000000, 0.5);
    this.hpBg.drawRect(bx, by, barW, barH);
    this.hpBg.endFill();

    this.hpFill.clear();
    this.hpFill.beginFill(0xff3d7f, 1);
    this.hpFill.drawRect(bx, by, barW * clamp(this.hp, 0, 1), barH);
    this.hpFill.endFill();
  }
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
