/**
 * The player's body-and-soul record from the heavenly onboarding: email,
 * the door they walked through (gender — which picks the GLB), and the
 * MakeHuman-style macro sliders: age, ethnicity (three blend weights,
 * like MakeHuman's african/asian/caucasian triangle), height, weight,
 * muscle, proportions. All 0..1. Separate from `identity` (username /
 * display name, which is still earned at the dressing room door).
 *
 * The GLBs are baked exports without MakeHuman's macro morph targets, so
 * the sliders shape the skeleton instead: girth and build scale bones
 * (with the head counter-scaled so it never balloons), ethnicity blends
 * skin tints and picks the model variant, and age reshapes the head,
 * weathers and wrinkles the skin (elder texture swap), and stoops the
 * spine. Baking real macro morphs via the MPFB pipeline is the future
 * upgrade path.
 */
import { Box3, TextureLoader, Vector2, sRGBEncoding } from 'three'

const KEY = 'b1ngster.profile.v2'

// Neutral defaults. Weight's neutral sits LEFT of centre on purpose: the
// authored bodies are slim, so the slider is honest about that and leaves
// most of its travel for fuller bodies — no framing where "middle" means
// slim and everything rightward reads as excess.
export const BODY_DEFAULTS = {
  age: 0.5,
  african: 0.5,
  asian: 0.5,
  indian: 0.5,
  european: 0.5,
  height: 0.5,
  weight: 0.35,
  muscle: 0.5,
  proportions: 0.5,
}

// Skin tints as multipliers over the authored skin texture, which is
// painted light — european near as-authored, asian warmed golden,
// african deepened to brown. Blended by the three ethnicity weights.
const TINTS = {
  african: [0.45, 0.32, 0.22],
  asian: [0.98, 0.87, 0.68],
  indian: [0.7, 0.5, 0.32],
  european: [1.0, 0.98, 0.96],
}

export const ETHNICITY_KEYS = ['african', 'asian', 'indian', 'european']

// Which GLB variant a blend loads: the heaviest weight wins; ties fall to
// european, which is the original (caucasian-leaning) export for the
// gender. Each variant carries its own authentic facial geometry and skin
// texture from MakeHuman.
export const dominantEthnicity = (body) => {
  // Ties break AWAY from european: for a 50/50 mixed-heritage person the
  // darker skin texture is the better base — the relative tint lifts it
  // toward the blend, which survives bright lighting far better than
  // darkening an overexposed pale texture.
  let best = 'european'
  let bestW = body.european ?? 0.5
  for (const key of ['african', 'asian', 'indian']) {
    const w = body[key] ?? 0.5
    if (w >= bestW) { best = key; bestW = w }
  }
  return best
}

// The skin tone each variant's own texture already carries — the in-app
// tint is applied RELATIVE to this, so a pure-african blend on the african
// model gets no tint at all, and mixes shade from the authentic base.
// (indian reuses the asian skin texture; its brown comes from the tint.)
const VARIANT_TONE = {
  african: TINTS.african,
  asian: TINTS.asian,
  indian: TINTS.asian,
  european: TINTS.european,
}

export const tintFor = (body) => {
  let sum = 0
  const out = [0, 0, 0]
  for (const key of ETHNICITY_KEYS) {
    const w = Math.max(0, body[key] ?? 0.5)
    sum += w
    for (let c = 0; c < 3; c++) out[c] += TINTS[key][c] * w
  }
  if (sum === 0) return TINTS.european
  return out.map((v) => v / sum)
}

// Each ethnicity anchor as a CSS colour for the slider labels: the tint
// applied to a stand-in for the authored light skin.
const SWATCH_BASE = [236, 196, 168]
export const swatchColor = (key) => {
  const [r, g, b] = TINTS[key]
  return `rgb(${Math.round(SWATCH_BASE[0] * r)}, ${Math.round(SWATCH_BASE[1] * g)}, ${Math.round(SWATCH_BASE[2] * b)})`
}

const num = (v, fallback) => (typeof v === 'number' && !Number.isNaN(v) ? v : fallback)

