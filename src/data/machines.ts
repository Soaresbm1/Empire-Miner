/**
 * Machines et structures constructibles.
 *
 * Chaque machine expose des statistiques homogènes (vitesse, consommation,
 * capacité, efficacité, niveau, coût) afin que les futures machines
 * (trieurs, concasseurs, fonderies, générateurs…) s'intègrent sans changer l'UI.
 */

export type MachineCategory = 'extraction' | 'traitement' | 'logistique' | 'rail' | 'stockage' | 'vente' | 'securite';

export interface MachineStats {
  /** Extraction : unités/s. Convoyeur : tuiles/s. */
  speed: number;
  /** Consommation électrique (kW). 0 = aucune (mécanique ou combustion). */
  power: number;
  /** Convoyeur : objets par tuile. Stockage : kg. Foreuse : tampon de sortie. */
  capacity: number;
  /** Efficacité (1 = 100 %) : unités extraites par unité de réserve consommée. */
  efficiency: number;
  level: number;
}

export interface FuelSpec {
  res: string;
  /** Secondes de fonctionnement par unité de combustible. */
  secondsPerUnit: number;
  /** Nombre max d'unités stockées dans la machine. */
  maxUnits: number;
}

export interface ShippingSpec {
  /** Intervalle entre deux passages du transporteur (s). */
  interval: number;
}

export interface BorerSpec {
  /** Niveau de roche maximal qu'elle peut percer. */
  tier: number;
  /** Longueurs de tunnel proposées dans son panneau (0 = sans limite). */
  lengths: number[];
  /** Minerai que la base peut garder (benne vidée au retour), en morceaux. */
  store: number;
}

export interface MachineGroup {
  id: string;
  /** Titre dans le magasin. */
  title: string;
  /** Nom court de l'onglet de la barre de construction. */
  tab: string;
  /** Machine dont l'icône illustre l'onglet. */
  icon: string;
  categories: MachineCategory[];
}

/** Groupes de machines, dans l'ordre du magasin et de la barre de construction. */
export const MACHINE_GROUPS: MachineGroup[] = [
  { id: 'extraction', title: 'Extraction', tab: 'Extraction', icon: 'drill', categories: ['extraction'] },
  { id: 'traitement', title: 'Traitement', tab: 'Fonte', icon: 'furnace', categories: ['traitement'] },
  { id: 'transport', title: 'Transport', tab: 'Transport', icon: 'conveyor', categories: ['logistique'] },
  { id: 'rail', title: 'Wagonnets et rails', tab: 'Rails', icon: 'wagon', categories: ['rail'] },
  { id: 'stockage', title: 'Stockage et vente', tab: 'Stockage', icon: 'storage', categories: ['stockage', 'vente'] },
  { id: 'securite', title: 'Sécurité', tab: 'Sécurité', icon: 'prop', categories: ['securite'] },
];

/** Four et fonderie : minerai → lingot, au charbon. */
export interface SmelterSpec {
  /** Temps pour fondre un minerai en lingot (s). */
  smeltTime: number;
  /** Minerai en attente de fonte (morceaux). */
  inputMax: number;
  /** Lingots prêts à sortir (morceaux). */
  outputMax: number;
}

/** Foreuse de percement : ce que change chaque niveau d'amélioration. */
export interface BorerLevelSpec {
  /** Dégâts infligés par seconde à la case percée. */
  damagePerSecond: number;
  /** Temps pour rouler d'une case dans le tunnel, à l'aller comme au retour (s). */
  moveTime: number;
  /** Charbon emporté par la foreuse à chaque sortie (unités prises dans la base). */
  tankUnits: number;
  /** Largeur du tunnel : 1, ou 3 (la tête perce aussi la case à gauche et à droite). */
  width: 1 | 3;
  /** Benne : morceaux de minerai ramassés et ramenés à la base (0 = pas de benne). */
  hopper: number;
}

export interface BridgeSpec {
  /** Distance maximale (en cases) entre un pont d'entrée et son pont de sortie. */
  range: number;
}

