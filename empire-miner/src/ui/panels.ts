/**
 * Contenu HTML des panneaux (comptoir, atelier, sac, coffre, foreuse, aide).
 * Chaque bouton porte un `data-action` traité par Game.
 */
import { DIR_ARROWS, DX, DY } from '../core/dir';
import { MACHINES, MachineDef, conveyorThroughput } from '../data/machines';
import { RESOURCES, getResource } from '../data/resources';
import { BAGS, PICKAXES } from '../data/tools';
import type { GameState } from '../sim/GameState';
import type { Drill } from '../sim/structures/Drill';
import type { ShippingCrate } from '../sim/structures/ShippingCrate';
import type { Sorter } from '../sim/structures/Sorter';
import type { RailStation, RailSwitch, SwitchSetting } from '../sim/structures/Rail';
import type { Storage } from '../sim/structures/Storage';
import { esc, kg, money, num, rarityTag, resIcon } from './format';

const btn = (action: string, label: string, opts: { arg?: string; disabled?: boolean; cls?: string; title?: string } = {}) =>
  `<button class="btn ${opts.cls ?? ''}" data-action="${action}"${opts.arg !== undefined ? ` data-arg="${esc(opts.arg)}"` : ''}${
    opts.disabled ? ' disabled' : ''
  }${opts.title ? ` title="${esc(opts.title)}"` : ''}>${label}</button>`;

function sortedItems(items: Record<string, number>): [string, number][] {
  return Object.entries(items)
    .filter(([, n]) => n > 0)
    .sort((a, b) => getResource(b[0]).value - getResource(a[0]).value);
}

// ------------------------------------------------------------------ comptoir

export function counterPanel(g: GameState): string {
  const items = sortedItems(g.inventory.items);
  const total = items.reduce((s, [res, n]) => s + n * getResource(res).value, 0);
  const rows = items
    .map(([res, n]) => {
      const r = getResource(res);
      return `<tr><td>${resIcon(res)} ${r.name} ${rarityTag(res)}</td><td class="num">×${n}</td><td class="num">${money(r.value)}</td>
      <td class="num gold">${money(n * r.value)}</td><td>${btn('sell', 'Vendre', { arg: res, cls: 'small' })}</td></tr>`;
    })
    .join('');
  return `
    <p class="sub">« Posez ça là, je vous en donne un bon prix. »</p>
    ${
      items.length
        ? `<table class="table"><thead><tr><th>Ressource</th><th>Qté</th><th>Prix</th><th>Total</th><th></th></tr></thead><tbody>${rows}</tbody></table>
       <div class="panel-footer"><span>Total : <b class="gold">${money(total)}</b></span>${btn('sellAll', `Tout vendre (${money(total)})`, { cls: 'primary' })}</div>`
        : `<p class="empty">Votre sac est vide. Descendez à la mine et rapportez des minerais !</p>`
    }`;
}

// ------------------------------------------------------------------ atelier

function stat(label: string, from: string, to?: string): string {
  return `<div class="stat"><span>${label}</span><b>${from}${to && to !== from ? ` <em>→ ${to}</em>` : ''}</b></div>`;
}

function ladder(names: string[], current: number): string {
  return `<div class="ladder">${names
    .map((n, i) => `<span class="${i < current ? 'owned' : i === current ? 'current' : ''}">${n}</span>`)
    .join('<i>›</i>')}</div>`;
}

