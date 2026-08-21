#!/usr/bin/env node
/**
 * Measure the bodies the way a tape measure would, and write the table the
 * app uses to turn centimetres back into slider values.
 *
 * The GLBs carry only MakeHuman's MACRO morphs — there are no measure
 * targets baked in — so the app cannot drive a waist directly. What it CAN
 * do is know what every control is worth in centimetres and solve for it.
 * This script measures each body at its neutral pose, then re-measures with
 * each macro morph pushed to full, giving a per-centimetre sensitivity for
 * every control. The app interpolates that table.
 *
 * Circumferences are taken as the CONVEX HULL perimeter of a horizontal
 * cross-section, because that is what a tape does — it bridges the hollow
 * of a waist rather than sinking into it.
 *
 *   node scripts/measure-bodies.mjs > src/measurements.json
 */
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { MeshoptDecoder } from 'meshoptimizer'

const BASE_HEIGHT = 1.7 // metres at the height slider's midpoint (see profile.js)
const DENSITY = 1010 // kg/m^3, near enough for a human body

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder })

// Everything from the shoulder joint outwards. A tape around a chest
// passes UNDER the arms; a horizontal slice does not know that and cuts
// straight through them, so the arms have to be taken out of the torso
// measurements or a chest reads 160cm. Found from the skin weights, not
// from position, so it follows the body however it is shaped.
const ARM_BONE = /upperarm|lowerarm|wrist|finger|thumb|palm|metacarp/i

const loadBody = async (path) => {
  const doc = await io.read(path)
  const mesh = doc.getRoot().listMeshes().find((m) => m.getName() === 'base')
  const prim = mesh.listPrimitives()[0]
  const skin = doc.getRoot().listSkins()[0]
  const jointNames = skin ? skin.listJoints().map((j) => j.getName()) : []
  const names = prim.getExtras()?.targetNames || mesh.getExtras()?.targetNames || []
  const pos = prim.getAttribute('POSITION')
  const idx = prim.getIndices()
  const n = pos.getCount()
  const base = new Float32Array(n * 3)
  const v = [0, 0, 0]
  for (let i = 0; i < n; i++) { pos.getElement(i, v); base[i * 3] = v[0]; base[i * 3 + 1] = v[1]; base[i * 3 + 2] = v[2] }
  const targets = prim.listTargets().map((t) => {
    const a = t.getAttribute('POSITION')
    const d = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) { a.getElement(i, v); d[i * 3] = v[0]; d[i * 3 + 1] = v[1]; d[i * 3 + 2] = v[2] }
    return d
  })
  const tris = new Uint32Array(idx.getCount())
  for (let i = 0; i < idx.getCount(); i++) tris[i] = idx.getScalar(i)

  // A vertex belongs to the arm if its heaviest bone is an arm bone.
  const jAttr = prim.getAttribute('JOINTS_0')
  const wAttr = prim.getAttribute('WEIGHTS_0')
  const isArm = new Uint8Array(n)
  if (jAttr && wAttr && jointNames.length) {
    const jv = [0, 0, 0, 0], wv = [0, 0, 0, 0]
    for (let i = 0; i < n; i++) {
      jAttr.getElement(i, jv); wAttr.getElement(i, wv)
      let bestW = -1, bestJ = -1
      for (let k = 0; k < 4; k++) if (wv[k] > bestW) { bestW = wv[k]; bestJ = jv[k] }
      if (bestJ >= 0 && ARM_BONE.test(jointNames[bestJ] || '')) isArm[i] = 1
    }
  }
  // Torso-only triangles, for the circumferences.
  const torsoTris = []
  for (let i = 0; i < tris.length; i += 3) {
    if (isArm[tris[i]] || isArm[tris[i + 1]] || isArm[tris[i + 2]]) continue
    torsoTris.push(tris[i], tris[i + 1], tris[i + 2])
  }
  return { names, base, targets, tris, torsoTris: new Uint32Array(torsoTris), isArm, n }
}

const morphed = (body, influences) => {
  const { base, targets, names, n } = body
  const out = new Float32Array(base)
  names.forEach((nm, t) => {
    const w = influences[nm]
    if (!w) return
    const d = targets[t]
    for (let i = 0; i < n * 3; i++) out[i] += d[i] * w
  })
  return out
}

// Convex hull perimeter of the points a horizontal plane cuts out of the
// mesh — a tape measure, not a shrink-wrap.
const hullPerimeter = (pts) => {
  if (pts.length < 3) return 0
  pts = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const half = (src) => {
    const h = []
    for (const p of src) {
      while (h.length >= 2 && cross(h[h.length - 2], h[h.length - 1], p) <= 0) h.pop()
      h.push(p)
    }
    return h
  }
  const hull = half(pts).slice(0, -1).concat(half(pts.slice().reverse()).slice(0, -1))
  let per = 0
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length]
    per += Math.hypot(a[0] - b[0], a[1] - b[1])
  }
  return per
}

