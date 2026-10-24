/**
 * Nombres de set de reserva, por si TCGCSV no responde.
 *
 * La fuente buena es TCGCSV (ver `map-sets.ts`): trae los sets nuevos el día
 * que salen, con fecha. Esta tabla solo cubre el caso de que esté caído, para
 * que un set conocido no se quede sin nombre. Si un código no está aquí se
 * enseña el código tal cual (`OP14`), que es como lo llama la gente de todos
 * modos.
 *
 * Solo nombres oficiales en inglés de los que no hay duda. Mejor un código
 * que un nombre equivocado.
 */
export const FALLBACK_SET_NAMES: Record<string, string> = {
  OP01: 'Romance Dawn',
  OP02: 'Paramount War',
  OP03: 'Pillars of Strength',
  OP04: 'Kingdoms of Intrigue',
  OP05: 'Awakening of the New Era',
  OP06: 'Wings of the Captain',
  OP07: '500 Years in the Future',
  OP08: 'Two Legends',
  OP09: 'Emperors in the New World',
  OP10: 'Royal Blood',
  OP11: 'A Fist of Divine Speed',
  OP12: 'Legacy of the Master',
  OP13: 'Carrying On His Will',
  EB01: 'Memorial Collection',
  EB02: 'Anime 25th Collection',
  PRB01: 'The Best',
  PRB02: 'The Best Vol.2',
  ST01: 'Straw Hat Crew',
  ST02: 'Worst Generation',
  ST03: 'The Seven Warlords of the Sea',
  ST04: 'Animal Kingdom Pirates',
  ST05: 'One Piece Film Edition',
  ST06: 'Absolute Justice',
  ST07: 'Big Mom Pirates',
  ST08: 'Monkey.D.Luffy',
  ST09: 'Yamato',
  ST10: 'The Three Captains',
  ST11: 'Uta',
  ST12: 'Zoro & Sanji',
  ST13: 'The Three Brothers',
  P: 'Promos',
}
