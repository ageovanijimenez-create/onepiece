import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  type GroupCard,
  type GroupInput,
  cleanGroupName,
  isBaseArt,
  matchExpansion,
  matchProducts,
} from './match'

/** Un set de TCGplayer con las cartas `prefix-001..n`. */
function group(
  groupId: number,
  name: string,
  abbreviation: string | null,
  numbers: string[],
  extra: GroupCard[] = [],
): GroupInput {
  return {
    groupId,
    name,
    abbreviation,
    publishedOn: '2023-05-26T00:00:00',
    cards: [
      ...numbers.map((number, i) => ({
        productId: groupId * 1000 + i,
        name: `Carta ${number}`,
        number,
        rarity: 'C',
        imageUrl: `https://img/${number}.jpg`,
      })),
      ...extra,
    ],
  }
}

const range = (prefix: string, n: number) =>
  Array.from({ length: n }, (_, i) => `${prefix}-${String(i + 1).padStart(3, '0')}`)

const singles = (codes: string[]) =>
  codes.map((code, i) => ({ idProduct: 500 + i, code, version: null }))

const OP01 = group(1, 'Romance Dawn', 'OP01', range('OP01', 30))
const OP02 = group(2, 'Paramount War', 'OP-02', range('OP02', 30))
const PRB01 = group(3, 'Premium Booster -The Best-', 'PRB01', [
  'OP01-001',
  'OP01-002',
  'OP02-005',
  'OP02-006',
  'ST01-001',
])
const PRE = group(4, 'Romance Dawn Pre-Release Cards', null, range('OP01', 30))
const GROUPS = [OP01, OP02, PRB01, PRE]

test('un booster normal va a su set aunque haya reimpresiones en otros', () => {
  const m = matchExpansion({ idExpansion: 10, singles: singles(range('OP01', 30)) }, GROUPS)
  assert.equal(m.groupId, 1)
  assert.equal(m.setCode, 'OP01')
  assert.equal(m.name, 'Romance Dawn')
  assert.equal(m.kind, 'booster')
  assert.equal(m.releaseDate, '2023-05-26')
  assert.equal(m.coverage, 1)
})

test('el empate con un set de pre-release lo gana el del código', () => {
  // PRE tiene exactamente los mismos números que OP01.
  const m = matchExpansion({ idExpansion: 10, singles: singles(range('OP01', 30)) }, [PRE, OP01])
  assert.equal(m.groupId, 1)
})

test('un recopilatorio va al set que reúne sus cartas, no a un booster', () => {
  const codes = ['OP01-001', 'OP01-002', 'OP02-005', 'OP02-006', 'ST01-001']
  const m = matchExpansion({ idExpansion: 11, singles: singles(codes) }, GROUPS)
  assert.equal(m.groupId, 3)
  assert.equal(m.setCode, 'PRB01')
  assert.equal(m.kind, 'premium')
  assert.equal(m.name, 'Premium Booster -The Best-')
})

test('sin TCGplayer se usa el prefijo y la tabla de reserva', () => {
  const m = matchExpansion({ idExpansion: 12, singles: singles(range('OP05', 10)) }, [])
  assert.equal(m.groupId, null)
  assert.equal(m.setCode, 'OP05')
  assert.equal(m.name, 'Awakening of the New Era')
  assert.equal(m.kind, 'booster')
})

test('un set desconocido sin TCGplayer se queda con el código y sin nombre', () => {
  const m = matchExpansion({ idExpansion: 13, singles: singles(range('OP99', 10)) }, [])
  assert.equal(m.setCode, 'OP99')
  assert.equal(m.name, null)
})

test('poca cobertura no se da por buena', () => {
  // Solo 2 de 10 códigos están en OP01: no es ese set.
  const codes = ['OP01-001', 'OP01-002', ...range('OP77', 8)]
  const m = matchExpansion({ idExpansion: 14, singles: singles(codes) }, GROUPS)
  assert.equal(m.groupId, null)
  assert.equal(m.setCode, 'OP77')
})

test('una expansión sin códigos no se identifica', () => {
  const m = matchExpansion({ idExpansion: 15, singles: [] }, GROUPS)
  assert.equal(m.groupId, null)
  assert.equal(m.setCode, null)
  assert.equal(m.kind, 'otros')
})

test('limpia el código pegado al nombre del set', () => {
  assert.equal(cleanGroupName('OP01: Romance Dawn', 'OP01'), 'Romance Dawn')
  assert.equal(cleanGroupName('Romance Dawn [OP01]', 'OP01'), 'Romance Dawn')
  assert.equal(cleanGroupName('Romance Dawn', 'OP01'), 'Romance Dawn')
  assert.equal(cleanGroupName('Promotion Cards', null), 'Promotion Cards')
})

