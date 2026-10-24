const EUR = new Intl.NumberFormat('es-ES', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 2,
})
const NUM = new Intl.NumberFormat('es-ES')

export const eur = (v: number | null | undefined) => (v == null ? '—' : EUR.format(v))
export const num = (v: number | null | undefined) => (v == null ? '—' : NUM.format(v))

/**
 * Nombre a mostrar de un set. Si no hay nombre se enseña el código (`OP14`),
 * que es como lo llama la gente; y si tampoco hay código, el id de Cardmarket,
 * que solo sale en el panel.
 */
export const setName = (e: { name: string | null; set_code: string | null; id_expansion: number }) =>
  e.name ?? e.set_code ?? `Expansión #${e.id_expansion}`

export const fecha = (iso: string | null | undefined) => {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })
}

/** Fecha compacta para columnas de tabla: "jul 2026". */
export const fechaCorta = (iso: string | null | undefined) => {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleDateString('es-ES', { month: 'short', year: 'numeric' }).replace('.', '')
}
