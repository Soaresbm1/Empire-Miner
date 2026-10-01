/**
 * Atelier : outils, transport, équipement et machines.
 *
 * Quatre onglets. Une bande « Conseil » propose le prochain achat utile ; chaque onglet porte une
 * pastille avec le nombre d'achats possibles tout de suite ; l'onglet Machines se filtre par
 * catégorie et se lit en lignes compactes (le détail se déplie).
 */
import { BOOTS_WATER, GEAR, GearDef, HAZARD_LABEL } from '../data/gear';
import { CAVE_IN, GAS, HEALTH, HEAT, WATER } from '../data/hazards';
import { MACHINES, MACHINE_GROUPS, MachineDef, conveyorThroughput, parseKit } from '../data/machines';
import { BAGS, JACKHAMMER, PICKAXES, SCOOTER } from '../data/tools';
import type { GameState } from '../sim/GameState';
import { esc, kg, money, num } from './format';
import { icon as themeIcon } from './theme';
import { btn, stat } from './widgets';

// ------------------------------------------------------------------ onglets et vue

export const WORKSHOP_TABS: readonly (readonly [id: string, label: string])[] = [
  ['tools', 'Outils'],
  ['transport', 'Transport'],
  ['gear', 'Équipement'],
  ['machines', 'Machines'],
];

/** Ce que le joueur a réglé dans l'onglet Machines (gardé tant que la partie est ouverte). */
export interface ShopView {
  /** Catégorie affichée : « all » ou l'identifiant d'un groupe de MACHINE_GROUPS. */
  cat: string;
  /** Seulement ce qu'on peut acheter tout de suite. */
  only: boolean;
  /** Machines dont le détail est déplié. */
  open: ReadonlySet<string>;
}

export const DEFAULT_VIEW: ShopView = { cat: 'all', only: false, open: new Set() };

export const isWorkshopTab = (id: string): boolean => WORKSHOP_TABS.some(([t]) => t === id);

// ------------------------------------------------------------------ offres hors machines

/** Un achat de progression (pioche, sac, outil, trottinette, équipement). */
export interface Offer {
  key: string;
  tab: string;
  name: string;
  price: number;
  action: string;
  arg?: string;
  /** Pourquoi on le propose. */
  reason: string;
  /** Nom d'icône du thème (« pick2 », « gear:mask »…). */
  icon: string;
}

/** Achats de progression encore possibles (pas verrouillés, pas déjà acquis), par ordre de priorité. */
export function offers(g: GameState): Offer[] {
  const out: Offer[] = [];
  const pick = PICKAXES[g.pickaxeLevel + 1];
  if (pick)
    out.push({ key: `pick${g.pickaxeLevel + 1}`, tab: 'tools', name: pick.name, price: pick.price, action: 'buyPickaxe', reason: `Prochain palier de pioche : ${pick.description}`, icon: `pick${g.pickaxeLevel + 1}` });
  // L'équipement qu'il faut avoir avant d'atteindre le danger qu'il contre.
  for (const def of GEAR)
    if (!g.hasGear(def.id) && g.stats.maxDepth + 40 >= def.fromDepth)
      out.push({
        key: `gear:${def.id}`,
        tab: 'gear',
        name: def.name,
        price: def.price,
        action: 'buyGear',
        arg: def.id,
        reason: `${HAZARD_LABEL[def.hazard]} dès ${def.fromDepth} m : absorbe ${Math.round(def.absorb * 100)} % des dégâts.`,
        icon: `gear:${def.id}`,
      });
  const bag = BAGS[g.bagLevel + 1];
  if (bag)
    out.push({ key: `bag${g.bagLevel + 1}`, tab: 'transport', name: bag.name, price: bag.price, action: 'buyBag', reason: `Capacité ${kg(g.bag.capacity)} → ${kg(bag.capacity)} : moins d'allers-retours.`, icon: 'bag' });
  if (!g.hasJackhammer && g.pickaxe.tier >= JACKHAMMER.unlock.pickaxeTier)
    out.push({ key: 'jackhammer', tab: 'tools', name: JACKHAMMER.name, price: JACKHAMMER.price, action: 'buyJackhammer', reason: 'Mine sur trois cases de large, très vite.', icon: 'tool:jackhammer' });
  if (!g.hasScooter)
    out.push({ key: 'scooter', tab: 'transport', name: SCOOTER.name, price: SCOOTER.price, action: 'buyScooter', reason: `Touche Maj : on file ${Math.round((SCOOTER.speedMul - 1) * 100)} % plus vite.`, icon: 'tool:scooter' });
  return out;
}