test('distingue la ilustración normal de las alternativas', () => {
  assert.equal(isBaseArt('Monkey.D.Luffy'), true)
  assert.equal(isBaseArt('Monkey.D.Luffy (001)'), true)
  assert.equal(isBaseArt('Monkey.D.Luffy (Parallel)'), false)
  assert.equal(isBaseArt('Monkey.D.Luffy (Manga)'), false)
  assert.equal(isBaseArt('Monkey.D.Luffy (Alternate Art)'), false)
})

// ─── Imágenes ────────────────────────────────────────────────────────────────

const card = (productId: number, name: string, number: string, rarity = 'SR'): GroupCard => ({
  productId,
  name,
  number,
  rarity,
  imageUrl: `https://img/${productId}.jpg`,
})

test('una versión en cada lado: se empareja', () => {
  const g = group(5, 'Set', 'OP05', [], [card(1, 'Yamato', 'OP05-010')])
  const [m] = matchProducts(
    { idExpansion: 1, singles: [{ idProduct: 900, code: 'OP05-010', version: null }] },
    g,
  )
  assert.equal(m.image, 'https://img/1.jpg')
  assert.equal(m.tcgProductId, 1)
  assert.equal(m.rarity, 'SR')
})

test('normal + paralela en cada lado: V.1 con la normal, V.2 con la paralela', () => {
  // La paralela tiene un productId MENOR: el orden lo decide el nombre, no el id.
  const g = group(5, 'Set', 'OP05', [], [
    card(20, 'Yamato (Parallel)', 'OP05-010'),
    card(30, 'Yamato', 'OP05-010'),
  ])
  const out = matchProducts(
    {
      idExpansion: 1,
      singles: [
        { idProduct: 902, code: 'OP05-010', version: 2 },
        { idProduct: 901, code: 'OP05-010', version: 1 },
      ],
    },
    g,
  )
  const byId = new Map(out.map((m) => [m.idProduct, m]))
  assert.equal(byId.get(901)!.tcgProductId, 30)
  assert.equal(byId.get(902)!.tcgProductId, 20)
})

test('tres versiones: solo la V.1 lleva imagen; la rareza común sí se pone', () => {
  const g = group(5, 'Set', 'OP05', [], [
    card(30, 'Yamato', 'OP05-010'),
    card(31, 'Yamato (Parallel)', 'OP05-010'),
    card(32, 'Yamato (Manga)', 'OP05-010'),
  ])
  const out = matchProducts(
    {
      idExpansion: 1,
      singles: [
        { idProduct: 901, code: 'OP05-010', version: 1 },
        { idProduct: 902, code: 'OP05-010', version: 2 },
        { idProduct: 903, code: 'OP05-010', version: 3 },
      ],
    },
    g,
  )
  const byId = new Map(out.map((m) => [m.idProduct, m]))
  assert.equal(byId.get(901)!.tcgProductId, 30)
  assert.equal(byId.get(902)!.image, null)
  assert.equal(byId.get(903)!.image, null)
  assert.equal(byId.get(903)!.rarity, 'SR')
})

test('si no está la V.1, dos y dos no se emparejan a ciegas', () => {
  const g = group(5, 'Set', 'OP05', [], [
    card(30, 'Yamato', 'OP05-010'),
    card(31, 'Yamato (Parallel)', 'OP05-010'),
  ])
  const out = matchProducts(
    {
      idExpansion: 1,
      singles: [
        { idProduct: 902, code: 'OP05-010', version: 2 },
        { idProduct: 903, code: 'OP05-010', version: 3 },
      ],
    },
    g,
  )
  assert.ok(out.every((m) => m.image === null))
})

test('rarezas distintas entre versiones: sin rareza para las no emparejadas', () => {
  const g = group(5, 'Set', 'OP05', [], [
    card(30, 'Yamato', 'OP05-010', 'R'),
    card(31, 'Yamato (Parallel)', 'OP05-010', 'R'),
    card(32, 'Yamato (Manga)', 'OP05-010', 'TR'),
  ])
  const out = matchProducts(
    {
      idExpansion: 1,
      singles: [
        { idProduct: 901, code: 'OP05-010', version: 1 },
        { idProduct: 903, code: 'OP05-010', version: 3 },
      ],
    },
    g,
  )
  const byId = new Map(out.map((m) => [m.idProduct, m]))
  assert.equal(byId.get(901)!.rarity, 'R')
  assert.equal(byId.get(903)!.rarity, null)
})
