/* Paint out the hair that MakeHuman bakes into its skin textures: fill
 * the scalp UV region (mask rasterized from the head geometry) with the
 * texture's own forehead tone, feathered. usage:
 *   node scripts/clean-scalp.mjs <mask.png> <texture...>  (in place)
 */
import sharp from 'sharp'

const [maskPath, ...textures] = process.argv.slice(2)
const SIZE = 1024

const maskRaw = await sharp(maskPath).resize(SIZE, SIZE).extractChannel(0).raw().toBuffer()
// feathered copy for soft edges
const feather = await sharp(maskPath).resize(SIZE, SIZE).extractChannel(0).blur(4).raw().toBuffer()

// forehead sample point: just below the lowest mask pixel in the mask's
// horizontal centre band
let maskBottom = 0, xs = []
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    if (maskRaw[y * SIZE + x] > 128) { maskBottom = Math.max(maskBottom, y); xs.push(x) }
  }
}
const xCentre = Math.round(xs.reduce((a, b) => a + b, 0) / xs.length)
const sampleY = Math.min(SIZE - 1, maskBottom + 18)

for (const tex of textures) {
  const img = sharp(tex)
  const meta = await img.metadata()
  const raw = await img.resize(SIZE, SIZE).ensureAlpha().raw().toBuffer()
  const i0 = (sampleY * SIZE + xCentre) * 4
  const tone = [raw[i0], raw[i0 + 1], raw[i0 + 2]]
  for (let p = 0; p < SIZE * SIZE; p++) {
    const a = feather[p] / 255
    if (a > 0.02) {
      for (let c = 0; c < 3; c++) raw[p * 4 + c] = Math.round(raw[p * 4 + c] * (1 - a) + tone[c] * a)
    }
  }
  await sharp(raw, { raw: { width: SIZE, height: SIZE, channels: 4 } })
    .webp({ quality: 88 })
    .toFile(tex + '.tmp')
  const { renameSync } = await import('fs')
  renameSync(tex + '.tmp', tex)
  console.log('cleaned', tex.split('/').pop(), 'tone rgb(' + tone.join(',') + ')')
}
