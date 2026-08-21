/**
 * The mirror in the clouds: the chosen body turns slowly on a cloud disc
 * while MakeHuman-style macro sliders shape it — gender, age, ethnicity
 * (three blend weights, like MakeHuman's triangle), height, weight,
 * muscle, proportions. The gender slider sweeps between the three bodies;
 * the door already walked through seeds it. The panel hugs one edge so
 * the body stays in view while it is being shaped. Continue seals it.
 */
import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, useGLTF } from '@react-three/drei'
import { SkeletonUtils } from 'three-stdlib'
import { MathUtils } from 'three'
import { SKY, HeavenSky } from './heaven'
import {
  modelUrlFor, applyBody, swatchColor, BODY_DEFAULTS, ETHNICITY_KEYS,
  dominantEthnicity, genderToSlider, sliderToGender,
  OUTFITS, HAIR_LABEL, CLOTH_COLORS, isDressed,
} from './profile'
import './heaven.css'

const PreviewModel = ({ url, body }) => {
  const { scene } = useGLTF(url)
  // Clone so the preview never fights the lobby's own instance of the
  // same cached GLB. SkeletonUtils, because plain clone() breaks
  // skinning — and clone the materials too, or the tint bleeds onto
  // every other instance.
  const model = useMemo(() => {
    const c = SkeletonUtils.clone(scene)
    c.traverse((o) => {
      if (o.isMesh && o.material) o.material = o.material.clone()
    })
    return c
  }, [scene])
  useEffect(() => {
    applyBody(model, body)
    const re = () => applyBody(model, body)
    window.addEventListener('skin-tex-loaded', re)
    return () => window.removeEventListener('skin-tex-loaded', re)
  }, [model, body])

  // No turntable: the hero holds still and the USER walks around them
  // (drag to orbit, pinch to zoom — OrbitControls below).
  return <primitive object={model} />
}

// Touch-first framing: starts close, one finger orbits, pinch (or
// wheel) zooms. The initial target keeps the body clear of the panel —
// portrait docks the panel along the bottom, so aim lower there. The
// 560px cutoff mirrors the .heaven-tune media query.
// Where each preset looks, on a body normalised to 1.7m: the height to
// aim at and how far back to stand. The MICRO sliders shape hands, feet
// and limbs — parts a single framing of the whole body can never show
// well — so getting to them has to be one tap, not a fight with a drag.
const VIEWS = {
  full: { y: 0.92, dist: 3.0 },
  face: { y: 1.56, dist: 0.9 },
  hands: { y: 0.78, dist: 1.2 },
  feet: { y: 0.16, dist: 1.0 },
}
export const VIEW_KEYS = ['full', 'face', 'hands', 'feet']

const TuneControls = ({ view }) => {
  const { camera, size } = useThree()
  const controls = useRef()
  const goal = useRef(null)
  const portrait = size.height > size.width || size.width <= 560

  // A preset re-aims height and distance but KEEPS the angle already
  // dragged to, so tapping FEET travels down the body you are looking at
  // instead of spinning it back to the front.
  useEffect(() => {
    const v = VIEWS[view] || VIEWS.full
    goal.current = { y: v.y, dist: v.dist * (portrait ? 1.2 : 1) }
  }, [view, portrait])

  useFrame((state, delta) => {
    const c = controls.current
    const g = goal.current
    if (!c || !g) return
    const dt = Math.min(delta, 0.05)
    const off = camera.position.clone().sub(c.target)
    const dist = off.length()
    // Close enough: hand control back, or the damping would fight every
    // drag for the rest of the session.
    if (Math.abs(c.target.y - g.y) < 0.002 && Math.abs(dist - g.dist) < 0.005) {
      goal.current = null
      return
    }
    c.target.y = MathUtils.damp(c.target.y, g.y, 6, dt)
    off.setLength(MathUtils.damp(dist, g.dist, 6, dt))
    camera.position.copy(c.target).add(off)
    c.update()
  })

  return (
    <OrbitControls
      ref={controls}
      // Panning is what reaches a hand or a foot when a preset lands
      // near but not on it — two fingers on touch, right-drag on desktop.
      enablePan
      screenSpacePanning
      minDistance={0.5}
      maxDistance={6}
      // Just shy of the poles: straight overhead gimbal-flips the orbit,
      // and there is nothing to see from directly underneath the floor.
      minPolarAngle={0.12}
      maxPolarAngle={Math.PI * 0.92}
      zoomSpeed={0.8}
      rotateSpeed={0.9}
    />
  )
}

// Worn / not worn. A button rather than a checkbox so it takes a thumb
// as happily as a cursor.
const Toggle = ({ label, on, onChange, disabled }) => (
  <button
    type="button"
    className={`tune-toggle${on && !disabled ? ' is-on' : ''}`}
    aria-pressed={on && !disabled}
    disabled={disabled}
    onClick={() => onChange(on ? 0 : 1)}
  >
    <span className="tune-tick" aria-hidden="true">{on ? '\u2713' : ''}</span>
    {label}
  </button>
)

