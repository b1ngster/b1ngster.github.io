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
import { useGLTF } from '@react-three/drei'
import { SkeletonUtils } from 'three-stdlib'
import { CloudField, SKY, HeavenSky } from './heaven'
import {
  modelUrlFor, applyBody, swatchColor, BODY_DEFAULTS, ETHNICITY_KEYS,
  dominantEthnicity, genderToSlider, sliderToGender,
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
  const group = useRef()

  useEffect(() => {
    applyBody(model, body)
  }, [model, body])

  useFrame((state, delta) => {
    if (group.current) group.current.rotation.y += delta * 0.35
  })

  return (
    <group ref={group}>
      <primitive object={model} />
    </group>
  )
}

// Frame the body clear of the panel: landscape docks the panel right, so
// nudge the body left; portrait (or any narrow window) docks it along the
// bottom, so look lower down (which lifts the body into the top of the
// frame). The 560px cutoff mirrors the .heaven-tune media query — the
// camera and the CSS must agree on which layout is showing.
const TuneCamera = () => {
  const { camera, size } = useThree()
  useEffect(() => {
    const portrait = size.height > size.width || size.width <= 560
    if (portrait) {
      camera.position.set(0, 1.5, 4.4)
      camera.lookAt(0, 0.1, 0)
    } else {
      camera.position.set(0.5, 1.5, 3.6)
      camera.lookAt(-0.3, 0.9, 0)
    }
  }, [camera, size])
  return null
}

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
  // ?bare swaps in the unclothed body (male european only, so far) — for
  // inspecting the macro deformations directly on the skin.
  const bare = useMemo(() => new URLSearchParams(window.location.search).has('bare'), [])
  const [genderT, setGenderT] = useState(() => genderToSlider(gender))
  const [body, setBody] = useState(BODY_DEFAULTS)
  const field = (key) => (v) => setBody((b) => ({ ...b, [key]: v }))

  const liveGender = sliderToGender(genderT)

  return (
    <>
      <Canvas shadows camera={{ position: [0.5, 1.5, 3.6], fov: 50 }}>
        <color attach="background" args={[SKY.top]} />
        <HeavenSky />
        <fog attach="fog" args={[SKY.horizon, 9, 26]} />
        {/* restrained: the HDRI already lights the scene, and blown-out
            highlights were washing the skin tints to nothing */}
        <ambientLight intensity={0.35} />
        <directionalLight castShadow position={[3, 6, 4]} intensity={0.8} color="#fff2d8" />
        <directionalLight position={[-4, 3, -2]} intensity={0.25} color="#cfe2f7" />
        {/* no floor up here — a cloud bank holds the hero up */}
        <CloudField count={12} center={[0, -0.5, 0]} spread={[5, 1, 4]} scale={[2, 4.5]} opacity={0.95} />
        <Suspense fallback={null}>
          <PreviewModel
            url={
              bare && liveGender === 'male' && dominantEthnicity(body) === 'european'
                ? `${process.env.PUBLIC_URL}/models/male_bare.glb?v=${modelVersion}`
                : modelUrlFor(liveGender, modelVersion, dominantEthnicity(body))
            }
            body={{ ...body, gender: liveGender }}
          />
        </Suspense>
        <CloudField count={20} center={[0, 2.5, -7]} spread={[30, 8, 10]} opacity={0.7} />
        <TuneCamera />
      </Canvas>
      <div className="heaven-tune heaven-card">
        <h1 style={{ fontSize: '1.1rem' }}>SHAPE YOURSELF</h1>
        <Slider label="GENDER" value={genderT} onChange={setGenderT} left="F" right="M" />
        <Slider label="AGE" value={body.age} onChange={field('age')} left="18" right="80" />
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
        <Slider label="HEIGHT" value={body.height} onChange={field('height')} />
        <Slider label="WEIGHT" value={body.weight} onChange={field('weight')} />
        <Slider label="MUSCLE" value={body.muscle} onChange={field('muscle')} />
        <Slider label="PROPORTIONS" value={body.proportions} onChange={field('proportions')} />
        <button
          className="heaven-button"
          style={{ marginTop: '1rem' }}
          onClick={() => onDone({ gender: liveGender, ...body })}
        >
          MY PERSONA
        </button>
      </div>
    </>
  )
}
