import { db } from './index'
import type { SetKind } from '../lib/cards'

export interface ExpansionRow {
  id_expansion: number
  set_code: string | null
  name: string | null
  kind: SetKind | null
  release_date: string | null
  tcg_group_id: number | null
  singles: number
  sealed: number
  top_single: number | null
  top_sealed: number | null
}

export interface ProductRow {
  id_product: number
  name: string
  card_name: string | null
  card_code: string | null
  version: number | null
  rarity: string | null
  category_name: string | null
  is_sealed: number
  image: string | null
  trend: number | null
  avg: number | null
  low: number | null
  avg7: number | null
  avg30: number | null
}

/**
 * Una expansión sale en la web si se sabe qué set es: por TCGplayer o, al
 * menos, por el prefijo de sus códigos. Las que no —agrupaciones raras,
 * expansiones solo de sellado sin ninguna pista— se quedan en el panel.
 */
const IDENTIFIED = `(e.set_code IS NOT NULL OR e.tcg_group_id IS NOT NULL)`

export function getStats() {
  return db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM products WHERE is_sealed = 0) AS singles,
         (SELECT COUNT(*) FROM products WHERE is_sealed = 1) AS sealed,
         (SELECT COUNT(*) FROM price_history)                AS history,
         (SELECT source_created_at FROM ingest_runs WHERE status='ok'
           ORDER BY id DESC LIMIT 1)                         AS updated_at`,
    )
    .get() as { singles: number; sealed: number; history: number; updated_at: string | null }
}

/**
 * Filtros de la portada, por tipo de producto. Extra y premium van juntos:
 * son pocos y se compran igual, por display.
 */
export type Filtro = 'todo' | 'boosters' | 'especiales' | 'inicio' | 'promos'

const FILTROS: Record<Filtro, string> = {
  todo: '',
  boosters: `AND e.kind = 'booster'`,
  especiales: `AND e.kind IN ('extra', 'premium')`,
  inicio: `AND e.kind = 'starter'`,
  promos: `AND e.kind IN ('promo', 'otros')`,
}

const EXPANSION_COLUMNS = `
  e.id_expansion, e.set_code, e.name, e.kind, e.release_date, e.tcg_group_id,
  COUNT(p.id_product) FILTER (WHERE p.is_sealed = 0)  AS singles,
  COUNT(p.id_product) FILTER (WHERE p.is_sealed = 1)  AS sealed,
  MAX(CASE WHEN p.is_sealed = 0 THEN pr.trend END)    AS top_single,
  MAX(CASE WHEN p.is_sealed = 1 THEN pr.trend END)    AS top_sealed`

/** Sets que se muestran en la web, los más nuevos primero. */
export function listExpansions(filtro: Filtro = 'todo'): ExpansionRow[] {
  return db
    .prepare(
      `SELECT ${EXPANSION_COLUMNS}
         FROM expansions e
         JOIN products  p  ON p.id_expansion = e.id_expansion
         LEFT JOIN prices pr ON pr.id_product = p.id_product
        WHERE ${IDENTIFIED} ${FILTROS[filtro]}
        GROUP BY e.id_expansion
        ORDER BY e.release_date IS NULL, e.release_date DESC, e.set_code DESC, e.id_expansion DESC`,
    )
    .all() as ExpansionRow[]
}

/** Cuántos sets hay en cada filtro, para poder etiquetarlos. */
export function contarPorFiltro(): Record<Filtro, number> {
  return db
    .prepare(
      `SELECT COUNT(*)                                            AS todo,
              COUNT(*) FILTER (WHERE kind = 'booster')            AS boosters,
              COUNT(*) FILTER (WHERE kind IN ('extra','premium')) AS especiales,
              COUNT(*) FILTER (WHERE kind = 'starter')            AS inicio,
              COUNT(*) FILTER (WHERE kind IN ('promo','otros'))   AS promos
         FROM expansions e
        WHERE ${IDENTIFIED}
          AND EXISTS (SELECT 1 FROM products p WHERE p.id_expansion = e.id_expansion)`,
    )
    .get() as Record<Filtro, number>
}

export function getExpansion(id: number): ExpansionRow | undefined {
  return db
    .prepare(
      `SELECT ${EXPANSION_COLUMNS}
         FROM expansions e
         LEFT JOIN products p  ON p.id_expansion = e.id_expansion
         LEFT JOIN prices   pr ON pr.id_product  = p.id_product
        WHERE e.id_expansion = ?
        GROUP BY e.id_expansion`,
    )
    .get(id) as ExpansionRow | undefined
}

export type Orden = 'precio' | 'numero'

const PRODUCT_COLUMNS = `
  p.id_product, p.name, p.card_name, p.card_code, p.version, p.rarity,
  p.category_name, p.is_sealed, p.image,
  pr.trend, pr.avg, pr.low, pr.avg7, pr.avg30`

export function getProducts(idExpansion: number, sealed: boolean, orden: Orden = 'precio'): ProductRow[] {
  // Por número es como se repasa una colección: OP05-001, OP05-002... con las
  // versiones de cada carta juntas.
  const order =
    orden === 'numero'
      ? `p.card_code IS NULL, p.card_code, COALESCE(p.version, 1), p.name`
      : `pr.trend DESC NULLS LAST, p.name`
  return db
    .prepare(
      `SELECT ${PRODUCT_COLUMNS}
         FROM products p
         LEFT JOIN prices pr ON pr.id_product = p.id_product
        WHERE p.id_expansion = ? AND p.is_sealed = ?
        ORDER BY ${order}`,
    )
    .all(idExpansion, sealed ? 1 : 0) as ProductRow[]
}

export type SearchRow = ProductRow & {
  id_expansion: number
  expansion_name: string | null
  set_code: string | null
  identified: number
}

/**
 * Busca por nombre o por código. El código ya va dentro del nombre de
 * Cardmarket (`Yamato (OP17-074)`), así que `OP17-074` encuentra la carta sin
 * hacer nada especial.
 */
export function searchProducts(q: string, limit = 60): SearchRow[] {
  return db
    .prepare(
      `SELECT ${PRODUCT_COLUMNS},
              e.id_expansion, e.name AS expansion_name, e.set_code,
              ${IDENTIFIED} AS identified
         FROM products p
         LEFT JOIN prices     pr ON pr.id_product   = p.id_product
         LEFT JOIN expansions e  ON e.id_expansion  = p.id_expansion
        WHERE p.name LIKE ?
        ORDER BY p.is_sealed DESC, pr.trend DESC NULLS LAST
        LIMIT ?`,
    )
    .all(`%${q}%`, limit) as SearchRow[]
}

// ─── Panel de administración ────────────────────────────────────────────────

export function getAdminOverview() {
  return db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM expansions)                                           AS expansions,
         (SELECT COUNT(*) FROM expansions e WHERE ${IDENTIFIED})                     AS identified,
         (SELECT COUNT(*) FROM expansions WHERE tcg_group_id IS NOT NULL)            AS via_tcg,
         (SELECT COUNT(*) FROM products)                                             AS products,
         (SELECT COUNT(*) FROM products WHERE is_sealed = 0)                         AS singles,
         (SELECT COUNT(*) FROM products WHERE is_sealed = 1)                         AS sealed,
         (SELECT COUNT(*) FROM products WHERE is_sealed = 0 AND card_code IS NOT NULL) AS with_code,
         (SELECT COUNT(*) FROM products WHERE image IS NOT NULL)                     AS with_image,
         (SELECT COUNT(*) FROM products WHERE rarity IS NOT NULL)                    AS with_rarity,
         (SELECT COUNT(*) FROM price_history)                                        AS history,
         (SELECT COUNT(DISTINCT day) FROM price_history)                             AS history_days,
         (SELECT COUNT(*) FROM products p JOIN expansions e USING (id_expansion)
           WHERE ${IDENTIFIED})                                                      AS products_in_named,
         (SELECT value FROM meta WHERE key = 'map_sets_at')                          AS map_sets_at`,
    )
    .get() as Record<string, number> & { map_sets_at: string | null }
}

