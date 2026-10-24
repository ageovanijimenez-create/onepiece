/**
 * URLs de imagen de TCGplayer.
 *
 * TCGCSV da la imagen pequeña (`.../product/453505_200w.jpg`). El CDN de
 * TCGplayer sirve otros tamaños cambiando el sufijo, así que guardamos la URL
 * tal cual y elegimos el tamaño al pintarla. Si algún día cambia el formato,
 * se usa la URL sin tocar.
 */
const SIZE_RE = /_(?:\d+w|in_\d+x\d+)\.jpg$/

export const cardThumb = (image: string) =>
  SIZE_RE.test(image) ? image.replace(SIZE_RE, '_200w.jpg') : image

export const cardFull = (image: string) =>
  SIZE_RE.test(image) ? image.replace(SIZE_RE, '_in_1000x1000.jpg') : image
