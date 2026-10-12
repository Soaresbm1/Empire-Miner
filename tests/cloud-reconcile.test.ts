import { describe, expect, it } from 'vitest';
import { briefOf, playTime, sameBrief, type Brief } from '../src/cloud/brief';
import { DRIFT_MS, lightly, reconcile, recognizeOwn, type SyncLink } from '../src/cloud/reconcile';
import { makeSave } from './support/cloudKit';

const brief = (seed: number, time: number): Brief => ({ seed, time, money: 0, depth: 0, savedAt: '' });
const cloud = (seed: number, time: number, rev: string) => ({ ...brief(seed, time), rev, device: '' });
const link = (rev: string, seed: number, time: number, at = 0): SyncLink => ({ rev, seed, time, at });

describe('compte : que faire de deux parties', () => {
  it('rien d’un côté ni de l’autre : rien', () => {
    expect(reconcile(null, null, null)).toEqual({ do: 'nothing' });
  });

  it('une partie ici, rien sur le compte : on l’envoie ; l’inverse : on la prend', () => {
    expect(reconcile(brief(1, 50), null, null)).toEqual({ do: 'push' });
    expect(reconcile(brief(1, 50), null, link('r1', 1, 50))).toEqual({ do: 'push' });
    expect(reconcile(null, cloud(1, 50, 'r1'), null)).toEqual({ do: 'pull' });
    expect(reconcile(null, cloud(1, 50, 'r1'), link('r0', 1, 10))).toEqual({ do: 'pull' });
  });

  it('la même partie des deux côtés : rien à transférer', () => {
    expect(reconcile(brief(1, 50), cloud(1, 50, 'r1'), link('r1', 1, 50))).toEqual({ do: 'nothing' });
    // Appareil neuf, ou révision inconnue : on retient seulement la révision.
    expect(reconcile(brief(1, 50), cloud(1, 50, 'r1'), null)).toEqual({ do: 'adopt' });
    expect(reconcile(brief(1, 50), cloud(1, 50, 'r2'), link('r1', 1, 10))).toEqual({ do: 'adopt' });
  });

  it('le compte n’a pas bougé depuis le dernier échange : seul l’appareil a pu avancer, on envoie', () => {
    expect(reconcile(brief(1, 80), cloud(1, 50, 'r1'), link('r1', 1, 50))).toEqual({ do: 'push' });
    // Y compris une autre partie (nouvelle partie démarrée ici, écrasement confirmé par le joueur).
    expect(reconcile(brief(9, 5), cloud(1, 50, 'r1'), link('r1', 1, 50))).toEqual({ do: 'push' });
  });

  it('le compte a avancé ailleurs et l’appareil n’a pas bougé : on prend celle du compte', () => {
    expect(reconcile(brief(1, 50), cloud(1, 90, 'r2'), link('r1', 1, 50))).toEqual({ do: 'pull' });
    expect(reconcile(brief(1, 50), cloud(7, 10, 'r2'), link('r1', 1, 50))).toEqual({ do: 'pull' });
  });

  it('les deux ont avancé chacun de leur côté : on demande', () => {
    expect(reconcile(brief(1, 80), cloud(1, 90, 'r2'), link('r1', 1, 50))).toEqual({ do: 'ask', why: 'diverged' });
    expect(reconcile(brief(2, 80), cloud(1, 90, 'r2'), link('r1', 1, 50))).toEqual({ do: 'ask', why: 'diverged' });
  });

  it('un appareil qui n’a jamais parlé à ce compte et a déjà une autre partie : on demande, même si le compte est plus avancé', () => {
    expect(reconcile(brief(1, 10), cloud(1, 9000, 'r1'), null)).toEqual({ do: 'ask', why: 'first' });
    expect(reconcile(brief(2, 10), cloud(1, 9000, 'r1'), null)).toEqual({ do: 'ask', why: 'first' });
    expect(reconcile(brief(1, 9000), cloud(1, 10, 'r1'), null)).toEqual({ do: 'ask', why: 'first' });
  });

  describe('la dernière sauvegarde d’une page qu’on ferme', () => {
    const at = Date.parse('2026-10-12T10:00:00.000Z');
    const at40s = (s: number) => ({ ...brief(1, 80), savedAt: new Date(at + s * 1000).toISOString() });

    it('quelques secondes après le dernier échange : ce n’est pas un travail à part, on prend celle du compte', () => {
      expect(reconcile(at40s(40), cloud(1, 90, 'r2'), link('r1', 1, 50, at))).toEqual({ do: 'pull' });
      expect(reconcile(at40s(0), cloud(1, 90, 'r2'), link('r1', 1, 50, at))).toEqual({ do: 'pull' });
      expect(reconcile(at40s(90), cloud(1, 90, 'r2'), link('r1', 1, 50, at))).toEqual({ do: 'pull' });
    });

    it('au-delà de la marge : un vrai travail, on demande', () => {
      expect(reconcile(at40s(91), cloud(1, 90, 'r2'), link('r1', 1, 50, at))).toEqual({ do: 'ask', why: 'diverged' });
      expect(reconcile(at40s(600), cloud(1, 90, 'r2'), link('r1', 1, 50, at))).toEqual({ do: 'ask', why: 'diverged' });
    });

    it('jamais si l’horloge a reculé, si la partie a changé, ou si l’appareil est revenu en arrière', () => {
      expect(reconcile(at40s(-5), cloud(1, 90, 'r2'), link('r1', 1, 50, at))).toEqual({ do: 'ask', why: 'diverged' });
      expect(reconcile({ ...at40s(10), seed: 2 }, cloud(1, 90, 'r2'), link('r1', 1, 50, at))).toEqual({ do: 'ask', why: 'diverged' });
      expect(reconcile({ ...at40s(10), time: 30 }, cloud(1, 90, 'r2'), link('r1', 1, 50, at))).toEqual({ do: 'ask', why: 'diverged' });
      expect(reconcile({ ...at40s(10), savedAt: 'n’importe quoi' }, cloud(1, 90, 'r2'), link('r1', 1, 50, at))).toEqual({ do: 'ask', why: 'diverged' });
    });

    it('une marge nulle désactive la tolérance ; un appareil qui n’a jamais parlé au compte demande toujours', () => {
      expect(reconcile(at40s(1), cloud(1, 90, 'r2'), link('r1', 1, 50, at), 0)).toEqual({ do: 'ask', why: 'diverged' });
      expect(reconcile(at40s(1), cloud(1, 90, 'r2'), null)).toEqual({ do: 'ask', why: 'first' });
      expect(DRIFT_MS).toBe(90000);
    });

    it('lightly : la mesure elle-même', () => {
      expect(lightly(at40s(30), link('r1', 1, 50, at), 60000)).toBe(true);
      expect(lightly(at40s(61), link('r1', 1, 50, at), 60000)).toBe(false);
    });
  });

  it('table complète : jamais d’envoi ni de reprise quand les deux ont bougé', () => {
    const times = [10, 50, 90];
    const seeds = [1, 2];
    const revs = ['r1', 'r2'];
    const links: (SyncLink | null)[] = [null, link('r1', 1, 50), link('r2', 2, 10)];
    for (const ls of seeds) for (const lt of times) for (const cs of seeds) for (const ct of times) for (const rev of revs) for (const lk of links) {
      const l = brief(ls, lt);
      const c = cloud(cs, ct, rev);
      const plan = reconcile(l, c, lk).do;
      const same = ls === cs && lt === ct;
      const localMoved = !lk || lk.seed !== ls || lk.time !== lt;
      const cloudMoved = !lk || lk.rev !== rev;
      const ctx = JSON.stringify({ ls, lt, cs, ct, rev, lk });
      if (!same && localMoved && cloudMoved) expect(plan, ctx).toBe('ask');
      if (plan === 'push') expect(!same && localMoved && !cloudMoved, ctx).toBe(true);
      if (plan === 'pull') expect(!same && !localMoved && cloudMoved, ctx).toBe(true);
    }
  });
});

