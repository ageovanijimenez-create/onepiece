/**
 * Pone nombre a las expansiones de Cardmarket y foto a las cartas.
 *
 * Cardmarket da `idExpansion` pero no el nombre del set, ni imágenes. TCGplayer
 * (vía TCGCSV) tiene las dos cosas, con el código de cada carta. El cruce está
 * en `match.ts`; aquí solo se descarga, se llama al cruce y se guarda.
 *
 * Son ~1 petición por set de TCGplayer, y se repite entero cada vez: así un
 * set que se identificó mal se corrige solo en la siguiente pasada, y una
 * carta que deja de ser segura (sale una versión nueva y ya no se sabe cuál
 * es cuál) pierde la foto en vez de quedarse con la equivocada.
 *
 * Si TCGCSV no responde no se rompe nada: las expansiones ya identificadas se
 * quedan como estaban, y las nuevas reciben lo que digan sus códigos.
 */
import { db, setMeta } from '../db/index'
import { CATEGORY_ONEPIECE, assertOnePiece, extended, listGroups, listProducts } from './tcgcsv'
import {
  type CmSingle,
  type ExpansionInput,
  type GroupInput,
  buildNumberIndex,
  matchExpansion,
  matchProducts,
} from './match'

export interface MapSetsResult {
  expansions: number
  identified: number
  viaTcgplayer: number
  images: number
  tcgcsv: boolean
}

/** Peticiones en paralelo a TCGCSV. Suficiente para ir rápido sin abusar. */
const CONCURRENCY = 4

/**
 * Los sets de TCGplayer con sus cartas. `failed` cuenta los sets cuya lista
 * de cartas no se pudo bajar: con alguno fallido, la pasada está incompleta.
 */
async function fetchGroups(
  log: (msg: string) => void,
): Promise<{ groups: GroupInput[]; failed: number } | null> {
  const groups = await listGroups()
  if (!groups?.length) return null
  assertOnePiece(groups)

  log(`${groups.length} sets en TCGplayer · descargando sus cartas...`)
  const out: GroupInput[] = []
  let failed = 0
  for (let i = 0; i < groups.length; i += CONCURRENCY) {
    const batch = groups.slice(i, i + CONCURRENCY)
    const results = await Promise.all(batch.map((g) => listProducts(g.groupId, CATEGORY_ONEPIECE)))
    results.forEach((products, j) => {
      const g = batch[j]
      if (!products) failed++
      const cards = (products ?? []).flatMap((p) => {
        const number = extended(p, 'Number')?.toUpperCase()
        // Sin número es sellado o un accesorio: no sirve para cruzar.
        if (!number) return []
        return [
          {
            productId: p.productId,
            name: p.name,
            number,
            rarity: extended(p, 'Rarity'),
            imageUrl: p.imageUrl || null,
          },
        ]
      })
      if (cards.length) {
        out.push({
          groupId: g.groupId,
          name: g.name,
          abbreviation: g.abbreviation,
          publishedOn: g.publishedOn,
          cards,
        })
      }
    })
  }
  if (failed) log(`${failed} sets de TCGplayer no respondieron: se conservan los cruces que ya había`)
  return { groups: out, failed }
}

export async function runMapSets(log: (msg: string) => void = () => {}): Promise<MapSetsResult> {
  const total = db.prepare(`SELECT COUNT(*) AS n FROM products`).get() as { n: number }
  if (!total.n) throw new Error('No hay productos. Hay que lanzar antes la ingesta.')

  // Las cartas con código de cada expansión: es todo lo que necesita el cruce.
  const rows = db
    .prepare(
      `SELECT id_expansion, id_product, card_code, version
         FROM products
        WHERE is_sealed = 0 AND card_code IS NOT NULL`,
    )
    .all() as { id_expansion: number; id_product: number; card_code: string; version: number | null }[]

  const byExpansion = new Map<number, CmSingle[]>()
  for (const r of rows) {
    const s = { idProduct: r.id_product, code: r.card_code, version: r.version }
    const list = byExpansion.get(r.id_expansion)
    if (list) list.push(s)
    else byExpansion.set(r.id_expansion, [s])
  }

  const expansions: ExpansionInput[] = (
    db.prepare(`SELECT id_expansion FROM expansions`).all() as { id_expansion: number }[]
  ).map((e) => ({ idExpansion: e.id_expansion, singles: byExpansion.get(e.id_expansion) ?? [] }))

  const fetched = await fetchGroups(log)
  if (!fetched) log('TCGCSV no responde: solo se usarán los códigos de las cartas.')
  const groups = fetched?.groups ?? []
  // Pasada incompleta: TCGCSV caído entero o algún set sin responder.
  const degraded = !fetched || fetched.failed > 0
  const index = buildNumberIndex(groups)
  const groupById = new Map(groups.map((g) => [g.groupId, g]))

  const updateExpansion = db.prepare(`
    UPDATE expansions
       SET set_code = ?, name = ?, kind = ?, release_date = ?, tcg_group_id = ?, coverage = ?
     WHERE id_expansion = ?
  `)
  const alreadyMatched = db.prepare(
    `SELECT tcg_group_id FROM expansions WHERE id_expansion = ?`,
  )
  const clearProducts = db.prepare(`
    UPDATE products SET image = NULL, rarity = NULL, tcg_product_id = NULL
     WHERE id_expansion = ? AND is_sealed = 0
  `)
  const setProduct = db.prepare(
    `UPDATE products SET image = ?, rarity = ?, tcg_product_id = ? WHERE id_product = ?`,
  )

  let identified = 0
  let viaTcgplayer = 0
  let images = 0

  db.transaction(() => {
    for (const exp of expansions) {
      const m = matchExpansion(exp, groups, index)

      // Con una pasada incompleta, que una expansión se quede sin set puede
      // ser solo que su set no respondió: no pisamos lo que ya se identificó
      // bien otro día.
      if (degraded && !m.groupId) {
        const prev = alreadyMatched.get(exp.idExpansion) as { tcg_group_id: number | null }
        if (prev?.tcg_group_id) {
          identified++
          viaTcgplayer++
          continue
        }
      }

      updateExpansion.run(
        m.setCode,
        m.name,
        m.kind,
        m.releaseDate,
        m.groupId,
        m.coverage,
        exp.idExpansion,
      )
      if (m.setCode || m.groupId) identified++

      if (m.groupId) {
        viaTcgplayer++
        clearProducts.run(exp.idExpansion)
        for (const p of matchProducts(exp, groupById.get(m.groupId)!)) {
          setProduct.run(p.image, p.rarity, p.tcgProductId, p.idProduct)
          if (p.image) images++
        }
      }
    }
  })()

  setMeta('map_sets_at', new Date().toISOString())

  log(
    `${identified}/${expansions.length} expansiones identificadas ` +
      `(${viaTcgplayer} con TCGplayer) · ${images.toLocaleString('es')} cartas con imagen`,
  )
  return { expansions: expansions.length, identified, viaTcgplayer, images, tcgcsv: Boolean(fetched) }
}
