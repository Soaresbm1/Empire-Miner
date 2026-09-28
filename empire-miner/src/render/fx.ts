/** Particules et textes flottants (purement visuels). */

export type ParticleKind = 'chip' | 'dust' | 'spark' | 'smoke' | 'glint';

export interface Particle {
  kind: ParticleKind;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  max: number;
  size: number;
  color: string;
}

export interface FloatingText {
  text: string;
  x: number;
  y: number;
  life: number;
  max: number;
  color: string;
}

export class Fx {
  particles: Particle[] = [];
  texts: FloatingText[] = [];
  shake = 0;

  emit(kind: ParticleKind, x: number, y: number, color: string, n: number, speed = 40): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = speed * (0.3 + Math.random() * 0.7);
      const life = kind === 'spark' ? 0.25 + Math.random() * 0.2 : kind === 'dust' ? 0.5 + Math.random() * 0.4 : kind === 'smoke' ? 1.2 + Math.random() * 0.8 : 0.6 + Math.random() * 0.5;
      this.particles.push({
        kind,
        x,
        y,
        z: kind === 'chip' ? 4 : 0,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp * (kind === 'smoke' ? 0.2 : 1),
        vz: kind === 'chip' ? 40 + Math.random() * 60 : 0,
        life,
        max: life,
        size: kind === 'dust' ? 2 + Math.random() * 2 : kind === 'smoke' ? 2 + Math.random() * 1.5 : kind === 'glint' ? 1 : Math.random() < 0.3 ? 2 : 1,
        color,
      });
    }
  }

  text(text: string, x: number, y: number, color = '#fff'): void {
    this.texts.push({ text, x, y, life: 1.3, max: 1.3, color });
  }

  update(dt: number): void {
    for (const p of this.particles) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const drag = Math.exp(-(p.kind === 'spark' ? 3 : 4) * dt);
      p.vx *= drag;
      p.vy *= drag;
      if (p.kind === 'chip') {
        p.vz -= 300 * dt;
        p.z += p.vz * dt;
        if (p.z < 0) {
          p.z = 0;
          p.vz = -p.vz * 0.3;
          p.vx *= 0.5;
          p.vy *= 0.5;
        }
      } else if (p.kind === 'smoke') {
        p.z += 9 * dt;
        p.size += dt * 1.5;
      } else if (p.kind === 'dust') {
        p.size += dt * 3;
      }
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    for (const t of this.texts) {
      t.life -= dt;
      t.y -= 14 * dt;
    }
    this.texts = this.texts.filter((t) => t.life > 0);
    this.shake = Math.max(0, this.shake - dt * 12);
  }
}
