/**
 * La actualización diaria, como función reutilizable.
 *
 * Vive aquí y no en `scripts/` porque la llaman dos sitios: el script de
 * consola (`npm run ingest`) y el planificador que corre dentro del servicio
 * web en Railway. Un volumen de Railway solo se puede montar en un servicio,
 * así que la ingesta no puede ser un cron aparte: tiene que vivir junto a la
 * web, que es quien tiene la base montada.
 *
 * Qué hace, en orden:
 *   1. Descarga el price guide y mira su `createdAt`. Si ya procesamos ese
 *      volcado exacto, se sale. Esto la hace idempotente: se puede llamar
 *      cuantas veces se quiera sin ensuciar nada.
 *   2. Descarga catálogo de cartas y sellados, comprueba que es One Piece, y
 *      los mete en `products` con el código y la versión ya separados.
 *   3. Compara los precios nuevos con los que ya teníamos y escribe en
 *      `price_history` SOLO los que han cambiado.
 *   4. Sobrescribe `prices` con la foto de hoy.
 *
 * El paso 3 es el que importa: Cardmarket te da la foto de hoy, nunca el
 * pasado. El histórico solo existe si lo guardas tú, empezando ya.
 */
import { db } from '../db/index'
import { assertOnePiece, fetchPrices, fetchProducts, foil, type CmProduct } from './cardmarket'
import { parseCardName } from './cards'

export interface IngestResult {
  status: 'ok' | 'skipped' | 'error'
  createdAt?: string
  products?: number
  /** Productos que no teníamos. Si hay, puede que haya salido un set nuevo. */
  newProducts?: number
  prices?: number
  changed?: number
  seconds?: number
  error?: string
}

type Logger = (msg: string) => void