/** Case exploitée par une foreuse, relative à sa flèche de sortie (devant). */
export type ReachSide = 'under' | 'left' | 'right' | 'back';

/** Niveau d'amélioration d'une machine (acheté sur la machine posée). */
export interface MachineLevel {
  level: number;
  /** Nom de l'amélioration (foreuse de percement). */
  name?: string;
  /** Prix de l'amélioration vers ce niveau (0 pour le niveau de base). */
  price: number;
  /** Foreuse à charbon : cases exploitées. */
  reach?: ReachSide[];
  /** Foreuse de percement : caractéristiques à ce niveau. */
  borer?: BorerLevelSpec;
  /** Condition supplémentaire (niveau de pioche). */
  unlock?: { pickaxeTier: number; text: string };
  /** Résumé affiché dans le panneau de la machine. */
  summary: string;
}

export interface MachineDef {
  id: string;
  name: string;
  category: MachineCategory;
  description: string;
  /** Résumé d'une ligne affiché dans le magasin. */
  summary: string;
  price: number;
  w: number;
  h: number;
  /** Bloque le passage du joueur. */
  solid: boolean;
  rotatable: boolean;
  stats: MachineStats;
  fuel?: FuelSpec;
  /** Condition de déblocage (texte + test sur le niveau de pioche). */
  unlock?: { pickaxeTier: number; text: string };
  /** Doit être posée sur un gisement exposé. */
  needsDeposit?: boolean;
  /** Ne peut être posée qu'en surface (au camp). */
  surfaceOnly?: boolean;
  /** Vente automatique (caisse d'expédition). */
  shipping?: ShippingSpec;
  /** Convoyeur (tous niveaux) : se trace en glissant et peut remplacer un autre convoyeur. */
  conveyor?: boolean;
  /** Couleur d'accent (liseré des convoyeurs). */
  accent?: string;
  /** Pont de convoyeur (se pose par paire). */
  bridge?: BridgeSpec;
  /** Fait partie de la voie des wagonnets (rails et quais). */
  track?: boolean;
  /** Se pose en glissant, case après case (rails). */
  dragPlace?: boolean;
  /** Se pose sur des rails (wagonnet). */
  onTrack?: boolean;
  /** Quai : remplit ('load') ou vide ('unload') les wagonnets. */
  station?: 'load' | 'unload';
  /** Aiguillage : se pose sur un embranchement (remplace un rail simple). */
  railSwitch?: boolean;
  /** Niveaux d'amélioration, du niveau de base (1) au niveau maximal. */
  levels?: MachineLevel[];
  /** Foreuse de percement : base fixe d'où sort une foreuse qui perce un tunnel droit. */
  borer?: BorerSpec;
  /** Four ou fonderie : fond le minerai en lingots. */
  smelter?: SmelterSpec;
}

