#!/usr/bin/env node
/**
 * Take the buckling out of the macro morph targets.
 *
 * MakeHuman's macro modifiers, baked out to glTF morph targets, carry a
 * high-frequency component that reads as creased, warped geometry once a
 * slider is pushed — worst over the ribs, where muscle_up alone buckles
 * the surface by ~6.7mm between neighbouring vertices. It is in the
 * targets themselves, not in how they are combined, so no amount of
 * blending in the app can hide it.
 *
 * Laplacian smoothing of the DELTAS fixes it at source: the low-frequency
 * shape change (which is the whole point of the morph) survives almost
 * untouched, while the vertex-to-vertex chatter that reads as a crease is
 * averaged away. Only macro_* targets are touched — a viseme is supposed
 * to be sharp.
 *
 *   node scripts/smooth-morphs.mjs <in.glb> <out.glb> [iterations] [lambda]
 *
 * Re-packs with meshopt on the way out, matching pack-models.sh. Bump
 * MODEL_VERSION in Scene.js afterwards or clients keep the old cache.
 */
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer'

const [, , inPath, outPath, iterArg, lamArg] = process.argv
if (!inPath || !outPath) {
  console.error('usage: smooth-morphs.mjs <in.glb> <out.glb> [iterations] [lambda]')
  process.exit(1)
}
const ITER = Number(iterArg ?? 2)
const LAMBDA = Number(lamArg ?? 0.5)

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder })

const doc = await io.read(inPath)

// Neighbours are needed in WELDED space: the export splits vertices along
// UV seams, and a seam vertex whose twin is smoothed differently would
// tear the surface open.
const weldedAdjacency = (prim) => {
  const pos = prim.getAttribute('POSITION')
  const idx = prim.getIndices()
  const n = pos.getCount()
  const key = new Map()
  const remap = new Int32Array(n)
  const v = [0, 0, 0]
  for (let i = 0; i < n; i++) {
    pos.getElement(i, v)
    const k = v.map((x) => Math.round(x * 1e5)).join(',')
    if (!key.has(k)) key.set(k, key.size)
    remap[i] = key.get(k)
  }
  const adj = Array.from({ length: key.size }, () => new Set())
  for (let i = 0; i < idx.getCount(); i += 3) {
    const t = [remap[idx.getScalar(i)], remap[idx.getScalar(i + 1)], remap[idx.getScalar(i + 2)]]
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) if (a !== b) adj[t[a]].add(t[b])
  }
  return { remap, adj, welded: key.size, count: n }
}

let smoothed = 0
for (const mesh of doc.getRoot().listMeshes()) {
  const names = mesh.getExtras()?.targetNames || []
  for (const prim of mesh.listPrimitives()) {
    const targets = prim.listTargets()
    if (!targets.length) continue
    const { remap, adj, welded, count } = weldedAdjacency(prim)

    targets.forEach((target, ti) => {
      // Visemes and expressions are meant to be sharp; only the macro
      // body morphs carry the buckling.
      if (!/^macro_/.test(names[ti] || '')) return

      for (const semantic of ['POSITION', 'NORMAL']) {
        const attr = target.getAttribute(semantic)
        if (!attr) continue
        // gather deltas into welded slots (all copies of a seam vertex
        // share a delta, so averaging them is a no-op)
        let acc = new Float32Array(welded * 3)
        const v = [0, 0, 0]
        for (let i = 0; i < count; i++) {
          attr.getElement(i, v)
          const w = remap[i]
          acc[w * 3] = v[0]; acc[w * 3 + 1] = v[1]; acc[w * 3 + 2] = v[2]
        }
        for (let it = 0; it < ITER; it++) {
          const next = new Float32Array(welded * 3)
          for (let w = 0; w < welded; w++) {
            const nb = adj[w]
            if (!nb.size) {
              next[w * 3] = acc[w * 3]; next[w * 3 + 1] = acc[w * 3 + 1]; next[w * 3 + 2] = acc[w * 3 + 2]
              continue
            }
            let mx = 0, my = 0, mz = 0
            for (const n2 of nb) { mx += acc[n2 * 3]; my += acc[n2 * 3 + 1]; mz += acc[n2 * 3 + 2] }
            const k = 1 / nb.size
            next[w * 3] = acc[w * 3] * (1 - LAMBDA) + mx * k * LAMBDA
            next[w * 3 + 1] = acc[w * 3 + 1] * (1 - LAMBDA) + my * k * LAMBDA
            next[w * 3 + 2] = acc[w * 3 + 2] * (1 - LAMBDA) + mz * k * LAMBDA
          }
          acc = next
        }
        for (let i = 0; i < count; i++) {
          const w = remap[i]
          attr.setElement(i, [acc[w * 3], acc[w * 3 + 1], acc[w * 3 + 2]])
        }
      }
      smoothed++
    })
  }
}

await io.write(outPath, doc)
console.log(`smoothed ${smoothed} macro targets (${ITER} iterations, lambda ${LAMBDA}) -> ${outPath}`)