export interface Advice extends Offer {
  /** Assez d'argent pour l'acheter maintenant. */
  can: boolean;
  missing: number;
}

/** Le prochain achat à faire : le premier de la liste de priorité, avec ce qu'il manque pour l'acheter. */
export function workshopAdvice(g: GameState): Advice | null {
  const first = offers(g)[0];
  return first ? { ...first, can: g.money >= first.price, missing: Math.max(0, first.price - g.money) } : null;
}

/** Machines qu'on peut acheter maintenant et qu'on n'a encore jamais eues (ni en stock, ni posées). */
function newMachines(g: GameState): MachineDef[] {
  return MACHINES.filter((m) => g.isUnlocked(m.id) && g.money >= m.price * (m.bridge ? 2 : 1) && !ownedAny(g, m));
}

function ownedAny(g: GameState, m: MachineDef): boolean {
  const inStock = Object.entries(g.inventory.kits).some(([kit, n]) => n > 0 && parseKit(kit).machine === m.id);
  return inStock || g.structures.list.some((s) => s.type === m.id);
}

/** Nombre d'achats possibles tout de suite dans chaque onglet (pastille de l'onglet). */
export function tabBadges(g: GameState): Record<string, number> {
  const badges: Record<string, number> = { tools: 0, transport: 0, gear: 0, machines: newMachines(g).length };
  for (const o of offers(g)) if (g.money >= o.price) badges[o.tab]++;
  // L'équipement qui n'est pas encore « conseillé » s'achète quand même : on le compte aussi.
  for (const def of GEAR) if (!g.hasGear(def.id) && g.money >= def.price && g.stats.maxDepth + 40 < def.fromDepth) badges.gear++;
  return badges;
}

// ------------------------------------------------------------------ briques

const pct = (v: number) => `${Math.round(v * 100)} %`;

/** Icône du thème en image, ou rien si elle n'est pas prête. */
function ico(name: string, cls = 'offer-img'): string {
  const src = themeIcon(name);
  return src ? `<img class="${cls}" src="${src}" alt="">` : '';
}

/** Bouton d'achat ; sans assez d'argent, il est grisé et une barre montre où l'on en est. */
function buyBlock(g: GameState, price: number, action: string, arg?: string, label = 'Acheter'): string {
  const can = g.money >= price;
  const button = btn(action, `${label} — ${money(price)}`, { arg, cls: 'primary', disabled: !can });
  if (can) return `<div class="buy">${button}</div>`;
  const ratio = Math.max(0, Math.min(1, g.money / price));
  return `<div class="buy">${button}<div class="meter" title="${money(g.money)} sur ${money(price)}"><i style="width:${Math.round(ratio * 100)}%"></i></div><small>Il vous manque ${money(price - g.money)}</small></div>`;
}

type CardState = 'buy' | 'owned' | 'plain' | 'locked';

interface CardSpec {
  icon?: string;
  title: string;
  /** Étiquette à côté du titre (« acquis », « porté », « conseillé »…). */
  tag?: string;
  desc: string;
  rows: string;
  state: CardState;
  buy?: string;
  lock?: string;
}

function card(c: CardSpec): string {
  return `<div class="card offer st-${c.state}"><div class="offer-head">${c.icon ? `<div class="offer-ico">${ico(c.icon)}</div>` : ''}<div class="offer-text">
    <h3>${c.title}${c.tag ? ` <span class="tag">${c.tag}</span>` : ''}</h3><p>${c.desc}</p></div></div>${c.rows}${
      c.lock ? `<div class="buy"><small class="lock">🔒 ${c.lock}</small></div>` : (c.buy ?? '')
    }</div>`;
}

