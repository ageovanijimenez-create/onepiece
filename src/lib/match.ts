/**
 * Cruce entre Cardmarket y TCGplayer, sin red ni base: solo datos en memoria.
 *
 * Cardmarket da el catálogo y los precios en euros, pero sus expansiones son
 * un número sin nombre. TCGplayer (vía TCGCSV) tiene nombre, fecha, rareza e
 * imagen de cada carta. La llave común es el código impreso en la carta.
 *
 * **Qué set es cada expansión.** No vale con mirar el prefijo de los códigos:
 * un booster normal es casi todo `OP05-xxx`, pero un recopilatorio como
 * *The Best* reimprime cartas de diez sets distintos. Así que se vota: la
 * expansión se asigna al set de TCGplayer que contiene más de sus códigos.
 *
 *   expansión de Cardmarket → sus códigos → set de TCGplayer que más cubre
 *
 * Funciona igual para los dos casos: *Romance Dawn* tiene sus 121 códigos en
 * el set OP01 y solo unos pocos en *The Best*; *The Best* los tiene todos en
 * PRB01 y pocos en cualquier otro.
 *
 * **Qué imagen es cada carta.** Una misma carta tiene varias versiones (la
 * normal, la paralela, la manga...). Cardmarket las numera `(V.1)`, `(V.2)`;
 * TCGplayer las marca en el nombre. No hay forma segura de emparejar la V.3
 * con "la manga", así que solo se asigna imagen cuando no hay duda. Como en
 * PokeVault: mejor sin foto que con la foto de otra carta —sobre todo cuando
 * las versiones que se confunden son las que valen cientos de euros—.
 */
import {
  type SetKind,
  dominantPrefix,
  kindFromSetCode,
  normalizeSetCode,
} from './cards'
import { FALLBACK_SET_NAMES } from './set-names'

export interface CmSingle {
  idProduct: number
  code: string
  version: number | null
}

export interface ExpansionInput {
  idExpansion: number
  singles: CmSingle[]
}

export interface GroupCard {
  productId: number
  name: string
  number: string
  rarity: string | null
  imageUrl: string | null
}

export interface GroupInput {
  groupId: number
  name: string
  abbreviation: string | null
  publishedOn: string | null
  cards: GroupCard[]
}

export interface ExpansionMatch {
  idExpansion: number
  /** Set de TCGplayer asignado, o null si ninguno convence. */
  groupId: number | null
  setCode: string | null
  name: string | null
  kind: SetKind
  releaseDate: string | null
  /** Fracción de los códigos de la expansión que están en el set elegido. */
  coverage: number
}

export interface ProductMatch {
  idProduct: number
  tcgProductId: number | null
  image: string | null
  rarity: string | null
}

/** Por debajo de esto el set no se da por bueno. */
export const MIN_COVERAGE = 0.6

/** Un código de set con forma de código: `OP05`, `PRB01`, `P`. */
const SET_CODE_SHAPE = /^[A-Z]{1,4}\d{0,3}$/

/**
 * Nombre del set sin el código que TCGplayer a veces le pega delante o
 * detrás: `OP01: Romance Dawn` o `Romance Dawn [OP01]` → `Romance Dawn`.
 */
export function cleanGroupName(name: string, abbreviation: string | null): string {
  let n = name.trim()
  if (abbreviation) {
    const a = abbreviation.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    n = n.replace(new RegExp(`^${a}\\s*[:\\-–]\\s*`, 'i'), '')
    n = n.replace(new RegExp(`\\s*[\\[(]${a}[\\])]$`, 'i'), '')
  }
  return n.trim() || name.trim()
}

/**
 * ¿Es la ilustración normal de la carta? TCGplayer marca las demás versiones
 * con un paréntesis: `(Parallel)`, `(Manga)`, `(Alternate Art)`...
 */
const VARIANT_RE =
  /\([^)]*\b(parallel|alternate|alt\.? art|manga|sp|wanted|textured|full art|foil|serial|gold|silver|treasure|jolly roger|box topper|pre-?release|reprint|promo|special|anniversary|championship|winner|judge|tournament)\b[^)]*\)/i

export const isBaseArt = (name: string) => !VARIANT_RE.test(name)

export function groupSetCode(g: Pick<GroupInput, 'abbreviation'>): string | null {
  if (!g.abbreviation) return null
  const c = normalizeSetCode(g.abbreviation)
  return SET_CODE_SHAPE.test(c) ? c : null
}

/** Índice código → sets de TCGplayer, para no recorrer todo por cada expansión. */
export function buildNumberIndex(groups: GroupInput[]) {
  const sizes = new Map<number, number>()
  const byNumber = new Map<string, number[]>()
  for (const g of groups) {
    const nums = new Set(g.cards.map((c) => c.number))
    sizes.set(g.groupId, nums.size)
    for (const n of nums) {
      const list = byNumber.get(n)
      if (list) list.push(g.groupId)
      else byNumber.set(n, [g.groupId])
    }
  }
  return { sizes, byNumber }
}

