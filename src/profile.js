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
import { Box3, CanvasTexture, TextureLoader, Vector2, Vector3, sRGBEncoding } from 'three'

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
  breastSize: 0.5,
  breastFirmness: 0.5,
  // --- Skeleton: the frame everything else hangs on --------------------
  // Separated from muscle and fat on purpose: a broad-shouldered, narrow
  // -hipped body and a narrow-shouldered, broad-hipped one are different
  // SKELETONS, not different weights, and collapsing them into one
  // "build" slider is what makes character creators produce one body.
  frame: 0.5,
  shoulderWidth: 0.5,
  hipWidth: 0.5,

  // --- Muscle: how much, and where it is carried -----------------------
  muscleUpper: 0.5, // 0 = the legs carry it, 1 = shoulders, chest and arms

  // --- Fat: how much (weight, above), and where it settles -------------
  // The same weight can be an apple or a pear. These decide which.
  fatBelly: 0.5,
  fatHips: 0.5,
  fatLimbs: 0.5,

  // --- Hair ------------------------------------------------------------
  hairGrey: 0,
  hairThin: 0,

  // Clothing. Numbers rather than booleans because loadProfile coerces
  // every stored field through num(): 1 is worn, 0 is not. Hair stays off
  // by default — the hero bodies are deliberately bald (see SCALP_RE);
  // this is just the switch that lifts it.
  wearOutfit: 1,
  wearHair: 0,
  clothColor: 0,
  // MakeHuman's armslegs micro modifiers, all neutral at the midpoint
  handSize: 0.5,
  footSize: 0.5,
  upperArmLength: 0.5,
  forearmLength: 0.5,
  thighLength: 0.5,
  shinLength: 0.5,
}