export const MACHINES: MachineDef[] = [
  {
    id: 'conveyor',
    name: 'Convoyeur',
    summary: "Transporte le minerai dans le sens de la flèche.",
    category: 'logistique',
    description: 'Transporte les minerais dans la direction de la flèche. Débit limité : il peut saturer.',
    price: 6,
    w: 1,
    h: 1,
    solid: false,
    rotatable: true,
    stats: { speed: 0.75, power: 0, capacity: 3, efficiency: 1, level: 1 },
    conveyor: true,
    accent: '#6a6b74',
  },
  {
    id: 'conveyor_fast',
    name: 'Convoyeur rapide',
    summary: "Deux fois plus rapide. Posez-le sur un convoyeur pour l'améliorer.",
    category: 'logistique',
    description: 'Deux fois plus rapide. Posez-le sur un convoyeur existant pour l\'améliorer sur place.',
    price: 15,
    w: 1,
    h: 1,
    solid: false,
    rotatable: true,
    stats: { speed: 1.5, power: 0, capacity: 3, efficiency: 1, level: 2 },
    conveyor: true,
    accent: '#d0503a',
    unlock: { pickaxeTier: 2, text: 'Nécessite la Pioche améliorée' },
  },
  {
    id: 'conveyor_express',
    name: 'Convoyeur express',
    summary: "Quatre fois plus rapide que le convoyeur de base.",
    category: 'logistique',
    description: 'Quatre fois plus rapide que le convoyeur de base. Pour les grandes lignes principales.',
    price: 40,
    w: 1,
    h: 1,
    solid: false,
    rotatable: true,
    stats: { speed: 3, power: 0, capacity: 3, efficiency: 1, level: 3 },
    conveyor: true,
    accent: '#4d8fe0',
    unlock: { pickaxeTier: 3, text: 'Nécessite la Pioche en fer' },
  },
  {
    id: 'splitter',
    name: 'Séparateur',
    summary: "Partage une ligne entre l'avant, la gauche et la droite.",
    category: 'logistique',
    description: "Le minerai entre par l'arrière et ressort à tour de rôle devant, à gauche et à droite. Les sorties bloquées ou vides sont sautées.",
    price: 35,
    w: 1,
    h: 1,
    solid: false,
    rotatable: true,
    stats: { speed: 3, power: 0, capacity: 3, efficiency: 1, level: 1 },
    accent: '#e0b84a',
    unlock: { pickaxeTier: 2, text: 'Nécessite la Pioche améliorée' },
  },
  {
    id: 'sorter',
    name: 'Trieur',
    summary: "Envoie le minerai choisi tout droit, le reste sur les côtés.",
    category: 'logistique',
    description: "Le minerai entre par l'arrière. Le minerai choisi (touche E) part tout droit, tout le reste part sur les côtés.",
    price: 60,
    w: 1,
    h: 1,
    solid: false,
    rotatable: true,
    stats: { speed: 3, power: 0, capacity: 3, efficiency: 1, level: 1 },
    accent: '#5fc0b0',
    unlock: { pickaxeTier: 2, text: 'Nécessite la Pioche améliorée' },
  },
  {
    id: 'bridge',
    name: 'Pont de convoyeur',
    summary: "Fait passer une ligne par-dessus une autre.",
    category: 'logistique',
    description: 'Se pose par paire, dans la même direction : le minerai passe au-dessus de ce qui se trouve entre les deux ponts. Idéal pour croiser deux lignes.',
    price: 25,
    w: 1,
    h: 1,
    solid: false,
    rotatable: true,
    stats: { speed: 3, power: 0, capacity: 3, efficiency: 1, level: 1 },
    bridge: { range: 5 },
    unlock: { pickaxeTier: 2, text: 'Nécessite la Pioche améliorée' },
  },
  {
    id: 'rail',
    name: 'Rails',
    summary: 'Voie des wagonnets. Se pose en glissant, les virages se font seuls.',
    category: 'rail',
    description: 'Rails pour wagonnets. Posez-les en glissant : ils se raccordent automatiquement (lignes droites et virages). Le joueur peut marcher dessus.',
    price: 2,
    w: 1,
    h: 1,
    solid: false,
    rotatable: false,
    stats: { speed: 0, power: 0, capacity: 0, efficiency: 1, level: 1 },
    track: true,
    dragPlace: true,
  },
  {
    id: 'rail_switch',
    name: 'Aiguillage',
    summary: 'Choisit la branche que prennent les wagonnets à un embranchement.',
    category: 'rail',
    description:
      "Se pose sur un embranchement (il remplace le rail qui s'y trouve). Les wagonnets qui arrivent par la pointe (flèche, tournée avec R) prennent la branche choisie avec E : tout droit, à gauche, à droite ou en alternance. Ceux qui reviennent par une branche repartent vers la pointe.",
    price: 20,
    w: 1,
    h: 1,
    solid: false,
    rotatable: true,
    stats: { speed: 0, power: 0, capacity: 0, efficiency: 1, level: 1 },
    track: true,
    railSwitch: true,
  },
  {
    id: 'wagon',
    name: 'Wagonnet',
    summary: "Fait l'aller-retour sur les rails. On peut monter dedans (E).",
    category: 'rail',
    description: "Se pose sur des rails. Il roule jusqu'au bout de la ligne puis repart dans l'autre sens ; il s'arrête aux quais pour charger ou décharger. Montez dedans avec E pour voyager.",
    price: 60,
    w: 1,
    h: 1,
    solid: false,
    rotatable: true,
    stats: { speed: 6, power: 0, capacity: 100, efficiency: 1, level: 1 },
    onTrack: true,
  },
  {
    id: 'rail_load',
    name: 'Quai de chargement',
    summary: "Remplit les wagonnets. Alimentez-le par convoyeur, foreuse, coffre ou avec votre sac.",
    category: 'rail',
    description: "Fait partie de la voie (en général au bout de la ligne). Il reçoit le minerai des convoyeurs, foreuses et coffres collés, ou de votre sac (E), et le charge dans le wagonnet qui s'arrête. Le wagonnet repart quand il est plein, ou quand il n'y a plus rien à charger.",
    price: 30,
    w: 1,
    h: 1,
    solid: false,
    rotatable: false,
    stats: { speed: 20, power: 0, capacity: 60, efficiency: 1, level: 1 },
    track: true,
    station: 'load',
  },
  {
    id: 'rail_unload',
    name: 'Quai de déchargement',
    summary: 'Vide les wagonnets et envoie le minerai dans ce qui est collé.',
    category: 'rail',
    description: "Fait partie de la voie (en général au bout de la ligne). Il vide le wagonnet qui s'arrête, puis envoie le minerai dans ce qui est collé : convoyeur, coffre ou caisse d'expédition.",
    price: 30,
    w: 1,
    h: 1,
    solid: false,
    rotatable: false,
    stats: { speed: 20, power: 0, capacity: 60, efficiency: 1, level: 1 },
    track: true,
    station: 'unload',
  },
  {
    id: 'drill',
    name: 'Foreuse à charbon',
    summary: "Extrait le gisement sous elle. Brûle du charbon. Améliorable : fore aussi les cases voisines.",
    category: 'extraction',
    description: 'Extrait le gisement sous elle et pousse le minerai vers l\'avant (ou dans un convoyeur collé). Brûle du charbon.',
    price: 220,
    w: 1,
    h: 1,
    solid: true,
    rotatable: true,
    stats: { speed: 0.4, power: 0, capacity: 8, efficiency: 1, level: 1 },
    fuel: { res: 'coal', secondsPerUnit: 30, maxUnits: 10 },
    unlock: { pickaxeTier: 2, text: 'Nécessite la Pioche améliorée' },
    needsDeposit: true,
    // Chaque niveau ajoute des têtes de forage sur les cases voisines (la sortie reste devant) :
    // chaque case couverte qui a un gisement produit à la cadence de base, pour le même charbon.
    levels: [
      { level: 1, price: 0, reach: ['under'], summary: 'Fore la case sous elle.' },
      { level: 2, price: 280, reach: ['under', 'left', 'right'], summary: 'Fore aussi les cases à gauche et à droite.' },
      {
        level: 3,
        price: 650,
        reach: ['under', 'left', 'right', 'back'],
        unlock: { pickaxeTier: 3, text: 'Nécessite la Pioche en fer' },
        summary: 'Fore aussi la case derrière elle.',
      },
    ],
  },
  {
    id: 'borer',
    name: 'Foreuse de percement',
    summary: 'Base fixe d’où sort une foreuse qui perce seule un tunnel droit, puis revient faire le plein. Brûle du charbon.',
    category: 'extraction',
    description:
      "La base reste où vous la posez ; la foreuse en sort pour percer tout droit devant la flèche, jusqu'au basalte, et y revient quand elle n'a plus de charbon ou ne peut plus percer. Les minerais tombent derrière elle, dans le tunnel. Chargez la base en charbon, réglez la longueur et démarrez-la avec E.",
    price: 1200,
    w: 1,
    h: 1,
    solid: true,
    rotatable: true,
    stats: { speed: 6, power: 0, capacity: 0, efficiency: 1, level: 1 },
    fuel: { res: 'coal', secondsPerUnit: 20, maxUnits: 20 },
    unlock: { pickaxeTier: 3, text: 'Nécessite la Pioche en fer' },
    borer: { tier: 3, lengths: [10, 25, 50, 0], store: 120 },
    // Améliorations achetées sur la base (foreuse rangée) ; chaque niveau garde les précédents.
    levels: [
      {
        level: 1,
        price: 0,
        summary: "Tunnel d'une case de large, 2 unités de charbon par sortie.",
        borer: { damagePerSecond: 6, moveTime: 0.35, tankUnits: 2, width: 1, hopper: 0 },
      },
      {
        level: 2,
        name: 'Moteur renforcé',
        price: 600,
        summary: 'Perce 2 fois plus vite, roule plus vite et emporte 4 unités de charbon.',
        borer: { damagePerSecond: 12, moveTime: 0.22, tankUnits: 4, width: 1, hopper: 0 },
      },
      {
        level: 3,
        name: 'Tête large',
        price: 1100,
        summary: 'Tunnel de 3 cases de large : la tête perce aussi à gauche et à droite.',
        borer: { damagePerSecond: 12, moveTime: 0.22, tankUnits: 4, width: 3, hopper: 0 },
      },
      {
        level: 4,
        name: 'Benne à minerai',
        price: 1800,
        summary: 'Ramasse le minerai percé (30 morceaux) et le ramène à la base, qui le pousse dans un convoyeur ou un coffre collé.',
        borer: { damagePerSecond: 12, moveTime: 0.22, tankUnits: 4, width: 3, hopper: 30 },
      },
    ],
  },
  {
    id: 'furnace',
    name: 'Four',
    summary: 'Fond le minerai en lingots, vendus 2,5 fois plus cher. Brûle du charbon.',
    category: 'traitement',
    description:
      "Reçoit le minerai par un convoyeur ou à la main, sur n'importe quel côté sauf sa sortie, le fond en lingots au charbon et les pousse devant sa flèche. Cuivre, fer, argent et or.",
    price: 350,
    w: 1,
    h: 1,
    solid: true,
    rotatable: true,
    stats: { speed: 1 / 3, power: 0, capacity: 12, efficiency: 1, level: 1 },
    fuel: { res: 'coal', secondsPerUnit: 24, maxUnits: 10 },
    unlock: { pickaxeTier: 2, text: 'Nécessite la Pioche améliorée' },
    smelter: { smeltTime: 3, inputMax: 12, outputMax: 12 },
  },
  {
    id: 'foundry',
    name: 'Fonderie',
    summary: 'Grande fonderie de 2×2 cases : 6 fois plus rapide qu’un four et bien plus économe en charbon.',
    category: 'traitement',
    description:
      'Un haut fourneau pour les grosses lignes : même principe que le four (entrée sur les côtés et à l’arrière, lingots poussés devant la flèche), mais un lingot toutes les demi-secondes.',
    price: 1500,
    w: 2,
    h: 2,
    solid: true,
    rotatable: true,
    stats: { speed: 2, power: 0, capacity: 40, efficiency: 1, level: 1 },
    fuel: { res: 'coal', secondsPerUnit: 15, maxUnits: 20 },
    unlock: { pickaxeTier: 3, text: 'Nécessite la Pioche en fer' },
    smelter: { smeltTime: 0.5, inputMax: 40, outputMax: 40 },
  },
  {
    id: 'prop',
    name: 'Étai',
    summary: "Consolide le plafond : pas d'éboulement à 3 cases autour de lui. On passe dessous.",
    category: 'securite',
    description:
      "Poteaux et poutre de bois. En profondeur (dès 60 m), une grande salle creusée à la main finit par craquer : un étai posé à moins de 3 cases l'empêche de s'effondrer, même pendant qu'elle craque.",
    price: 15,
    w: 1,
    h: 1,
    solid: false,
    rotatable: false,
    stats: { speed: 0, power: 0, capacity: 0, efficiency: 1, level: 1 },
  },
  {
    id: 'fan',
    name: 'Ventilateur',
    summary: 'Chasse le grisou à 6 cases autour de lui, en quelques secondes. Tourne tout seul.',
    category: 'securite',
    description: "Grande hélice qui aspire le grisou libéré par une poche percée (dès 120 m). Posé près d'un front de taille, il garde la galerie respirable.",
    price: 180,
    w: 1,
    h: 1,
    solid: true,
    rotatable: false,
    stats: { speed: 0, power: 0, capacity: 0, efficiency: 1, level: 1 },
    unlock: { pickaxeTier: 2, text: 'Nécessite la Pioche améliorée' },
  },
  {
    id: 'pump',
    name: 'Pompe',
    summary: "Assèche les galeries inondées à 5 cases autour d'elle. Tourne toute seule, sans charbon.",
    category: 'securite',
    description: "Pompe pour les poches d'eau (dès 70 m). Posée près d'une galerie inondée, elle se met en marche toute seule et l'assèche en quelques secondes.",
    price: 240,
    w: 1,
    h: 1,
    solid: true,
    rotatable: false,
    stats: { speed: 0, power: 0, capacity: 0, efficiency: 1, level: 1 },
    unlock: { pickaxeTier: 2, text: 'Nécessite la Pioche améliorée' },
  },
  {
    id: 'storage',
    name: 'Coffre de stockage',
    summary: "Stocke le minerai, le renvoie sur les convoyeurs, recharge les foreuses.",
    category: 'stockage',
    description: 'Reçoit les minerais, se vide dans les convoyeurs qui en partent et recharge en charbon les foreuses collées. Vous pouvez y déposer votre sac.',
    price: 45,
    w: 1,
    h: 1,
    solid: true,
    rotatable: false,
    stats: { speed: 0, power: 0, capacity: 150, efficiency: 1, level: 1 },
  },
  {
    id: 'shipping',
    name: "Caisse d'expédition",
    summary: "Vend automatiquement tout ce qui y entre.",
    category: 'vente',
    description: 'Vend automatiquement tout ce qui y entre, au prix du comptoir. Un transporteur la vide régulièrement. Se pose en surface.',
    price: 180,
    w: 1,
    h: 1,
    solid: true,
    rotatable: false,
    // capacity : kg en attente du transporteur ; efficiency : part du prix du comptoir.
    stats: { speed: 0, power: 0, capacity: 120, efficiency: 1, level: 1 },
    shipping: { interval: 15 },
    unlock: { pickaxeTier: 2, text: 'Nécessite la Pioche améliorée' },
    surfaceOnly: true,
  },
];

