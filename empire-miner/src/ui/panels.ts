/**
 * Contenu HTML des panneaux (comptoir, atelier, sac, coffre, foreuse, aide).
 * Chaque bouton porte un `data-action` traité par Game.
 */
import { DIR_ARROWS } from '../core/dir';
import { MACHINES, MachineDef, conveyorThroughput } from '../data/machines';
import { RESOURCES, getResource } from '../data/resources';
import { BAGS, PICKAXES } from '../data/tools';
import type { GameState } from '../sim/GameState';
import type { Drill } from '../sim/structures/Drill';
import type { ShippingCrate } from '../sim/structures/ShippingCrate';
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

export function workshopPanel(g: GameState, tab: string): string {
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
    body = `<div class="cards">${MACHINES.map((m) => machineCard(g, m)).join('')}</div>`;
  }
  return `<p class="sub">Outils, équipement et machines. Les machines achetées se posent avec <kbd>B</kbd>.</p><div class="tabs">${tabs}</div>${body}`;
}

function machineCard(g: GameState, m: MachineDef): string {
  const unlocked = g.isUnlocked(m.id);
  const owned = g.inventory.kitCount(m.id);
  const placed = g.structures.list.filter((s) => s.type === m.id).length;
  const s = m.stats;
  const speed =
    m.id === 'conveyor'
      ? `${num(s.speed, 2)} tuile/s`
      : m.id === 'drill'
        ? `${num(s.speed * 60, 0)} unités/min`
        : m.shipping
          ? `1 passage / ${m.shipping.interval} s`
          : '—';
  const cap =
    m.id === 'conveyor'
      ? `${s.capacity} objets/tuile (débit max ${num(conveyorThroughput(m))}/s)`
      : m.id === 'storage' || m.shipping
        ? kg(s.capacity)
        : `${s.capacity} unités en attente`;
  const power = m.fuel ? `Charbon : 1 unité / ${m.fuel.secondsPerUnit} s` : s.power ? `${s.power} kW` : 'Aucune';
  const qtyButtons = m.id === 'conveyor' ? [1, 10] : [1];
  const where = m.surfaceOnly ? `<div class="owned">Se pose en surface, au camp.</div>` : '';
  return `<div class="card ${unlocked ? '' : 'locked'}"><h3>${m.name}</h3><p>${m.description}</p>
    ${stat('Vitesse', speed)}${stat('Consommation', power)}${stat('Capacité', cap)}${stat('Efficacité', `${Math.round(s.efficiency * 100)} %`)}
    ${stat('Niveau', String(s.level))}${stat('Coût', money(m.price))}
    <div class="owned">En stock : <b>${owned}</b> · Posé(s) : <b>${placed}</b></div>${where}
    <div class="buy">${
      unlocked
        ? qtyButtons
            .map((q) => btn('buyKit', q > 1 ? `×${q} — ${money(m.price * q)}` : `Acheter — ${money(m.price)}`, { arg: `${m.id}:${q}`, cls: 'primary', disabled: g.money < m.price * q }))
            .join('')
        : `<small class="lock">🔒 ${m.unlock?.text}</small>`
    }</div></div>`;
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

// ------------------------------------------------------------------ foreuse

const DRILL_STATUS: Record<string, [string, string]> = {
  ok: ['En marche', 'good'],
  nofuel: ['À l\'arrêt : plus de charbon', 'bad'],
  full: ['Bloquée : la sortie est saturée', 'warn'],
  depleted: ['Gisement épuisé', 'bad'],
};

export function drillPanel(g: GameState, d: Drill): string {
  const [label, cls] = DRILL_STATUS[d.status];
  const dep = g.world.depositAt(d.x, d.y);
  const reserve = g.world.reserve[g.world.idx(d.x, d.y)];
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
      ${stat('Gisement', dep ? `${resIcon(dep)} ${getResource(dep).name}` : 'épuisé')}
      ${stat('Réserve restante', dep ? `${reserve} unités` : '0')}
      ${stat('Cadence', `${num(d.def.stats.speed * 60, 0)} unités/min`)}
      ${stat('Extrait au total', String(d.extracted))}
      ${stat('Sortie', `${DIR_ARROWS[d.dir]} en priorité, sinon tout convoyeur collé`)}
    </div><div class="card">
      ${stat('Charbon chargé', `${d.fuelUnits} / ${d.fuelMax}`)}
      ${stat('Autonomie', `${Math.floor(secs / 60)} min ${Math.floor(secs % 60)} s`)}
      ${chests ? stat('Recharge auto (coffre collé)', `${nearbyFuel} charbon en réserve`) : ''}
      ${stat('Production en attente', `${out} / ${d.def.stats.capacity}`)}
      <div class="buy">${btn('drillFuel', `Charger le charbon (${coal} dans le sac)`, { cls: 'primary', disabled: coal <= 0 || d.fuelUnits >= d.fuelMax })}
      ${btn('drillCollect', `Récupérer la production (${out})`, { disabled: out <= 0 })}
      ${btn('drillRotate', 'Tourner ↻')}</div>
    </div></div>
    <p class="hint">Astuce : un coffre de charbon collé à la foreuse la recharge automatiquement. Un convoyeur qui pointe vers elle peut aussi lui livrer du charbon.</p>`;
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
    <div><h4>Menu</h4><p><kbd>Échap</kbd> : pause, sauvegarde, chargement</p></div>
  </div>
  <p class="hint">Le jeu se sauvegarde automatiquement toutes les minutes dans ce navigateur.${
    import.meta.env.MODE !== 'artifact' ? ' Exportez un fichier depuis le menu pour garder une copie.' : ''
  }</p>`;
}
