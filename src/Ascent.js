/**
 * The ascension: the very first thing a new hero does is rise. No stairs,
 * no floor — just cloud. First person, lifted gently up through layer
 * after layer of drifting cloud, under a photographic sky, toward the
 * warm sunburst above. Breaking through the last layer hands over to the
 * gate in the clouds.
 */
import React, { useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { CloudField, SKY, HeavenSky } from './heaven'

const RISE_SECONDS = 9
const TOP_Y = 26 // how high the ascent carries you

// The sunburst overhead: hand-drawn radial rays on a canvas (the no-CDN
// rule — nothing fetched). The whole climb aims at it.
let rayTexture = null
const getRayTexture = () => {
  if (rayTexture) return rayTexture
  const size = 512
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')
  const c = size / 2
  ctx.translate(c, c)
  for (let i = 0; i < 28; i++) {
    ctx.save()
    ctx.rotate((i / 28) * Math.PI * 2 + (i % 3) * 0.04)
    const len = c * (0.65 + ((i * 37) % 10) / 28)
    const g = ctx.createLinearGradient(0, 0, len, 0)
    g.addColorStop(0, 'rgba(255,250,230,0.55)')
    g.addColorStop(1, 'rgba(255,250,230,0)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.lineTo(len, -size * 0.012)
    ctx.lineTo(len, size * 0.012)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
  }
  const core = ctx.createRadialGradient(0, 0, 0, 0, 0, c * 0.5)
  core.addColorStop(0, 'rgba(255,255,255,0.9)')
  core.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = core
  ctx.fillRect(-c, -c, size, size)
  rayTexture = new THREE.CanvasTexture(canvas)
  return rayTexture
}

const Sunburst = () => (
  <sprite position={[0, TOP_Y + 16, -10]} scale={[70, 70, 1]}>
    <spriteMaterial
      map={getRayTexture()}
      transparent
      opacity={0.75}
      depthWrite={false}
      fog={false}
      toneMapped={false}
    />
  </sprite>
)

const Riser = ({ onArrive }) => {
  const state = useRef({ t: 0, done: false })

  useFrame(({ camera, clock }, delta) => {
    const s = state.current
    const dt = Math.min(delta, 0.05)
    s.t += dt
    const k = Math.min(1, s.t / RISE_SECONDS)
    // a gentle lift that gathers conviction near the light
    const eased = k * k * (3 - 2 * k)
    const y = 1.5 + eased * TOP_Y
    // a slow breathing sway, nothing like footsteps — you are carried
    const swayT = clock.elapsedTime * 0.7
    camera.position.set(
      Math.sin(swayT) * 0.35,
      y + Math.sin(swayT * 1.7) * 0.12,
      Math.cos(swayT * 0.8) * 0.25
    )
    // the gaze tilts from the horizon up into the sunburst as you rise
    camera.lookAt(0, y + 4 + 14 * k, -12)
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
    <fog attach="fog" args={['#e9eae6', 18, 90]} />
    {/* the HDRI carries the ambient light; a warm hazy sun on top */}
    <directionalLight position={[1, 10, 2]} intensity={0.55} color="#ffe8c0" />
    {/* cloud decks to rise through: wide, layered, drifting */}
    {DECKS.map((k, i) => (
      <CloudField
        key={k}
        count={26}
        center={[0, 1 + k * TOP_Y, -4]}
        spread={[46, 3.5, 34]}
        scale={[5 + (i % 3) * 3, 14]}
        opacity={0.9 - k * 0.35}
        drift={0.25}
      />
    ))}
    {/* a thick base deck below — where you began */}
    <CloudField count={30} center={[0, -3.5, -4]} spread={[50, 4, 36]} scale={[8, 18]} opacity={0.95} drift={0.2} />
    {/* wisps at arm's reach on the way up, off to the sides */}
    {[0.25, 0.5, 0.75].map((k) =>
      [-6, 6].map((side) => (
        <CloudField
          key={`${k}:${side}`}
          count={6}
          center={[side, 1.5 + k * TOP_Y, -2]}
          spread={[4, 2.5, 8]}
          scale={[1.5, 3.5]}
          opacity={0.5}
          drift={0.4}
        />
      ))
    )}
    <Sunburst />
    <Riser onArrive={onArrive} />
  </Canvas>
)
