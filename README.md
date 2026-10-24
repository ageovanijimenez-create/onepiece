# OPVault

Catálogo y precios de One Piece Card Game para el mercado europeo. Cartas y
producto sellado, separados por set, en euros.

Es el hermano de [PokeVault](https://github.com/ageovanijimenez-create/PokeVault):
misma arquitectura, mismo sistema visual y la misma idea de fondo —guardar
cada día el histórico de precios que Cardmarket no publica—, adaptado a cómo
funciona One Piece.

```bash
npm install
npm run ingest      # catálogo + precios de Cardmarket, y si es la primera vez, identifica los sets
npm run map-sets    # nombres de set, rarezas e imágenes (TCGCSV); se lanza solo cuando hace falta
npm run dev         # http://localhost:3000
npm test            # tests de la lógica de cruce
```

`ingest` es lo único que hay que ejecutar a diario, y en Railway lo hace solo.

---

## Lo que cambia respecto a PokeVault

En Pokémon, Cardmarket da `Pikachu` y nada más: hubo que montar un puente de
IDs con TCGdex, carta a carta, para saber de qué set era cada una (~40.000
peticiones la primera vez).

**En One Piece cada carta lleva impreso su código, y Cardmarket lo mete en el
nombre:**

```
Monkey.D.Luffy (OP13-118) (V.1)
Yamato (OP17-074)
```

El código dice el set (`OP13`), y la `(V.n)` qué versión es (normal, paralela,
manga...). Con eso:

- se sabe a qué set pertenece cada carta sin preguntar a nadie;
- se cruza con TCGplayer por código, set entero de una vez: unas pocas
  decenas de peticiones en total, no miles;
- el buscador encuentra `OP05-119` sin hacer nada especial.

Por eso hay dos tareas en vez de siete, y no hace falta subir una base
precalculada para no machacar a nadie.

---

## De dónde salen los datos

| Fuente | Qué aporta | Coste |
|---|---|---|
| **Cardmarket** (ficheros públicos) | Catálogo completo y precios en EUR, cartas y sellado | Gratis, sin API key |
| **TCGCSV** (espejo de TCGplayer) | Nombre y fecha de cada set, rareza e imagen de cada carta | Gratis, pide User-Agent propio |

Los ficheros de Cardmarket son los mismos que en PokeVault, con el id de juego
de One Piece (`18`) en vez del de Pokémon (`6`):

```
https://downloads.s3.cardmarket.com/productCatalog/productList/products_singles_18.json
https://downloads.s3.cardmarket.com/productCatalog/productList/products_nonsingles_18.json
https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_18.json
```

En TCGCSV, One Piece es la categoría `68`.

> **Los dos ids se comprueban, no se suponen.** La ingesta aborta antes de
> escribir nada si menos de la mitad de las cartas descargadas llevan código
> de One Piece, y `map-sets` si TCGCSV no tiene ningún set `OPxx`. Si algún
> día cambian, se corrigen con `CARDMARKET_GAME` y `TCGCSV_CATEGORY`.

---

## Cómo funciona la actualización diaria

Idéntica a PokeVault. Cardmarket regenera el price guide una vez al día, de
madrugada, y cada fichero lleva un `createdAt` que gobierna todo:

```
npm run ingest
  │
  ├─ 1. Baja el price guide y lee su createdAt
  │      ¿coincide con el de la última ejecución correcta? → sí: se sale
  │
  ├─ 2. Baja el catálogo, comprueba que es One Piece y actualiza `products`
  │      separando nombre, código y versión
  │
  ├─ 3. Escribe en `price_history` SOLO los precios que han cambiado
  │
  ├─ 4. Sobrescribe `prices` con la foto de hoy
  │
  └─ 5. ¿Ha entrado algún producto nuevo? → identifica sets (map-sets)
```

**El paso 3 es lo que hace que el proyecto valga algo.** Cardmarket da la
foto de hoy y nada más. El histórico solo existe si lo guardas tú, y cada día
que no lo guardas ya no se recupera.

> Un hueco en `price_history` significa "ese día no cambió". Al leer la serie
> hay que arrastrar el último valor conocido, no interpretarlo como un cero.

En Railway el planificador (`src/lib/scheduler.ts`) va dentro de la propia web
—un volumen solo se puede montar en un servicio— y mira cada hora con un
`HEAD` si el `ETag` del price guide ha cambiado. Se apaga con `SCHEDULER=off`
y se fuerza en local con `SCHEDULER=on`.

---

## Cómo se identifica cada set

Cardmarket da `idExpansion`, un número sin nombre. El cruce (`src/lib/match.ts`)
**vota**: cada expansión se asigna al set de TCGplayer que contiene más de sus
códigos.

```
expansión de Cardmarket → sus códigos → el set de TCGplayer que más cubre
```

No basta con mirar el prefijo, por los recopilatorios: *The Best* (PRB01)
reimprime cartas de diez sets, así que sus códigos son `OP01-024`, `OP02-013`,
`ST01-013`... Votando funciona para los dos casos: *Romance Dawn* tiene sus
códigos en el set OP01 y pocos en *The Best*; *The Best* los tiene todos en
PRB01 y pocos en cualquier otro. En empate gana el set cuyo código coincide con
el de las cartas (OP01 antes que su pre-release).

Hace falta cubrir al menos el 60% de los códigos. Si TCGplayer no responde o
todavía no tiene el set (pasa los primeros días), la expansión se queda con lo
que dicen sus propios códigos: sale en la web como `OP14` con el nombre
pendiente, sin imágenes, y se completa sola en cuanto TCGplayer lo publica.

`map-sets` se repite entero cada vez (son pocas peticiones), así que un error
de una pasada se corrige solo en la siguiente.

### Las imágenes, solo cuando no hay duda

Una misma carta tiene varias versiones. Cardmarket las numera `(V.1)`,
`(V.2)`...; TCGplayer las marca en el nombre: `(Parallel)`, `(Manga)`. No hay
forma segura de saber que la V.3 de Cardmarket es "la manga" de TCGplayer. Así
que:

| Versiones en cada lado | Qué se hace |
|---|---|
| Una y una | Se emparejan |
| Normal + una alternativa | V.1 con la normal, V.2 con la alternativa |
| Tres o más | Solo la V.1 lleva imagen |

La rareza sí se pone aunque no se sepa qué versión es cuál, siempre que todas
coincidan. Como en PokeVault: **mejor sin foto que con la de otra carta**, y
más aquí, donde las versiones que se confunden son las que valen cientos de
euros.

---

## Desplegar en Railway

Igual que PokeVault:

1. **Volumen** (Settings → Volumes). Sin él cada despliegue se lleva por
   delante el histórico de precios. No hace falta `DB_PATH`: la base va sola a
   `RAILWAY_VOLUME_MOUNT_PATH`. Si falta, el panel lo dice en rojo.
2. **Variable** `ADMIN_TOKEN=<algo largo y aleatorio>`.
3. **Nada más.** La primera ingesta carga el catálogo e identifica los sets
   sola a los 30 segundos de arrancar.

Para traerte una base de local (sobre todo, su histórico) está *Restaurar la
base* en `/admin`, o a mano:

```bash
curl -X POST https://<tu-app>.up.railway.app/api/admin/restore \
     -H "Cookie: op_admin=<tu ADMIN_TOKEN>" \
     --data-binary @data/opvault.sqlite
```

Se valida antes de aceptarla y se coloca en el siguiente reinicio, nunca en
caliente.

---

## Estructura

```
src/
  lib/cards.ts        código, versión y tipo de set a partir del nombre (puro)
  lib/match.ts        cruce Cardmarket ↔ TCGplayer (puro, con tests)
  lib/set-names.ts    nombres de reserva si TCGCSV está caído
  lib/cardmarket.ts   descarga de los ficheros de Cardmarket
  lib/tcgcsv.ts       descarga de TCGCSV
  lib/ingest.ts       la actualización diaria
  lib/map-sets.ts     identifica sets, rarezas e imágenes
  lib/scheduler.ts    planificador dentro del servicio web
  lib/jobs.ts         tareas lanzables desde el panel
  db/index.ts         conexión y esquema
  db/queries.ts       consultas de lectura para la web
  app/                Next.js (App Router)
  app/admin/          panel privado
```

---

## Sistema visual

El de PokeVault: gris oscuro neutro, densidad alta, y color solo donde
significa algo. La única novedad es que el **código del set hace de marca**
(`OP05`), porque es como se llama a los sets en One Piece y TCGplayer no
publica logos.

---

## Panel privado

En `/admin`, protegido por `ADMIN_TOKEN` (sin la variable el panel no existe:
devuelve 404). Muestra la cobertura (sets identificados, cartas con código,
rareza e imagen), las últimas ingestas, los sets que tienen código pero aún no
están en TCGplayer y las expansiones de Cardmarket que no se han podido
identificar. Desde ahí se lanzan las dos tareas y se restaura la base.

---

## Limitaciones conocidas

- **Las cartas con tres o más versiones solo tienen foto en la V.1.** Ver
  arriba. Si algún día hay una fuente que ate la V.n de Cardmarket con su
  producto de TCGplayer, se quita esta limitación.
- **El sellado no tiene imagen.** Igual que en PokeVault: cruzar sellado EU↔US
  por nombre da falsos positivos.
- **El sellado no tiene medias de venta.** Cardmarket solo publica
  `avg1/avg7/avg30` para cartas.
- **Expansiones duplicadas por idioma.** Cardmarket separa alguna edición
  (*The Best (Non-English)*). Las dos casan con el mismo set de TCGplayer y
  salen con el mismo nombre.
- **SQLite** es para el prototipo. El SQL es estándar a propósito y está todo
  en `src/db/`.

---

## Pendiente de verificar con datos reales

El proyecto se escribió en un entorno sin acceso a Cardmarket ni a TCGCSV, así
que la lógica está probada con tests y con ficheros de prueba, pero **no
contra los ficheros reales**. Lo que hay que confirmar en la primera ejecución:

| Supuesto | Si falla, se nota en |
|---|---|
| One Piece es el juego `18` de Cardmarket | `npm run ingest` aborta con "no parece One Piece" |
| Los nombres llevan el código: `Yamato (OP17-074)` | Lo mismo |
| One Piece es la categoría `68` de TCGCSV | `npm run map-sets` aborta con "no parece One Piece" |
| TCGCSV da el código y la rareza en `extendedData` como `Number` y `Rarity` | El panel: "Expansiones cruzadas con TCGplayer" a 0% |
| TCGplayer marca las versiones con `(Parallel)`, `(Manga)`... | El panel: pocas cartas con imagen |

Cuando todo cuadre, esta sección se puede borrar.

---

Proyecto independiente. Sin relación con Bandai, Eiichiro Oda, Shueisha, Toei
Animation ni Cardmarket. Los precios son de Cardmarket y los nombres de set,
rarezas e imágenes de TCGplayer.
