/**
 * Mathématiques déterministes pour la simulation.
 *
 * `Math.hypot`, `Math.exp`, `Math.log`, `Math.sin`… ne sont pas garanties identiques d'un moteur JavaScript à l'autre
 * (V8, JavaScriptCore) : la dernière décimale peut changer. En jeu à deux, chaque téléphone recalcule la partie ; un
 * seul écart minuscule suffirait à les faire diverger au bout de quelques minutes. Ici, seulement des additions,
 * multiplications, divisions et racines carrées, dont le résultat est fixé par la norme IEEE 754 : tous les moteurs
 * donnent le même nombre au bit près. Le rendu, lui, garde librement `Math.*`.
 */

/** Longueur du vecteur (dx, dy). */
export function hyp(dx: number, dy: number): number {
  return Math.sqrt(dx * dx + dy * dy);
}

const LN2 = 0.6931471805599453;
const INV_LN2 = 1.4426950408889634;

/** Multiplie par 2^k (k entier) sans `Math.pow` : exact. */
function scale2(v: number, k: number): number {
  while (k > 0) {
    v *= 2;
    k--;
  }
  while (k < 0) {
    v *= 0.5;
    k++;
  }
  return v;
}

/** e^x, précis à ~1e-15 pour |x| raisonnable (marché, frottements). */
export function dexp(x: number): number {
  if (x !== x) return x;
  if (x > 700) return Infinity;
  if (x < -700) return 0;
  const k = Math.round(x * INV_LN2);
  const r = x - k * LN2; // |r| <= ln2 / 2
  // Série de Taylor de e^r : |r| <= 0.35, 14 termes donnent moins de 1e-17.
  let term = 1;
  let sum = 1;
  for (let i = 1; i <= 14; i++) {
    term = (term * r) / i;
    sum += term;
  }
  return scale2(sum, k);
}

/** Logarithme népérien de x > 0, précis à ~1e-15. */
export function dlog(x: number): number {
  if (!(x > 0)) return x === 0 ? -Infinity : NaN;
  if (x === Infinity) return Infinity;
  // x = m * 2^e avec m dans [0.70, 1.41[
  let m = x;
  let e = 0;
  while (m >= 1.4142135623730951) {
    m *= 0.5;
    e++;
  }
  while (m < 0.7071067811865476) {
    m *= 2;
    e--;
  }
  // ln(m) = 2 atanh(z), z = (m - 1) / (m + 1), |z| <= 0.172
  const z = (m - 1) / (m + 1);
  const z2 = z * z;
  let term = z;
  let sum = 0;
  for (let i = 1; i <= 25; i += 2) {
    sum += term / i;
    term *= z2;
  }
  return 2 * sum + e * LN2;
}

/**
 * Cosinus et sinus d'un petit angle (|a| <= 1,2 rad : la dispersion des éclats de roche). Série de Taylor,
 * précis à ~1e-15 dans cet intervalle.
 */
export function smallCosSin(a: number): { cos: number; sin: number } {
  const a2 = a * a;
  let c = 1;
  let s = a;
  let tc = 1;
  let ts = a;
  for (let i = 1; i <= 8; i++) {
    tc *= -a2 / ((2 * i - 1) * (2 * i));
    ts *= -a2 / ((2 * i) * (2 * i + 1));
    c += tc;
    s += ts;
  }
  return { cos: c, sin: s };
}