/**
 * Bande de paliers : chaque marche porte son icône, son nom et son prix. Celles déjà acquises sont
 * cochées, la marche en main est dorée et la suivante est la cible.
 */
function steps(items: { icon: string; name: string; note: string }[], current: number): string {
  return `<div class="steps">${items
    .map((s, i) => {
      const cls = i < current ? 'owned' : i === current ? 'current' : i === current + 1 ? 'next' : '';
      return `<div class="step ${cls}">${ico(s.icon, 'step-img')}<b>${s.name}</b><small>${i < current ? '✔ acquis' : i === current ? 'en main' : s.note}</small></div>`;
    })
    .join('<i class="step-arrow">›</i>')}</div>`;
}

// ------------------------------------------------------------------ outils

function pickaxeCards(g: GameState): string {
  const cur = g.pickaxe;
  const next = PICKAXES[g.pickaxeLevel + 1];
  const rows = (n: typeof cur, from?: typeof cur) =>
    `${stat('Dégâts par coup', String(from?.damage ?? n.damage), from ? String(n.damage) : undefined)}${stat("Durée d'un coup", `${num(from?.swingTime ?? n.swingTime, 2)} s`, from ? `${num(n.swingTime, 2)} s` : undefined)}${stat(
      'Puissance',
      `${num((from ?? n).damage / (from ?? n).swingTime)} /s`,
      from ? `${num(n.damage / n.swingTime)} /s` : undefined,
    )}`;
  const now = card({ icon: `pick${g.pickaxeLevel}`, title: cur.name, tag: 'en main', desc: cur.description, rows: rows(cur), state: 'plain' });
  if (!next) return `<div class="cards">${now}${card({ title: 'Meilleure pioche atteinte', desc: 'Vous avez la meilleure pioche de cette version du jeu.', rows: '', state: 'owned' })}</div>`;
  return `<div class="cards">${now}${card({
    icon: `pick${g.pickaxeLevel + 1}`,
    title: next.name,
    tag: `niveau ${next.tier}`,
    desc: next.description,
    rows: rows(next, cur),
    state: 'buy',
    buy: buyBlock(g, next.price, 'buyPickaxe'),
  })}</div>`;
}

function jackhammerCard(g: GameState): string {
  const j = JACKHAMMER;
  const rows = `${stat('Cases par coup', `${j.width} de large`)}${stat('Puissance', `${num((j.damage * j.width) / j.swingTime, 0)} /s sur ${j.width} cases`)}${stat('Charbon', `1 unité / ${j.fuel.secondsPerUnit} s, pris dans le sac`)}`;
  if (g.hasJackhammer) {
    const inHand = g.tool === 'jackhammer';
    return card({
      icon: 'tool:jackhammer',
      title: j.name,
      tag: inHand ? 'en main' : 'acquis',
      desc: `${inHand ? 'En main.' : 'Rangé : vous tenez la pioche.'} Touche <kbd>T</kbd> pour passer de l'un à l'autre.`,
      rows: `${rows}${stat('Charbon dans le sac', String(g.inventory.count(j.fuel.res)))}`,
      state: inHand ? 'plain' : 'owned',
    });
  }
  const locked = g.pickaxe.tier < j.unlock.pickaxeTier;
  return card({ icon: 'tool:jackhammer', title: j.name, desc: j.description, rows, state: locked ? 'locked' : 'buy', buy: locked ? undefined : buyBlock(g, j.price, 'buyJackhammer'), lock: locked ? j.unlock.text : undefined });
}

function toolsTab(g: GameState): string {
  const st = steps(
    PICKAXES.map((p) => ({ icon: `pick${PICKAXES.indexOf(p)}`, name: p.name, note: money(p.price) })),
    g.pickaxeLevel,
  );
  return `${st}${pickaxeCards(g)}<h4>Outils mécaniques</h4><div class="cards one">${jackhammerCard(g)}</div>`;
}

// ------------------------------------------------------------------ transport

