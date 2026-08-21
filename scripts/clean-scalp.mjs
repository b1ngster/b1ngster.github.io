/* Paint out the hair MakeHuman bakes into its skin textures: fill the
 * scalp UV region with the MEDIAN skin tone of the pixels bordering the
 * mask (local and robust — a single-point sample once painted a beige cap
 * on dark skin), with the mask dilated enough to swallow UV-seam lines.
 * usage: node scripts/clean-scalp.mjs <mask.png> <texture...>  (in place)
 */
import sharp from 'sharp'
import { renameSync } from 'fs'

const [maskPath, ...textures] = process.argv.slice(2)
const SIZE = 1024

const hard = await sharp(maskPath).resize(SIZE, SIZE).extractChannel(0).raw().toBuffer()
// dilate: heavy blur then threshold low, so seams and fringes are inside
const dilated = await sharp(maskPath).resize(SIZE, SIZE).extractChannel(0).blur(6).raw().toBuffer()
const feather = await sharp(maskPath).resize(SIZE, SIZE).extractChannel(0).blur(10).raw().toBuffer()

// border band: dilated minus hard — the ring of true skin around the mask
const border = []
for (let p = 0; p < SIZE * SIZE; p++) {
  if (dilated[p] > 40 && hard[p] < 64) border.push(p)
}

for (const tex of textures) {
  const raw = await sharp(tex).resize(SIZE, SIZE).ensureAlpha().raw().toBuffer()
  const rs = [], gs = [], bs = []
  for (const p of border) {
    rs.push(raw[p * 4]); gs.push(raw[p * 4 + 1]); bs.push(raw[p * 4 + 2])
  }
  const med = (a) => a.sort((x, y) => x - y)[a.length >> 1]
  const tone = [med(rs), med(gs), med(bs)]
  for (let p = 0; p < SIZE * SIZE; p++) {
    const a = Math.min(1, (feather[p] / 255) * 1.6)
    if (a > 0.03) {
      for (let c = 0; c < 3; c++) raw[p * 4 + c] = Math.round(raw[p * 4 + c] * (1 - a) + tone[c] * a)
    }
  }
  await sharp(raw, { raw: { width: SIZE, height: SIZE, channels: 4 } }).webp({ quality: 88 }).toFile(tex + '.tmp')
  renameSync(tex + '.tmp', tex)
  console.log('cleaned', tex.split('/').pop(), 'median rgb(' + tone.join(',') + ')')
}
