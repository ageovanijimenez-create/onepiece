/**
 * Nombres de set, rarezas e imágenes, desde consola.
 *
 *   npm run map-sets
 *
 * La lógica vive en `src/lib/map-sets.ts` porque también se lanza desde el
 * panel y, sola, cuando la ingesta trae productos nuevos.
 */
import { runMapSets } from '../lib/map-sets'

console.log('\n▶ Identificar sets (TCGCSV)\n')

try {
  await runMapSets((msg) => console.log(`  ${msg}`))
  console.log('')
} catch (err) {
  console.error(`\n  ✗ ${(err as Error).message}\n`)
  process.exit(1)
}