function transportTab(g: GameState): string {
  const cur = g.bag;
  const next = BAGS[g.bagLevel + 1];
  const st = steps(
    BAGS.map((b) => ({ icon: 'bag', name: b.name, note: money(b.price) })),
    g.bagLevel,
  );
  const speed = (b: typeof cur) => `${Math.round(b.speedMul * 100)} %`;
  const now = card({ icon: 'bag', title: cur.name, tag: 'en main', desc: cur.description, rows: `${stat('Capacité', kg(cur.capacity))}${stat('Vitesse de marche', speed(cur))}`, state: 'plain' });
  const nxt = next
    ? card({
        icon: 'bag',
        title: next.name,
        desc: next.description,
        rows: `${stat('Capacité', kg(cur.capacity), kg(next.capacity))}${stat('Vitesse de marche', speed(cur), speed(next))}`,
        state: 'buy',
        buy: buyBlock(g, next.price, 'buyBag'),
      })
    : card({ title: 'Transport personnel au maximum', desc: 'Pour transporter davantage, automatisez : foreuses, convoyeurs et coffres.', rows: '', state: 'owned' });
  const s = SCOOTER;
  const scooter = g.hasScooter
    ? card({
        icon: 'tool:scooter',
        title: s.name,
        tag: 'acquise',
        desc: 'Maintenez <kbd>Maj</kbd> pour monter dessus, relâchez pour en descendre. Vous ne pouvez pas miner en roulant.',
        rows: `${stat('Vitesse de marche', pct(s.speedMul))}${stat('Commande', 'Maj maintenue')}`,
        state: 'owned',
      })
    : card({
        icon: 'tool:scooter',
        title: s.name,
        desc: s.description,
        rows: `${stat('Vitesse de marche', '100 %', pct(s.speedMul))}${stat('Commande', 'maintenir Maj (relâcher : on descend)')}${stat('Minage', 'impossible en roulant')}`,
        state: 'buy',
        buy: buyBlock(g, s.price, 'buyScooter'),
      });
  return `${st}<div class="cards">${now}${nxt}</div><h4>Moyen de déplacement</h4><div class="cards one">${scooter}</div>`;
}

// ------------------------------------------------------------------ équipement

/** Ce que la pièce change, danger par danger : « sans → avec ». */
function gearFacts(def: GearDef): string {
  const keep = 1 - def.absorb;
  switch (def.hazard) {
    case 'cavein':
      return stat('Éboulement', `${CAVE_IN.damage} dégâts`, `${num(CAVE_IN.damage * keep, 0)}`);
    case 'gas':
      return stat('Grisou', `${GAS.dps} / s`, `${num(GAS.dps * keep)} / s`);
    case 'water':
      return `${stat('Eau profonde', `${WATER.dps} / s`, `${num(WATER.dps * keep)} / s`)}${stat("Marche dans l'eau", pct(WATER.slowShallow), pct(BOOTS_WATER.shallow))}${stat('Marche en eau profonde', pct(WATER.slowDeep), pct(BOOTS_WATER.deep))}`;
    case 'heat':
      return stat('Chaleur', `${num(HEAT.hurtTop)} à ${num(HEAT.hurtBottom)} / s`, `${num(HEAT.hurtTop * keep, 2)} à ${num(HEAT.hurtBottom * keep, 2)} / s`);
  }
}

function gearTab(g: GameState): string {
  // Les pièces qu'on est en train de rejoindre passent en premier.
  const soon = (d: GearDef) => !g.hasGear(d.id) && g.stats.maxDepth + 40 >= d.fromDepth;
  const list = [...GEAR].sort((a, b) => Number(soon(b)) - Number(soon(a)));
  const cards = list
    .map((def) => {
      const owned = g.hasGear(def.id);
      const rows = `${stat(`${HAZARD_LABEL[def.hazard]} (dès ${def.fromDepth} m)`, `−${Math.round(def.absorb * 100)} % de dégâts`)}${gearFacts(def)}`;
      return card({
        icon: `gear:${def.id}`,
        title: def.name,
        tag: owned ? 'porté' : soon(def) ? 'conseillé' : def.slotName.toLowerCase(),
        desc: def.description,
        rows,
        state: owned ? 'owned' : 'buy',
        buy: owned ? undefined : buyBlock(g, def.price, 'buyGear', def.id),
      });
    })
    .join('');
  const worn = GEAR.filter((d) => g.hasGear(d.id)).length;
  return `<p class="shop-hint">Chaque pièce absorbe une part des dégâts d'un danger précis, dès l'achat (${worn} sur ${GEAR.length} portées). Dégâts en points de vie, sur ${HEALTH.max} : « sans → avec ».</p><div class="cards gear-cards">${cards}</div>`;
}

