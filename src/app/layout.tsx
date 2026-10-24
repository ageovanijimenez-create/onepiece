import type { Metadata } from 'next'
import { startScheduler } from '@/lib/scheduler'
import './globals.css'

export const metadata: Metadata = {
  title: 'OPVault — precios One Piece Card Game en Europa',
  description:
    'Catálogo completo de cartas y productos sellados de One Piece Card Game con precios europeos en euros, set a set.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Dentro del componente, no en el ámbito del módulo: así solo arranca cuando
  // se renderiza una página de verdad, no cuando el build lee el fichero.
  // Tiene su propia guarda para no repetirse. Ver src/lib/scheduler.ts.
  startScheduler()

  return (
    <html lang="es">
      <body>
        <header className="top">
          <div className="wrap inner">
            <a href="/" className="brand">
              OP<span>Vault</span>
            </a>
            <form className="search" action="/buscar" role="search">
              <label htmlFor="q" className="sr-only">
                Buscar carta, código o producto
              </label>
              <input
                id="q"
                name="q"
                type="search"
                placeholder="Buscar carta o código (OP05-119)…"
                autoComplete="off"
              />
            </form>
          </div>
        </header>
        <main className="wrap">{children}</main>
        <div className="wrap">
          <footer className="bottom">
            Precios de Cardmarket · nombres de set, rarezas e imágenes de TCGplayer (vía TCGCSV).
            <br />
            Proyecto independiente, sin relación con Bandai, Shueisha, Toei Animation ni Cardmarket.
          </footer>
        </div>
      </body>
    </html>
  )
}
