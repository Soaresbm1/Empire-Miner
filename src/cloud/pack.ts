/**
 * La sauvegarde telle qu'elle est gardée dans le compte : le texte JSON, compressé (deflate) puis en base64 — une dizaine de
 * Ko pour une partie avancée, bien en dessous de la limite d'un document Firestore (1 Mio). Même outil que l'instantané du
 * jeu à deux ; le préfixe dit si le texte est compressé (« z: ») ou non (« p: », navigateur sans compression).
 */
import { packSnapshot, unpackSnapshot } from '../net/snapshot';

export async function packSave(json: string): Promise<string> {
  const packed = await packSnapshot(json);
  return `${packed.z ? 'z' : 'p'}:${packed.chunks.join('')}`;
}

export async function unpackSave(data: string): Promise<string> {
  const m = /^([zp]):/.exec(data);
  if (!m) throw new Error('Format de sauvegarde inconnu');
  return unpackSnapshot(m[1] === 'z', [data.slice(2)]);
}