// Every point where the mesh crosses the plane y = h, in the XZ plane.
const sliceAt = (P, tris, h) => {
  const pts = []
  for (let i = 0; i < tris.length; i += 3) {
    const a = tris[i], b = tris[i + 1], c = tris[i + 2]
    const e = [[a, b], [b, c], [c, a]]
    for (const [p, q] of e) {
      const y0 = P[p * 3 + 1], y1 = P[q * 3 + 1]
      if ((y0 - h) * (y1 - h) >= 0) continue
      const t = (h - y0) / (y1 - y0)
      pts.push([
        P[p * 3] + (P[q * 3] - P[p * 3]) * t,
        P[p * 3 + 2] + (P[q * 3 + 2] - P[p * 3 + 2]) * t,
      ])
    }
  }
  return pts
}

// Signed-tetrahedron volume. The bare bodies are watertight (verified: 0
// open boundary edges), so this is exact rather than an estimate.
const volumeOf = (P, tris) => {
  let vol = 0
  for (let i = 0; i < tris.length; i += 3) {
    const a = tris[i] * 3, b = tris[i + 1] * 3, c = tris[i + 2] * 3
    vol += (
      P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1]) -
      P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c]) +
      P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c])
    ) / 6
  }
  return Math.abs(vol)
}

const measure = (body, influences) => {
  const P = morphed(body, influences)
  const { tris, torsoTris, isArm, n } = body
  let lo = Infinity, hi = -Infinity
  for (let i = 0; i < n; i++) { const y = P[i * 3 + 1]; if (y < lo) lo = y; if (y > hi) hi = y }
  const span = hi - lo
  // model units -> metres, normalised so the midpoint body stands BASE_HEIGHT
  const S = BASE_HEIGHT / span
  const at = (f) => lo + span * f
  const circAt = (f) => hullPerimeter(sliceAt(P, torsoTris, at(f))) * S

  // Landmarks found from the geometry, not guessed: the chest is the
  // widest place on the upper torso, the waist the narrowest below it,
  // the hips the widest below that.
  const scan = (a, b, pick) => {
    let best = null, bestF = a
    for (let f = a; f <= b; f += 0.005) {
      const c = circAt(f)
      if (c <= 0) continue
      if (best === null || pick(c, best)) { best = c; bestF = f }
    }
    return { value: best || 0, at: bestF }
  }
  const chest = scan(0.70, 0.82, (c, b) => c > b)
  const waist = scan(0.62, chest.at - 0.01, (c, b) => c < b)
  const hips = scan(0.48, waist.at - 0.01, (c, b) => c > b)

  // Shoulder width: the widest the body gets across the deltoids.
  let shoulder = 0
  for (let i = 0; i < n; i++) {
    const f = (P[i * 3 + 1] - lo) / span
    if (f < 0.80 || f > 0.87) continue
    const x = Math.abs(P[i * 3])
    if (x > shoulder) shoulder = x
  }
  shoulder *= 2 * S

  // Inseam: the crotch is the lowest geometry on the mid-sagittal plane —
  // below it the legs have parted and there is nothing at x = 0.
  let crotch = Infinity
  for (let i = 0; i < n; i++) {
    if (isArm[i] || Math.abs(P[i * 3]) > 0.015) continue
    const y = P[i * 3 + 1]
    if (y > lo + span * 0.30 && y < crotch) crotch = y
  }
  const inseam = (crotch - lo) * S

  return {
    height: span * S,
    chest: chest.value,
    waist: waist.value,
    hips: hips.value,
    shoulder,
    inseam,
    // volume scales with the cube of the linear scale
    mass: volumeOf(P, tris) * S * S * S * DENSITY,
  }
}

const MODELS = ['male_bare', 'female_bare', 'nonbinary_bare']
// The controls the app can actually move, and the morph each one drives.
const CONTROLS = [
  ['weightUp', { macro_weight_up: 1 }],
  ['weightDown', { macro_weight_down: 1 }],
  ['muscleUp', { macro_muscle_up: 1 }],
  ['muscleDown', { macro_muscle_down: 1 }],
  ['proportionsUp', { macro_proportions_up: 1 }],
  ['proportionsDown', { macro_proportions_down: 1 }],
]
const NEUTRAL = { macro_african: 1 / 3, macro_asian: 1 / 3, macro_caucasian: 1 / 3 }

const out = { note: 'generated by scripts/measure-bodies.mjs — centimetres, on a 1.7m body', bodies: {} }
for (const m of MODELS) {
  const body = await loadBody(`public/models/${m}.glb`)
  const neutral = measure(body, NEUTRAL)
  const entry = { neutral: {}, delta: {} }
  for (const k in neutral) entry.neutral[k] = +(neutral[k] * (k === 'mass' ? 1 : 100)).toFixed(2)
  for (const [name, inf] of CONTROLS) {
    const got = measure(body, { ...NEUTRAL, ...inf })
    entry.delta[name] = {}
    for (const k in got) {
      entry.delta[name][k] = +((got[k] - neutral[k]) * (k === 'mass' ? 1 : 100)).toFixed(2)
    }
  }
  out.bodies[m.replace('_bare', '')] = entry
}
console.log(JSON.stringify(out, null, 2))