// Skin tints as multipliers over the authored skin texture, which is
// painted light — european near as-authored, asian warmed golden,
// african deepened to brown. Blended by the three ethnicity weights.
const TINTS = {
  african: [0.32, 0.22, 0.15],
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
// Decoupled from TINTS: these describe what the TEXTURES inherently
// carry, so the targets above can sit darker than the texture and the
// ratio actually deepens the skin (a 1:1 ratio was leaving Black skin
// too light under the bright sky).
const VARIANT_TONE = {
  african: [0.45, 0.32, 0.22],
  asian: [0.98, 0.87, 0.68],
  indian: [0.98, 0.87, 0.68],
  european: [1.0, 0.98, 0.96],
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

// --- The wardrobe ----------------------------------------------------------
// Each body owns exactly one outfit, baked into its clothed export.
//
// It is all-or-nothing on purpose, and the reason is in the geometry:
// MakeHuman deletes the body faces its garments cover, so the clothed
// export's body is NOT watertight. Measured on the actual exports (open
// boundary edges on the body mesh): male 40, all at the soles under the
// boots; female 188, reaching the torso under the shift dress; nonbinary
// 318, reaching the waist. The bare exports are watertight — 0 each.
// Removing one garment would therefore tear a hole in the body under it,
// so the switch is the whole outfit, and undressing loads the bare body.
// Per-garment control needs the clothed models re-exported without
// MakeHuman's delete-groups.
export const OUTFITS = {
  male: 'SWEATER, WOOL PANTS & BOOTS',
  female: 'SHIFT DRESS & BALLET FLATS',
  nonbinary: 'T-SHIRT, HAREM PANTS & SHOES',
}

export const HAIR_LABEL = {
  male: 'MESSY CROP',
  female: 'BLUNT BOB',
  nonbinary: 'INVERTED BOB',
}

// The cloth palette. The garments' woven textures are dropped for a flat
// hero colour (as they always have been), so this is what actually shows.
export const CLOTH_COLORS = [
  { name: 'WHITE', hex: '#eceff5' },
  { name: 'SAND', hex: '#dccaa6' },
  { name: 'CLAY', hex: '#b8735a' },
  { name: 'MOSS', hex: '#6f8b5f' },
  { name: 'SLATE', hex: '#5b6b80' },
  { name: 'INK', hex: '#39404f' },
]
export const clothRGB = (index) => {
  const { hex } = CLOTH_COLORS[Math.round(index)] || CLOTH_COLORS[0]
  const n = parseInt(hex.slice(1), 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

// Which GLB to load. The outfit alone decides it: the clothed export
// carries the garments AND the hair, the bare one carries the extra
// body-detail morphs and a watertight body. Hair cannot outlive the
// outfit — it lives only in the clothed export, and that export's body
// is cut away under its garments, so showing it with the clothes hidden
// would put the holes on display.
export const isDressed = (body) => {
  const b = { ...BODY_DEFAULTS, ...body }
  return b.wearOutfit > 0.5
}

const MODEL_BY_GENDER = {
  male: 'male.glb',
  female: 'female.glb',
  nonbinary: 'nonbinary.glb',
}
export const modelUrlFor = (gender, version, ethnicity = 'european', bare = false) => {
  let base = (MODEL_BY_GENDER[gender] || 'nonbinary.glb').replace('.glb', '')
  // The modelling mirror works on the anatomical nude body, MakeHuman
  // style; the lobby wears real geometry clothing.
  if (bare) base += '_bare' 
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

// --- MakeHuman micro modifiers (the "armslegs" group) ----------------------
// MakeHuman runs these as decr|incr pairs either side of a neutral
// midpoint; one 0..1 slider covers both halves. The ranges mirror
// MakeHuman's own: limb segments +-12%, hands and feet +-15%.
const clamp01 = (t) => Math.min(1, Math.max(0, t))
export const limbLengthScale = (t) => 1 + (clamp01(t) - 0.5) * 0.24
export const extremityScale = (t) => 1 + (clamp01(t) - 0.5) * 0.3

// Which bones each slider drives, mapped onto the export's chains
// (shoulder01 > upperarm01 > upperarm02 > lowerarm01 > lowerarm02 > wrist,
// and upperleg01 > upperleg02 > lowerleg01 > lowerleg02 > foot). Every
// bone offsets along its own local +Y, so a segment's length is the sum
// of the two joints hanging below it.
//
// Lengths MOVE the joints rather than scaling the bone. Scaling a bone's
// length axis shears every rotated child — the same trap the girth code
// documents above — whereas translating the child joint stretches the
// skin between the two cleanly and carries everything below it rigidly.
export const LIMB_SEGMENTS = {
  upperArmLength: ['upperarm02', 'lowerarm01'],
  forearmLength: ['lowerarm02', 'wrist'],
  thighLength: ['upperleg02', 'lowerleg01'],
  shinLength: ['lowerleg02', 'foot'],
}
// Hands and feet take a UNIFORM scale, which no rotation can shear, so
// the fingers and toes below them come along for free.
export const EXTREMITY_BONES = { handSize: 'wrist', footSize: 'foot' }

// The bones whose .position the micro sliders own. The clips key every
// bone's translation with its static rest offset, so the mixer would
// overwrite these every frame — Character strips exactly these tracks.
// Deliberately NOT root or pelvis: those are the only bones a clip could
// legitimately translate (root motion), and a walk cycle never stretches
// a limb, so every track named here is provably static.
export const MICRO_LENGTH_BONES = new Set(
  Object.values(LIMB_SEGMENTS).flat().flatMap((b) => [`${b}.L`, `${b}.R`])
)

// --- Age, as a driver across every system ----------------------------------
// Age is not a shape of its own; it is a set of leans on the other
// systems, which is how a body actually ages. One slider therefore moves
// skin, fat, muscle, posture, facial proportion and hair together.
//
// (Facial proportion is the weak one: the exports carry no age morph, so
// the head is merely rescaled. Real aged features need a re-export.)
export const ageEffects = (t) => {
  const a = clamp01(t)
  const old = Math.max(0, a - 0.5) * 2 // 0 at mid-life, 1 at the far end
  const young = Math.max(0, 0.5 - a) * 2
  return {
    muscleLoss: old * 0.35, // sarcopenia: mass goes first
    fatToBelly: old * 0.45, // and fat migrates to the trunk...
    fatFromLimbs: old * 0.35, // ...leaving the limbs
    stoop: old * 0.55, // the spine gives
    headScale: 1 + young * 0.07, // children are relatively big-headed
    skin: old, // roughening and the elder texture swap
    grey: old, // hair loses pigment...
    thin: old * 0.8, // ...and density
  }
}

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
    const entry = { tex: null }
    const t = new TextureLoader().load(url, () => {
      entry.tex = t
      // let mounted characters re-apply now the map is usable
      window.dispatchEvent(new Event('skin-tex-loaded'))
    })
    t.flipY = false // glTF UV convention
    t.encoding = sRGBEncoding
    oldTexCache[url] = entry
  }
  // null until the image has streamed — callers keep their current map,
  // because three renders a not-yet-loaded texture as solid black
  return oldTexCache[url].tex
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

// --- Composited skin: swimwear painted over tinted skin --------------------
// The suit must stay white on every skin tone, so tinting happens in
// TEXTURE space: base skin x tint on a canvas, then the swimwear regions
// (UV masks rasterized from the body geometry) painted white on top.
const imageCache = {}
const loadImage = (url) => {
  if (!imageCache[url]) {
    imageCache[url] = new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = reject
      img.src = url
    })
  }
  return imageCache[url]
}

// luminance mask -> alpha canvas, once per mask
const alphaMaskCache = {}
const alphaMask = (img, key) => {
  if (!alphaMaskCache[key]) {
    const c = document.createElement('canvas')
    c.width = c.height = 1024
    const ctx = c.getContext('2d')
    ctx.drawImage(img, 0, 0, 1024, 1024)
    const d = ctx.getImageData(0, 0, 1024, 1024)
    for (let i = 0; i < d.data.length; i += 4) d.data[i + 3] = d.data[i]
    ctx.putImageData(d, 0, 0)
    alphaMaskCache[key] = c
  }
  return alphaMaskCache[key]
}

const SUIT_URL = (m) => `${process.env.PUBLIC_URL}/textures/skin/${m}.webp`
const compositedCache = {}
const compositeSkin = (baseUrl, tint, gender, onReady) => {
  const key = `${baseUrl}|${tint.map((v) => v.toFixed(2)).join(',')}|${gender}`
  if (compositedCache[key]) {
    onReady(compositedCache[key], key)
    return key
  }
  const wantTop = gender !== 'male'
  Promise.all([
    loadImage(baseUrl),
    loadImage(SUIT_URL('suit_briefs')),
    wantTop ? loadImage(SUIT_URL('suit_top')) : Promise.resolve(null),
  ]).then(([base, briefs, top]) => {
    if (compositedCache[key]) {
      onReady(compositedCache[key], key)
      return
    }
    const c = document.createElement('canvas')
    c.width = c.height = 1024
    const ctx = c.getContext('2d')
    ctx.drawImage(base, 0, 0, 1024, 1024)
    ctx.globalCompositeOperation = 'multiply'
    ctx.fillStyle = `rgb(${Math.round(tint[0] * 255)}, ${Math.round(tint[1] * 255)}, ${Math.round(tint[2] * 255)})`
    ctx.fillRect(0, 0, 1024, 1024)
    ctx.globalCompositeOperation = 'source-over'
    // No painted clothing: the skin is real printed skin; clothing is
    // real geometry worn over it. (briefs/top masks retired.)
    void briefs; void top
    const tex = new CanvasTexture(c)
    tex.flipY = false
    tex.encoding = sRGBEncoding
    compositedCache[key] = tex
    onReady(tex, key)
  }).catch(() => {})
  return key
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
      const unified = !!(o.morphTargetDictionary && 'macro_african' in o.morphTargetDictionary)
      if (unified) {
        // Composited skin: tint baked into the texture, swimwear painted
        // white over it. Material colour stays neutral so the suit never
        // browns on dark skin. Assigned only when the canvas is ready.
        o.material.color.setRGB(1, 1, 1)
        const baseUrl = b.age > OLD_AGE
          ? oldTextureUrl(dominant, b.gender)
          : youngTextureUrl(dominant, b.gender)
        const mat = o.material
        mat.userData.wantKey = compositeSkin(baseUrl, [r, g, bl], b.gender, (tex, key) => {
          if (mat.userData.wantKey === key && mat.map !== tex) {
            mat.map = tex
            mat.needsUpdate = true
          }
        })
      } else {
        o.material.color.setRGB(r, g, bl)
      }
      // Matte skin: the baked roughness map modulates BELOW this
      // multiplier, and the environment reflection is cut hard — real
      // skin is not glossy. Age still weathers it further.
      o.material.roughness = Math.min(1, 0.96 + Math.max(0, b.age - 0.5) * 0.1)
      o.material.envMapIntensity = 0.45
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
    else if (SCALP_RE.test(name)) {
      o.visible = b.wearOutfit > 0.5 && b.wearHair > 0.5
      // Greying and thinning, from the sliders and from age on top. Grey
      // lifts the hair toward ash rather than washing it white; thinning
      // fades it out, which reads better on a card-based hair mesh than
      // shrinking it would.
      const a = ageEffects(b.age)
      const grey = Math.min(1, clamp01(b.hairGrey) + a.grey)
      const thin = Math.min(0.85, clamp01(b.hairThin) + a.thin)
      o.material.color.setRGB(
        0.22 + grey * 0.58,
        0.20 + grey * 0.57,
        0.18 + grey * 0.56
      )
      if (thin > 0.01) {
        o.material.transparent = true
        o.material.opacity = 1 - thin
      }
      o.material.needsUpdate = true
    }
    else if (CLOTHES_RE.test(name)) {
      // The outfit goes on or comes off as one — see OUTFITS for why
      // single garments cannot be removed without holing the body.
      o.visible = b.wearOutfit > 0.5
      // Hero cloth: drop the woven texture and take a flat chosen colour.
      if (o.material.map) {
        o.material.map = null
        o.material.needsUpdate = true
      }
      const [cr, cg, cb] = clothRGB(b.clothColor)
      o.material.color.setRGB(cr, cg, cb)
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
    root.position.y = 0
    root.updateMatrixWorld(true)
    const box = new Box3().setFromObject(root)
    root.userData.baseHeight = Math.max(0.1, box.max.y - box.min.y)
    // How high the ankle rides above the floor, unscaled. A bigger foot
    // scales about the ankle joint, so this is how far its sole drops.
    const ankle = root.getObjectByName('foot.L')
    root.userData.restAnkleY = ankle ? ankle.getWorldPosition(new Vector3()).y : 0.08
  }
  const rootScale = (BASE_HEIGHT / root.userData.baseHeight) * heightScale(b.height)
  root.scale.setScalar(rootScale)

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
  // MakeHuman's macro modifiers are baked out as independent morph
  // targets, so they simply sum. That stacking is intentional here — a
  // heavy AND muscular body should read as both. What it must NOT do is
  // crease, and the buckling that used to show over the ribs lived in the
  // targets themselves (muscle_up alone rippled the surface ~6.7mm
  // vertex-to-vertex). That is fixed at source now, by Laplacian-smoothing
  // the macro deltas in the export — see scripts/smooth-morphs.mjs — so
  // the sliders keep their full authored strength here.
  const influences = {
    // Ethnicity is normalised to sum to 1 already and describes a whole
    // phenotype rather than a deformation on top of one — left undamped.
    macro_african: eAf / eSum,
    macro_asian: eAs / eSum,
    macro_caucasian: eCa / eSum,
    macro_weight_up: Math.max(0, (b.weight - 0.5) * 2),
    macro_weight_down: Math.max(0, (0.5 - b.weight) * 2),
    // Sarcopenia: age takes mass off the morph itself, so an old strong
    // body still reads as older than a young one at the same slider.
    macro_muscle_up: Math.max(0, (b.muscle - 0.5) * 2) * (1 - ageEffects(b.age).muscleLoss),
    macro_muscle_down: Math.max(
      0,
      (0.5 - b.muscle) * 2 + ageEffects(b.age).muscleLoss * 0.5
    ),
    macro_proportions_up: Math.max(0, (b.proportions - 0.5) * 2),
    macro_proportions_down: Math.max(0, (0.5 - b.proportions) * 2),
    macro_breastsize_up: Math.max(0, (b.breastSize - 0.5) * 2),
    macro_breastsize_down: Math.max(0, (0.5 - b.breastSize) * 2),
    macro_breastfirm_up: Math.max(0, (b.breastFirmness - 0.5) * 2),
    macro_breastfirm_down: Math.max(0, (0.5 - b.breastFirmness) * 2),
    macro_weight: Math.max(0, ((b.weight - 0.35) / 0.65) * 1.8),
    macro_muscle: Math.max(0, (b.muscle - 0.5) * 3),
  }
  root.traverse((o) => {
    if (!o.isMesh || !o.morphTargetDictionary) return
    for (const name in influences) {
      const idx = o.morphTargetDictionary[name]
      if (idx !== undefined) o.morphTargetInfluences[idx] = influences[name]
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

  // --- The layered body --------------------------------------------------
  // The morphs above set how much muscle and fat there IS. The skeleton
  // below decides where it SITS, and how broad the frame under it is.
  // Keeping those separate is the whole point: two bodies of identical
  // weight can be an apple or a pear, and two of identical muscle can be
  // a swimmer or a cyclist. One "build" slider cannot say that.
  //
  // Every scale here is girth-only on an axis-aware helper, and every
  // width is a joint TRANSLATION, never a length scale — non-uniform
  // scale on a rotated child shears the mesh (see the note above).
  const age = ageEffects(b.age)
  const bias = (t) => (clamp01(t) - 0.5) * 2 // -1 .. +1 around neutral

  // How much fat there is to place. Neutral weight sits at 0.35, so this
  // is the travel above it — with a floor, or the distribution sliders
  // would do nothing at all on a slim body.
  const fatAmount = 0.45 + Math.max(0, (b.weight - 0.35) / 0.65) * 0.55
  // ...and how much muscle, less whatever age has taken.
  const muscleAmount = Math.max(0, (b.muscle - 0.5) * 2) * (1 - age.muscleLoss)

  // FAT distribution. Age leans it toward the trunk and out of the limbs.
  const belly = 1 + (bias(b.fatBelly) * 0.20 + age.fatToBelly * 0.16) * fatAmount
  const seat = 1 + (bias(b.fatHips) * 0.20) * fatAmount
  const limbFat = 1 + (bias(b.fatLimbs) * 0.14 - age.fatFromLimbs * 0.12) * fatAmount

  // MUSCLE distribution: the same mass thrown upward or downward.
  const upper = 1 + muscleAmount * (0.5 + 0.5 * bias(b.muscleUpper)) * 0.16
  const lower = 1 + muscleAmount * (0.5 - 0.5 * bias(b.muscleUpper)) * 0.16

  // SKELETON: the frame itself — ribcage depth and limb bone thickness,
  // independent of anything living on top of it.
  const frame = 1 + bias(b.frame) * 0.10

  // Torso. The belly is countered one bone above so a paunch never
  // travels up into the chest, arms or head.
  // spine05 is the ROOT of the torso, so whatever it carries travels all
  // the way up to the shoulders. Only the skeleton belongs there — seat
  // fat lives on the pelvis, or widening someone's hips would narrow
  // their shoulders. The belly is countered one bone above, so a paunch
  // never reaches the chest, arms or head either.
  boneScale('spine05', frame)
  boneScale('spine04', belly)
  boneScale('spine03', 1 / belly)
  boneScale('spine02', upper * frame)
  // Arms: cancel the inherited torso girth at the clavicle (the shoulder
  // POSITIONS are set separately, below), then give the arms their own
  // thickness from muscle and fat.
  boneScaleLR('clavicle', 1 / (upper * frame))
  boneScaleLR('upperarm01', upper * limbFat)
  boneScaleLR('lowerarm01', 1 + (limbFat - 1) * 0.5)
  // Hips and legs.
  boneScaleLR('pelvis', seat)
  boneScaleLR('upperleg01', lower * limbFat * (1 + (seat - 1) * 0.5))
  boneScaleLR('lowerleg01', lower / (1 + (limbFat - 1) * 0.4))

  // Frame WIDTH, as joint offsets: shoulder01 rides out along the
  // clavicle, upperleg01 out along the pelvis. Translating the joint
  // widens the skeleton without scaling — and therefore without shearing
  // — anything hanging off it.
  const widen = (bone, factor) => {
    for (const side of ['.L', '.R']) {
      const node = root.getObjectByName(bone + side)
      if (!node) continue
      if (!node.userData.restPos) node.userData.restPos = node.position.clone()
      node.position.copy(node.userData.restPos).multiplyScalar(factor)
    }
  }
  widen('shoulder01', 1 + bias(b.shoulderWidth) * 0.22)
  widen('upperleg01', 1 + bias(b.hipWidth) * 0.20)

  // The neck cancels the torso scale EXACTLY: any residual non-uniform
  // scale near the head makes face vertices (blended across neck+head
  // bones) drift against the rigidly-boned tongue and teeth — that was
  // the tongue-through-chin artifact. Identity above the shoulders.
  boneScale('neck01', 1 / (upper * frame))
  const headBone = root.getObjectByName('head')
  if (headBone) headBone.scale.setScalar(age.headScale)

  // --- The micro modifiers: limb lengths, hands and feet -----------------
  // Set absolutely from a cached rest pose, so dragging a slider never
  // accumulates. Lengthening a leg pushes the foot through the floor, so
  // the added length is tallied and given back as a lift on the root.
  let legDrop = 0
  for (const key in LIMB_SEGMENTS) {
    const f = limbLengthScale(b[key])
    const leg = key === 'thighLength' || key === 'shinLength'
    for (const base of LIMB_SEGMENTS[key]) {
      for (const side of ['.L', '.R']) {
        const node = root.getObjectByName(base + side)
        if (!node) continue
        if (!node.userData.restPos) node.userData.restPos = node.position.clone()
        node.position.copy(node.userData.restPos).multiplyScalar(f)
        // one side only: both legs lengthen together, the body drops once
        if (leg && side === '.L') legDrop += node.userData.restPos.length() * (f - 1)
      }
    }
  }
  for (const key in EXTREMITY_BONES) {
    const f = extremityScale(b[key])
    for (const side of ['.L', '.R']) {
      const node = root.getObjectByName(EXTREMITY_BONES[key] + side)
      if (node) node.scale.setScalar(f)
    }
  }
  legDrop += (root.userData.restAnkleY || 0) * (extremityScale(b.footSize) - 1)
  root.position.y = legDrop * rootScale
}
