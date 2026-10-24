import Database from 'better-sqlite3'
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { dirname } from 'node:path'
import { estadoAlmacen, rutaPorDefecto } from '../lib/storage'

/**
 * Dónde vive la base.
 *
 * Si Railway tiene un volumen montado, por defecto vamos ahí sin que nadie
 * tenga que configurar nada: el disco del contenedor es efímero y cada
 * despliegue se llevaría por delante el histórico de precios, que es lo único
 * que no se puede reconstruir.
 */
export const DB_PATH = process.env.DB_PATH ?? rutaPorDefecto()

/** Fichero que deja `/api/admin/restore` para que lo recojamos al arrancar. */
export const INCOMING_PATH = `${DB_PATH}.incoming`

/**
 * La conexión se abre PEREZOSAMENTE, en el primer uso real.
 *
 * Abrirla al importar el módulo tumba el build: `next build` lanza varios
 * procesos en paralelo para recolectar la configuración de las rutas, todos
 * importan este fichero y todos intentan crear el esquema a la vez sobre el
 * mismo SQLite → "database is locked". Pasó en PokeVault.
 */
let conexion: Database.Database | null = null

function abrir(): Database.Database {
  mkdirSync(dirname(DB_PATH), { recursive: true })

  // Avisar en los logs si los datos van a un disco que no sobrevive al
  // próximo despliegue. Es un fallo silencioso: todo funciona hasta que
  // redespliegas y descubres que ya no está.
  const almacen = estadoAlmacen(DB_PATH)
  if (almacen.persistencia === 'efimero') {
    console.warn(
      `[db] AVISO: ${DB_PATH} NO está en un volumen. Los datos se perderán en el próximo despliegue.` +
        (almacen.sugerencia ? ` → ${almacen.sugerencia}` : ''),
    )
  }

  // Si hay una base subida esperando, se coloca ANTES de abrir nada. Hacer el
  // cambiazo con la conexión abierta corrompe la base. Los `-wal` y `-shm`
  // viejos hay que borrarlos: son de la base anterior y aplicarlos sobre la
  // nueva la destrozan.
  if (existsSync(INCOMING_PATH)) {
    for (const suffix of ['', '-wal', '-shm']) {
      rmSync(`${DB_PATH}${suffix}`, { force: true })
    }
    renameSync(INCOMING_PATH, DB_PATH)
    console.log('[db] Base restaurada desde la subida pendiente')
  }

  const db = new Database(DB_PATH)
  db.pragma('journal_mode = WAL')
  // Si otro proceso está escribiendo, esperar en vez de fallar en el acto.
  db.pragma('busy_timeout = 10000')

  crearEsquema(db)
  return db
}

/**
 * Esquema. SQL estándar a propósito: mover esto a Postgres en Railway es
 * cambiar INTEGER PRIMARY KEY por BIGINT y poco más.
 */
function crearEsquema(db: Database.Database) {
  db.exec(`
CREATE TABLE IF NOT EXISTS expansions (
  id_expansion  INTEGER PRIMARY KEY,   -- id de expansión de Cardmarket
  set_code      TEXT,                  -- 'OP05', 'ST10', 'PRB01'... null si no se sabe
  name          TEXT,                  -- 'Awakening of the New Era'
  kind          TEXT,                  -- booster | extra | premium | starter | promo | otros
  release_date  TEXT,
  tcg_group_id  INTEGER,               -- set de TCGplayer del que salen nombre, fecha e imágenes
  coverage      REAL                   -- fracción de sus códigos que están en ese set
);
CREATE INDEX IF NOT EXISTS idx_expansions_code ON expansions(set_code);

CREATE TABLE IF NOT EXISTS products (
  id_product     INTEGER PRIMARY KEY,  -- id de producto de Cardmarket
  name           TEXT NOT NULL,        -- tal cual: 'Monkey.D.Luffy (OP13-118) (V.1)'
  card_name      TEXT,                 -- 'Monkey.D.Luffy'
  card_code      TEXT,                 -- 'OP13-118'; null en sellado y DON!!
  version        INTEGER,              -- el (V.n) de Cardmarket; null si solo hay una
  id_category    INTEGER,
  category_name  TEXT,
  id_expansion   INTEGER,
  is_sealed      INTEGER NOT NULL DEFAULT 0,
  date_added     TEXT,
  rarity         TEXT,                 -- 'L', 'SR', 'SEC'... de TCGplayer
  image          TEXT,                 -- imagen de TCGplayer, solo si el cruce es seguro
  tcg_product_id INTEGER
);
CREATE INDEX IF NOT EXISTS idx_products_expansion ON products(id_expansion);
CREATE INDEX IF NOT EXISTS idx_products_name      ON products(name);
CREATE INDEX IF NOT EXISTS idx_products_code      ON products(card_code);

-- Precio actual: una fila por producto, se sobrescribe cada día.
CREATE TABLE IF NOT EXISTS prices (
  id_product INTEGER PRIMARY KEY,
  avg REAL, low REAL, trend REAL,
  avg1 REAL, avg7 REAL, avg30 REAL,
  avg_foil REAL, low_foil REAL, trend_foil REAL,
  avg1_foil REAL, avg7_foil REAL, avg30_foil REAL,
  updated_at TEXT
);

-- Histórico: una fila por producto y día, SOLO cuando el precio cambia.
-- Es lo único que Cardmarket no nos da y que nadie nos puede quitar.
CREATE TABLE IF NOT EXISTS price_history (
  id_product INTEGER NOT NULL,
  day        TEXT    NOT NULL,
  trend REAL, avg REAL, low REAL, avg7 REAL, avg30 REAL,
  PRIMARY KEY (id_product, day)
);

-- Bitácora de ejecuciones, para saber si el cron va bien sin entrar a mirar.
CREATE TABLE IF NOT EXISTS ingest_runs (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at        TEXT,
  finished_at       TEXT,
  source_created_at TEXT,
  products_upserted INTEGER,
  products_new      INTEGER,
  prices_upserted   INTEGER,
  history_rows      INTEGER,
  status            TEXT,
  error             TEXT
);

-- Tareas de mantenimiento lanzadas desde el panel o encadenadas tras la
-- ingesta. Se guardan aquí para poder seguirlas desde la web.
CREATE TABLE IF NOT EXISTS jobs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  started_at  TEXT NOT NULL,
  finished_at TEXT,
  status      TEXT NOT NULL,          -- running | ok | error
  detail      TEXT,                   -- última línea de progreso
  error       TEXT,
  trigger     TEXT                    -- manual | auto
);

-- Cosas sueltas que no merecen tabla propia: el ETag del último price guide
-- visto (para no bajarse el fichero cada hora) y cuándo se identificaron los
-- sets por última vez.
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);
`)
}

/**
 * Se usa igual que una conexión normal (`db.prepare(...)`), pero por dentro
 * no existe hasta que alguien la toca. El Proxy es lo que permite mantener la
 * apertura diferida sin cambiar los usos repartidos por el código.
 */
export const db = new Proxy({} as Database.Database, {
  get(_target, prop, receiver) {
    conexion ??= abrir()
    const valor = Reflect.get(conexion, prop, receiver)
    return typeof valor === 'function' ? valor.bind(conexion) : valor
  },
})

export const getMeta = (key: string): string | null =>
  (db.prepare(`SELECT value FROM meta WHERE key = ?`).get(key) as { value: string } | undefined)
    ?.value ?? null

export const setMeta = (key: string, value: string) =>
  db
    .prepare(
      `INSERT INTO meta (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run(key, value)