const byId = new Map(MACHINES.map((m) => [m.id, m]));

/**
 * Identifiant de kit de construction : la machine seule (« drill ») au niveau 1,
 * ou la machine et son niveau (« drill@3 ») pour une machine améliorée qu'on a
 * démontée : reposée, elle garde son niveau.
 */
export function kitId(machineId: string, level = 1): string {
  return level > 1 ? `${machineId}@${level}` : machineId;
}

export function parseKit(kit: string): { machine: string; level: number } {
  const [machine, lvl] = kit.split('@');
  return { machine, level: lvl ? Math.max(1, Math.floor(Number(lvl)) || 1) : 1 };
}

/** Nom affiché d'un kit, avec son niveau s'il est amélioré. */
export function kitName(kit: string): string {
  const { machine, level } = parseKit(kit);
  const def = MACHINES.find((m) => m.id === machine);
  return `${def?.name ?? machine}${level > 1 ? ` niv. ${level}` : ''}`;
}

export function getMachine(id: string): MachineDef {
  const m = byId.get(id);
  if (!m) throw new Error(`Machine inconnue : ${id}`);
  return m;
}

/** Débit maximum théorique d'un convoyeur (objets/s). */
export function conveyorThroughput(def: MachineDef): number {
  return def.stats.speed * def.stats.capacity;
}
