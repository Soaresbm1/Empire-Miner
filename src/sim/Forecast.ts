/**
 * Prévisions : au rythme où la mine produit en ce moment, dans combien de temps une phase du Grand Chevalement ou une
 * commande sera-t-elle prête, et qu'est-ce qui la retient ?
 *
 * Ce sont des estimations d'affichage, rien ici ne change la partie. Elles partent de la production récente
 * (`ProductionLog.recent`, 2 minutes), en retirent ce que les fours et la Manufacture consomment, et comptent ce que le
 * joueur a déjà dans son sac. Elles supposent que toute la production arrive à destination et que deux besoins sur la même
 * ressource ne se la partagent pas : c'est un ordre de grandeur pour décider s'il faut bâtir une ligne de plus, pas une promesse.
 */
import { RECIPES } from '../data/recipes';
import { getResource } from '../data/resources';
import type { Contract } from './Contracts';
import type { Rates } from './Production';
import type { Project } from './Project';

/** En deçà de ce débit (unités par minute), on considère que rien n'est produit. */
export const IDLE_RATE = 0.05;

/** Au-delà, une prévision n'a plus de sens : on dit seulement que c'est très long. */
export const FAR_MINUTES = 600;

/** Un besoin : un matériau (`res`), ou de l'argent (`res` null). */
export interface Need {
  res: string | null;
  /** Ce qu'il en manque encore, une fois déduit ce que le joueur a déjà sur lui. */
  left: number;
  /** Ce que la production en laisse chaque minute (le revenu des ventes, pour l'argent). */
  rate: number;
  /** Minutes pour le réunir à ce rythme : 0 si rien ne manque, null si rien n'arrive. */
  minutes: number | null;
}

export interface Forecast {
  needs: Need[];
  /** Ce qui retient le plus : le besoin le plus long à réunir (un besoin qui n'avance pas passe avant), ou null si tout est réuni. */
  slowest: Need | null;
  /** Minutes avant que tout soit réuni : 0 si tout l'est déjà, null si un besoin n'avance pas. */
  minutes: number | null;
}

/** Minutes pour réunir `left` unités au débit `rate` (par minute) : 0 si rien ne manque, null si rien n'arrive. */
export function minutesFor(left: number, rate: number): number | null {
  if (left <= 0) return 0;
  return rate > IDLE_RATE ? left / rate : null;
}

/**
 * Ce que la production laisse de `res` chaque minute : extrait, fondu ou fabriqué, moins ce que les fours et les recettes
 * de la Manufacture en prennent (un lingot fondu a coûté un minerai, une plaque a coûté un lingot).
 */
export function supply(r: Rates, res: string): number {
  let v = (r.ore[res] ?? 0) + (r.ingots[res] ?? 0) + (r.made[res] ?? 0);
  const ingot = getResource(res).smeltsTo;
  if (ingot) v -= r.ingots[ingot] ?? 0;
  for (const rec of RECIPES) {
    const k = rec.inputs[res];
    if (k) v -= (k * (r.made[rec.id] ?? 0)) / rec.yield;
  }
  return Math.max(0, v);
}

/** L'argent que rapportent les ventes (comptoir et caisses) chaque minute. */
export function income(r: Rates): number {
  return r.counter + r.crate;
}

/** Besoin de `qty` unités de `res`, dont `bag` sont déjà dans le sac. */
export function materialNeed(res: string, qty: number, bag: number, r: Rates): Need {
  const left = Math.max(0, qty - bag);
  const rate = supply(r, res);
  return { res, left, rate, minutes: minutesFor(left, rate) };
}

/** Besoin d'argent : `owed` $ à verser, dont le joueur a déjà `balance` $ en poche. */
export function moneyNeed(owed: number, balance: number, r: Rates): Need {
  const left = Math.max(0, owed - balance);
  const rate = income(r);
  return { res: null, left, rate, minutes: minutesFor(left, rate) };
}

/** Réunit des besoins : tout se produit en même temps, c'est donc le plus long qui décide. */
export function combine(needs: Need[]): Forecast {
  let slowest: Need | null = null;
  let minutes: number | null = 0;
  for (const n of needs) {
    if (n.minutes === 0) continue;
    if (n.minutes === null) {
      // Un besoin qui n'avance pas retient tout : le premier d'entre eux est cité.
      if (minutes !== null) slowest = n;
      minutes = null;
    } else if (minutes !== null && n.minutes > minutes) {
      slowest = n;
      minutes = n.minutes;
    }
  }
  return { needs, slowest, minutes };
}

/** La phase en cours du chantier : matériaux manquants et salaires. `bag` : ce que le joueur porte de chaque ressource. */
export function projectForecast(p: Project, money: number, bag: (res: string) => number, r: Rates): Forecast {
  const needs = p.missing().map((n) => materialNeed(n.res, n.qty, bag(n.res), r));
  const owed = p.moneyLeft();
  if (owed > 0) needs.push(moneyNeed(owed, money, r));
  return combine(needs);
}

/** Une commande : ce que ses lignes attendent encore. */
export function orderForecast(c: Pick<Contract, 'lines'>, bag: (res: string) => number, r: Rates): Forecast {
  return combine(c.lines.filter((l) => l.done < l.qty).map((l) => materialNeed(l.res, l.qty - l.done, bag(l.res), r)));
}

/** Où en est une prévision par rapport au temps dont on dispose ? */
export type Fit = 'ready' | 'ok' | 'tight' | 'late' | 'stalled';

/**
 * Une prévision tient-elle dans `seconds` ? « ok » : avec de la marge (80 % du temps au plus) ; « tight » : de justesse ;
 * « late » : non ; « stalled » : elle n'avance pas ; « ready » : tout est déjà réuni.
 */
export function fitIn(f: Forecast, seconds: number): Fit {
  if (f.minutes === null) return 'stalled';
  if (f.minutes <= 0) return 'ready';
  const need = f.minutes * 60;
  return need <= seconds * 0.8 ? 'ok' : need <= seconds ? 'tight' : 'late';
}
