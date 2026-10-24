/**
 * Lo que se puede saber de una carta de One Piece solo con su nombre.
 *
 * Aquí está la gran diferencia con PokeVault. En Pokémon, Cardmarket da
 * `Pikachu` y nada más, y hubo que montar un puente de IDs con TCGdex para
 * saber de qué set era cada carta. En One Piece cada carta lleva impreso su
 * código —`OP05-119`— y Cardmarket lo mete en el nombre del producto:
 *
 *   Monkey.D.Luffy (OP13-118) (V.1)
 *   Yamato (OP17-074)
 *
 * El código dice el set (`OP13`), y con eso se puede nombrar la expansión,
 * deducir qué tipo de producto es y cruzar con otros catálogos sin pedir nada
 * carta a carta.
 *
 * Todo lo de este fichero es puro: sin red ni base, y con tests.
 */

/**
 * Código de carta: prefijo de set + número.
 *
 *   OP01-003   booster          ST10-001   baraja de inicio
 *   EB01-012   extra booster    PRB01-001  premium booster
 *   P-001      promo
 *
 * El prefijo admite letras con o sin número (`P-001` no lleva) y el número
 * puede acabar en letra en alguna impresión rara.
 */
const CODE_RE = /\(([A-Z]{1,4}\d{0,3}-\d{2,4}[A-Z]?)\)/
const VERSION_RE = /\(V\.?\s*(\d+)\)/i

export interface ParsedName {
  /** El nombre sin código ni versión: `Monkey.D.Luffy`. */
  cardName: string
  /** `OP13-118`, o null si el producto no lleva código (DON!!, sellado...). */
  code: string | null
  /** El `(V.n)` de Cardmarket. null si la carta solo tiene una versión. */
  version: number | null
}

/**
 * Separa nombre, código y versión. No depende del orden en que vengan los
 * paréntesis: si un día Cardmarket pone la versión delante, sigue funcionando.
 */
export function parseCardName(name: string): ParsedName {
  const code = name.match(CODE_RE)?.[1] ?? null
  const v = name.match(VERSION_RE)?.[1]
  const cardName = name
    .replace(CODE_RE, '')
    .replace(VERSION_RE, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
  return { cardName: cardName || name.trim(), code, version: v ? Number(v) : null }
}

/** `OP13-118` → `OP13`. `P-001` → `P`. */
export const codePrefix = (code: string) => code.split('-')[0].toUpperCase()

/**
 * Abreviatura de set normalizada para comparar: `OP-01`, `op01` y `OP01`
 * son lo mismo.
 */
export const normalizeSetCode = (s: string) => s.replace(/[^A-Za-z0-9]/g, '').toUpperCase()

export type SetKind = 'booster' | 'extra' | 'premium' | 'starter' | 'promo' | 'otros'

/** Qué tipo de producto es un set, por su código. */
export function kindFromSetCode(setCode: string | null): SetKind {
  if (!setCode) return 'otros'
  const c = normalizeSetCode(setCode)
  if (/^OP\d/.test(c)) return 'booster'
  if (/^EB\d/.test(c)) return 'extra'
  if (/^PRB\d/.test(c)) return 'premium'
  if (/^ST\d/.test(c)) return 'starter'
  if (/^P(ROMO)?$/.test(c)) return 'promo'
  return 'otros'
}

export const KIND_LABELS: Record<SetKind, string> = {
  booster: 'Booster',
  extra: 'Extra booster',
  premium: 'Premium booster',
  starter: 'Baraja de inicio',
  promo: 'Promos',
  otros: 'Otros',
}

/**
 * El prefijo que domina entre los códigos de una expansión, si alguno domina.
 *
 * Un booster normal es casi todo `OP05-xxx` con alguna reimpresión suelta. Un
 * recopilatorio como *The Best* mezcla códigos de diez sets distintos y no
 * tiene prefijo dominante: ahí el código no basta y hace falta otra fuente.
 */
export function dominantPrefix(codes: Iterable<string>, threshold = 0.6): string | null {
  const counts = new Map<string, number>()
  let total = 0
  for (const code of new Set(codes)) {
    const p = codePrefix(code)
    counts.set(p, (counts.get(p) ?? 0) + 1)
    total++
  }
  if (!total) return null
  let best: string | null = null
  let n = 0
  for (const [p, c] of counts) {
    if (c > n) {
      best = p
      n = c
    }
  }
  return n / total >= threshold ? best : null
}
