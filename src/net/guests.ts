/**
 * Arrivée et départ d'un invité dans la partie de l'hôte. Ses affaires (sac, pioche, achats, position) sont gardées de côté
 * quand il part et lui sont rendues quand il revient avec le même identifiant d'invité.
 */
import { loadPersonal, personalOf, type PersonalSave } from '../save/save';
import type { GameState } from '../sim/GameState';

/** Fait entrer l'invité `guestId` (un emplacement libre, ou celui qu'il occupe déjà) ; renvoie son emplacement, -1 si la mine est pleine. */
export function joinGuest(g: GameState, guestId: string): number {
  let slot = g.presentSlots().find((s) => s !== 0 && g.guestIds[s] === guestId) ?? -1;
  if (slot < 0) {
    slot = g.addPlayer();
    if (slot < 0) return -1;
    g.guestIds[slot] = guestId;
    const kept = g.guestStash[guestId] as PersonalSave | undefined;
    if (kept) {
      g.withSlot(slot, () => loadPersonal(g, kept));
      delete g.guestStash[guestId];
    }
  }
  return slot;
}

/** L'invité de l'emplacement `slot` part : on garde ses affaires de côté et on libère sa place. */
export function dropGuest(g: GameState, slot: number): void {
  if (slot === 0 || !g.isPresent(slot)) return;
  const id = g.guestIds[slot];
  if (id) g.guestStash[id] = g.withSlot(slot, () => personalOf(g));
  g.removePlayer(slot);
}

/** Retire tous les invités encore présents dans une partie chargée (ils ne sont plus là) en gardant leurs affaires. */
export function releaseGuests(g: GameState): void {
  for (const slot of g.presentSlots()) if (slot !== g.local) dropGuest(g, slot);
}
