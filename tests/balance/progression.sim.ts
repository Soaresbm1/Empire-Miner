/**
 * Progression : quatre profils de joueur macro (voir player.ts et profiles.ts) jouent la même carte pendant plusieurs heures de
 * jeu. On compare le temps pour atteindre chaque étape, l'argent, la part automatique du revenu, et on vérifie que la partie
 * reste saine (conservation des objets, argent, sauvegarde rechargeable).
 */
import { describe, expect, it } from 'vitest';
import { getResource } from '../../src/data/resources';
import { Drill } from '../../src/sim/structures/Drill';
import { Bench, digest, reload, round, saveOf } from './harness';
import { Macro, MILESTONES } from './player';
import { PROFILES } from './profiles';
import { record } from './report';

const MINUTES = Number(process.env.BALANCE_MINUTES ?? 180);
const SEEDS = (process.env.BALANCE_SEEDS ?? '11').split(',').map(Number);
const ONLY = process.env.BALANCE_PROFILE;

/** Sauvegarde dont les âges de tas au sol sont ramenés à au moins 1 s, comme le fait le chargement. */
function withDropAgesFloored<T extends { drops: [string, number, number, number, number?][] }>(save: T): T {
  return { ...save, drops: save.drops.map(([res, n, x, y, age]) => [res, n, x, y, Math.max(1, age ?? 1)] as [string, number, number, number, number]) };
}

describe(`progression des profils (${MINUTES} min de jeu)`, () => {
  for (const seed of SEEDS)
    for (const profile of PROFILES.filter((p) => !ONLY || p.id === ONLY)) {
      it(`${profile.id}, graine ${seed}`, () => {
        const bench = new Bench(seed);
        const macro = new Macro(bench, profile);
        const t0 = Date.now();
        macro.play(MINUTES);
        const g = bench.g;
        const cpu = round((Date.now() - t0) / 1000, 1);

        const row: Record<string, string | number | null> = { profil: profile.id, graine: seed };
        for (const m of MILESTONES) row[m.label] = macro.reached.get(m.id) ?? null;
        record('progression : minutes de jeu pour atteindre chaque étape (— : jamais)', row);

        const handMoney = g.stats.earned - g.stats.autoSold;
        record('progression : état en fin de partie', {
          profil: profile.id,
          graine: seed,
          argent: g.money,
          revenuMain: Math.round(handMoney),
          revenuAuto: g.stats.autoSold,
          partAuto: g.stats.earned ? round(g.stats.autoSold / g.stats.earned, 2) : 0,
          lignes: macro.lines,
          fours: macro.smelters,
          pioche: g.pickaxeLevel + 1,
          sac: g.bagLevel + 1,
          profondeurMax: g.stats.maxDepth,
          blocsPiochés: g.stats.tilesMined,
          evanouissements: g.stats.faints,
          marche: Math.round(macro.spent.walk / 60),
          minage: Math.round(macro.spent.mine / 60),
          construction: Math.round(macro.spent.build / 60),
          attente: Math.round(macro.spent.idle / 60),
          calculSecondes: cpu,
          blocsAbandonnes: macro.stuck,
          echecs: macro.failures.length,
        });

        // Que font les foreuses en fin de partie ? (à sec : plus de charbon ; vides : gisement épuisé ; pleines : sortie bloquée)
        const drills = g.structures.list.filter((x): x is Drill => x instanceof Drill);
        const byStatus = (st: string) => drills.filter((d) => d.status === st).length;
        record('progression : état des foreuses en fin de partie', {
          profil: profile.id,
          graine: seed,
          foreuses: drills.length,
          enMarche: byStatus('ok'),
          sansCharbon: byStatus('nofuel'),
          gisementEpuise: byStatus('depleted'),
          sortieBloquee: byStatus('full'),
          extraitParForeuse: drills.length ? Math.round(drills.reduce((a, d) => a + d.extracted, 0) / drills.length) : 0,
          reserveRestanteMoyenne: drills.length ? Math.round(drills.reduce((a, d) => a + g.world.reserve[g.world.idx(d.x, d.y)], 0) / drills.length) : 0,
        });

        // Où est le goulot ? La caisse d'expédition (une seule) ou le convoyeur commun.
        const crates = g.structures.list.filter((x) => x.type === 'shipping');
        const belts = g.structures.list.filter((x) => x.type === 'conveyor');
        const stuckBelts = belts.filter((x) => x.flowState()?.toString() === 'stuck').length;
        record('progression : goulot des lignes en fin de partie', {
          profil: profile.id,
          graine: seed,
          caisses: crates.length,
          chargeCaisses: crates.map((c) => Math.round(Object.entries(c.contents()).reduce((a, [r, n]) => a + n * getResource(r).weight, 0))).join(' / '),
          convoyeurs: belts.length,
          convoyeursBloques: stuckBelts,
        });

        // La partie reste saine, quoi qu'ait fait le joueur.
        expect(macro.failures).toEqual([]);
        expect(bench.conservation()).toEqual({});
        expect(Number.isFinite(g.money) && g.money >= 0).toBe(true);
        // Constat connu (voir le skill balance-lab) : au chargement, l'âge d'un tas au sol de moins de 1 s est ramené à 1 s
        // (save.ts, deserialize : Math.max(1, âge)). Tout le reste doit être identique.
        expect(withDropAgesFloored(saveOf(reload(g)))).toEqual(withDropAgesFloored(saveOf(g)));
      });
    }

  it('reproductible : le même joueur sur la même carte joue deux fois la même partie (30 min)', () => {
    const play = () => {
      const b = new Bench(11);
      const m = new Macro(b, PROFILES[3]);
      m.play(30);
      return { money: b.g.money, mined: b.g.stats.tilesMined, reached: [...m.reached], digest: digest(b.g) };
    };
    expect(play()).toEqual(play());
  });
});