export function workshopPanel(g: GameState, tab: string, icon: (id: string) => string = () => ''): string {
  const tabs = [
    ['tools', 'Pioches'],
    ['transport', 'Transport'],
    ['machines', 'Machines'],
  ]
    .map(([id, label]) => `<button class="tab ${tab === id ? 'active' : ''}" data-action="tab" data-arg="${id}">${label}</button>`)
    .join('');
  let body = '';
  if (tab === 'tools') {
    const cur = g.pickaxe;
    const next = PICKAXES[g.pickaxeLevel + 1];
    body = ladder(
      PICKAXES.map((p) => p.name),
      g.pickaxeLevel,
    );
    body += `<div class="cards">`;
    body += `<div class="card"><h3>Actuelle : ${cur.name}</h3><p>${cur.description}</p>
      ${stat('Niveau', String(cur.tier))}${stat('Dégâts par coup', String(cur.damage))}${stat('Durée d\'un coup', `${num(cur.swingTime, 2)} s`)}
      ${stat('Puissance', `${num(cur.damage / cur.swingTime)} /s`)}</div>`;
    if (next) {
      const can = g.money >= next.price;
      body += `<div class="card highlight"><h3>${next.name}</h3><p>${next.description}</p>
        ${stat('Niveau', String(cur.tier), String(next.tier))}${stat('Dégâts par coup', String(cur.damage), String(next.damage))}
        ${stat('Durée d\'un coup', `${num(cur.swingTime, 2)} s`, `${num(next.swingTime, 2)} s`)}
        ${stat('Puissance', `${num(cur.damage / cur.swingTime)} /s`, `${num(next.damage / next.swingTime)} /s`)}
        <div class="buy">${btn('buyPickaxe', `Acheter — ${money(next.price)}`, { cls: 'primary', disabled: !can })}${can ? '' : `<small>Il vous manque ${money(next.price - g.money)}</small>`}</div></div>`;
    } else body += `<div class="card"><h3>Meilleure pioche atteinte</h3><p>Vous avez la meilleure pioche de cette version du jeu.</p></div>`;
    body += `</div>`;
  } else if (tab === 'transport') {
    const cur = g.bag;
    const next = BAGS[g.bagLevel + 1];
    body = ladder(
      BAGS.map((b) => b.name),
      g.bagLevel,
    );
    body += `<div class="cards"><div class="card"><h3>Actuel : ${cur.name}</h3><p>${cur.description}</p>
      ${stat('Capacité', kg(cur.capacity))}${stat('Vitesse de marche', `${Math.round(cur.speedMul * 100)} %`)}</div>`;
    if (next) {
      const can = g.money >= next.price;
      body += `<div class="card highlight"><h3>${next.name}</h3><p>${next.description}</p>
        ${stat('Capacité', kg(cur.capacity), kg(next.capacity))}${stat('Vitesse de marche', `${Math.round(cur.speedMul * 100)} %`, `${Math.round(next.speedMul * 100)} %`)}
        <div class="buy">${btn('buyBag', `Acheter — ${money(next.price)}`, { cls: 'primary', disabled: !can })}${can ? '' : `<small>Il vous manque ${money(next.price - g.money)}</small>`}</div></div>`;
    } else body += `<div class="card"><h3>Transport personnel au maximum</h3><p>Pour transporter davantage, automatisez : foreuses, convoyeurs et coffres.</p></div>`;
    body += `</div>`;
  } else {
    body = `<p class="shop-hint">Survolez une machine pour lire sa description complète.</p>${machineShop(g, icon)}`;
  }
  return `<p class="sub">Outils, équipement et machines. Les machines achetées se posent avec <kbd>B</kbd>.</p><div class="tabs">${tabs}</div>${body}`;
}

