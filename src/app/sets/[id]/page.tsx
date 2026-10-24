import { notFound } from 'next/navigation'
import { getExpansion, getProducts, type Orden } from '@/db/queries'
import { ProductTable } from '@/components/ProductTable'
import { KIND_LABELS } from '@/lib/cards'
import { fecha, num, setName } from '@/lib/format'

export const dynamic = 'force-dynamic'

export default async function SetPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ ver?: string; orden?: string }>
}) {
  const { id } = await params
  const { ver, orden: pedido } = await searchParams

  const expansion = getExpansion(Number(id))
  if (!expansion) notFound()

  // Por defecto el sellado, como en PokeVault; pero un set de promos no
  // tiene, y abrirlo en una pestaña vacía no tiene sentido.
  const viendoSellados = ver === 'sellados' || (ver !== 'cartas' && expansion.sealed > 0)
  const orden: Orden = pedido === 'numero' ? 'numero' : 'precio'
  const rows = getProducts(expansion.id_expansion, viendoSellados, orden)

  const base = `/sets/${id}`
  const cartasHref = (o: Orden) => `${base}?ver=cartas${o === 'numero' ? '&orden=numero' : ''}`

  return (
    <>
      <div style={{ paddingTop: 22 }}>
        <a className="back" href="/">
          ← Todos los sets
        </a>
      </div>

      <div className="set-head">
        {expansion.set_code && <span className="set-code big">{expansion.set_code}</span>}
        <div>
          <h1>{setName(expansion)}</h1>
          <div className="sub">
            {[
              expansion.kind ? KIND_LABELS[expansion.kind] : null,
              fecha(expansion.release_date),
              `${num(expansion.singles)} cartas`,
              `${num(expansion.sealed)} sellados`,
            ]
              .filter(Boolean)
              .join(' · ')}
          </div>
        </div>
      </div>

      <div className="tabs-row">
        <div className="tabs">
          <a className={`tab ${viendoSellados ? 'on' : ''}`} href={`${base}?ver=sellados`}>
            Sellados ({num(expansion.sealed)})
          </a>
          <a className={`tab ${viendoSellados ? '' : 'on'}`} href={cartasHref(orden)}>
            Cartas ({num(expansion.singles)})
          </a>
        </div>

        {!viendoSellados && rows.length > 1 && (
          <div className="sort" aria-label="Ordenar">
            Ordenar por
            <a className={orden === 'precio' ? 'on' : ''} href={cartasHref('precio')}>
              precio
            </a>
            <a className={orden === 'numero' ? 'on' : ''} href={cartasHref('numero')}>
              número
            </a>
          </div>
        )}
      </div>

      {viendoSellados && expansion.sealed > 0 && (
        <div className="note">
          Cardmarket no publica medias de venta para producto sellado: solo <b>trend</b>, media y
          mínimo. La evolución en el tiempo la construye OPVault guardando una foto diaria.
        </div>
      )}

      {!viendoSellados && !expansion.tcg_group_id && expansion.singles > 0 && (
        <div className="note">
          Este set todavía no está cruzado con TCGplayer, así que sus cartas salen <b>sin imagen
          ni rareza</b>. Suele pasar con los sets recién salidos y se arregla solo cuando TCGplayer
          los publica.
        </div>
      )}

      <ProductTable
        rows={rows}
        showSalesAverages={!viendoSellados}
        emptyLabel={
          viendoSellados
            ? 'Este set no tiene producto sellado en Cardmarket.'
            : 'Este set no tiene cartas sueltas en Cardmarket.'
        }
      />
    </>
  )
}
