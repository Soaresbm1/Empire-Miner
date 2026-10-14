/**
 * Banc de simulation d'Empire Miner : `npm run balance` (quelques dizaines de secondes).
 * - Invariants (échec = défaut à corriger) : déterminisme, sauvegarde fidèle, deux rechargements identiques, conservation
 *   des objets, argent sain.
 * - Mesures (rapportées, pas jugées ici) : vitesse de la simulation, économie de chaque ligne de production, réserves des cartes.
 * Les mesures sont écrites dans tests/balance/out/ (ignoré par git) et affichées à la fin.
 */
import { describe, expect, it } from 'vitest';
import { depthAt } from '../../src/core/constants';
import { BLOCKS } from '../../src/data/blocks';
import { DEPTH_ZONES } from '../../src/data/depth';
import { RESOURCES, getResource } from '../../src/data/resources';
import { GameState } from '../../src/sim/GameState';
import { Bench, digest, reload, round, saveOf } from './harness';
import { crowdedFactory, measureLine, referenceLine, refuel, type Chain } from './scenarios';
import { record } from './report';

const MIN = 60;

/** Empreintes d'une ligne de référence, une par minute de jeu. */
function digests(seed: number, minutes: number): number[] {
  const { bench } = referenceLine({ ore: 'iron', chain: 'smelt', seed });
  const out: number[] = [];
  for (let m = 0; m < minutes; m++) {
    bench.run(MIN, { every: 5, tick: refuel });
    out.push(digest(bench.g));
  }
  return out;
}

describe('invariants', () => {
  it('déterminisme : la même partie jouée deux fois donne la même empreinte à chaque minute (30 min)', () => {
    const a = digests(11, 30);
    const b = digests(11, 30);
    expect(b).toEqual(a);
    // Et la graine compte : une autre carte, une autre partie.
    expect(digests(12, 1)[0]).not.toBe(a[0]);
  });

  it('sauvegarde fidèle : recharger une partie redonne exactement la même sauvegarde (toutes les 10 min, 1 h)', () => {
    const { bench } = referenceLine({ ore: 'copper', chain: 'smelt' });
    for (let k = 0; k < 6; k++) {
      bench.run(10 * MIN, { every: 5, tick: refuel });
      expect(saveOf(reload(bench.g))).toEqual(saveOf(bench.g));
    }
  });

  it('deux appareils qui rechargent la même sauvegarde avancent ensemble (resynchronisation du jeu à deux)', () => {
    const { bench } = referenceLine({ ore: 'copper', chain: 'raw' });
    bench.run(15 * MIN, { every: 5, tick: refuel });
    const atReload = { money: bench.g.money, extracted: bench.ledger.extracted.copper ?? 0 };
    const a = new Bench(11, reload(bench.g));
    const b = new Bench(11, reload(bench.g));
    for (let m = 0; m < 15; m++) {
      a.run(MIN, { every: 5, tick: refuel });
      b.run(MIN, { every: 5, tick: refuel });
      expect(digest(b.g)).toBe(digest(a.g));
    }
    // Pour information : la partie d'origine et sa copie rechargée ne restent pas forcément identiques, car des curseurs de
    // répartition ne sont pas sauvegardés (voir docs/ARCHITECTURE.md, « Rendement des lignes »). On mesure l'écart.
    const original = bench;
    original.run(15 * MIN, { every: 5, tick: refuel });
    // Mêmes 15 minutes pour les deux : depuis le rechargement.
    record('écart après rechargement (information)', {
      cas: 'ligne cuivre brut, 15 min après rechargement',
      gainOriginal: original.g.money - atReload.money,
      gainRecharge: a.g.money - atReload.money,
      extraitOriginal: (original.ledger.extracted.copper ?? 0) - atReload.extracted,
      extraitRecharge: a.ledger.extracted.copper ?? 0,
      empreintesEgales: digest(original.g) === digest(a.g),
    });
  });

  it('conservation : rien ne se crée ni ne se perd, ligne avec four (2 h) et usine chargée (1 h)', () => {
    const { bench } = referenceLine({ ore: 'gold', chain: 'smelt' });
    for (let k = 0; k < 12; k++) {
      bench.run(10 * MIN, { every: 5, tick: refuel });
      expect(bench.conservation()).toEqual({});
    }
    const factory = crowdedFactory(5);
    for (let k = 0; k < 6; k++) {
      factory.run(10 * MIN, { every: 5, tick: refuel });
      expect(factory.conservation()).toEqual({});
    }
    record('conservation', { cas: 'ligne or + four, 2 h', extrait: sum(bench.ledger.extracted), fondu: sum(bench.ledger.smelted), vendu: sum(bench.ledger.sold), charbonBrule: bench.fuelBurned(), ecarts: 0 });
    record('conservation', { cas: 'usine de 30 lignes, 1 h', extrait: sum(factory.ledger.extracted), fondu: 0, vendu: sum(factory.ledger.sold), charbonBrule: factory.fuelBurned(), ecarts: 0 });
  });

  it('argent sain : jamais négatif ni non numérique pendant 4 h de ligne', () => {
    const { bench } = referenceLine({ ore: 'silver', chain: 'smelt' });
    bench.run(4 * 60 * MIN, { every: 5, tick: refuel, sampleEvery: 10 * MIN });
    for (const s of bench.samples) {
      expect(Number.isFinite(s.money)).toBe(true);
      expect(s.money).toBeGreaterThanOrEqual(0);
    }
    expect(bench.g.money).toBe(bench.ledger.soldMoney);
  });
});

