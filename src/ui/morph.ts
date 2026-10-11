/**
 * Met un élément à jour pour qu'il contienne `html`, en modifiant le DOM existant au lieu de le remplacer.
 *
 * `el.innerHTML = html` recrée tous les éléments. Au doigt, c'est un défilement ou un appui coupé net : le navigateur perd
 * l'élément que le doigt tenait, et la fenêtre paraît figée. Ici, un élément de même sorte à la même place est gardé et
 * seuls son texte et ses attributs sont corrigés : il conserve son défilement, son état « appuyé », ses images et ses
 * animations en cours.
 *
 * L'appariement se fait par position, sans clé : le résultat est celui de `innerHTML = html` (à la taille près des canevas
 * déjà là, qui appartient à qui les dessine) ; seul le nombre d'éléments recréés change.
 */
export function morph(root: Element, html: string): void {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  syncChildren(root, tpl.content);
}

const ELEMENT = 1;

/** Deux nœuds de même sorte peuvent se corriger l'un en l'autre (même balise, dans le même espace de noms). */
function sameKind(a: Node, b: Node): boolean {
  if (a.nodeType !== b.nodeType) return false;
  if (a.nodeType !== ELEMENT) return true;
  const [x, y] = [a as Element, b as Element];
  return x.localName === y.localName && x.namespaceURI === y.namespaceURI;
}

function syncChildren(dst: Node, src: Node): void {
  let d = dst.firstChild;
  let s = src.firstChild;
  while (s) {
    const next = s.nextSibling;
    if (!d) {
      dst.appendChild(s);
    } else if (sameKind(d, s)) {
      patch(d, s);
      d = d.nextSibling;
    } else {
      const after = d.nextSibling;
      dst.replaceChild(s, d);
      d = after;
    }
    s = next;
  }
  while (d) {
    const after = d.nextSibling;
    dst.removeChild(d);
    d = after;
  }
}

function patch(d: Node, s: Node): void {
  if (d.nodeType !== ELEMENT) {
    if (d.nodeValue !== s.nodeValue) d.nodeValue = s.nodeValue;
    return;
  }
  const [de, se] = [d as Element, s as Element];
  // Un canevas appartient à celui qui le dessine (la carte règle sa taille à chaque image) : on n'y touche pas, ce qui
  // évite aussi de l'effacer. Un attribut identique n'est pas réécrit non plus : retoucher un `src` recharge l'image.
  const own = (a: Attr) => de.localName === 'canvas' && (a.name === 'width' || a.name === 'height');
  for (const a of Array.from(de.attributes)) if (!own(a) && !se.hasAttributeNS(a.namespaceURI, a.localName)) de.removeAttributeNS(a.namespaceURI, a.localName);
  for (const a of Array.from(se.attributes)) if (!own(a) && de.getAttributeNS(a.namespaceURI, a.localName) !== a.value) de.setAttributeNS(a.namespaceURI, a.name, a.value);
  syncChildren(de, se);
}