export function matchExpansion(
  exp: ExpansionInput,
  groups: GroupInput[],
  index = buildNumberIndex(groups),
): ExpansionMatch {
  const codes = new Set(exp.singles.map((s) => s.code))
  const prefix = dominantPrefix(codes)

  // Votos: cuántos códigos de la expansión tiene cada set de TCGplayer.
  const hits = new Map<number, number>()
  for (const code of codes) {
    for (const gid of index.byNumber.get(code) ?? []) {
      hits.set(gid, (hits.get(gid) ?? 0) + 1)
    }
  }

  const byId = new Map(groups.map((g) => [g.groupId, g]))
  let best: { g: GroupInput; hit: number; prefixMatch: boolean; size: number } | null = null

  for (const [gid, hit] of hits) {
    const g = byId.get(gid)!
    const cand = {
      g,
      hit,
      prefixMatch: prefix !== null && groupSetCode(g) === prefix,
      size: index.sizes.get(gid) ?? 0,
    }
    if (!best) {
      best = cand
      continue
    }
    // Más códigos cubiertos gana. En empate, el set cuyo código coincide con
    // el de las cartas (OP01 antes que "Pre-Release OP01"), y después el más
    // pequeño, que es el más específico.
    const better =
      cand.hit !== best.hit
        ? cand.hit > best.hit
        : cand.prefixMatch !== best.prefixMatch
          ? cand.prefixMatch
          : cand.size !== best.size
            ? cand.size < best.size
            : cand.g.groupId < best.g.groupId
    if (better) best = cand
  }

  const coverage = best && codes.size ? best.hit / codes.size : 0
  const accepted = best && coverage >= MIN_COVERAGE && best.hit >= Math.min(3, codes.size)

  if (accepted) {
    const g = best!.g
    const setCode = groupSetCode(g) ?? prefix
    let kind = kindFromSetCode(setCode)
    if (kind === 'otros' && /promo/i.test(g.name)) kind = 'promo'
    return {
      idExpansion: exp.idExpansion,
      groupId: g.groupId,
      setCode,
      name: cleanGroupName(g.name, g.abbreviation),
      kind,
      releaseDate: g.publishedOn ? g.publishedOn.slice(0, 10) : null,
      coverage,
    }
  }

  // Sin TCGplayer, o sin un set que convenza: nos quedamos con lo que dicen
  // los propios códigos, si dicen algo claro.
  return {
    idExpansion: exp.idExpansion,
    groupId: null,
    setCode: prefix,
    name: prefix ? (FALLBACK_SET_NAMES[prefix] ?? null) : null,
    kind: kindFromSetCode(prefix),
    releaseDate: null,
    coverage,
  }
}

/**
 * Rareza, imagen e id de TCGplayer para las cartas de una expansión ya
 * asignada a su set.
 *
 * Se empareja solo cuando no hay ambigüedad:
 *   - una versión en cada lado → esa con esa
 *   - normal + una alternativa en cada lado → V.1 con la normal, V.2 con la otra
 *   - más versiones → solo la V.1 con la normal; el resto sin imagen
 *
 * La rareza sí se puede poner aunque no se sepa qué versión es cuál, siempre
 * que todas las versiones de TCGplayer coincidan.
 */
export function matchProducts(exp: ExpansionInput, group: GroupInput): ProductMatch[] {
  const tpByNumber = new Map<string, GroupCard[]>()
  for (const c of group.cards) {
    const list = tpByNumber.get(c.number)
    if (list) list.push(c)
    else tpByNumber.set(c.number, [c])
  }

  const cmByCode = new Map<string, CmSingle[]>()
  for (const s of exp.singles) {
    const list = cmByCode.get(s.code)
    if (list) list.push(s)
    else cmByCode.set(s.code, [s])
  }

  const out: ProductMatch[] = []

  for (const [code, cmsRaw] of cmByCode) {
    const tps = tpByNumber.get(code)
    if (!tps?.length) continue

    const cms = [...cmsRaw].sort(
      (a, b) => (a.version ?? 1) - (b.version ?? 1) || a.idProduct - b.idProduct,
    )
    const bases = tps.filter((t) => isBaseArt(t.name)).sort((a, b) => a.productId - b.productId)
    const variants = tps.filter((t) => !isBaseArt(t.name)).sort((a, b) => a.productId - b.productId)

    const rarities = new Set(tps.map((t) => t.rarity).filter(Boolean))
    const sharedRarity = rarities.size === 1 ? [...rarities][0]! : null

    const pairs = new Map<number, GroupCard>()
    if (cms.length === 1 && tps.length === 1) {
      pairs.set(cms[0].idProduct, tps[0])
    } else if (
      cms.length === 2 &&
      tps.length === 2 &&
      bases.length === 1 &&
      (cms[0].version ?? 1) === 1
    ) {
      pairs.set(cms[0].idProduct, bases[0])
      pairs.set(cms[1].idProduct, variants[0])
    } else if (bases.length === 1) {
      const v1 = cms.filter((c) => (c.version ?? 1) === 1)
      if (v1.length === 1) pairs.set(v1[0].idProduct, bases[0])
    }

    for (const cm of cms) {
      const tp = pairs.get(cm.idProduct)
      out.push({
        idProduct: cm.idProduct,
        tcgProductId: tp?.productId ?? null,
        image: tp?.imageUrl ?? null,
        rarity: tp?.rarity ?? sharedRarity,
      })
    }
  }

  return out
}