/** Chiffres utiles d'une machine, en étiquettes courtes. */
function machineSpecs(m: MachineDef): [string, string][] {
  const s = m.stats;
  if (m.conveyor) return [['Vitesse', `${num(s.speed, 2)} case/s`], ['Débit', `${num(conveyorThroughput(m))} /s`]];
  if (m.id === 'splitter') return [['Sorties', '3, à tour de rôle'], ['Débit', `${num(s.speed * s.capacity)} /s`]];
  if (m.id === 'sorter') return [['Tout droit', 'le minerai choisi'], ['Côtés', 'tout le reste']];
  if (m.bridge) return [['Portée', `jusqu'à ${m.bridge.range} cases`], ['Vendu', 'par paire']];
  if (m.shipping) return [['Vente', `toutes les ${m.shipping.interval} s`], ['Capacité', kg(s.capacity)], ['Pose', 'en surface']];
  if (m.id === 'storage') return [['Capacité', kg(s.capacity)]];
  if (m.id === 'rail') return [['Pose', 'en glissant'], ['Virages', 'automatiques']];
  if (m.onTrack) return [['Vitesse', `${num(s.speed)} cases/s`], ['Capacité', kg(s.capacity)], ['Passager', 'touche F']];
  if (m.station) return [['Tampon', kg(s.capacity)], ['Transfert', `${num(s.speed)} /s`]];
  if (m.railSwitch) return [['Branches', 'tout droit, gauche, droite'], ['Mode', 'fixe ou alterné']];
  const out: [string, string][] = [];
  if (s.speed) out.push(['Cadence', `${num(s.speed * 60, 0)} /min`]);
  if (m.fuel) out.push(['Charbon', `1 unité / ${m.fuel.secondsPerUnit} s`], ['Réservoir', `${m.fuel.maxUnits} unités`]);
  if (m.levels && m.levels.length > 1) out.push(['Améliorable', `jusqu'au niveau ${m.levels.length} (touche E dessus)`]);
  if (s.power) out.push(['Consommation', `${s.power} kW`]);
  return out;
}

const SHOP_GROUPS: { title: string; categories: MachineDef['category'][] }[] = [
  { title: 'Extraction', categories: ['extraction'] },
  { title: 'Transport', categories: ['logistique'] },
  { title: 'Wagonnets et rails', categories: ['rail'] },
  { title: 'Stockage et vente', categories: ['stockage', 'vente'] },
];

function machineRow(g: GameState, m: MachineDef, icon: (id: string) => string): string {
  const unlocked = g.isUnlocked(m.id);
  const owned = g.inventory.kitCount(m.id);
  const placed = g.structures.list.filter((s) => s.type === m.id).length;
  // Les ponts se vendent par paire (une entrée + une sortie).
  const qtys = m.conveyor ? [1, 10] : m.bridge ? [2] : m.dragPlace ? [10, 50] : [1];
  const label = (q: number) => (m.bridge ? `Paire · ${money(m.price * q)}` : q > 1 ? `×${q} · ${money(m.price * q)}` : `Acheter · ${money(m.price)}`);
  const cheapest = m.price * qtys[0];
  const specs = machineSpecs(m)
    .map(([k, v]) => `<span class="spec"><i>${k}</i>${v}</span>`)
    .join('');
  const level = m.conveyor ? `<span class="lvl">N${m.stats.level}</span>` : '';
  const img = icon(m.id);
  const side = unlocked
    ? `<div class="buy-row">${qtys.map((q) => btn('buyKit', label(q), { arg: `${m.id}:${q}`, cls: 'primary', disabled: g.money < m.price * q })).join('')}</div>
       ${g.money < cheapest ? `<small class="miss">Il manque ${money(cheapest - g.money)}</small>` : ''}`
    : `<small class="lock">🔒 ${m.unlock?.text}</small>`;
  return `<div class="shop-row ${unlocked ? '' : 'locked'}" title="${esc(m.description)}">
    <div class="shop-icon">${img ? `<img src="${img}" alt="">` : ''}</div>
    <div class="shop-main">
      <div class="shop-title">${m.name}${level}</div>
      <div class="shop-sum">${m.summary}</div>
      <div class="specs">${specs}</div>
    </div>
    <div class="shop-side">
      <div class="stock">${owned ? `<b>${owned}</b> en stock` : 'Aucun en stock'}${placed ? ` · <b>${placed}</b> posé${placed > 1 ? 's' : ''}` : ''}</div>
      ${side}
    </div>
  </div>`;
}

function machineShop(g: GameState, icon: (id: string) => string): string {
  return SHOP_GROUPS.map((grp) => {
    const rows = MACHINES.filter((m) => grp.categories.includes(m.category));
    if (!rows.length) return '';
    return `<section class="shop-group"><h4>${grp.title}</h4>${rows.map((m) => machineRow(g, m, icon)).join('')}</section>`;
  }).join('');
}

