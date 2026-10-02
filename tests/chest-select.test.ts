import { describe, expect, it } from 'vitest';
import { GameState } from '../src/sim/GameState';
import { Storage } from '../src/sim/structures/Storage';
import { allowWords, chestBar, chestsInRect, filterChips, filterResources, pickChests, toggleDraft } from '../src/ui/chestFilter';
import { helpPanel, storagePanel } from '../src/ui/panels';

function camp(): GameState {
  const g = new GameState(4);
  g.stats.discovered = ['coal', 'copper', 'iron'];
  return g;
}

/** Une grille de coffres 3 colonnes × 2 rangées dont le coin haut gauche est en (40, 5). */
function grid(g: GameState): Storage[][] {
  const rows: Storage[][] = [];
  for (let y = 5; y < 7; y++) {
    const row: Storage[] = [];
    for (let x = 40; x < 43; x++) row.push(g.structures.add(new Storage(x, y, 1)) as Storage);
    rows.push(row);
  }
  return rows;
}

const view = (over: Partial<Parameters<typeof chestBar>[1]> = {}) => ({ total: 6, selected: 0, draft: [], hover: null, label: (c: string) => c.replace('Key', ''), ...over });

describe('régler plusieurs coffres : logique', () => {
  it('storages() ne liste que les coffres, pas les caisses ni les machines', () => {
    const g = camp();
    const rows = grid(g);
    expect(g.storages()).toHaveLength(6);
    expect(g.storages()).toContain(rows[0][0]);
    expect(g.storages().every((s) => s instanceof Storage)).toBe(true);
  });

  it('setStoragesAllow règle tous les coffres d’un coup et compte ceux qui ont changé', () => {
    const g = camp();
    const [row] = grid(g);
    row[0].setAllow(['copper', 'iron']);
    expect(g.setStoragesAllow(row, ['iron', 'copper'])).toBe(2); // le premier est déjà ainsi (ordre normalisé)
    for (const s of row) expect(s.allow).toEqual(['copper', 'iron']);
    expect(g.setStoragesAllow(row, [])).toBe(3);
    for (const s of row) expect(s.allow).toEqual([]);
    expect(g.setStoragesAllow(row, [])).toBe(0);
  });

  it('setStoragesAllow écarte les ressources inconnues et les doublons', () => {
    const g = camp();
    const [row] = grid(g);
    g.setStoragesAllow(row, ['coal', 'coal', 'nimporte-quoi', 'copper']);
    for (const s of row) expect(s.allow).toEqual(['coal', 'copper']);
  });

  it('un coffre réglé en groupe respecte son filtre comme un coffre réglé seul', () => {
    const g = camp();
    const [row] = grid(g);
    g.setStoragesAllow(row, ['copper']);
    expect(row.every((s) => s.accepts('copper') && !s.accepts('coal'))).toBe(true);
    expect(row[1].put('coal', 3)).toBe(0);
    expect(row[1].put('copper', 3)).toBe(3);
  });

  it('toggleDraft ajoute, retire, garde l’ordre des ressources ; « » remet tout', () => {
    expect(toggleDraft([], 'iron')).toEqual(['iron']);
    expect(toggleDraft(['iron'], 'copper')).toEqual(['copper', 'iron']);
    expect(toggleDraft(['copper', 'iron'], 'copper')).toEqual(['iron']);
    expect(toggleDraft(['iron'], 'iron')).toEqual([]);
    expect(toggleDraft(['copper', 'iron'], '')).toEqual([]);
    expect(toggleDraft(['copper'], 'nimporte-quoi')).toEqual(['copper']);
  });

  it('chestsInRect trouve les coffres touchés par le rectangle, dans n’importe quel sens', () => {
    const g = camp();
    const rows = grid(g);
    expect(chestsInRect(g, 40, 5, 41, 5).sort()).toEqual([rows[0][0], rows[0][1]].sort());
    expect(chestsInRect(g, 41, 6, 40, 5)).toHaveLength(4); // coins inversés
    expect(chestsInRect(g, 0, 0, 100, 100)).toHaveLength(6);
    expect(chestsInRect(g, 0, 0, 10, 10)).toEqual([]);
    expect(chestsInRect(g, 42, 6, 42, 6)).toEqual([rows[1][2]]); // une seule case
  });

  it('pickChests ajoute, puis retire quand tous sont déjà choisis', () => {
    const g = camp();
    const rows = grid(g);
    const sel = new Set<Storage>();
    expect(pickChests(sel, rows[0])).toBe(true);
    expect(sel.size).toBe(3);
    // Une zone qui mêle choisis et non choisis : elle ajoute les manquants.
    expect(pickChests(sel, [rows[0][0], rows[1][0]])).toBe(true);
    expect(sel.size).toBe(4);
    // Tous déjà choisis : la même zone les retire.
    expect(pickChests(sel, [rows[0][0], rows[1][0]])).toBe(false);
    expect(sel.size).toBe(2);
    // Aucun coffre dans la zone : rien ne bouge.
    expect(pickChests(sel, [])).toBe(false);
    expect(sel.size).toBe(2);
  });

  it('allowWords : « tout » ou la liste en minuscules', () => {
    expect(allowWords([])).toBe('tout');
    expect(allowWords(['copper', 'iron'])).toBe('cuivre, fer');
  });
});

