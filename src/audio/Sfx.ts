/**
 * Effets sonores synthétisés avec la Web Audio API (aucun fichier audio).
 * L'AudioContext n'est créé qu'après une interaction de l'utilisateur.
 */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private ambient: { gain: GainNode; filter: BiquadFilterNode } | null = null;
  muted = false;
  private lastPickup = 0;

  /** À appeler depuis un gestionnaire d'événement utilisateur. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5;
    this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.startAmbient();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.5, this.ctx.currentTime, 0.05);
  }

  /** Ambiance souterraine : grondement filtré dont le volume suit la profondeur. */
  setDepth(depth: number): void {
    if (!this.ambient || !this.ctx) return;
    const v = depth <= 0 ? 0 : Math.min(0.09, 0.03 + depth / 5000);
    this.ambient.gain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.5);
    this.ambient.filter.frequency.setTargetAtTime(depth > 150 ? 110 : 160, this.ctx.currentTime, 1);
  }

  private startAmbient(): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 160;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(filter).connect(gain).connect(this.master!);
    src.start();
    this.ambient = { gain, filter };
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, slideTo?: number, delay = 0): void {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private noise(dur: number, freq: number, q: number, vol: number, type: BiquadFilterType = 'bandpass', delay = 0): void {
    if (!this.ctx || !this.master || !this.noiseBuf) return;
    const t = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  swing(): void {
    this.noise(0.12, 900, 0.8, 0.05, 'bandpass');
  }

  /** Marteau-piqueur : rafale de chocs secs et grondement du moteur. */
  hammer(): void {
    for (let i = 0; i < 3; i++) {
      this.noise(0.035, 1500 + Math.random() * 600, 2, 0.16, 'bandpass', i * 0.045);
      this.tone(120 + Math.random() * 30, 0.03, 'square', 0.05, 80, i * 0.045);
    }
    this.noise(0.15, 260, 0.8, 0.08, 'lowpass');
  }

  /** Coup de pioche : plus aigu sur les roches dures. */
  hit(hardness: number): void {
    const f = 700 + hardness * 180 + Math.random() * 120;
    this.tone(f, 0.08, 'triangle', 0.18, f * 0.6);
    this.noise(0.09, 1800 + hardness * 300, 1.2, 0.35);
    this.tone(90, 0.07, 'sine', 0.25, 50);
  }

  break(): void {
    this.noise(0.35, 500, 0.7, 0.5, 'lowpass');
    this.noise(0.2, 1400, 1, 0.25);
    this.tone(70, 0.25, 'sine', 0.4, 35);
    for (let i = 0; i < 4; i++) this.noise(0.05, 2500, 3, 0.12, 'bandpass', 0.08 + i * 0.05 + Math.random() * 0.04);
  }

  denied(): void {
    this.tone(1900, 0.12, 'square', 0.08, 1500);
    this.tone(2600, 0.1, 'square', 0.05, 2000, 0.02);
    this.noise(0.08, 4000, 4, 0.2);
  }

  pickup(): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    if (now - this.lastPickup < 0.04) return;
    this.lastPickup = now;
    const f = 620 + Math.random() * 80;
    this.tone(f, 0.07, 'square', 0.06, f * 1.5);
  }

  sell(): void {
    [988, 1319, 1568].forEach((f, i) => this.tone(f, 0.18, 'square', 0.07, undefined, i * 0.07));
    this.noise(0.25, 6000, 2, 0.08, 'highpass', 0.05);
  }

  /** Tintement discret de la vente automatique. */
  coins(): void {
    [1319, 1760].forEach((f, i) => this.tone(f, 0.12, 'triangle', 0.05, undefined, i * 0.06));
  }

  buy(): void {
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.22, 'triangle', 0.14, undefined, i * 0.08));
  }

  place(): void {
    this.tone(160, 0.12, 'square', 0.12, 80);
    this.noise(0.1, 600, 1, 0.25, 'lowpass');
  }

  remove(): void {
    this.tone(300, 0.12, 'square', 0.1, 150);
  }

  error(): void {
    this.tone(220, 0.15, 'sawtooth', 0.08, 160);
  }

  /** Corde de rappel : crissement du mousqueton au départ, claquement quand elle lâche, souffle à l'arrivée. */
  rope(phase: 'start' | 'cancel' | 'up' | 'down'): void {
    if (phase === 'start') {
      this.tone(900, 0.05, 'square', 0.05);
      this.tone(1350, 0.06, 'square', 0.04, undefined, 0.07);
      this.noise(0.5, 1800, 3, 0.04, 'bandpass', 0.1);
    } else if (phase === 'cancel') {
      this.tone(300, 0.14, 'sawtooth', 0.06, 130);
      this.noise(0.1, 700, 1, 0.08);
    } else {
      // Le tirage de corde : un souffle qui monte (remontée) ou qui tombe (descente), puis un toc.
      const up = phase === 'up';
      this.noise(0.4, up ? 700 : 1400, 0.8, 0.14, 'lowpass');
      this.tone(up ? 260 : 520, 0.35, 'triangle', 0.09, up ? 620 : 240);
      this.tone(180, 0.1, 'sine', 0.2, 90, 0.38);
    }
  }

  /** Trottinette : le moteur démarre (monter) ou s'éteint (descendre). */
  mount(on: boolean): void {
    if (on) {
      this.tone(150, 0.22, 'sawtooth', 0.06, 380);
      this.noise(0.14, 500, 1, 0.1, 'lowpass');
      this.tone(520, 0.05, 'square', 0.04, undefined, 0.16);
    } else {
      this.tone(330, 0.18, 'sawtooth', 0.05, 110);
      this.noise(0.08, 400, 1, 0.06, 'lowpass');
    }
  }

  click(): void {
    this.tone(880, 0.04, 'square', 0.05);
  }

  discover(): void {
    [784, 988, 1175, 1568].forEach((f, i) => this.tone(f, 0.3, 'triangle', 0.1, undefined, i * 0.1));
  }

  /** Blessure : choc sourd et petit cri de douleur synthétique. */
  hurt(): void {
    this.tone(180, 0.18, 'square', 0.12, 90);
    this.noise(0.12, 600, 1, 0.3, 'lowpass');
  }

  /** Plafond qui craque : grondement grave et craquements épars. */
  rumble(): void {
    this.noise(1.2, 120, 0.7, 0.45, 'lowpass');
    for (let i = 0; i < 5; i++) this.noise(0.06, 2200 + Math.random() * 800, 3, 0.18, 'bandpass', 0.15 + i * 0.18 + Math.random() * 0.1);
  }

  /** Éboulement : fracas de roches. */
  collapse(): void {
    this.noise(1.4, 200, 0.6, 0.8, 'lowpass');
    this.tone(55, 0.8, 'sine', 0.5, 30);
    for (let i = 0; i < 8; i++) this.noise(0.08, 900 + Math.random() * 1200, 2, 0.3, 'bandpass', i * 0.09 + Math.random() * 0.05);
  }

  /** Grisou qui s'échappe : sifflement. */
  gas(): void {
    this.noise(1.6, 3200, 0.9, 0.22, 'highpass');
  }

  /** Poche d'eau percée : jaillissement. */
  flood(): void {
    this.noise(1.1, 700, 0.8, 0.4, 'bandpass');
    for (let i = 0; i < 6; i++) this.tone(500 + Math.random() * 700, 0.07, 'sine', 0.06, 250, 0.1 + i * 0.12);
  }
}
