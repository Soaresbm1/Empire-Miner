/** Encodage compact des grilles (RLE + base64) pour les sauvegardes. */

export function rleEncode(data: Uint8Array): string {
  const out: number[] = [];
  let i = 0;
  while (i < data.length) {
    const v = data[i];
    let run = 1;
    while (i + run < data.length && data[i + run] === v && run < 255) run++;
    out.push(v, run);
    i += run;
  }
  return bytesToBase64(Uint8Array.from(out));
}

export function rleDecode(encoded: string, length: number): Uint8Array {
  const bytes = base64ToBytes(encoded);
  const out = new Uint8Array(length);
  let o = 0;
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    const v = bytes[i];
    const run = bytes[i + 1];
    if (o + run > length) throw new Error('Données de carte corrompues');
    out.fill(v, o, o + run);
    o += run;
  }
  if (o !== length) throw new Error('Taille de carte incohérente');
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode(...bytes.subarray(i, i + CH));
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
