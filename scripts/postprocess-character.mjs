/* Post-process a raw MPFB character export for the web:
 * - alphaMode: MASK for lash/brow/hair/eye-overlay materials, OPAQUE for
 *   the rest (MAKESKIN exports everything as BLEND, which breaks three.js
 *   depth sorting on hair)
 * - textures: skin diffuse capped at 2048, everything else at 1024, all
 *   webp q90 (hair ships at 3600x3600 and dominates the file otherwise)
 * usage: node postprocess.mjs in.glb out.glb
 */
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { textureCompress } from '@gltf-transform/functions'
import sharp from 'sharp'

const [inPath, outPath] = process.argv.slice(2)
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
const doc = await io.read(inPath)

const MASK_RE = /eyebrow|eyelashes|high-poly|bob|messy|hair/i
for (const mat of doc.getRoot().listMaterials()) {
  if (MASK_RE.test(mat.getName())) {
    mat.setAlphaMode('MASK')
    mat.setAlphaCutoff(0.5)
  } else {
    mat.setAlphaMode('OPAQUE')
  }
}

// skin diffuse keeps 2K; everything else drops to 1K
await doc.transform(
  textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 90, resize: [2048, 2048], pattern: /young_|diffuse/i }),
  textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 90, resize: [1024, 1024] }),
)

await io.write(outPath, doc)
console.log('postprocessed:', outPath)
