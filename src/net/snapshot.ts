/**
 * Instantané d'une partie pour l'envoyer à l'autre téléphone : le texte de la sauvegarde, compressé (si le navigateur sait
 * le faire), en base64, découpé en morceaux d'une taille que les courtiers publics acceptent sans broncher.
 */

/** Taille d'un morceau (caractères base64). */
export const CHUNK_SIZE = 6000;

const hasStreams = typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';

async function pipe(bytes: Uint8Array<ArrayBuffer>, stream: CompressionStream | DecompressionStream): Promise<Uint8Array<ArrayBuffer>> {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream as unknown as ReadableWritablePair<Uint8Array, Uint8Array>));
  return new Uint8Array(await out.arrayBuffer());
}

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) bin += String.fromCharCode(...bytes.subarray(i, i + step));
  return btoa(bin);
}

function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export interface PackedSnapshot {
  /** Compressé (deflate) ou en clair. */
  z: boolean;
  chunks: string[];
}

export async function packSnapshot(text: string): Promise<PackedSnapshot> {
  const raw = new TextEncoder().encode(text);
  let bytes: Uint8Array<ArrayBuffer> = raw;
  let z = false;
  if (hasStreams) {
    try {
      bytes = await pipe(raw, new CompressionStream('deflate-raw'));
      z = true;
    } catch {
      bytes = raw;
    }
  }
  const b64 = toBase64(bytes);
  const chunks: string[] = [];
  for (let i = 0; i < b64.length; i += CHUNK_SIZE) chunks.push(b64.slice(i, i + CHUNK_SIZE));
  return { z, chunks: chunks.length ? chunks : [''] };
}

export async function unpackSnapshot(z: boolean, chunks: string[]): Promise<string> {
  const bytes = fromBase64(chunks.join(''));
  if (!z) return new TextDecoder().decode(bytes);
  if (!hasStreams) throw new Error('Ce navigateur ne sait pas décompresser la partie');
  return new TextDecoder().decode(await pipe(bytes, new DecompressionStream('deflate-raw')));
}