// ------------------------------------------------------------------ machines

/** Chiffres utiles d'une machine, en étiquettes courtes. */
function machineSpecs(m: MachineDef): [string, string][] {
  const s = m.stats;
  if (m.conveyor) return [['Vitesse', `${num(s.speed, 2)} case/s`], ['Débit', `${num(conveyorThroughput(m))} /s`]];
  if (m.id === 'splitter') return [['Sorties', '3, à tour de rôle'], ['Débit', `${num(s.speed * s.capacity)} /s`]];
  if (m.id === 'sorter') return [['Tout droit', 'les minerais choisis'], ['Côtés', 'tout le reste']];
  if (m.bridge) return [['Portée', `jusqu'à ${m.bridge.range} cases`], ['Vendu', 'par paire']];
  if (m.shipping) return [['Vente', `toutes les ${m.shipping.interval} s`], ['Capacité', kg(s.capacity)], ['Pose', 'en surface']];
  if (m.id === 'storage') return [['Capacité', kg(s.capacity)]];
  if (m.id === 'rail') return [['Pose', 'en glissant'], ['Virages', 'automatiques']];
  if (m.onTrack) return [['Vitesse', `${num(s.speed)} cases/s`], ['Capacité', kg(s.capacity)], ['Passager', 'touche F']];
  if (m.station) return [['Tampon', kg(s.capacity)], ['Transfert', `${num(s.speed)} /s`]];
  if (m.railSwitch) return [['Branches', 'tout droit, gauche, droite'], ['Mode', 'fixe ou alterné']];
  if (m.id === 'prop') return [['Protège', '3 cases autour (7×7)'], ['Passage', 'on passe dessous']];
  if (m.id === 'fan') return [['Grisou', `${GAS.fanRadius} cases`], ['Chaleur', `rafraîchit à ${HEAT.fanRadius} cases`], ['Énergie', 'aucune']];
  if (m.id === 'pump') return [['Portée', `${WATER.pumpRadius} cases`], ['Énergie', 'aucune']];
  if (m.smelter && m.fuel)
    return [
      ['Vitesse', `1 lingot / ${num(m.smelter.smeltTime)} s`],
      ['Charbon', `1 unité / ${num(m.fuel.secondsPerUnit / m.smelter.smeltTime, 0)} lingots`],
      ['Lingot', '2,5 × le prix du minerai'],
      ...(m.w > 1 ? [['Taille', `${m.w}×${m.h} cases`] as [string, string]] : []),
    ];
  if (m.borer && m.fuel)
    return [
      ['Tunnel', "jusqu'à 50 cases, ou sans limite"],
      ['Roche', "jusqu'à la roche volcanique"],
      ['Charbon', `1 unité / ${m.fuel.secondsPerUnit} s de perçage`],
      ['Plein', `${m.levels?.[0].borer?.tankUnits ?? 0} unités par sortie, puis retour à la base`],
      ['Améliorable', `jusqu'au niveau ${m.levels?.length ?? 1} (touche E sur la base)`],
    ];
  const out: [string, string][] = [];
  if (s.speed) out.push(['Cadence', `${num(s.speed * 60, 0)} /min`]);
  if (m.fuel) out.push(['Charbon', `1 unité / ${m.fuel.secondsPerUnit} s`], ['Réservoir', `${m.fuel.maxUnits} unités`]);
  if (m.levels && m.levels.length > 1) out.push(['Améliorable', `jusqu'au niveau ${m.levels.length} (touche E dessus)`]);
  if (s.power) out.push(['Consommation', `${s.power} kW`]);
  return out;
}

