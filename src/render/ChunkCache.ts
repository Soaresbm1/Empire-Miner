/**
 * Cache de rendu du terrain par blocs de CHUNK×CHUNK tuiles.
 * Seules les tuiles modifiées (minage, exploration) sont repeintes.
 */
import { CHUNK, TILE } from '../core/constants';
import type { World } from '../sim/World';
import type { RGB } from './color';
import { paintTile } from './TilePainter';

interface Chunk {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  image: ImageData;
  dirty: Set<number> | null; // null = rien à faire
}

const SIZE = CHUNK * TILE;

export class ChunkCache {
  private readonly chunks = new Map<number, Chunk>();
  private readonly cols: number;
  private readonly rows: number;

  constructor(private readonly world: World) {
    this.cols = Math.ceil(world.w / CHUNK);
    this.rows = Math.ceil(world.h / CHUNK);
  }

  /** Répercute les tuiles modifiées dans la simulation. */
  sync(): void {
    for (const i of this.world.consumeDirty()) {
      const tx = i % this.world.w;
      const ty = (i / this.world.w) | 0;
      const key = ((ty / CHUNK) | 0) * this.cols + ((tx / CHUNK) | 0);
      const ch = this.chunks.get(key);
      if (!ch) continue; // sera peint entièrement à sa création
      (ch.dirty ??= new Set()).add(i);
    }
  }

  private build(cx: number, cy: number): Chunk {
    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext('2d')!;
    const image = ctx.createImageData(SIZE, SIZE);
    const ch: Chunk = { canvas, ctx, image, dirty: null };
    for (let ty = cy * CHUNK; ty < Math.min(this.world.h, (cy + 1) * CHUNK); ty++)
      for (let tx = cx * CHUNK; tx < Math.min(this.world.w, (cx + 1) * CHUNK); tx++) this.paint(ch, cx, cy, tx, ty);
    ctx.putImageData(image, 0, 0);
    return ch;
  }

  private paint(ch: Chunk, cx: number, cy: number, tx: number, ty: number): void {
    const data = ch.image.data;
    const ox = (tx - cx * CHUNK) * TILE;
    const oy = (ty - cy * CHUNK) * TILE;
    paintTile(this.world, tx, ty, (px: number, py: number, c: RGB) => {
      const o = ((oy + py) * SIZE + ox + px) * 4;
      data[o] = c[0];
      data[o + 1] = c[1];
      data[o + 2] = c[2];
      data[o + 3] = 255;
    });
  }

  private get(cx: number, cy: number): Chunk {
    const key = cy * this.cols + cx;
    let ch = this.chunks.get(key);
    if (!ch) {
      ch = this.build(cx, cy);
      this.chunks.set(key, ch);
    } else if (ch.dirty) {
      for (const i of ch.dirty) this.paint(ch, cx, cy, i % this.world.w, (i / this.world.w) | 0);
      ch.dirty = null;
      ch.ctx.putImageData(ch.image, 0, 0);
    }
    return ch;
  }

  /** Dessine les blocs visibles. `ctx` est déjà en coordonnées monde. */
  draw(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number): void {
    const cx0 = Math.max(0, Math.floor(x0 / SIZE));
    const cy0 = Math.max(0, Math.floor(y0 / SIZE));
    const cx1 = Math.min(this.cols - 1, Math.floor(x1 / SIZE));
    const cy1 = Math.min(this.rows - 1, Math.floor(y1 / SIZE));
    for (let cy = cy0; cy <= cy1; cy++)
      for (let cx = cx0; cx <= cx1; cx++) ctx.drawImage(this.get(cx, cy).canvas, cx * SIZE, cy * SIZE);
  }
}
