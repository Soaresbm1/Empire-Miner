/**
 * Empreinte de l'état de la simulation. En jeu à deux, les deux téléphones calculent la même partie ; toutes les
 * quelques secondes ils comparent leur empreinte, et la partie est resynchronisée si elles diffèrent.
 *
 * Elle couvre tout ce qui décide de la suite : monde, joueurs, structures, ouvriers, marché, tas au sol… Les angles de
 * visée (animation de la pioche) n'y sont pas : ils ne servent qu'au dessin.
 */
import { serialize } from '../save/save';
import type { GameState } from '../sim/GameState';

/** FNV-1a 32 bits sur des octets, des nombres ou des textes. */
export class Hasher {
  h = 0x811c9dc5;
  private readonly view = new DataView(new ArrayBuffer(8));

  byte(b: number): void {
    this.h = Math.imul(this.h ^ (b & 0xff), 0x01000193);
  }

  bytes(a: ArrayLike<number>): void {
    for (let i = 0; i < a.length; i++) this.h = Math.imul(this.h ^ (a[i] & 0xff), 0x01000193);
  }

  num(n: number): void {
    this.view.setFloat64(0, n);
    for (let i = 0; i < 8; i++) this.byte(this.view.getUint8(i));
  }

  str(s: string): void {
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      this.byte(c);
      this.byte(c >>> 8);
    }
    this.byte(0xff);
  }

  get value(): number {
    return this.h >>> 0;
  }
}

/** Empreinte de l'état de `g` (32 bits). Ne modifie rien (les joueurs sont parcourus dans l'ordre, quel que soit l'appareil). */
export function stateDigest(g: GameState): number {
  const h = new Hasher();
  const w = g.world;
  h.num(g.time);
  h.num(g.money);
  h.bytes(w.tiles);
  h.bytes(w.deposit);
  h.bytes(w.explored);
  h.bytes(new Uint8Array(w.gas.buffer, w.gas.byteOffset, w.gas.byteLength));
  h.bytes(new Uint8Array(w.water.buffer, w.water.byteOffset, w.water.byteLength));
  h.bytes(new Uint8Array(w.reserve.buffer, w.reserve.byteOffset, w.reserve.byteLength));
  // Tout le reste passe par le format de sauvegarde (la description complète de la partie), sans le monde ni l'heure d'écriture.
  const { savedAt: _savedAt, ...rest } = serialize(g, { world: false });
  h.str(JSON.stringify(rest));
  // Les joueurs, au bit près (la sauvegarde arrondit) : position, santé, sac.
  for (const slot of g.presentSlots()) {
    g.withSlot(slot, () => {
      const p = g.player;
      h.num(slot);
      h.num(p.x);
      h.num(p.y);
      h.num(p.facing);
      h.num(p.swingT);
      h.num(g.hp);
      h.str(JSON.stringify(g.inventory.items));
    });
  }
  return h.value;
}