// ------------------------------------------------------------------ sac

export function inventoryPanel(g: GameState): string {
  const inv = g.inventory;
  const w = inv.weight();
  const rows = RESOURCES.map((r) => {
    const n = inv.count(r.id);
    const known = n > 0 || g.stats.discovered.includes(r.id) || r.id === 'stone' || (g.stats.collected[r.id] ?? 0) > 0;
    if (!known) return `<tr class="unknown"><td>${resIcon(r.id)} ???</td><td colspan="5">Pas encore découvert</td></tr>`;
    const on = g.autoPickup[r.id];
    return `<tr><td>${resIcon(r.id)} ${r.name} ${rarityTag(r.id)}</td><td class="num">×${n}</td><td class="num">${kg(r.weight)}</td><td class="num">${money(r.value)}</td>
      <td>${btn('togglePickup', on ? 'Oui' : 'Non', { arg: r.id, cls: `small ${on ? 'on' : 'off'}`, title: 'Ramasser automatiquement' })}</td>
      <td>${n > 0 ? btn('drop', 'Jeter', { arg: r.id, cls: 'small' }) : ''}</td></tr>`;
  }).join('');
  const kits = Object.entries(inv.kits)
    .map(([id, n]) => `<li><b>${MACHINES.find((m) => m.id === id)?.name ?? id}</b> ×${n}</li>`)
    .join('');
  const st = g.stats;
  return `
    <div class="bar big"><div style="width:${Math.min(100, (w / inv.capacity) * 100)}%"></div><span>${g.bag.name} : ${kg(w)} / ${kg(inv.capacity)}</span></div>
    <table class="table"><thead><tr><th>Ressource</th><th>Qté</th><th>Poids</th><th>Valeur</th><th>Ramasser</th><th></th></tr></thead><tbody>${rows}</tbody></table>
    <h4>Kits de construction</h4>${kits ? `<ul class="kits">${kits}</ul>` : '<p class="empty">Aucun. Achetez des machines à l\'Atelier.</p>'}
    <h4>Carnet du mineur</h4>
    <div class="stats-grid">
      <span>Blocs minés</span><b>${st.tilesMined}</b><span>Minerais ramassés</span><b>${st.itemsCollected}</b>
      <span>Argent gagné</span><b>${money(st.earned)}</b><span>Profondeur max.</span><b>${Math.floor(st.maxDepth)} m</b>
      <span>Livré par vos machines</span><b>${st.delivered}</b><span>Temps de jeu</span><b>${Math.floor(st.playTime / 60)} min</b>
    </div>`;
}

// ------------------------------------------------------------------ coffre

export function storagePanel(g: GameState, s: Storage): string {
  const items = sortedItems(s.items);
  const w = s.weight();
  const rows = items
    .map(
      ([res, n]) =>
        `<tr><td>${resIcon(res)} ${getResource(res).name}</td><td class="num">×${n}</td><td class="num">${kg(n * getResource(res).weight)}</td><td>${btn('storageTake', 'Prendre', { arg: res, cls: 'small' })}</td></tr>`,
    )
    .join('');
  return `
    <div class="bar big"><div style="width:${Math.min(100, (w / s.capacity) * 100)}%"></div><span>${kg(w)} / ${kg(s.capacity)}</span></div>
    ${items.length ? `<table class="table"><tbody>${rows}</tbody></table>` : '<p class="empty">Coffre vide. Reliez-le à une foreuse avec des convoyeurs, ou déposez-y votre sac.</p>'}
    <p class="hint">Un convoyeur collé au coffre qui ne pointe pas vers lui en sort les minerais automatiquement. Le charbon du coffre recharge aussi les foreuses collées.</p>
    <div class="panel-footer"><span>Votre sac : ${kg(g.inventory.weight())} / ${kg(g.inventory.capacity)}</span>
    <span>${btn('storageDeposit', 'Tout déposer', { disabled: g.inventory.isEmpty() })} ${btn('storageTakeAll', 'Tout prendre', { cls: 'primary', disabled: !items.length })}</span></div>`;
}