const Slider = ({ label, value, onChange, left, right, swatch }) => (
  <div className="tune-row">
    <label>
      {swatch && <span className="tune-swatch" style={{ background: swatch }} />}
      {label}
    </label>
    <div className="tune-slider">
      {left && <span className="tune-end">{left}</span>}
      <input
        type="range"
        min="0"
        max="1"
        step="0.01"
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        aria-label={label}
      />
      {right && <span className="tune-end">{right}</span>}
    </div>
  </div>
)

export const BodyTune = ({ gender, modelVersion, onDone }) => {
  const [genderT, setGenderT] = useState(() => genderToSlider(gender))
  const [body, setBody] = useState(BODY_DEFAULTS)
  const [tab, setTab] = useState('macro')
  const [view, setView] = useState('full')
  // The panel covers the middle of a phone screen, which is exactly where
  // the body is. Collapsing it hands the whole canvas back for orbiting.
  const [open, setOpen] = useState(true)
  const field = (key) => (v) => setBody((b) => ({ ...b, [key]: v }))

  const liveGender = sliderToGender(genderT)

  return (
    <>
      <Canvas shadows camera={{ position: [0.5, 1.5, 3.6], fov: 50 }}>
        {/* flat backdrop: the HDR background + sprite haze dithered into
            rainbow speckle on mobile — the mirror is a studio now */}
        <color attach="background" args={['#dfe7ef']} />
        <HeavenSky lightingOnly />
        <fog attach="fog" args={[SKY.horizon, 9, 26]} />
        {/* restrained: the HDRI already lights the scene, and blown-out
            highlights were washing the skin tints to nothing */}
        <ambientLight intensity={0.35} />
        <directionalLight castShadow position={[3, 6, 4]} intensity={0.8} color="#fff2d8" />
        <directionalLight position={[-4, 3, -2]} intensity={0.25} color="#cfe2f7" />
        <Suspense fallback={null}>
          <PreviewModel
            url={modelUrlFor(liveGender, modelVersion, dominantEthnicity(body), !isDressed(body))}
            body={{ ...body, gender: liveGender }}
          />
        </Suspense>
        <TuneControls view={view} />
      </Canvas>
      {/* Always on top of the canvas, never inside the collapsible panel:
          jumping to a hand must not depend on the sliders being open. */}
      <div className="tune-views">
        {VIEW_KEYS.map((k) => (
          <button
            key={k}
            type="button"
            className={`tune-view${view === k ? ' is-on' : ''}`}
            onClick={() => setView(k)}
          >
            {k.toUpperCase()}
          </button>
        ))}
      </div>
      <div className={`heaven-tune heaven-card${open ? '' : ' is-collapsed'}`}>
        <button
          type="button"
          className="tune-collapse"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? 'HIDE SLIDERS' : 'SHAPE YOURSELF'}
        </button>
        {open && (
          <>
          {/* Above the tabs on purpose. Gender picks the body; age is not a
              layer but a driver that leans on ALL of them at once — skin,
              fat placement, muscle mass, posture, head proportion and
              hair — so it would be wrong to file it under any one. */}
          <Slider label="GENDER" value={genderT} onChange={setGenderT} left="F" right="M" />
          <Slider label="AGE" value={body.age} onChange={field('age')} left="18" right="80" />
          {/* One tab per system: the skeleton, the muscle on it, the fat
              over that, the skin over that, and what it wears. */}
          <div className="tune-tabs" role="tablist">
            {['frame', 'muscle', 'fat', 'skin', 'wear'].map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                className={`tune-tab${tab === t ? ' is-on' : ''}`}
                onClick={() => setTab(t)}
              >
                {t.toUpperCase()}
              </button>
            ))}
          </div>
          {tab === 'skin' && (
            <>
              <div className="tune-group">ETHNICITY</div>
              {ETHNICITY_KEYS.map((key) => (
                <Slider
                  key={key}
                  label={{ african: 'AFRICAN', asian: 'EAST ASIAN', indian: 'SOUTH ASIAN', european: 'EUROPEAN' }[key]}
                  value={body[key]}
                  onChange={field(key)}
                  swatch={swatchColor(key)}
                />
              ))}
            </>
          )}
          {tab === 'frame' && (
            <>
              {/* The skeleton: the frame everything else hangs on. Bone
                  breadth and joint offsets only — nothing here is muscle
                  or fat, which is what lets a broad-shouldered narrow-hipped
                  body exist at any weight. Widths move the JOINT rather
                  than scaling a bone, so nothing shears. */}
              <div className="tune-group">BUILD</div>
              <Slider label="HEIGHT" value={body.height} onChange={field('height')} left="SHORT" right="TALL" />
              <Slider label="BONE FRAME" value={body.frame} onChange={field('frame')} left="FINE" right="HEAVY" />
              <Slider label="SHOULDER WIDTH" value={body.shoulderWidth} onChange={field('shoulderWidth')} left="NARROW" right="BROAD" />
              <Slider label="HIP WIDTH" value={body.hipWidth} onChange={field('hipWidth')} left="NARROW" right="BROAD" />
              <Slider label="PROPORTIONS" value={body.proportions} onChange={field('proportions')} left="LONG TORSO" right="LEGGY" />
              <div className="tune-group">ARMS</div>
              <Slider label="UPPER ARM LENGTH" value={body.upperArmLength} onChange={field('upperArmLength')} left="SHORT" right="LONG" />
              <Slider label="FOREARM LENGTH" value={body.forearmLength} onChange={field('forearmLength')} left="SHORT" right="LONG" />
              <div className="tune-group">LEGS</div>
              <Slider label="THIGH LENGTH" value={body.thighLength} onChange={field('thighLength')} left="SHORT" right="LONG" />
              <Slider label="SHIN LENGTH" value={body.shinLength} onChange={field('shinLength')} left="SHORT" right="LONG" />
              <div className="tune-group">HANDS &amp; FEET</div>
              <Slider label="HAND SIZE" value={body.handSize} onChange={field('handSize')} left="SMALL" right="LARGE" />
              <Slider label="FOOT SIZE" value={body.footSize} onChange={field('footSize')} left="SMALL" right="LARGE" />
            </>
          )}
          {tab === 'muscle' && (
            <>
              {/* How much muscle there is, and where it is carried. The
                  mass comes from MakeHuman's muscle morph; the balance is
                  the skeleton's girth, so a swimmer and a cyclist can hold
                  the same mass in different places. Age takes mass off
                  both — sarcopenia is wired into the age slider. */}
              <div className="tune-group">MASS</div>
              <Slider label="MUSCLE" value={body.muscle} onChange={field('muscle')} left="SOFT" right="BUILT" />
              <div className="tune-group">WHERE IT SITS</div>
              <Slider label="UPPER / LOWER" value={body.muscleUpper} onChange={field('muscleUpper')} left="LEGS" right="CHEST" />
              <p className="tune-note">
                Age thins muscle wherever it sits — an older body reads
                softer at the same setting.
              </p>
            </>
          )}
          {tab === 'fat' && (
            <>
              {/* Weight says how much; these say where it settles. The
                  same weight can be an apple or a pear, and that choice
                  is most of what makes bodies look like people. */}
              <div className="tune-group">AMOUNT</div>
              <Slider label="WEIGHT" value={body.weight} onChange={field('weight')} left="LEAN" right="FULL" />
              <div className="tune-group">WHERE IT SETTLES</div>
              <Slider label="BELLY" value={body.fatBelly} onChange={field('fatBelly')} left="FLAT" right="ROUND" />
              <Slider label="HIPS &amp; SEAT" value={body.fatHips} onChange={field('fatHips')} left="SLIM" right="FULL" />
              <Slider label="ARMS &amp; LEGS" value={body.fatLimbs} onChange={field('fatLimbs')} left="SLIM" right="FULL" />
              <div className="tune-group">CHEST</div>
              <Slider label="BREAST SIZE" value={body.breastSize} onChange={field('breastSize')} left="FLAT" right="FULL" />
              <Slider label="FIRMNESS" value={body.breastFirmness} onChange={field('breastFirmness')} left="SOFT" right="FIRM" />
              <p className="tune-note">
                Age moves fat toward the trunk and away from the limbs.
              </p>
            </>
          )}
          {tab === 'wear' && (
            <>
              {/* One outfit per body, on or off as a whole. Its garments
                  are real separate meshes over the body — not painted on
                  — but the clothed export's body is cut away beneath
                  them, so a single garment cannot come off alone. */}
              <div className="tune-group">WORN</div>
              <Toggle
                label={OUTFITS[liveGender] || 'OUTFIT'}
                on={body.wearOutfit > 0.5}
                onChange={field('wearOutfit')}
              />
              <Toggle
                label={HAIR_LABEL[liveGender] || 'HAIR'}
                on={body.wearHair > 0.5}
                onChange={field('wearHair')}
                disabled={body.wearOutfit <= 0.5}
              />
              <div className="tune-group">HAIR</div>
              <Slider label="GREY" value={body.hairGrey} onChange={field('hairGrey')} left="NONE" right="WHITE" />
              <Slider label="THINNING" value={body.hairThin} onChange={field('hairThin')} left="FULL" right="SPARSE" />
              <div className="tune-group">CLOTH COLOUR</div>
              <div className="tune-chips">
                {CLOTH_COLORS.map((c, i) => (
                  <button
                    key={c.name}
                    type="button"
                    aria-label={c.name}
                    title={c.name}
                    className={`tune-chip${Math.round(body.clothColor) === i ? ' is-on' : ''}`}
                    style={{ background: c.hex }}
                    onClick={() => field('clothColor')(i)}
                  />
                ))}
              </div>
              <p className="tune-note">
                The outfit is real garment geometry worn over the body, not
                a painted texture. It goes on and off as a whole; stripped
                bare, the body swaps to the export that carries the extra
                shape morphs.
              </p>
            </>
          )}
          </>
        )}
        <button
          className="heaven-button"
          style={{ marginTop: open ? '1rem' : '0.4rem' }}
          onClick={() => onDone({ gender: liveGender, ...body })}
        >
          MY PERSONA
        </button>
      </div>
    </>
  )
}
