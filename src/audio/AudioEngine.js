// ─────────────────────────────────────────────
//  AudioEngine.js  –  Web Audio API wrapper
// ─────────────────────────────────────────────

export class AudioEngine {
  constructor() {
    /** @type {AudioContext} */
    this.ctx       = null;
    this._source   = null;    // current music source node
    this._buffer   = null;    // decoded AudioBuffer for the song
    this._gainNode = null;    // master volume
    this._startTime    = 0;   // AudioContext time when play() was called
    this._startOffset  = 0;   // offset in the audio we started from (seconds)
    this._playing  = false;
    this._playbackRate = 1;

    // Pre-loaded hit sound buffers keyed by name
    this._hitSoundBuffers = new Map();
  }

  // ── Initialisation ──────────────────────────

  /** Must be called from a user gesture (click / keydown) */
  async init() {
    if (this.ctx) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this._gainNode = this.ctx.createGain();
    this._gainNode.connect(this.ctx.destination);
  }

  /** Load the song from an ArrayBuffer (e.g. from File API or fetch) */
  async loadSong(arrayBuffer) {
    await this.init();
    this._buffer = await this.ctx.decodeAudioData(arrayBuffer);
  }

  /** Pre-load a hit sound from an ArrayBuffer and store under `name` */
  async loadHitSound(name, arrayBuffer) {
    await this.init();
    const buf = await this.ctx.decodeAudioData(arrayBuffer);
    this._hitSoundBuffers.set(name, buf);
  }

  // ── Playback ─────────────────────────────────

  /** Play / resume from `offsetMs` milliseconds into the song */
  play(offsetMs = 0) {
    if (!this._buffer) throw new Error('No song loaded. Call loadSong() first.');
    this._stopCurrentSource();

    const source = this.ctx.createBufferSource();
    source.buffer         = this._buffer;
    source.playbackRate.value = this._playbackRate;
    source.connect(this._gainNode);

    this._startOffset = Math.max(0, offsetMs / 1000);
    this._startTime   = this.ctx.currentTime;
    source.start(0, this._startOffset);

    this._source  = source;
    this._playing = true;

    source.onended = () => {
      if (this._playing) this._playing = false;
    };
  }

  pause() {
    if (!this._playing) return;
    this._stopCurrentSource();
  }

  resume() {
    if (this._playing) return;
    if (!this._buffer) return;   // no song loaded yet, silently do nothing
    this.play(this.currentTimeMs);
  }

  stop() {
    this._stopCurrentSource();
    this._startOffset = 0;
  }

  seek(ms) {
    const wasPlaying = this._playing;
    this._stopCurrentSource();
    if (wasPlaying) this.play(ms);
    else this._startOffset = ms / 1000;
  }

  // ── Hit sounds ──────────────────────────────

  /**
   * Schedule a hit sound to play at a precise AudioContext time.
   * @param {string} name     Key used in loadHitSound()
   * @param {number} atMs     Beatmap time in ms
   * @param {number} volume   0.0 – 1.0
   */
  scheduleHitSound(name, atMs, volume = 1) {
    const buf = this._hitSoundBuffers.get(name);
    if (!buf) return;

    const atAudioTime = this._startTime + (atMs / 1000 - this._startOffset) / this._playbackRate;
    if (atAudioTime < this.ctx.currentTime) return; // already passed

    const src  = this.ctx.createBufferSource();
    const gain = this.ctx.createGain();
    src.buffer = buf;
    gain.gain.value = volume;
    src.connect(gain);
    gain.connect(this._gainNode);
    src.start(atAudioTime);
  }

  /**
   * Play a hit sound immediately (fire-and-forget).
   * @param {string} name
   * @param {number} volume
   */
  playHitSoundNow(name, volume = 1) {
    const buf = this._hitSoundBuffers.get(name);
    if (!buf) return;
    const src  = this.ctx.createBufferSource();
    const gain = this.ctx.createGain();
    src.buffer      = buf;
    gain.gain.value = volume;
    src.connect(gain);
    gain.connect(this._gainNode);
    src.start();
  }

  // ── Properties ──────────────────────────────

  /** Current playback position in milliseconds */
  get currentTimeMs() {
    if (!this.ctx) return 0;
    if (!this._playing) return this._startOffset * 1000;
    return (this._startOffset + (this.ctx.currentTime - this._startTime) * this._playbackRate) * 1000;
  }

  get duration() {
    return this._buffer ? this._buffer.duration * 1000 : 0;
  }

  get isPlaying() {
    return this._playing;
  }

  /** Master volume 0.0 – 1.0 */
  set volume(v) {
    if (this._gainNode) this._gainNode.gain.value = Math.max(0, Math.min(1, v));
  }
  get volume() {
    return this._gainNode ? this._gainNode.gain.value : 1;
  }

  /** Playback speed (e.g. 0.75 for HT, 1.5 for DT) */
  set playbackRate(r) {
    this._playbackRate = r;
    if (this._source) this._source.playbackRate.value = r;
  }
  get playbackRate() {
    return this._playbackRate;
  }

  // ── Internals ────────────────────────────────

  _stopCurrentSource() {
    if (this._source) {
      try { this._source.stop(); } catch (_) {}
      this._source.disconnect();
      this._source  = null;
    }
    if (this._playing) {
      this._startOffset = Math.max(0,
        this._startOffset + (this.ctx.currentTime - this._startTime) * this._playbackRate
      );
    }
    this._playing = false;
  }

  dispose() {
    this.stop();
    if (this.ctx) this.ctx.close();
    this.ctx = null;
  }
}