// ------------------------------------------------------------------ caisse d'expédition

export function shippingPanel(g: GameState, c: ShippingCrate): string {
  const items = sortedItems(c.items);
  const w = c.weight();
  const rows = items
    .map(([res, n]) => {
      const r = getResource(res);
      return `<tr><td>${resIcon(res)} ${r.name}</td><td class="num">×${n}</td><td class="num gold">${money(n * r.value)}</td></tr>`;
    })
    .join('');
  const secs = Math.max(0, Math.ceil(c.timer));
  const bag = g.inventory.weight();
  return `
    <div class="status good">● Prochain passage du transporteur dans ${secs} s</div>
    <div class="bar big ${w / c.capacity > 0.9 ? 'full' : ''}"><div style="width:${Math.min(100, (w / c.capacity) * 100)}%"></div><span>${kg(w)} / ${kg(c.capacity)}</span></div>
    ${items.length ? `<table class="table"><tbody>${rows}</tbody></table>` : '<p class="empty">Caisse vide. Amenez-y vos minerais avec des convoyeurs.</p>'}
    <div class="panel-footer"><span>En attente : <b class="gold">${money(c.pendingValue())}</b> · Vendu par cette caisse : <b class="gold">${money(c.soldTotal)}</b></span>
    ${btn('shipDeposit', `Déposer mon sac (${kg(bag)})`, { cls: 'primary', disabled: g.inventory.isEmpty() })}</div>
    <p class="hint">Tout ce qui entre ici est vendu au prix du comptoir à chaque passage. Si la caisse est pleine, elle refuse les minerais et les convoyeurs s'arrêtent.</p>`;
}

// ------------------------------------------------------------------ quais

export function stationPanel(g: GameState, st: RailStation): string {
  const items = sortedItems(st.items);
  const w = st.weight();
  const docked = g.wagons.list.find((wg) => wg.stopped && wg.x === st.x && wg.y === st.y);
  const rows = items
    .map(([res, n]) => `<tr><td>${resIcon(res)} ${getResource(res).name}</td><td class="num">×${n}</td><td class="num">${kg(n * getResource(res).weight)}</td></tr>`)
    .join('');
  const load = st.mode === 'load';
  return `
    <div class="status ${load ? 'good' : 'warn'}">● ${load ? 'Remplit les wagonnets qui s\'arrêtent ici.' : 'Vide les wagonnets et envoie le minerai dans ce qui est collé.'}</div>
    <div class="bar big"><div style="width:${Math.min(100, (w / st.capacity) * 100)}%"></div><span>${kg(w)} / ${kg(st.capacity)}</span></div>
    ${items.length ? `<table class="table"><tbody>${rows}</tbody></table>` : `<p class="empty">${load ? 'Quai vide. Déposez votre sac, ou amenez le minerai par convoyeur, foreuse ou coffre.' : 'Quai vide.'}</p>`}
    <div class="panel-footer"><span>${docked ? `Wagonnet à quai : <b>${kg(docked.weight())}</b> / ${kg(docked.capacity)}` : 'Aucun wagonnet à quai'}</span>
    ${load ? btn('stationDeposit', `Déposer mon sac (${kg(g.inventory.weight())})`, { cls: 'primary', disabled: g.inventory.isEmpty() }) : btn('stationTakeAll', 'Tout prendre', { cls: 'primary', disabled: !items.length })}</div>
    <p class="hint">${
      load
        ? 'Le wagonnet repart quand il est plein, ou 2 s après la fin du chargement.'
        : "Collez un convoyeur, un coffre ou une caisse d'expédition au quai pour qu'il se vide tout seul."
    } Montez dans un wagonnet avec <kbd>F</kbd>.</p>`;
}