/** Expansiones que no salen en la web porque no se sabe qué son. */
export function listUnidentified(limit = 40) {
  return db
    .prepare(
      `SELECT e.id_expansion,
              COUNT(*)                              AS products,
              SUM(p.is_sealed)                      AS sealed,
              MAX(pr.trend)                         AS top_trend,
              (SELECT name FROM products
                WHERE id_expansion = e.id_expansion
                ORDER BY is_sealed DESC LIMIT 1)    AS sample
         FROM expansions e
         JOIN products p   ON p.id_expansion = e.id_expansion
         LEFT JOIN prices pr ON pr.id_product = p.id_product
        WHERE NOT ${IDENTIFIED}
        GROUP BY e.id_expansion
        ORDER BY products DESC
        LIMIT ?`,
    )
    .all(limit) as {
    id_expansion: number
    products: number
    sealed: number
    top_trend: number | null
    sample: string
  }[]
}

/**
 * Sets que salen en la web pero sin TCGplayer detrás: tienen código, pero no
 * nombre fiable ni imágenes. Lo normal es que sean muy nuevos (TCGplayer aún
 * no los tiene) o que el cruce no haya llegado al mínimo de cobertura.
 */
export function listWithoutTcg(limit = 40) {
  return db
    .prepare(
      `SELECT e.id_expansion, e.set_code, e.name, e.coverage,
              COUNT(p.id_product) FILTER (WHERE p.is_sealed = 0) AS singles
         FROM expansions e
         LEFT JOIN products p ON p.id_expansion = e.id_expansion
        WHERE e.set_code IS NOT NULL AND e.tcg_group_id IS NULL
        GROUP BY e.id_expansion
        ORDER BY singles DESC
        LIMIT ?`,
    )
    .all(limit) as {
    id_expansion: number
    set_code: string
    name: string | null
    coverage: number | null
    singles: number
  }[]
}

export function listRuns(limit = 12) {
  return db
    .prepare(`SELECT * FROM ingest_runs ORDER BY id DESC LIMIT ?`)
    .all(limit) as {
    id: number
    started_at: string
    finished_at: string | null
    source_created_at: string | null
    products_upserted: number | null
    products_new: number | null
    prices_upserted: number | null
    history_rows: number | null
    status: string
    error: string | null
  }[]
}
