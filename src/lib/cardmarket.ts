/**
 * Ficheros públicos de Cardmarket.
 *
 * Cardmarket retiró estos datos de la API y los publica como ficheros sueltos en
 * un bucket S3: sin API key, sin login y —lo importante— sin el Cloudflare que
 * protege www.cardmarket.com. Por eso se pueden descargar desde Railway.
 *
 * Se regeneran una vez al día (madrugada, CET). El campo `createdAt` de cada
 * fichero es la marca que usamos para no reprocesar dos veces el mismo volcado.
 *
 * Es exactamente el mismo mecanismo que en PokeVault; solo cambia el id de
 * juego.
 */
import { parseCardName } from './cards'

/**
 * ID de juego en Cardmarket. 1 = Magic, 3 = Yu-Gi-Oh!, 6 = Pokémon,
 * 18 = One Piece.
 *
 * Configurable por si acaso. Si el id no es el bueno, `assertOnePiece` lo
 * detecta antes de escribir nada en la base.
 */
export const GAME_ONEPIECE = Number(process.env.CARDMARKET_GAME ?? 18)

const BASE = 'https://downloads.s3.cardmarket.com/productCatalog'

export const urls = (game: number = GAME_ONEPIECE) => ({
  singles: `${BASE}/productList/products_singles_${game}.json`,
  sealed: `${BASE}/productList/products_nonsingles_${game}.json`,
  prices: `${BASE}/priceGuide/price_guide_${game}.json`,
})

export interface CmProduct {
  idProduct: number
  name: string
  idCategory: number
  categoryName: string
  idExpansion: number
  idMetacard: number
  dateAdded: string
}

/**
 * Una entrada del price guide. Los campos de la versión especial se llaman
 * `-holo` en Pokémon y `-foil` en otros juegos: leemos los dos.
 */
export interface CmPrice {
  idProduct: number
  idCategory: number
  avg: number | null
  low: number | null
  trend: number | null
  /** Medias de venta a 1/7/30 días. Ojo: los sellados SIEMPRE las traen a null. */
  avg1: number | null
  avg7: number | null
  avg30: number | null
  [extra: string]: number | null
}

/** Campo de la versión foil/holo, venga con el nombre que venga. */
export const foil = (p: CmPrice, field: 'avg' | 'low' | 'trend' | 'avg1' | 'avg7' | 'avg30') =>
  p[`${field}-foil`] ?? p[`${field}-holo`] ?? null

interface FileEnvelope {
  version: number
  createdAt: string
}
type ProductFile = FileEnvelope & { products: CmProduct[] }
type PriceFile = FileEnvelope & { priceGuides: CmPrice[] }

/**
 * Comprueba si hay volcado nuevo sin bajarse el fichero entero.
 *
 * El bucket devuelve `ETag` y `Last-Modified`, así que una petición HEAD basta
 * para saber si el fichero ha cambiado. Esto es lo que permite que el
 * planificador dentro del servicio web mire cada hora sin gastar ancho de
 * banda.
 */
export async function peekPrices(game?: number): Promise<{ etag: string | null; lastModified: string | null }> {
  try {
    const res = await fetch(urls(game).prices, { method: 'HEAD' })
    if (!res.ok) return { etag: null, lastModified: null }
    return {
      etag: res.headers.get('etag'),
      lastModified: res.headers.get('last-modified'),
    }
  } catch {
    return { etag: null, lastModified: null }
  }
}

async function getJson<T>(url: string, attempt = 1): Promise<T> {
  try {
    const res = await fetch(url, { headers: { 'accept-encoding': 'gzip' } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return (await res.json()) as T
  } catch (err) {
    if (attempt >= 3) throw new Error(`No se pudo descargar ${url}: ${(err as Error).message}`)
    await new Promise((r) => setTimeout(r, attempt * 2000))
    return getJson<T>(url, attempt + 1)
  }
}

export async function fetchProducts(game?: number) {
  const u = urls(game)
  const [singles, sealed] = await Promise.all([
    getJson<ProductFile>(u.singles),
    getJson<ProductFile>(u.sealed),
  ])
  return {
    createdAt: singles.createdAt,
    singles: singles.products,
    sealed: sealed.products,
  }
}

export async function fetchPrices(game?: number) {
  const file = await getJson<PriceFile>(urls(game).prices)
  return { createdAt: file.createdAt, prices: file.priceGuides }
}

/**
 * ¿Es One Piece lo que hemos descargado?
 *
 * Las cartas de One Piece llevan su código en el nombre (`Yamato (OP17-074)`).
 * Si menos de la mitad lo llevan, o el id de juego está mal o Cardmarket ha
 * cambiado el formato de los nombres. En los dos casos es mejor parar aquí,
 * con un mensaje claro, que llenar la base de algo que no es.
 */
export function assertOnePiece(singles: CmProduct[], game = GAME_ONEPIECE) {
  if (!singles.length) throw new Error(`El catálogo del juego ${game} de Cardmarket viene vacío.`)
  const withCode = singles.filter((p) => parseCardName(p.name).code).length
  const pct = withCode / singles.length
  if (pct < 0.5) {
    const ejemplo = singles.slice(0, 3).map((p) => `"${p.name}"`).join(', ')
    throw new Error(
      `El juego ${game} de Cardmarket no parece One Piece: solo el ${(pct * 100).toFixed(0)}% de ` +
        `las cartas lleva código tipo OP01-001 (ejemplos: ${ejemplo}). Revisa CARDMARKET_GAME.`,
    )
  }
  return pct
}

/**
 * Enlace directo a la ficha del producto en Cardmarket.
 *
 * Cardmarket mantiene una redirección oficial por id de producto, así que no
 * hace falta construir el slug de la ficha (que lleva el nombre de la
 * expansión, y ese no viene en los ficheros públicos).
 *
 * `referrer` es cortesía: le dice a Cardmarket de dónde le llega el tráfico.
 */
export const productUrl = (idProduct: number, locale = 'es') =>
  `https://www.cardmarket.com/${locale}/OnePiece/Products?idProduct=${idProduct}&referrer=opvault`