// ------------------------------------------------------------------ aiguillage

export function switchPanel(g: GameState, sw: RailSwitch): string {
  const connected = (d: number) => !!g.structures.at(sw.x + [1, 0, -1, 0][d], sw.y + [0, 1, 0, -1][d])?.isTrack;
  const arrows = ['→', '↓', '←', '↑'];
  const labels: Record<Exclude<SwitchSetting, 'alt'>, string> = { straight: 'Tout droit', left: 'À gauche', right: 'À droite' };
  const branches = sw.branches(connected);
  const next = sw.nextBranch(connected);
  const choice = (id: SwitchSetting, label: string) => btn('switchSet', label, { arg: id, cls: `small ${sw.setting === id ? 'on' : 'off'}` });
  const tip = arrows[(sw.dir + 2) % 4];
  return `
    <div class="status good">● ${
      next ? `Le prochain wagonnet venant de la pointe (${tip}) partira <b>${labels[next].toLowerCase()} ${arrows[sw.side(next)]}</b>.` : "Aucune branche raccordée : posez des rails autour de l'aiguillage."
    }</div>
    <h4>Branche prise en venant de la pointe</h4>
    <div class="buy">${branches.map((b) => choice(b, `${labels[b]} ${arrows[sw.side(b)]}`)).join('')}${branches.length > 1 ? choice('alt', 'Alterner ⇄') : ''}</div>
    <div class="cards" style="margin-top:12px"><div class="card">
      ${stat('Pointe (arrivée de la ligne principale)', `côté ${tip}`)}
      ${stat('Passages depuis la pointe', String(sw.passes))}
      <div class="buy">${btn('switchRotate', 'Tourner la pointe ↻')}</div>
    </div></div>
    <p class="hint">Les wagonnets qui reviennent par une branche repartent toujours vers la pointe. En alternance, un wagonnet sur deux prend chaque branche : pratique pour desservir deux quais avec une seule ligne.</p>`;
}

// ------------------------------------------------------------------ trieur

export function sorterPanel(g: GameState, s: Sorter): string {
  const known = RESOURCES.filter(
    (r) => r.id === 'stone' || r.id === 'coal' || r.id === s.filter || g.stats.discovered.includes(r.id) || (g.stats.collected[r.id] ?? 0) > 0,
  );
  const choice = (id: string | null, label: string) =>
    btn('sorterFilter', label, { arg: id ?? '', cls: `small ${s.filter === id ? 'on' : 'off'}` });
  const status = s.filter
    ? `${resIcon(s.filter)} <b>${getResource(s.filter).name}</b> part tout droit, tout le reste part sur les côtés.`
    : 'Aucun minerai choisi : tout va tout droit.';
  return `
    <div class="status good">${status}</div>
    <h4>Minerai envoyé tout droit</h4>
    <div class="buy">${choice(null, 'Aucun')}${known.map((r) => choice(r.id, `${resIcon(r.id)} ${r.name}`)).join('')}</div>
    <div class="cards" style="margin-top:12px"><div class="card">
      ${stat('Triés tout droit', String(s.sortedFront))}${stat('Envoyés sur les côtés', String(s.sortedSides))}
      ${stat('Entrée', "par l'arrière (face opposée à la flèche verte)")}
    </div></div>
    <p class="hint">Les côtés sont servis à tour de rôle ; un côté sans rien de branché est ignoré. Si la sortie avant est pleine, le minerai choisi attend : le tri reste fiable.</p>`;
}

// ------------------------------------------------------------------ foreuse

const DRILL_STATUS: Record<string, [string, string]> = {
  ok: ['En marche', 'good'],
  nofuel: ['À l\'arrêt : plus de charbon', 'bad'],
  full: ['Bloquée : la sortie est saturée', 'warn'],
  depleted: ['Gisement épuisé', 'bad'],
};

/**
 * Plan 3×3 autour de la foreuse, orienté comme dans le monde : cases forées au
 * niveau `level` (couleur du gisement, ou hachures si elles n'ont rien à forer)
 * et flèche de sortie.
 */