describe('vitesse de la simulation', () => {
  const speed = (cas: string, b: Bench) =>
    record('vitesse', { cas, structures: b.g.structures.list.length, pasParSeconde: b.stepsPerSecond(), pireMs: round(b.worstStepMs, 2), heureDeJeuEnSecondes: round(216_000 / b.stepsPerSecond(), 1) });

  it('partie neuve, joueur immobile : 10 min de jeu', () => {
    const b = new Bench(11);
    b.run(10 * MIN);
    speed('partie neuve', b);
    expect(b.stepsPerSecond()).toBeGreaterThan(0);
  });

  for (const rows of [5, 20]) {
    it(`usine chargée : ${rows * 6} lignes foreuse → convoyeurs → coffre, 10 min de jeu`, () => {
      const b = crowdedFactory(rows);
      b.run(10 * MIN, { every: 5, tick: refuel });
      speed(`usine de ${rows * 6} lignes`, b);
      // Le jeu demande 60 pas par seconde, 240 à la vitesse ×4 : il faut une marge large.
      expect(b.stepsPerSecond()).toBeGreaterThan(240);
    });
  }
});

describe('économie des lignes de production', () => {
  const ores = ['coal', 'copper', 'iron', 'silver', 'gold', 'diamond'];
  for (const ore of ores) {
    const chains: Chain[] = getResource(ore).smeltsTo ? ['raw', 'smelt'] : ['raw'];
    for (const chain of chains) {
      it(`${ore} ${chain === 'raw' ? 'brut' : 'fondu'} : ligne de référence, 20 min mesurées`, () => {
        const line = referenceLine({ ore, chain });
        const e = measureLine(line);
        const def = getResource(ore);
        const reserve = def.deposit ? (def.deposit[0] + def.deposit[1]) / 2 : null;
        const life = reserve && e.extractedPerMin > 0 ? reserve / e.extractedPerMin : null;
        record('économie des lignes', {
          minerai: def.name,
          chaine: chain === 'raw' ? 'brut → caisse' : 'four → caisse',
          extraitParMin: e.extractedPerMin,
          venteParMinMarche: e.incomePerMin,
          venteParMinBase: e.baseIncomePerMin,
          charbonParMin: e.coalPerMin,
          coutCharbonParMin: e.coalCostPerMin,
          netParMin: e.netPerMin,
          investissement: e.investment,
          rembourseEnMin: e.paybackMin,
          reserveMoyenne: reserve,
          gisementEpuiseEnMin: life === null ? null : round(life, 1),
          gainNetParGisement: life === null ? null : round(e.netPerMin * life - e.investment, 0),
          foreuseOccupee: e.drillBusy === null ? null : round(e.drillBusy, 2),
        });
        expect(e.extractedPerMin).toBeGreaterThan(0);
        expect(line.bench.conservation()).toEqual({});
      });
    }
  }
});

describe('réserves des cartes', () => {
  it('gisements pour foreuses et filons à la pioche, par minerai et par zone, sur 5 graines', () => {
    const seeds = [1, 2, 3, 4, 5];
    for (const res of RESOURCES.filter((r) => r.vein)) {
      const ri = RESOURCES.indexOf(res) + 1;
      const perZone = DEPTH_ZONES.map(() => ({ tiles: 0, reserve: 0, veins: 0 }));
      for (const seed of seeds) {
        const w = new GameState(seed).world;
        for (let y = 0; y < w.h; y++)
          for (let x = 0; x < w.w; x++) {
            const i = w.idx(x, y);
            const z = zoneOf(depthAt(y));
            if (w.deposit[i] === ri) {
              perZone[z].tiles++;
              perZone[z].reserve += w.reserve[i];
            }
            if (BLOCKS[w.tiles[i]]?.ore === res.id) perZone[z].veins++;
          }
      }
      const n = seeds.length;
      const drops = (res.drops[0] + res.drops[1]) / 2;
      DEPTH_ZONES.forEach((zone, z) => {
        const p = perZone[z];
        if (!p.tiles && !p.veins) return;
        record('réserves des cartes (moyenne par carte)', {
          minerai: res.name,
          zone: zone.name,
          casesDeGisement: round(p.tiles / n, 1),
          reservePourForeuses: round(p.reserve / n, 0),
          valeurPourForeuses: round((p.reserve / n) * res.value, 0),
          blocsDeFilon: round(p.veins / n, 1),
          valeurALaPioche: round((p.veins / n) * drops * res.value, 0),
        });
      });
    }
    expect(true).toBe(true);
  });
});

function zoneOf(depth: number): number {
  let z = 0;
  for (let k = 0; k < DEPTH_ZONES.length; k++) if (depth >= DEPTH_ZONES[k].minDepth) z = k;
  return z;
}

function sum(t: Record<string, number>): number {
  return Object.values(t).reduce((a, b) => a + b, 0);
}
