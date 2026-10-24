import { test } from 'node:test'
import assert from 'node:assert/strict'
import { type CmPrice, type CmProduct, assertOnePiece, foil } from './cardmarket'

const product = (name: string): CmProduct => ({
  idProduct: 1,
  name,
  idCategory: 1,
  categoryName: 'One Piece Single',
  idExpansion: 1,
  idMetacard: 1,
  dateAdded: '2024-01-01 00:00:00',
})

test('acepta un catálogo de One Piece', () => {
  const pct = assertOnePiece([
    product('Monkey.D.Luffy (OP13-118) (V.1)'),
    product('Yamato (OP17-074)'),
    product('DON!! Card (V.1)'),
  ])
  assert.ok(pct > 0.6)
})

test('rechaza otro juego con un mensaje que dice qué tocar', () => {
  assert.throws(
    () => assertOnePiece([product('Pikachu'), product('Charizard ex'), product('Mewtwo')], 6),
    /no parece One Piece.*CARDMARKET_GAME/,
  )
  assert.throws(() => assertOnePiece([], 18), /vacío/)
})

test('lee el precio especial se llame -foil o -holo', () => {
  const base = { idProduct: 1, idCategory: 1, avg: 1, low: 1, trend: 1, avg1: 1, avg7: 1, avg30: 1 }
  assert.equal(foil({ ...base, 'trend-foil': 5 } as CmPrice, 'trend'), 5)
  assert.equal(foil({ ...base, 'trend-holo': 7 } as CmPrice, 'trend'), 7)
  assert.equal(foil(base as CmPrice, 'trend'), null)
})