function drillMap(g: GameState, d: Drill, level: number): string {
  const covered = d.reach(level);
  const fx = d.x + DX[d.dir];
  const fy = d.y + DY[d.dir];
  let cells = '';
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const x = d.x + dx;
      const y = d.y + dy;
      const t = covered.find((c) => c.x === x && c.y === y);
      const dep = t && d.canDrill(t, g) ? g.world.depositAt(x, y) : null;
      let cls = t ? (dep ? 'on' : 'dry') : '';
      let style = '';
      let inner = '';
      if (dep) {
        const r = getResource(dep);
        style = ` style="--c:${r.color};--l:${r.light};--d:${r.dark}"`;
      }
      if (dx === 0 && dy === 0) cls += ' me';
      else if (x === fx && y === fy) {
        cls += ' out';
        inner = DIR_ARROWS[d.dir];
      }
      cells += `<span class="${cls.trim()}"${style}>${inner}</span>`;
    }
  return `<div class="drill-map">${cells}</div>`;
}

/** Colonnes « niveau 1 / 2 / 3 » : cases couvertes, cadence obtenue ici, achat du niveau suivant. */
function drillLevels(g: GameState, d: Drill): string {
  const next = d.nextLevel();
  const blocker = g.drillUpgradeBlocker(d);
  const cols = d.levels
    .map((l) => {
      const n = d.sources(g, l.level).length;
      const state = l.level < d.level ? 'owned' : l.level === d.level ? 'current' : l.level === d.level + 1 ? 'next' : 'later';
      let foot: string;
      if (state === 'current') foot = '<span class="dl-tag">Niveau actuel</span>';
      else if (state === 'owned') foot = '<span class="dl-done">✓ Installé</span>';
      else if (state === 'next') {
        const locked = l.unlock && g.pickaxe.tier < l.unlock.pickaxeTier;
        const why = locked ? l.unlock!.text : g.money < l.price ? `Il vous manque ${money(l.price - g.money)}` : '';
        foot = `${btn('drillUpgrade', `Améliorer — ${money(l.price)}`, { cls: 'primary small', disabled: !!blocker })}${
          why ? `<span class="miss">${why}</span>` : ''
        }`;
      } else foot = `<span class="dl-later">${money(l.price)} · après le niveau ${l.level - 1}</span>`;
      return `<div class="dl ${state}">
        <div class="dl-title">Niveau ${l.level}</div>
        ${drillMap(g, d, l.level)}
        <div class="dl-sum">${l.summary}</div>
        <div class="dl-rate">${n} case${n > 1 ? 's' : ''} à forer ici · <b>${num(d.def.stats.speed * n * 60, 0)}/min</b></div>
        ${l.unlock && state === 'later' ? `<div class="dl-lock">${l.unlock.text}</div>` : ''}
        <div class="dl-foot">${foot}</div>
      </div>`;
    })
    .join('');
  const tip = next
    ? `Chaque case avec un gisement produit ${num(d.def.stats.speed * 60, 0)}/min, pour le même charbon`
    : 'Niveau maximal : elle fore sous elle, à gauche, à droite et derrière';
  return `<h4>Amélioration — niveau ${d.level} / ${d.maxLevel}</h4>
    <div class="drill-levels">${cols}</div>
    <p class="hint">${tip} · démonter rembourse les améliorations.</p>`;
}