/** Quantités proposées à l'achat : les ponts se vendent par paire, les convoyeurs par dizaines… */
function quantities(m: MachineDef): number[] {
  return m.conveyor ? [1, 10] : m.bridge ? [2] : m.dragPlace ? [10, 50] : m.id === 'prop' ? [1, 5] : [1];
}

/** Nombre de caractéristiques montrées sans déplier. */
const SPEC_PREVIEW = 3;

function machineRow(g: GameState, m: MachineDef, icon: (id: string) => string, open: boolean): string {
  const unlocked = g.isUnlocked(m.id);
  const img = icon(m.id);
  const ico$ = `<div class="shop-icon">${img ? `<img src="${img}" alt="">` : ''}</div>`;
  const level = m.conveyor ? `<span class="lvl">N${m.stats.level}</span>` : '';
  if (!unlocked)
    return `<div class="shop-row locked" title="${esc(m.description)}">${ico$}<div class="shop-main"><div class="shop-title">${m.name}${level}</div><div class="shop-sum">🔒 ${m.unlock?.text ?? 'Verrouillée'}</div></div></div>`;
  const owned = g.inventory.kitCount(m.id);
  // Machines améliorées démontées, rangées avec leur niveau.
  const upgraded = Object.entries(g.inventory.kits)
    .filter(([kit, n]) => n > 0 && parseKit(kit).machine === m.id && parseKit(kit).level > 1)
    .map(([kit, n]) => `<b>${n}</b> niv. ${parseKit(kit).level}`)
    .join(', ');
  const placed = g.structures.list.filter((s) => s.type === m.id).length;
  const qtys = quantities(m);
  const label = (q: number) => (m.bridge ? `Paire · ${money(m.price * q)}` : q > 1 ? `×${q} · ${money(m.price * q)}` : `Acheter · ${money(m.price)}`);
  const cheapest = m.price * qtys[0];
  const all = machineSpecs(m);
  const shown = open ? all : all.slice(0, SPEC_PREVIEW);
  const specs = shown.map(([k, v]) => `<span class="spec"><i>${k}</i>${v}</span>`).join('');
  const more = all.length > SPEC_PREVIEW || m.description.length > m.summary.length;
  const stock = owned || upgraded || placed ? `${owned ? `<b>${owned}</b> en stock` : ''}${upgraded ? ` (+ ${upgraded})` : ''}${placed ? `${owned || upgraded ? ' · ' : ''}<b>${placed}</b> posé${placed > 1 ? 's' : ''}` : ''}` : 'jamais acheté';
  return `<div class="shop-row ${open ? 'open' : ''}">${ico$}
    <div class="shop-main">
      <div class="shop-title">${m.name}${level}<span class="stock">${stock}</span></div>
      <div class="shop-sum">${open ? m.description : m.summary}</div>
      <div class="specs">${specs}${more ? btn('shopMore', open ? 'Moins ▴' : 'Détails ▾', { arg: m.id, cls: 'small link' }) : ''}</div>
    </div>
    <div class="shop-side">
      <div class="buy-row">${qtys.map((q) => btn('buyKit', label(q), { arg: `${m.id}:${q}`, cls: 'primary', disabled: g.money < m.price * q })).join('')}</div>
      ${g.money < cheapest ? `<small class="miss">Il manque ${money(cheapest - g.money)}</small>` : ''}
    </div>
  </div>`;
}

/** Filtres du magasin de machines : une rangée de catégories et le réglage « achetables ». */
function shopFilters(g: GameState, view: ShopView): string {
  const can = (m: MachineDef) => g.isUnlocked(m.id) && g.money >= m.price * quantities(m)[0];
  const inGroup = (grp: (typeof MACHINE_GROUPS)[number]) => MACHINES.filter((m) => grp.categories.includes(m.category));
  const shown = (m: MachineDef) => !view.only || can(m);
  const total = MACHINES.filter(shown).length;
  const chip = (id: string, label: string, n: number) =>
    btn('shopCat', `${label}<i>${n}</i>`, { arg: id, cls: `small chip ${view.cat === id ? 'on' : 'off'}`, disabled: false });
  const chips = [chip('all', 'Tout', total), ...MACHINE_GROUPS.map((grp) => chip(grp.id, grp.tab, inGroup(grp).filter(shown).length))].join('');
  const only = btn('shopOnly', view.only ? '✔ Achetables' : 'Achetables', { cls: `small ${view.only ? 'on' : 'off'}`, title: 'Cacher ce que vous ne pouvez pas acheter maintenant' });
  return `<div class="shop-filters"><div class="chips">${chips}</div>${only}</div>`;
}

