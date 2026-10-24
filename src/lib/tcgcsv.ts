/**
 * TCGCSV: espejo diario y gratuito del catálogo de TCGplayer.
 *
 * En PokeVault solo servía para traducir nombres de sets japoneses. Aquí hace
 * el papel que allí hacía TCGdex: Cardmarket no publica el nombre de las
 * expansiones ni imágenes, y TCGplayer sí, con el código de cada carta en sus
 * datos. Así que de aquí salen el nombre del set, su fecha de salida, la
 * rareza y la foto de cada carta.
 *
 * Son pocas peticiones: una para la lista de sets y una por set. Nada de ir
 * carta a carta.
 */

const BASE = 'https://tcgcsv.com/tcgplayer'

/** Nos identificamos: es lo que pide TCGCSV y es de buena educación. */
const USER_AGENT =
  process.env.USER_AGENT ?? 'OPVault/0.1 (+https://github.com/ageovanijimenez-create/onepiece)'

/**
 * Categoría de TCGplayer. 68 = One Piece Card Game.
 *
 * Configurable por si TCGplayer la cambia algún día; `assertOnePiece` avisa
 * si lo que llega no tiene pinta de One Piece.
 */
export const CATEGORY_ONEPIECE = Number(process.env.TCGCSV_CATEGORY ?? 68)

export interface TcgcsvGroup {
  groupId: number
  name: string
  abbreviation: string | null
  publishedOn: string | null
  categoryId: number
}

export interface TcgcsvProduct {
  productId: number
  name: string
  cleanName?: string
  imageUrl: string
  groupId: number
  url?: string
  extendedData?: { name: string; displayName?: string; value: string }[]
}

async function getJson<T>(path: string): Promise<T | null> {
  try {
    // TCGCSV rechaza el User-Agent por defecto de Node y pide que te
    // identifiques. Es su norma y es razonable: la respetamos.
    const res = await fetch(`${BASE}${path}`, { headers: { 'user-agent': USER_AGENT } })
    if (!res.ok) return null
    const body = (await res.json()) as { results?: T }
    return body.results ?? null
  } catch {
    return null
  }
}

export const listGroups = (categoryId = CATEGORY_ONEPIECE) =>
  getJson<TcgcsvGroup[]>(`/${categoryId}/groups`)

export const listProducts = (groupId: number, categoryId = CATEGORY_ONEPIECE) =>
  getJson<TcgcsvProduct[]>(`/${categoryId}/${groupId}/products`)

/** Un campo de `extendedData` por nombre, sin importar mayúsculas. */
export function extended(p: TcgcsvProduct, field: string): string | null {
  const f = field.toLowerCase()
  const hit = p.extendedData?.find(
    (d) => d.name?.toLowerCase() === f || d.displayName?.toLowerCase() === f,
  )
  return hit?.value?.trim() || null
}

/**
 * Comprueba que la categoría es One Piece de verdad: algún set con
 * abreviatura `OPxx`. Mejor fallar con un mensaje claro que llenar la base
 * de nombres de otro juego.
 */
export function assertOnePiece(groups: TcgcsvGroup[], categoryId = CATEGORY_ONEPIECE) {
  const ok = groups.some((g) => /^OP-?\d/i.test(g.abbreviation ?? ''))
  if (!ok) {
    throw new Error(
      `La categoría ${categoryId} de TCGCSV no parece One Piece (ningún set "OPxx"). Revisa TCGCSV_CATEGORY.`,
    )
  }
}
