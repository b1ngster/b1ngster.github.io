/**
 * The ascension: the very first thing a new hero does is rise. First
 * person, carried gently upward under a photographic sky whose own
 * clouds and light do all the talking — no sprites, nothing that can
 * shimmer or dither on any device. The gaze pans and lifts toward the
 * brightness, then hands over to the gate in the clouds.
 */
import React, { useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { SKY, HeavenSky } from './heaven'

const RISE_SECONDS = 9
const TOP_Y = 26 // how high the ascent carries you


const Riser = ({ onArrive }) => {
  const state = useRef({ t: 0, done: false })

  useFrame(({ camera, clock }, delta) => {
    const s = state.current
    const dt = Math.min(delta, 0.05)
    s.t += dt
    const k = Math.min(1, s.t / RISE_SECONDS)
    // a gentle lift that gathers conviction near the light
    const eased = k * k * (3 - 2 * k)
    const y = 3.2 + eased * TOP_Y
    // a slow breathing sway, nothing like footsteps — you are carried
    const swayT = clock.elapsedTime * 0.7
    camera.position.set(
      Math.sin(swayT) * 0.35,
      y + Math.sin(swayT * 1.7) * 0.12,
      Math.cos(swayT * 0.8) * 0.25
    )
    // the gaze pans slowly across the photographic sky and lifts toward
    // the light as you rise — the sky itself carries the motion
    camera.lookAt(Math.sin(k * 1.2) * 6, y + 3 + 15 * k, -12)
    if (k >= 1 && !s.done) {
      s.done = true
      onArrive()
    }
  })
  return null
}

// Cloud decks stacked along the ascent — each one drifts past as you
// break through it. Denser near the start, thinning toward the light.
const DECKS = [0, 0.18, 0.36, 0.55, 0.75, 0.92]

export const Ascent = ({ onArrive }) => (
  <Canvas camera={{ position: [0, 1.5, 0], fov: 68 }}>
    <color attach="background" args={[SKY.top]} />
    <HeavenSky file="heaven_clouds_1k.hdr" />
        {/* the HDRI carries the ambient light; a warm hazy sun on top */}
    <directionalLight position={[1, 10, 2]} intensity={0.55} color="#ffe8c0" />
    <Riser onArrive={onArrive} />
  </Canvas>
)