describe('compte : reconnaître son propre envoi', () => {
  it('le compte contient ce qu’on venait d’envoyer : c’est le nôtre', () => {
    expect(recognizeOwn(link('r1', 1, 50), { seed: 1, time: 80 }, cloud(1, 80, 'r2'), 5000)).toEqual(link('r2', 1, 80, 5000));
    expect(recognizeOwn(null, { seed: 1, time: 80 }, cloud(1, 80, 'r2'), 5000)).toEqual(link('r2', 1, 80, 5000));
  });

  it('autre chose dans le compte, rien d’envoyé, ou rien changé : le souvenir reste tel quel', () => {
    const l = link('r1', 1, 50);
    expect(recognizeOwn(l, { seed: 1, time: 80 }, cloud(1, 90, 'r2'), 5000)).toBe(l);
    expect(recognizeOwn(l, { seed: 2, time: 80 }, cloud(1, 80, 'r2'), 5000)).toBe(l);
    expect(recognizeOwn(l, null, cloud(1, 80, 'r2'), 5000)).toBe(l);
    expect(recognizeOwn(l, { seed: 1, time: 80 }, null, 5000)).toBe(l);
    expect(recognizeOwn(link('r2', 1, 80, 1), { seed: 1, time: 80 }, cloud(1, 80, 'r2'), 5000)).toEqual(link('r2', 1, 80, 1));
  });
});

describe('compte : résumé d’une sauvegarde', () => {
  it('lit la graine, le temps, l’argent, la profondeur et la date d’une vraie sauvegarde', () => {
    const b = briefOf(makeSave(1234, 3725, 4500, 87));
    expect(b).toMatchObject({ seed: 1234, time: 3725, money: 4500, depth: 87 });
    expect(b?.savedAt).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(sameBrief(b!, { ...b!, savedAt: 'autre' })).toBe(true);
  });

  it('refuse ce qui n’est pas une sauvegarde du jeu', () => {
    expect(briefOf('pas du json')).toBeNull();
    expect(briefOf('null')).toBeNull();
    expect(briefOf(JSON.stringify({ game: 'autre', seed: 1, time: 2 }))).toBeNull();
    expect(briefOf(JSON.stringify({ game: 'empire-miner', seed: 'x', time: 2 }))).toBeNull();
  });

  it('dit le temps de jeu en mots', () => {
    expect(playTime(0)).toBe('moins d’une minute');
    expect(playTime(59)).toBe('moins d’une minute');
    expect(playTime(60 * 45)).toBe('45 min');
    expect(playTime(3600 * 3 + 60 * 5)).toBe('3 h 05');
    expect(playTime(-5)).toBe('moins d’une minute');
  });
});