export const loadProfile = () => {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const p = JSON.parse(raw)
    if (!p.email || !p.gender) return null
    const body = {}
    for (const key in BODY_DEFAULTS) body[key] = num(p[key], BODY_DEFAULTS[key])
    return { email: p.email, gender: p.gender, ...body }
  } catch {
    return null
  }
}

export const saveProfile = (profile) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(profile))
  } catch {
    // private mode: the profile just lives for the session
  }
}

// The reset button's other half: forget the journey so the next visit
// (or the same one, via state) starts back at the email gate.
export const clearProfile = () => {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // nothing stored, nothing to forget
  }
}

const MODEL_BY_GENDER = {
  male: 'male.glb',
  female: 'female.glb',
  nonbinary: 'nonbinary.glb',
}
export const modelUrlFor = (gender, version, ethnicity = 'european') => {
  const base = (MODEL_BY_GENDER[gender] || 'nonbinary.glb').replace('.glb', '')
  // One unified model per gender: ethnicity is now morph geometry inside
  // the GLB, blended continuously — no per-ethnicity files. (The
  // receptionist has her own female_reception.glb with the visemes.)
  void ethnicity
  return `${process.env.PUBLIC_URL}/models/${base}.glb?v=${version}`
}

// The gender slider sweeps female → non-binary → male; the door choice
// seeds it and the slider's thirds map back to a model.
export const genderToSlider = (gender) =>
  gender === 'female' ? 0 : gender === 'male' ? 1 : 0.5
export const sliderToGender = (t) =>
  t < 1 / 3 ? 'female' : t < 2 / 3 ? 'nonbinary' : 'male'

// --- Slider curves ---------------------------------------------------------

// Height: uniform scale around the normalized base, a believable +-8%.
export const heightScale = (t) => 0.92 + Math.min(1, Math.max(0, t)) * 0.16

// Every character stands exactly this tall at the slider's midpoint. The
// gender templates and ethnicity phenotypes were authored at different
// statures — normalizing here means switching bodies never changes height;
// only the HEIGHT slider does.
const BASE_HEIGHT = 1.7

// Weight: girth on torso, hips and limbs. Neutral (as-modelled) at 0.35;
// a little travel toward slighter, most of it toward fuller — up to +30%.
export const weightScale = (t) => {
  const v = Math.min(1, Math.max(0, t))
  return v <= 0.35 ? 1 + ((v - 0.35) / 0.35) * 0.08 : 1 + ((v - 0.35) / 0.65) * 0.3
}

// Muscle: shoulders, chest and arms broaden around the same frame.
export const muscleScale = (t) => 1 + (Math.min(1, Math.max(0, t)) - 0.5) * 0.24

// Proportions: long-torso <-> leggy, as a torso-length trade. Feet stay
// planted because only the spine (above the legs) changes length.
export const torsoScale = (t) => 1 + (Math.min(1, Math.max(0, t)) - 0.5) * 0.1

// Age: youth carries a relatively bigger head.
export const headAgeScale = (t) => 1 + (0.5 - Math.min(1, Math.max(0, t))) * 0.12

// Past here (slider ~58yo) the body wears MakeHuman's wrinkled elder skin.
const OLD_AGE = 0.65
// Elders stoop: radians of forward lean at the mid-spine, by age.
export const stoopAngle = (t) => Math.max(0, Math.min(1, t) - 0.5) * 0.55

