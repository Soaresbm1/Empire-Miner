import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { watchForUpdate } from '../src/game/update';

const answer = (body: unknown, ok = true) => vi.fn(async (_url?: unknown, _init?: unknown) => ({ ok, json: async () => body }) as unknown as Response);

describe('mise à jour du jeu : une nouvelle version est-elle publiée ?', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('prévient, une seule fois, quand la version publiée n’est pas celle de la page', async () => {
    const fetchFn = answer({ build: 'nouvelle' });
    const onNew = vi.fn();
    const w = watchForUpdate(onNew, { build: 'ancienne', url: 'http://jeu/version.json', fetchFn, first: 10, every: 1000 });
    await vi.advanceTimersByTimeAsync(20);
    expect(onNew).toHaveBeenCalledTimes(1);
    expect(onNew).toHaveBeenCalledWith('nouvelle');
    await vi.advanceTimersByTimeAsync(5000);
    expect(onNew).toHaveBeenCalledTimes(1);
    // L'adresse porte un paramètre qui change : le navigateur ne répond pas depuis son cache.
    expect(String(fetchFn.mock.calls[0][0])).toMatch(/^http:\/\/jeu\/version\.json\?t=\d+$/);
    expect(fetchFn.mock.calls[0][1]).toEqual({ cache: 'no-store' });
    w.stop();
  });

  it('ne dit rien si la version est la même, si le fichier manque ou si le réseau tombe', async () => {
    const onNew = vi.fn();
    for (const fetchFn of [answer({ build: 'courante' }), answer({}, false), vi.fn(async (_url?: unknown, _init?: unknown) => Promise.reject(new Error('hors ligne'))), answer({ build: 12 })]) {
      const w = watchForUpdate(onNew, { build: 'courante', url: 'http://jeu/version.json', fetchFn, first: 10, every: 1000 });
      await vi.advanceTimersByTimeAsync(2500);
      expect(await w.check()).toBe(false);
      w.stop();
    }
    expect(onNew).not.toHaveBeenCalled();
  });

  it('contrôle peu après le démarrage, puis régulièrement : une publication tardive est vue', async () => {
    let published = 'courante';
    const fetchFn = vi.fn(async (_url?: unknown, _init?: unknown) => ({ ok: true, json: async () => ({ build: published }) }) as unknown as Response);
    const onNew = vi.fn();
    const w = watchForUpdate(onNew, { build: 'courante', url: 'http://jeu/version.json', fetchFn, first: 100, every: 1000 });
    await vi.advanceTimersByTimeAsync(150);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(onNew).not.toHaveBeenCalled();
    published = 'suivante';
    await vi.advanceTimersByTimeAsync(1000);
    expect(onNew).toHaveBeenCalledTimes(1);
    w.stop();
  });

  it('rien du tout en développement (pas de version.json) et une fois arrêté', async () => {
    const fetchFn = answer({ build: 'autre' });
    const onNew = vi.fn();
    const dev = watchForUpdate(onNew, { build: 'dev', url: 'http://jeu/version.json', fetchFn, first: 10, every: 100 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchFn).not.toHaveBeenCalled();
    expect(await dev.check()).toBe(false);
    const w = watchForUpdate(onNew, { build: 'courante', url: 'http://jeu/version.json', fetchFn, first: 10, every: 100 });
    w.stop();
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchFn).not.toHaveBeenCalled();
    expect(onNew).not.toHaveBeenCalled();
  });
});
