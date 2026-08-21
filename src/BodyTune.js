/**
 * The mirror in the clouds: the chosen body turns slowly on a cloud disc
 * while MakeHuman-style macro sliders shape it — gender, age, ethnicity
 * (three blend weights, like MakeHuman's triangle), height, weight,
 * muscle, proportions. The gender slider sweeps between the three bodies;
 * the door already walked through seeds it. The panel hugs one edge so
 * the body stays in view while it is being shaped. Continue seals it.
 */
import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls, useGLTF } from '@react-three/drei'
import { SkeletonUtils } from 'three-stdlib'
import { SKY, HeavenSky } from './heaven'
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
const TuneControls = () => {
  const { camera, size } = useThree()
  const controls = useRef()
  const portrait = size.height > size.width || size.width <= 560
  useEffect(() => {
    if (portrait) {
      camera.position.set(0, 1.4, 3.0)
      controls.current?.target.set(0, 0.6, 0)
    } else {
      camera.position.set(0.35, 1.3, 2.3)
      controls.current?.target.set(-0.1, 0.95, 0)
    }
    controls.current?.update()
  }, [camera, portrait])
  return (
    <OrbitControls
      ref={controls}
      enablePan={false}
      minDistance={0.7}
      maxDistance={6}
      zoomSpeed={0.8}
      rotateSpeed={0.9}
    />
  )
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
  const [genderT, setGenderT] = useState(() => genderToSlider(gender))
  const [body, setBody] = useState(BODY_DEFAULTS)
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
            url={modelUrlFor(liveGender, modelVersion, dominantEthnicity(body), true)}
            body={{ ...body, gender: liveGender }}
          />
        </Suspense>
        <TuneControls />
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
        <Slider label="BREAST SIZE" value={body.breastSize} onChange={field('breastSize')} />
        <Slider label="FIRMNESS" value={body.breastFirmness} onChange={field('breastFirmness')} />
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
