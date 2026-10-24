import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  codePrefix,
  dominantPrefix,
  kindFromSetCode,
  normalizeSetCode,
  parseCardName,
} from './cards'

test('separa nombre, código y versión', () => {
  assert.deepEqual(parseCardName('Monkey.D.Luffy (OP13-118) (V.1)'), {
    cardName: 'Monkey.D.Luffy',
    code: 'OP13-118',
    version: 1,
  })
  assert.deepEqual(parseCardName('Yamato (OP17-074)'), {
    cardName: 'Yamato',
    code: 'OP17-074',
    version: null,
  })
})

test('acepta cualquier orden y prefijos sin número', () => {
  assert.deepEqual(parseCardName('Nami (V.2) (ST01-007)'), {
    cardName: 'Nami',
    code: 'ST01-007',
    version: 2,
  })
  assert.equal(parseCardName('Monkey.D.Luffy (P-001)').code, 'P-001')
  assert.equal(parseCardName('Roronoa Zoro (PRB01-001) (V.3)').code, 'PRB01-001')
})

test('un producto sin código conserva su nombre', () => {
  assert.deepEqual(parseCardName('Romance Dawn Booster Box'), {
    cardName: 'Romance Dawn Booster Box',
    code: null,
    version: null,
  })
  // Un paréntesis que no es código ni versión se queda en el nombre.
  assert.equal(parseCardName('DON!! Card (Gold) (V.4)').cardName, 'DON!! Card (Gold)')
})

test('prefijo y código de set', () => {
  assert.equal(codePrefix('OP05-119'), 'OP05')
  assert.equal(codePrefix('P-001'), 'P')
  assert.equal(normalizeSetCode('OP-01'), 'OP01')
  assert.equal(normalizeSetCode('prb01'), 'PRB01')
})

test('tipo de set por su código', () => {
  assert.equal(kindFromSetCode('OP05'), 'booster')
  assert.equal(kindFromSetCode('EB-02'), 'extra')
  assert.equal(kindFromSetCode('PRB01'), 'premium')
  assert.equal(kindFromSetCode('ST10'), 'starter')
  assert.equal(kindFromSetCode('P'), 'promo')
  assert.equal(kindFromSetCode(null), 'otros')
})

test('prefijo dominante: booster normal sí, recopilatorio no', () => {
  const booster = ['OP05-001', 'OP05-002', 'OP05-003', 'OP01-024']
  assert.equal(dominantPrefix(booster), 'OP05')

  const recopilatorio = ['OP01-024', 'OP02-013', 'OP03-040', 'ST01-012', 'OP04-083']
  assert.equal(dominantPrefix(recopilatorio), null)

  assert.equal(dominantPrefix([]), null)
})