export async function runIngest(log: Logger = () => {}): Promise<IngestResult> {
  const t0 = Date.now()

  const run = db
    .prepare(`INSERT INTO ingest_runs (started_at, status) VALUES (?, 'running')`)
    .run(new Date().toISOString())
  const runId = run.lastInsertRowid as number

  try {
    // ─── 1. ¿Hay volcado nuevo? ──────────────────────────────────────────────
    log('Descargando price guide...')
    const { createdAt, prices } = await fetchPrices()
    log(`Volcado del ${createdAt} · ${prices.length.toLocaleString('es')} precios`)

    const last = db
      .prepare(
        `SELECT source_created_at FROM ingest_runs WHERE status='ok' ORDER BY id DESC LIMIT 1`,
      )
      .get() as { source_created_at: string } | undefined

    if (last?.source_created_at === createdAt) {
      log('Ya teníamos este volcado. Nada que hacer.')
      db.prepare(
        `UPDATE ingest_runs SET finished_at=?, status='skipped', source_created_at=? WHERE id=?`,
      ).run(new Date().toISOString(), createdAt, runId)
      return { status: 'skipped', createdAt }
    }

    // El día del histórico lo marca el fichero, no el reloj de la máquina.
    const day = createdAt.slice(0, 10)

    // ─── 2. Catálogo ─────────────────────────────────────────────────────────
    log('Descargando catálogo...')
    const { singles, sealed } = await fetchProducts()
    log(`${singles.length.toLocaleString('es')} cartas · ${sealed.length.toLocaleString('es')} sellados`)

    // Antes de tocar la base: ¿de verdad es One Piece?
    const pctCode = assertOnePiece(singles)
    log(`${(pctCode * 100).toFixed(1)}% de las cartas con código de carta`)

    const known = new Set(
      (db.prepare(`SELECT id_product FROM products`).all() as { id_product: number }[]).map(
        (r) => r.id_product,
      ),
    )

    const upsertProduct = db.prepare(`
      INSERT INTO products (id_product, name, card_name, card_code, version,
                            id_category, category_name, id_expansion, is_sealed, date_added)
      VALUES (@idProduct, @name, @cardName, @code, @version,
              @idCategory, @categoryName, @idExpansion, @isSealed, @dateAdded)
      ON CONFLICT(id_product) DO UPDATE SET
        name=excluded.name, card_name=excluded.card_name, card_code=excluded.card_code,
        version=excluded.version, id_category=excluded.id_category,
        category_name=excluded.category_name, id_expansion=excluded.id_expansion,
        is_sealed=excluded.is_sealed
    `)
    const ensureExpansion = db.prepare(`INSERT OR IGNORE INTO expansions (id_expansion) VALUES (?)`)

    let newProducts = 0
    const writeProducts = db.transaction((rows: CmProduct[], isSealed: number) => {
      for (const p of rows) {
        // El sellado no lleva código; se guarda el nombre tal cual.
        const parsed = isSealed
          ? { cardName: p.name, code: null, version: null }
          : parseCardName(p.name)
        if (!known.has(p.idProduct)) newProducts++
        ensureExpansion.run(p.idExpansion)
        upsertProduct.run({
          idProduct: p.idProduct,
          name: p.name,
          cardName: parsed.cardName,
          code: parsed.code,
          version: parsed.version,
          idCategory: p.idCategory,
          categoryName: p.categoryName,
          idExpansion: p.idExpansion,
          isSealed,
          dateAdded: p.dateAdded,
        })
      }
    })
    writeProducts(singles, 0)
    writeProducts(sealed, 1)
    log(
      `Catálogo guardado (${(singles.length + sealed.length).toLocaleString('es')} productos, ` +
        `${newProducts.toLocaleString('es')} nuevos)`,
    )

    // ─── 3. Histórico: solo lo que ha cambiado ───────────────────────────────
    const previous = new Map<number, { trend: number | null; avg: number | null; low: number | null }>()
    for (const row of db.prepare(`SELECT id_product, trend, avg, low FROM prices`).iterate() as Iterable<{
      id_product: number
      trend: number | null
      avg: number | null
      low: number | null
    }>) {
      previous.set(row.id_product, { trend: row.trend, avg: row.avg, low: row.low })
    }

    const insertHistory = db.prepare(`
      INSERT INTO price_history (id_product, day, trend, avg, low, avg7, avg30)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id_product, day) DO UPDATE SET
        trend=excluded.trend, avg=excluded.avg, low=excluded.low,
        avg7=excluded.avg7, avg30=excluded.avg30
    `)
    const upsertPrice = db.prepare(`
      INSERT INTO prices (id_product, avg, low, trend, avg1, avg7, avg30,
                          avg_foil, low_foil, trend_foil, avg1_foil, avg7_foil, avg30_foil, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id_product) DO UPDATE SET
        avg=excluded.avg, low=excluded.low, trend=excluded.trend,
        avg1=excluded.avg1, avg7=excluded.avg7, avg30=excluded.avg30,
        avg_foil=excluded.avg_foil, low_foil=excluded.low_foil, trend_foil=excluded.trend_foil,
        avg1_foil=excluded.avg1_foil, avg7_foil=excluded.avg7_foil, avg30_foil=excluded.avg30_foil,
        updated_at=excluded.updated_at
    `)

    let changed = 0
    const writePrices = db.transaction(() => {
      for (const p of prices) {
        const prev = previous.get(p.idProduct)
        if (!prev || prev.trend !== p.trend || prev.avg !== p.avg || prev.low !== p.low) {
          insertHistory.run(p.idProduct, day, p.trend, p.avg, p.low, p.avg7, p.avg30)
          changed++
        }
        upsertPrice.run(
          p.idProduct, p.avg, p.low, p.trend, p.avg1, p.avg7, p.avg30,
          foil(p, 'avg'), foil(p, 'low'), foil(p, 'trend'),
          foil(p, 'avg1'), foil(p, 'avg7'), foil(p, 'avg30'),
          createdAt,
        )
      }
    })
    writePrices()

    const pct = prices.length ? ((changed / prices.length) * 100).toFixed(1) : '0'
    log(`Precios guardados · ${changed.toLocaleString('es')} cambios anotados en el histórico (${pct}%)`)

    db.prepare(`
      UPDATE ingest_runs SET finished_at=?, status='ok', source_created_at=?,
        products_upserted=?, products_new=?, prices_upserted=?, history_rows=? WHERE id=?
    `).run(
      new Date().toISOString(), createdAt,
      singles.length + sealed.length, newProducts, prices.length, changed, runId,
    )

    return {
      status: 'ok',
      createdAt,
      products: singles.length + sealed.length,
      newProducts,
      prices: prices.length,
      changed,
      seconds: +((Date.now() - t0) / 1000).toFixed(1),
    }
  } catch (err) {
    const message = (err as Error).message
    db.prepare(`UPDATE ingest_runs SET finished_at=?, status='error', error=? WHERE id=?`).run(
      new Date().toISOString(),
      message,
      runId,
    )
    return { status: 'error', error: message }
  }
}