export function drillPanel(g: GameState, d: Drill): string {
  const [label, cls] = DRILL_STATUS[d.status];
  const sources = d.sources(g);
  const deposits: Record<string, number> = {};
  let reserve = 0;
  for (const t of sources) {
    const res = g.world.depositAt(t.x, t.y)!;
    deposits[res] = (deposits[res] ?? 0) + 1;
    reserve += g.world.reserve[g.world.idx(t.x, t.y)];
  }
  const depositList = Object.entries(deposits)
    .map(([res, n]) => `${resIcon(res)} ${getResource(res).name}${n > 1 ? ` ×${n}` : ''}`)
    .join(', ');
  const coal = g.inventory.count('coal');
  const secs = d.fuelSeconds();
  // Charbon disponible dans les coffres collés (recharge automatique).
  const fuelRes = d.def.fuel?.res ?? 'coal';
  let nearbyFuel = 0;
  let chests = 0;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const s = g.structures.at(d.x + dx, d.y + dy);
    if (s?.type === 'storage') {
      chests++;
      nearbyFuel += (s as Storage).items[fuelRes] ?? 0;
    }
  }
  const out = d.buffer.length;
  return `
    <div class="status ${cls}">● ${label}</div>
    <div class="cards"><div class="card">
      ${stat('Gisements forés', depositList || 'épuisés')}
      ${stat('Réserve restante', `${reserve} unités`)}
      ${stat('Cadence', `${num(d.def.stats.speed * sources.length * 60, 0)} unités/min`)}
      ${stat('Extrait au total', String(d.extracted))}
    </div><div class="card">
      ${stat('Charbon chargé', `${d.fuelUnits} / ${d.fuelMax}`)}
      ${stat('Autonomie', `${Math.floor(secs / 60)} min ${Math.floor(secs % 60)} s`)}
      ${chests ? stat('Recharge auto (coffre collé)', `${nearbyFuel} charbon en réserve`) : ''}
      ${stat('Production en attente', `${out} / ${d.def.stats.capacity}`)}
    </div></div>
    <div class="buy">${btn('drillFuel', `Charger le charbon du sac (${coal})`, { cls: 'primary', disabled: coal <= 0 || d.fuelUnits >= d.fuelMax })}
      ${btn('drillCollect', `Récupérer la production (${out})`, { disabled: out <= 0 })}
      ${btn('drillRotate', 'Tourner ↻')}</div>
    ${drillLevels(g, d)}
    <p class="hint">Sortie devant la flèche ${DIR_ARROWS[d.dir]}, sinon dans un convoyeur collé. Un coffre de charbon collé la recharge tout seul.</p>`;
}

// ------------------------------------------------------------------ aide

export function helpPanel(keys: { move: string; label: (c: string) => string }): string {
  const k = (c: string) => `<kbd>${keys.label(c)}</kbd>`;
  return `<div class="help">
    <div><h4>Se déplacer</h4><p><kbd>${keys.move}</kbd> ou flèches</p></div>
    <div><h4>Miner</h4><p>Maintenir le <kbd>clic gauche</kbd> sur une paroi proche, ou ${k('Space')} pour frapper devant soi</p></div>
    <div><h4>Interagir</h4><p>${k('KeyE')} près du comptoir, de l'atelier, d'un coffre ou d'une foreuse</p></div>
    <div><h4>Sac</h4><p>${k('KeyI')} ou <kbd>Tab</kbd></p></div>
    <div><h4>Construire</h4><p>${k('KeyB')} : mode construction. <kbd>Clic gauche</kbd> poser (glisser pour tracer des convoyeurs), <kbd>clic droit</kbd> démonter, ${k('KeyR')} tourner, <kbd>1-9</kbd> choisir</p></div>
    <div><h4>Zoom</h4><p>Molette de la souris</p></div>
    <div><h4>Wagonnet</h4><p>${k('KeyF')} : monter / descendre</p></div>
    <div><h4>Améliorer une foreuse</h4><p>${k('KeyE')} sur la foreuse : niveau 2 = cases gauche et droite, niveau 3 = aussi derrière</p></div>
    <div><h4>Menu</h4><p><kbd>Échap</kbd> : pause, sauvegarde, chargement</p></div>
  </div>
  <p class="hint">Le jeu se sauvegarde automatiquement toutes les minutes dans ce navigateur.${
    import.meta.env.MODE !== 'artifact' ? ' Exportez un fichier depuis le menu pour garder une copie.' : ''
  }</p>`;
}