describe('régler plusieurs coffres : affichage', () => {
  it('les puces du panneau d’un coffre et celles de la barre sont les mêmes minerais', () => {
    const g = camp();
    const ids = filterResources(g, []).map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining(['stone', 'coal', 'copper', 'iron']));
    expect(ids).not.toContain('gold');
    expect(filterResources(g, ['gold']).map((r) => r.id)).toContain('gold');
    expect(filterResources(g, [], { diamond: 2 }).map((r) => r.id)).toContain('diamond');
    const html = filterChips(g, ['copper'], 'chestDraft');
    expect(html).toMatch(/class="btn small off" data-action="chestDraft" data-arg=""/);
    expect(html).toMatch(/class="btn small on" data-action="chestDraft" data-arg="copper"/);
  });

  it('la barre : aucune sélection → bouton d’application grisé, avec le réglage dedans', () => {
    const g = camp();
    const html = chestBar(g, view());
    expect(html).toContain('Régler les coffres');
    expect(html).toContain('0</b> choisi sur 6');
    expect(html).toMatch(/data-action="chestApply"[^>]*disabled/);
    expect(html).toMatch(/data-action="chestNone"[^>]*disabled/);
    expect(html).not.toMatch(/data-action="chestAll"[^>]*disabled/);
  });

  it('la barre : le bouton dit combien de coffres et quel réglage', () => {
    const g = camp();
    const html = chestBar(g, view({ selected: 4, draft: ['copper', 'iron'] }));
    expect(html).toContain('4</b> choisis sur 6');
    expect(html).toContain('Appliquer à 4 coffres : seulement cuivre, fer');
    expect(html).not.toMatch(/data-action="chestApply"[^>]*disabled/);
    expect(chestBar(g, view({ selected: 1 }))).toContain('Appliquer à 1 coffre : tout accepter');
    expect(chestBar(g, view({ selected: 6 }))).toMatch(/data-action="chestAll"[^>]*disabled/);
  });

  it('la barre : puces du réglage, chaque clic part vers « chestDraft »', () => {
    const g = camp();
    const html = chestBar(g, view({ draft: ['coal'] }));
    expect(html).toMatch(/class="btn small on" data-action="chestDraft" data-arg="coal"/);
    expect(html).toMatch(/class="btn small off" data-action="chestDraft" data-arg="copper"/);
    expect(html).toMatch(/class="btn small off" data-action="chestDraft" data-arg=""/);
    expect(chestBar(g, view())).toMatch(/class="btn small on" data-action="chestDraft" data-arg=""/);
  });

  it('la barre : le coffre visé est décrit, choisi ou non', () => {
    const g = camp();
    const [row] = grid(g);
    row[0].setAllow(['gold']);
    const html = chestBar(g, view({ hover: { chest: row[0], picked: false } }));
    expect(html).toContain('accepte seulement or');
    expect(html).toContain('le choisir');
    expect(chestBar(g, view({ hover: { chest: row[1], picked: true } }))).toContain('✓ Choisi');
    expect(chestBar(g, view({ hover: { chest: row[1], picked: true } }))).toContain('le retirer de la sélection');
    expect(chestBar(g, view())).toContain('glissez un rectangle');
  });

  it('la barre : sans coffre posé, elle l’explique et ne propose rien d’autre', () => {
    const g = camp();
    const html = chestBar(g, view({ total: 0 }));
    expect(html).toContain('Aucun coffre posé');
    expect(html).not.toContain('chestApply');
    expect(html).toContain('data-action="chestClose"');
  });

  it('le panneau d’un coffre propose la sélection multiple seulement s’il y a plusieurs coffres', () => {
    const g = camp();
    const one = g.structures.add(new Storage(40, 5, 1)) as Storage;
    expect(storagePanel(g, one)).not.toContain('data-action="chestMode"');
    const two = g.structures.add(new Storage(41, 5, 1)) as Storage;
    expect(storagePanel(g, one)).toContain('data-action="chestMode"');
    expect(storagePanel(g, two)).toContain('Sélectionner plusieurs coffres');
    // Les puces du panneau n’ont pas changé.
    expect(storagePanel(g, one)).toMatch(/class="btn small on" data-action="storageAllow" data-arg=""/);
  });

  it('l’aide explique la sélection multiple', () => {
    const html = helpPanel({ move: 'ZQSD', label: (c) => c.replace('Key', '') });
    expect(html).toContain('Régler plusieurs coffres');
    expect(html).toContain('glissé');
  });
});