// MakeHuman's own old-skin texture mapping: african wears darkskinned,
// asian (and our south-asian) the "2" lightskinned, european the plain one.
const oldTextureUrl = (ethnicity, gender) => {
  const tone = ethnicity === 'african' ? 'darkskinned' : 'lightskinned'
  const sex = gender === 'male' ? 'male' : 'female'
  const suffix = ethnicity === 'asian' || ethnicity === 'indian' ? '2' : ''
  return `${process.env.PUBLIC_URL}/textures/age/old_${tone}_${sex}_diffuse${suffix}.webp`
}
// Young skins for the unified (v4) models: the GLB embeds the light
// caucasian skin; african/asian/indian dominance swaps in the matching
// authentic texture, and the relative tint blends from there.
const youngTextureUrl = (ethnicity, gender) => {
  const tone = ethnicity === 'african' ? 'darkskinned' : 'lightskinned'
  const sex = gender === 'male' ? 'male' : 'female'
  const suffix = ethnicity === 'asian' || ethnicity === 'indian' ? '2' : ''
  return `${process.env.PUBLIC_URL}/textures/skin/young_${tone}_${sex}_diffuse${suffix}.webp`
}
const oldTexCache = {}
const loadOldTex = (url) => {
  if (!oldTexCache[url]) {
    const t = new TextureLoader().load(url)
    t.flipY = false // glTF UV convention
    t.encoding = sRGBEncoding
    oldTexCache[url] = t
  }
  return oldTexCache[url]
}

// Micro-detail maps baked from MPFB's enhanced procedural skin (Cycles
// bake of its pore/grain bump and roughness variation, 2K, one set for
// every body — all genders share the MakeHuman UV layout). Linear data,
// not colour.
const detailCache = {}
const loadDetailTex = (name) => {
  if (!detailCache[name]) {
    const t = new TextureLoader().load(`${process.env.PUBLIC_URL}/textures/skin/${name}.webp`)
    t.flipY = false
    detailCache[name] = t
  }
  return detailCache[name]
}

// --- Applying a body to a character ---------------------------------------

// Scalp hair is hidden entirely — bald is the one look every culture
// shares, so the hero bodies stay neutral. Brows and lashes remain, or
// faces stop reading as faces. (The receptionist keeps her bob: applyBody
// only ever runs on player bodies.)
const SCALP_RE = /bob|messy|hair/i
// Clothing materials are the toigo_/cortu_ assets that are NOT hair.
const CLOTHES_RE = /toigo_|cortu_/i

