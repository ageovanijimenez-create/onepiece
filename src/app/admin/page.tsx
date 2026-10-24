import { notFound } from 'next/navigation'
import { existsSync, statSync } from 'node:fs'
import { adminEnabled, isAdmin } from '@/lib/admin'
import { getAdminOverview, listRuns, listUnidentified, listWithoutTcg } from '@/db/queries'
import { DB_PATH, INCOMING_PATH } from '@/db/index'
import { estadoAlmacen } from '@/lib/storage'
import { RestoreForm } from '@/components/RestoreForm'
import { JobsPanel } from '@/components/JobsPanel'
import { listJobs } from '@/lib/jobs'
import { eur, fechaCorta, num } from '@/lib/format'

export const dynamic = 'force-dynamic'

function Coverage({ label, done, total }: { label: string; done: number; total: number }) {
  const pct = total ? Math.round((100 * done) / total) : 0
  return (
    <div className="cover-row">
      <span>{label}</span>
      <span className="cover-track">
        <span className="bar">
          <span className="bar-fill" style={{ width: `${pct}%` }} />
        </span>
        <span className="bar-pct">{pct}%</span>
      </span>
      <b>
        {num(done)} / {num(total)}
      </b>
    </div>
  )
}

export default async function Admin({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (!adminEnabled()) notFound()

  if (!(await isAdmin())) {
    const { error } = await searchParams
    return (
      <div className="login">
        <h1>Panel privado</h1>
        <p className="hint-sm">Acceso restringido.</p>
        <form method="post" action="/api/admin/login">
          <label htmlFor="token" className="sr-only">
            Token de acceso
          </label>
          <input id="token" type="password" name="token" placeholder="Token" autoFocus />
          <button type="submit">Entrar</button>
        </form>
        {error && <p className="err">Token incorrecto.</p>}
      </div>
    )
  }

  const o = getAdminOverview()
  const unidentified = listUnidentified(30)
  const withoutTcg = listWithoutTcg(30)
  const runs = listRuns(8)
  const jobs = listJobs(8)
  const subidaPendiente = existsSync(INCOMING_PATH)
    ? { bytes: statSync(INCOMING_PATH).size }
    : null
  const almacen = estadoAlmacen(DB_PATH)

  return (
    <>
      <div className="page-head">
        <h1>Panel</h1>
        <p className="lede">Estado del catálogo y lo que falta por meter.</p>
        <div className="meta-line">
          <span>
            <b>{num(o.history)}</b> puntos de histórico
          </span>
          <span className="sep">/</span>
          <span>
            <b>{num(o.history_days)}</b> días registrados
          </span>
          <span className="sep">/</span>
          <span>
            <b>{num(o.products)}</b> productos
          </span>
          <span className="sep">/</span>
          <span>
            sets identificados <b>{o.map_sets_at ? fechaCorta(o.map_sets_at) : 'nunca'}</b>
          </span>
        </div>
      </div>

      {almacen.persistencia === 'efimero' && (
        <div className="alert">
          <strong>Los datos no sobreviven al próximo despliegue.</strong>
          <p>
            La base está en <code>{almacen.dbPath}</code>, que es disco del contenedor, no un
            volumen. Cada vez que redespliegues se borra: el catálogo se reconstruye solo, pero el{' '}
            <b>histórico de precios no</b> — ese no se puede recuperar.
          </p>
          <p>
            {almacen.volumeMountPath ? (
              <>
                Hay un volumen montado en <code>{almacen.volumeMountPath}</code>, pero{' '}
                <code>DB_PATH</code> apunta fuera. Corrígelo con{' '}
                <code>{almacen.sugerencia}</code>.
              </>
            ) : (
              <>
                No hay ningún volumen en este servicio. Añádelo en Railway (Settings → Volumes) y,
                si dejas <code>DB_PATH</code> sin definir, la base irá sola al volumen.
              </>
            )}
          </p>
        </div>
      )}

      <h2 className="section">Mantenimiento</h2>
      <p className="hint" style={{ marginTop: -4, marginBottom: 12 }}>
        Cuando sale un set nuevo se identifica <b>solo</b>, después de la ingesta diaria. Los
        botones son por si quieres adelantarlo o repetirlo.
      </p>
      <JobsPanel inicial={jobs} />

      <h2 className="section">Restaurar la base</h2>
      <p className="hint" style={{ marginTop: -4, marginBottom: 12 }}>
        Sube un fichero <code>.sqlite</code> (o su <code>.gz</code>) construido en local. Sirve
        sobre todo para traerte el <b>histórico de precios</b>, que es lo único que no se puede
        reconstruir. Se valida antes de aceptarla y se coloca en el siguiente reinicio, nunca en
        caliente. Destino: <code>{DB_PATH}</code>
      </p>
      <RestoreForm pendiente={subidaPendiente} />

      <h2 className="section">Cobertura</h2>
      <div className="cover">
        <Coverage label="Expansiones identificadas" done={o.identified} total={o.expansions} />
        <Coverage label="Expansiones cruzadas con TCGplayer" done={o.via_tcg} total={o.expansions} />
        <Coverage label="Productos en un set identificado" done={o.products_in_named} total={o.products} />
        <Coverage label="Cartas con código" done={o.with_code} total={o.singles} />
        <Coverage label="Cartas con rareza" done={o.with_rarity} total={o.singles} />
        <Coverage label="Cartas con imagen" done={o.with_image} total={o.singles} />
      </div>
      <p className="hint">
        Las imágenes solo se ponen cuando el cruce es seguro. Cuando una carta tiene tres o más
        versiones (normal, paralela, manga...) solo la V.1 lleva foto: no hay forma fiable de saber
        cuál de las demás es cuál, y una foto equivocada es peor que ninguna.
      </p>

      <h2 className="section">Últimas ingestas</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>Volcado</th>
              <th style={{ textAlign: 'left' }}>Estado</th>
              <th>Productos</th>
              <th>Nuevos</th>
              <th>Precios</th>
              <th>Cambios</th>
            </tr>
          </thead>
          <tbody>
            {runs.length === 0 && (
              <tr>
                <td colSpan={6} className="nil">
                  Todavía no se ha lanzado ninguna ingesta.
                </td>
              </tr>
            )}
            {runs.map((r) => (
              <tr key={r.id}>
                <td>{r.source_created_at?.slice(0, 16).replace('T', ' ') ?? '—'}</td>
                <td style={{ textAlign: 'left' }}>
                  <span className={`pill ${r.status}`}>{r.status}</span>
                  {r.error && <span className="cat run-error">{r.error}</span>}
                </td>
                <td>{r.products_upserted ? num(r.products_upserted) : <span className="nil">—</span>}</td>
                <td>{r.products_new ? num(r.products_new) : <span className="nil">—</span>}</td>
                <td>{r.prices_upserted ? num(r.prices_upserted) : <span className="nil">—</span>}</td>
                <td>{r.history_rows ? num(r.history_rows) : <span className="nil">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="section">Con código pero sin TCGplayer ({num(o.identified - o.via_tcg)})</h2>
      <p className="hint" style={{ marginTop: -4, marginBottom: 12 }}>
        Salen en la web porque sus cartas dicen qué set son, pero sin nombre de TCGplayer ni
        imágenes. Lo normal es que sean sets muy nuevos que TCGplayer aún no tiene.
      </p>
      {withoutTcg.length === 0 ? (
        <div className="empty">
          <strong>Ninguno</strong>
          Todos los sets identificados están cruzados con TCGplayer.
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Set</th>
                <th>ID</th>
                <th>Cartas</th>
                <th>Mejor cobertura</th>
              </tr>
            </thead>
            <tbody>
              {withoutTcg.map((w) => (
                <tr key={w.id_expansion}>
                  <td>
                    <a href={`/sets/${w.id_expansion}`}>{w.name ?? 'Nombre pendiente'}</a>
                    <span className="cat">{w.set_code}</span>
                  </td>
                  <td>{w.id_expansion}</td>
                  <td>{num(w.singles)}</td>
                  <td>
                    {w.coverage != null ? `${Math.round(w.coverage * 100)}%` : <span className="nil">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="section">Expansiones sin identificar ({num(o.expansions - o.identified)})</h2>
      <p className="hint" style={{ marginTop: -4, marginBottom: 12 }}>
        No salen en la web: ni sus cartas tienen un código dominante ni casan con ningún set de
        TCGplayer. Suelen ser agrupaciones de Cardmarket (lotes, accesorios, sellado suelto).
        Ordenadas por volumen.
      </p>
      {unidentified.length === 0 ? (
        <div className="empty">
          <strong>Ninguna</strong>
          Todas las expansiones de Cardmarket están identificadas.
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Ejemplo de producto</th>
                <th>ID</th>
                <th>Productos</th>
                <th>Sellados</th>
                <th>Más caro</th>
              </tr>
            </thead>
            <tbody>
              {unidentified.map((u) => (
                <tr key={u.id_expansion}>
                  <td>
                    <a href={`/sets/${u.id_expansion}`}>{u.sample}</a>
                  </td>
                  <td>{u.id_expansion}</td>
                  <td>{num(u.products)}</td>
                  <td>{num(u.sealed)}</td>
                  <td>{u.top_trend ? eur(u.top_trend) : <span className="nil">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
