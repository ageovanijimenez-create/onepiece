import { contarPorFiltro, getStats, listExpansions, type Filtro } from '@/db/queries'
import { KIND_LABELS } from '@/lib/cards'
import { eur, fechaCorta, num } from '@/lib/format'

export const dynamic = 'force-dynamic'

const FILTROS: { id: Filtro; etiqueta: string }[] = [
  { id: 'todo', etiqueta: 'Todos' },
  { id: 'boosters', etiqueta: 'Boosters' },
  { id: 'especiales', etiqueta: 'Extra y Premium' },
  { id: 'inicio', etiqueta: 'Barajas de inicio' },
  { id: 'promos', etiqueta: 'Promos y otros' },
]

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ tipo?: string }>
}) {
  const { tipo: pedido } = await searchParams
  const filtro: Filtro = FILTROS.some((f) => f.id === pedido) ? (pedido as Filtro) : 'todo'

  const stats = getStats()
  const conteo = contarPorFiltro()
  const sets = listExpansions(filtro)

  return (
    <>
      <div className="page-head">
        <h1>Precios de One Piece Card Game en Europa</h1>
        <p className="lede">
          Cartas y producto sellado, set a set, con el precio de mercado de Cardmarket en euros.
        </p>
        <div className="meta-line">
          <span>
            <b>{num(conteo.todo)}</b> sets
          </span>
          <span className="sep">/</span>
          <span>
            <b>{num(stats.singles)}</b> cartas
          </span>
          <span className="sep">/</span>
          <span>
            <b>{num(stats.sealed)}</b> sellados
          </span>
          <span className="sep">/</span>
          <span>
            actualizado <b>{stats.updated_at ? fechaCorta(stats.updated_at) : '—'}</b>
          </span>
        </div>
      </div>

      {conteo.todo === 0 ? (
        <div className="empty" style={{ marginTop: 24 }}>
          {stats.singles + stats.sealed > 0 ? (
            // Hay productos pero ningún set identificado. Decir "no hay
            // catálogo" aquí sería mentira y manda a buscar el problema donde
            // no está: el catálogo está entero, solo le falta agruparlo.
            <>
              <strong>El catálogo está, pero sin agrupar por sets</strong>
              Hay {num(stats.singles + stats.sealed)} productos cargados y el buscador ya los
              encuentra. Lo que falta es identificar los sets: entra en <code>/admin</code> y pulsa{' '}
              <b>Identificar sets e imágenes</b>.
            </>
          ) : (
            <>
              <strong>Todavía no hay catálogo</strong>
              La primera ingesta lo carga sola en unos minutos. Para adelantarla, entra en{' '}
              <code>/admin</code> y pulsa <b>Actualizar precios</b>.
            </>
          )}
        </div>
      ) : (
        <>
          <div className="tabs" style={{ marginTop: 20, marginBottom: 12 }}>
            {FILTROS.map((f) => (
              <a
                key={f.id}
                className={`tab ${filtro === f.id ? 'on' : ''}`}
                href={f.id === 'todo' ? '/' : `/?tipo=${f.id}`}
              >
                {f.etiqueta} ({num(conteo[f.id])})
              </a>
            ))}
          </div>

          {sets.length === 0 ? (
            <div className="empty">
              <strong>Nada en esta categoría</strong>
              Todavía no hay sets de este tipo en el catálogo.
            </div>
          ) : (
            <div className="index">
              <div className="index-head">
                <span>Código</span>
                <span>Set</span>
                <span className="col-kind">Tipo</span>
                <span className="col-date num">Salida</span>
                <span className="col-singles num">Cartas</span>
                <span className="col-sealed num">Sellados</span>
                <span className="col-top-single num">Carta top</span>
                <span className="num">Sellado top</span>
              </div>

              {sets.map((e) => (
                <a className="set-row" key={e.id_expansion} href={`/sets/${e.id_expansion}`}>
                  <span className="set-code">{e.set_code ?? '—'}</span>
                  {/* El código ya está a la izquierda: repetirlo como nombre
                      no dice nada. */}
                  <span className="set-name">
                    {e.name ?? <span className="nil">Nombre pendiente</span>}
                  </span>
                  <span className="col-kind">{KIND_LABELS[e.kind ?? 'otros']}</span>
                  <span className="col-date num">{fechaCorta(e.release_date) ?? '—'}</span>
                  <span className="col-singles num">{num(e.singles)}</span>
                  <span className="col-sealed num">{num(e.sealed)}</span>
                  <span className="col-top-single num">{e.top_single ? eur(e.top_single) : '—'}</span>
                  <span className="num strong">{e.top_sealed ? eur(e.top_sealed) : '—'}</span>
                </a>
              ))}
            </div>
          )}
        </>
      )}
    </>
  )
}
