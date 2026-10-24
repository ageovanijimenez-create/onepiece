/**
 * Tareas de mantenimiento, lanzables desde el panel o encadenadas tras la
 * ingesta diaria.
 *
 * Corren en segundo plano dentro del propio servicio: la petición HTTP crea la
 * tarea y contesta al momento, y el panel va preguntando cómo va. Se guarda
 * todo en la tabla `jobs` para poder seguirlo desde la web sin mirar logs.
 *
 * Solo una a la vez: dos escribiendo sobre las mismas tablas se pisarían.
 *
 * Son dos y no siete como en PokeVault: en One Piece el código de carta hace
 * casi todo el trabajo, y TCGCSV da nombre, fecha, rareza e imagen de una
 * sola pasada.
 */
import { db, getMeta } from '../db/index'
import { runIngest } from './ingest'
import { runMapSets } from './map-sets'
import type { JobName, JobRow } from './jobs-shared'

export { JOB_NAMES, JOB_LABELS } from './jobs-shared'
export type { JobName, JobRow } from './jobs-shared'

/** Una tarea a la vez en todo el proceso. */
let corriendo: JobName | null = null

export const jobEnCurso = () => corriendo

const RUNNERS: Record<JobName, (log: (msg: string) => void) => Promise<void> | void> = {
  // Igual que el planificador: si entran productos nuevos, se identifican en
  // la misma tarea. Así la primera carga desde el panel es un solo botón.
  ingest: async (log) => {
    const r = await runIngest(log)
    if (r.status === 'error') throw new Error(r.error)
    if (r.status === 'ok' && hayQueIdentificar(r.newProducts ?? 0)) {
      log('Hay productos nuevos: identificando sets...')
      await runMapSets(log)
    }
  },
  'map-sets': async (log) => void (await runMapSets(log)),
}

/**
 * Arranca una tarea en segundo plano. Devuelve su id al momento; el resultado
 * se consulta luego en la tabla `jobs`.
 */
export function startJob(name: JobName, trigger: 'manual' | 'auto' = 'manual'): number | null {
  if (corriendo) return null

  corriendo = name
  const { lastInsertRowid } = db
    .prepare(`INSERT INTO jobs (name, started_at, status, trigger) VALUES (?, ?, 'running', ?)`)
    .run(name, new Date().toISOString(), trigger)
  const id = Number(lastInsertRowid)

  const setDetail = db.prepare(`UPDATE jobs SET detail = ? WHERE id = ?`)
  const log = (msg: string) => {
    console.log(`[${name}] ${msg}`)
    try {
      setDetail.run(msg, id)
    } catch {
      /* el progreso es informativo: si falla, la tarea sigue */
    }
  }

  void (async () => {
    try {
      await RUNNERS[name](log)
      db.prepare(`UPDATE jobs SET finished_at = ?, status = 'ok' WHERE id = ?`).run(
        new Date().toISOString(),
        id,
      )
    } catch (err) {
      const message = (err as Error).message
      console.error(`[${name}] ERROR: ${message}`)
      db.prepare(`UPDATE jobs SET finished_at = ?, status = 'error', error = ? WHERE id = ?`).run(
        new Date().toISOString(),
        message,
        id,
      )
    } finally {
      corriendo = null
    }
  })()

  return id
}

export const listJobs = (limit = 8) =>
  db.prepare(`SELECT * FROM jobs ORDER BY id DESC LIMIT ?`).all(limit) as JobRow[]

/**
 * ¿Hay que volver a identificar sets? Sí si nunca se ha hecho, o si la
 * ingesta ha traído productos nuevos (lo normal cuando sale un set).
 */
export function hayQueIdentificar(newProducts: number): boolean {
  return newProducts > 0 || getMeta('map_sets_at') === null
}