function machinesTab(g: GameState, icon: (id: string) => string, view: ShopView): string {
  const can = (m: MachineDef) => g.isUnlocked(m.id) && g.money >= m.price * quantities(m)[0];
  const inGroup = (grp: (typeof MACHINE_GROUPS)[number]) => MACHINES.filter((m) => grp.categories.includes(m.category));
  const shown = (m: MachineDef) => !view.only || can(m);
  const groups = MACHINE_GROUPS.filter((grp) => view.cat === 'all' || view.cat === grp.id)
    .map((grp) => {
      const rows = inGroup(grp).filter(shown);
      if (!rows.length) return '';
      return `<section class="shop-group"><h4>${grp.title}</h4>${rows.map((m) => machineRow(g, m, icon, view.open.has(m.id))).join('')}</section>`;
    })
    .join('');
  const empty = `<p class="empty">${view.only ? 'Rien à acheter pour le moment ici : gagnez de l\'argent au comptoir, ou affichez aussi ce que vous ne pouvez pas encore payer.' : 'Aucune machine dans cette catégorie.'}</p>`;
  return `${groups || empty}<p class="hint">Les machines achetées se rangent dans vos kits (touche <kbd>I</kbd>) et se posent avec <kbd>B</kbd>.</p>`;
}

// ------------------------------------------------------------------ panneau

/** Bande « Conseil » : le prochain achat utile, avec le bouton pour l'acheter ou la barre qui s'en approche. */
function adviceBar(g: GameState): string {
  const a = workshopAdvice(g);
  if (!a) return `<div class="advice done"><b>Atelier au complet.</b><span>Il ne reste que les machines : achetez-les dans l'onglet Machines.</span></div>`;
  const ratio = Math.max(0, Math.min(1, g.money / a.price));
  const right = a.can
    ? btn(a.action, `Acheter — ${money(a.price)}`, { arg: a.arg, cls: 'primary small' })
    : `<div class="meter" title="${money(g.money)} sur ${money(a.price)}"><i style="width:${Math.round(ratio * 100)}%"></i></div><small>Il manque ${money(a.missing)}</small>${btn('tab', 'Voir', { arg: a.tab, cls: 'small' })}`;
  return `<div class="advice ${a.can ? 'ok' : ''}">${ico(a.icon, 'advice-img')}<div class="advice-text"><b>Conseil : ${a.name}</b><span>${a.reason}</span></div><div class="advice-act">${right}</div></div>`;
}

function tabBar(g: GameState, tab: string): string {
  const badges = tabBadges(g);
  return `<div class="tabs">${WORKSHOP_TABS.map(([id, label], i) => {
    const n = badges[id];
    return `<button class="tab ${tab === id ? 'active' : ''}" data-action="tab" data-arg="${id}" title="${label} (touche ${i + 1})"><kbd class="tab-key">${i + 1}</kbd>${label}${
      n ? `<span class="badge" title="${n} achat${n > 1 ? 's' : ''} possible${n > 1 ? 's' : ''} tout de suite">${n}</span>` : ''
    }</button>`;
  }).join('')}</div>`;
}

export function workshopPanel(g: GameState, tab: string, icon: (id: string) => string = () => '', view: ShopView = DEFAULT_VIEW): string {
  const id = isWorkshopTab(tab) ? tab : 'tools';
  const body = id === 'tools' ? toolsTab(g) : id === 'transport' ? transportTab(g) : id === 'gear' ? gearTab(g) : machinesTab(g, icon, view);
  // Le conseil défile avec la liste ; les onglets (et les filtres des machines) restent collés en haut.
  return `${adviceBar(g)}<div class="shop-nav">${tabBar(g, id)}${id === 'machines' ? shopFilters(g, view) : ''}</div>${body}`;
}
