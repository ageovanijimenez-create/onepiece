import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cardFull, cardThumb } from './images'

test('cambia el tamaño de una imagen del CDN de TCGplayer', () => {
  const url = 'https://tcgplayer-cdn.tcgplayer.com/product/453505_200w.jpg'
  assert.equal(cardThumb(url), url)
  assert.equal(cardFull(url), 'https://tcgplayer-cdn.tcgplayer.com/product/453505_in_1000x1000.jpg')
  assert.equal(cardThumb(cardFull(url)), url)
})

test('una URL con otro formato se usa tal cual', () => {
  assert.equal(cardThumb('https://otro.cdn/foto.png'), 'https://otro.cdn/foto.png')
})
