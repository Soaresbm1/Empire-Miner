/**
 * Décor animé des menus : poussières qui flottent et braises qui montent, en gros pixels.
 * Le nombre de grains dépend du réglage Qualité (0 : rien, pas de boucle d'animation).
 */
interface Mote {
  x: number;
  y: number;
  vx: number;
  vy: number;
  phase: number;
  ember: boolean;
}

const PIXEL = 3;

export class MenuFx {
  private motes: Mote[] = [];
  private running = false;
  private w = 0;
  private h = 0;
  private last = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {}

  /** Lance (ou arrête, si `count` vaut 0) l'animation avec ce nombre de grains. */
  start(count: number): void {
    const visible = count > 0;
    this.canvas.classList.toggle('hidden', !visible);
    if (!visible) {
      this.running = false;
      return;
    }
    this.resize();
    while (this.motes.length < count) this.motes.push(this.spawn(true));
    this.motes.length = count;
    if (!this.running) {
      this.running = true;
      this.last = performance.now();
      requestAnimationFrame((t) => this.frame(t));
    }
  }

  stop(): void {
    this.running = false;
    this.canvas.classList.add('hidden');
  }

  private resize(): void {
    this.w = Math.max(1, Math.ceil(window.innerWidth / PIXEL));
    this.h = Math.max(1, Math.ceil(window.innerHeight / PIXEL));
    this.canvas.width = this.w;
    this.canvas.height = this.h;
  }

  private spawn(anywhere: boolean): Mote {
    const ember = Math.random() < 0.4;
    return {
      x: Math.random() * this.w,
      y: anywhere ? Math.random() * this.h : this.h + 2,
      vx: (Math.random() - 0.5) * (ember ? 5 : 3),
      vy: -(ember ? 5 + Math.random() * 9 : 1 + Math.random() * 3),
      phase: Math.random() * 6.28,
      ember,
    };
  }

  private frame(t: number): void {
    if (!this.running) return;
    const dt = Math.min(0.1, (t - this.last) / 1000);
    this.last = t;
    if (this.canvas.width !== Math.ceil(window.innerWidth / PIXEL)) this.resize();
    const ctx = this.canvas.getContext('2d')!;
    ctx.clearRect(0, 0, this.w, this.h);
    this.motes.forEach((m, i) => {
      m.x += (m.vx + Math.sin(t / 900 + m.phase) * 2) * dt;
      m.y += m.vy * dt;
      if (m.y < -2 || m.x < -2 || m.x > this.w + 2) this.motes[i] = this.spawn(false);
      const tw = 0.55 + 0.45 * Math.sin(t / 240 + m.phase * 3);
      if (m.ember) {
        ctx.fillStyle = tw > 0.85 ? '#ffe28a' : tw > 0.5 ? '#ff9a30' : '#c8481c';
        ctx.fillRect(Math.round(m.x), Math.round(m.y), 1, 1);
        if (tw > 0.85) {
          ctx.fillStyle = 'rgba(255,150,50,0.35)';
          ctx.fillRect(Math.round(m.x) - 1, Math.round(m.y), 3, 1);
          ctx.fillRect(Math.round(m.x), Math.round(m.y) - 1, 1, 3);
        }
      } else {
        ctx.fillStyle = `rgba(230,215,190,${0.15 + tw * 0.3})`;
        ctx.fillRect(Math.round(m.x), Math.round(m.y), 1, 1);
      }
    });
    requestAnimationFrame((n) => this.frame(n));
  }
}