// Apply the body record to a character root: tint the skin (MakeHuman
// body materials are named "<Char>.body"; the ".high-poly" mesh is the
// eyeballs — never tint those), hide the scalp hair, dress the hero in
// white, scale height on the root, and shape the skeleton bone by bone. The animation clips must
// have their (static) scale tracks stripped, or the mixer overwrites the
// bone scales every frame.
// Callers must hand this a clone with cloned materials, or the tint
// bleeds onto every other instance of the same GLB.
export const applyBody = (root, body) => {
  const b = { ...BODY_DEFAULTS, ...body }
  const tone = VARIANT_TONE[dominantEthnicity(b)]
  const [r, g, bl] = tintFor(b).map((v, c) => Math.min(1.5, v / tone[c]))
  const dominant = dominantEthnicity(b)
  root.traverse((o) => {
    if (!o.isMesh || !o.material) return
    const name = o.material.name
    if (/\.body$/.test(name)) {
      o.material.color.setRGB(r, g, bl)
      // Elders wear the wrinkled skin; the authored map is kept for the
      // way back down the slider. Unified (v4) models also swap the young
      // skin by dominant ethnicity — mixed faces come from the morphs,
      // authentic texture detail from the swap, shade from the tint.
      if (o.material.userData.youngMap === undefined) o.material.userData.youngMap = o.material.map
      const unified = !!(o.morphTargetDictionary && 'macro_african' in o.morphTargetDictionary)
      const young = unified && dominant !== 'european'
        ? loadOldTex(youngTextureUrl(dominant, b.gender))
        : o.material.userData.youngMap
      const wanted = b.age > OLD_AGE
        ? loadOldTex(oldTextureUrl(dominant, b.gender))
        : young
      if (o.material.map !== wanted) {
        o.material.map = wanted
        o.material.needsUpdate = true
      }
      // and skin weathers: rougher past the middle years
      if (o.material.userData.baseRoughness === undefined) o.material.userData.baseRoughness = o.material.roughness
      o.material.roughness = Math.min(1, o.material.userData.baseRoughness + Math.max(0, b.age - 0.5) * 0.35)
      // Modern skin: pore-level normal + roughness variation baked from
      // MPFB's enhanced skin — micro-detail at glancing light.
      if (!o.material.userData.skinDetail) {
        o.material.normalMap = loadDetailTex('skin_nor')
        o.material.normalScale = new Vector2(0.55, 0.55)
        o.material.roughnessMap = loadDetailTex('skin_rough')
        o.material.userData.skinDetail = true
        o.material.needsUpdate = true
      }
    }
    else if (SCALP_RE.test(name)) o.visible = false
    else if (CLOTHES_RE.test(name)) {
      // Hero whites: drop the patterned cloth texture and wear pure white.
      if (o.material.map) {
        o.material.map = null
        o.material.needsUpdate = true
      }
      o.material.color.setRGB(0.92, 0.92, 0.95)
      // Matte cloth: specular highlights were carving every crease into
      // the flat white.
      o.material.roughness = 0.85
      // Trousers hug the body too closely once the pattern is gone — puff
      // the geometry a few millimetres along its normals (once per
      // geometry) so the cloth stops vacuum-sealing into the crotch and
      // glute creases. Morph deltas are untouched.
      if (/pants|trousers|harem|wool/i.test(name) && !o.geometry.userData.puffed) {
        const pos = o.geometry.attributes.position
        const nor = o.geometry.attributes.normal
        if (pos && nor) {
          for (let i = 0; i < pos.count; i++) {
            pos.setXYZ(
              i,
              pos.getX(i) + nor.getX(i) * 0.006,
              pos.getY(i) + nor.getY(i) * 0.006,
              pos.getZ(i) + nor.getZ(i) * 0.006
            )
          }
          pos.needsUpdate = true
        }
        o.geometry.userData.puffed = true
      }
    }
  })

  // Measure the model once, unscaled (bind-pose geometry ignores any bone
  // scaling from earlier calls), then normalize all bodies to BASE_HEIGHT.
  if (!root.userData.baseHeight) {
    root.scale.setScalar(1)
    root.updateMatrixWorld(true)
    const box = new Box3().setFromObject(root)
    root.userData.baseHeight = Math.max(0.1, box.max.y - box.min.y)
  }
  root.scale.setScalar((BASE_HEIGHT / root.userData.baseHeight) * heightScale(b.height))

  // MakeHuman's own macro morphs: the v3 models carry six directional
  // targets baked from the canonical 0.5 midpoints out to MakeHuman's own
  // 0.0 and 1.0 extremes, so each slider maps 1:1 onto MakeHuman's value
  // — real muscle contours, true proportion shifts, and the skeleton is
  // never scaled. (Legacy single-direction morphs stay supported until
  // every model is rebuilt.)
  // Ethnicity as geometry: the unified models blend three facial morphs
  // continuously — a half-Black half-white person gets a genuinely mixed
  // face, not a coin-flip between two models. The South Asian slider
  // folds into MakeHuman's triangle per its blend recipe.
  const eAf = Math.max(0, b.african) + 0.15 * Math.max(0, b.indian)
  const eAs = Math.max(0, b.asian) + 0.5 * Math.max(0, b.indian)
  const eCa = Math.max(0, b.european) + 0.35 * Math.max(0, b.indian)
  const eSum = eAf + eAs + eCa || 1
  const influences = {
    macro_african: eAf / eSum,
    macro_asian: eAs / eSum,
    macro_caucasian: eCa / eSum,
    macro_weight_up: Math.max(0, (b.weight - 0.5) * 2),
    macro_weight_down: Math.max(0, (0.5 - b.weight) * 2),
    macro_muscle_up: Math.max(0, (b.muscle - 0.5) * 2),
    macro_muscle_down: Math.max(0, (0.5 - b.muscle) * 2),
    macro_proportions_up: Math.max(0, (b.proportions - 0.5) * 2),
    macro_proportions_down: Math.max(0, (0.5 - b.proportions) * 2),
    macro_weight: Math.max(0, ((b.weight - 0.35) / 0.65) * 1.8),
    macro_muscle: Math.max(0, (b.muscle - 0.5) * 3),
  }
  let hasMorphs = false
  root.traverse((o) => {
    if (!o.isMesh || !o.morphTargetDictionary) return
    for (const name in influences) {
      const idx = o.morphTargetDictionary[name]
      if (idx !== undefined) {
        o.morphTargetInfluences[idx] = influences[name]
        hasMorphs = true
      }
    }
  })

  // The elder stoop, set absolutely so slider drags never accumulate. In
  // the lobby the animation mixer overwrites these every frame — Character
  // re-applies the lean post-mixer there.
  const stoop = stoopAngle(b.age)
  for (const [bone, k] of [['spine02', 1], ['neck02', -0.55]]) {
    const node = root.getObjectByName(bone)
    if (!node) continue
    if (!node.userData.restQuat) node.userData.restQuat = node.quaternion.clone()
    node.quaternion.copy(node.userData.restQuat)
    node.rotateX(stoop * k)
  }

  const w = hasMorphs ? 1 : weightScale(b.weight) // torso/hip/limb girth
  const m = hasMorphs ? 1 : muscleScale(b.muscle) // shoulder/chest/arm build
  const sp = hasMorphs ? 1 : torsoScale(b.proportions) // torso length (morphs own it)
  const ha = headAgeScale(b.age)
  const chest = 1 + (m - 1) * 0.6 // chest carries some of the muscle
  const neck = 1 + (w * chest - 1) * 0.4 // neck thickens a little, not fully

  const set = (name, x, y, z) => {
    const bone = root.getObjectByName(name)
    if (bone) bone.scale.set(x, y, z)
  }
  const setLR = (name, x, y, z) => {
    set(`${name}.L`, x, y, z)
    set(`${name}.R`, x, y, z)
  }

  // Weight and build, bone by bone — axis-aware. Each bone's length axis
  // is discovered from where its child attaches (exported bone axes are
  // not consistent), and girth touches only the two cross axes: scaling
  // the wrong axis was lengthening arms and adding height. Counters are
  // uniform or cross-axis-only, never mixed — mixed non-uniform scale on
  // rotated children shears geometry (the broken faces).
  const boneScale = (name, girthF, lengthF = 1) => {
    const node = root.getObjectByName(name)
    if (!node) return
    const child = node.children.find((c) => c.isBone) || node.children[0]
    let lengthAxis = 1
    if (child) {
      const a = [Math.abs(child.position.x), Math.abs(child.position.y), Math.abs(child.position.z)]
      lengthAxis = a.indexOf(Math.max(...a))
    }
    const sc = [girthF, girthF, girthF]
    sc[lengthAxis] = lengthF
    node.scale.set(sc[0], sc[1], sc[2])
  }
  const boneScaleLR = (name, girthF, lengthF = 1) => {
    boneScale(`${name}.L`, girthF, lengthF)
    boneScale(`${name}.R`, girthF, lengthF)
  }

  // Torso: base girth from the hips up, an extra paunch at the belly that
  // is countered one bone above so it never reaches chest, arms or head.
  const belly = 1 + (w - 1) * 0.6
  boneScale('spine05', w, sp)
  boneScale('spine04', belly)
  boneScale('spine03', 1 / belly)
  boneScale('spine02', chest)
  // Arms: neutralise the inherited torso girth at the clavicle (the
  // shoulder POSITIONS stay wide — that offset already happened), then
  // give the arms their own thickness from muscle and weight.
  boneScaleLR('clavicle', 1 / (w * chest))
  boneScaleLR('upperarm01', m * (1 + (w - 1) * 0.45))
  // Hips and legs: wide hips, heavy thighs, tapering calves.
  boneScaleLR('pelvis', w)
  boneScaleLR('upperleg01', 1 + (w - 1) * 0.6)
  boneScaleLR('lowerleg01', 1 / (1 + (w - 1) * 0.55))
  // The neck cancels the torso scale EXACTLY: any residual non-uniform
  // scale near the head makes face vertices (blended across neck+head
  // bones) drift against the rigidly-boned tongue and teeth — that was
  // the tongue-through-chin artifact. Identity above the shoulders.
  boneScale('neck01', 1 / (w * chest), 1 / sp)
  const headBone = root.getObjectByName('head')
  if (headBone) headBone.scale.setScalar(ha)
}
