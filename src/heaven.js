/**
 * heaven — the shared look of the onboarding: a procedural cloud sprite
 * (canvas radial blobs, so nothing is fetched from anywhere — the no-CDN
 * rule), a drifting CloudField, and the sky palette. Deterministic: cloud
 * placement is hashed from the index, so every visit looks the same.
 */
import React, { Suspense, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Environment } from '@react-three/drei'
import * as THREE from 'three'

export const SKY = {
  top: '#7fbdf2',
  horizon: '#eaf5ff',
  glow: '#fff3cf',
}

// A soft cloud puff: overlapping radial gradients on a canvas. Generated
// once and shared by every sprite.
let cloudTexture = null
export const getCloudTexture = () => {
  if (cloudTexture) return cloudTexture
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')
  const blob = (x, y, r, a) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r)
    g.addColorStop(0, `rgba(255,255,255,${a})`)
    g.addColorStop(0.6, `rgba(255,255,255,${a * 0.55})`)
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, size, size)
  }
  // one wide base and a few lumps on top, like every cloud ever drawn
  blob(128, 150, 95, 0.85)
  blob(85, 125, 60, 0.8)
  blob(175, 120, 55, 0.75)
  blob(128, 100, 48, 0.7)
  blob(60, 150, 45, 0.6)
  blob(195, 150, 42, 0.6)
  cloudTexture = new THREE.CanvasTexture(canvas)
  return cloudTexture
}

const hash = (n) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return s - Math.floor(s)
}

// A drifting bank of cloud sprites filling a box around `center`. Sprites
// loop across the box along x so the bank never runs out.
export const CloudField = ({
  count = 30,
  center = [0, 0, 0],
  spread = [40, 8, 30],
  scale = [6, 14],
  opacity = 0.85,
  drift = 0.4,
}) => {
  const group = useRef()
  const clouds = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        offset: [
          (hash(i * 3 + 1) - 0.5) * spread[0],
          (hash(i * 3 + 2) - 0.5) * spread[1],
          (hash(i * 3 + 3) - 0.5) * spread[2],
        ],
        size: scale[0] + hash(i * 7 + 5) * (scale[1] - scale[0]),
        fade: 0.35 + hash(i * 11 + 9) * 0.65,
        speed: 0.5 + hash(i * 13 + 4),
      })),
    [count, spread, scale]
  )

  useFrame((state) => {
    if (!group.current) return
    const t = state.clock.elapsedTime
    group.current.children.forEach((sprite, i) => {
      const c = clouds[i]
      const x = c.offset[0] + t * drift * c.speed
      const half = spread[0] / 2
      // wrap across the box, keeping the offset pattern
      sprite.position.x = ((x + half) % spread[0]) - half
    })
  })

  const map = getCloudTexture()
  return (
    <group ref={group} position={center}>
      {clouds.map((c, i) => (
        <sprite key={i} position={c.offset} scale={[c.size, c.size * 0.6, 1]}>
          <spriteMaterial
            map={map}
            transparent
            opacity={opacity * c.fade}
            depthWrite={false}
          />
        </sprite>
      ))}
    </group>
  )
}

// The real sky over heaven: a self-hosted CC0 HDRI (Poly Haven,
// "Kloppenheim 06 puresky") used as both the background and image-based
// lighting — depth the flat gradient could never give. Self-hosted under
// public/, never a CDN (a CDN HDR once blanked the whole site on iPad),
// and any load failure just leaves the flat SKY colours in place.
class SkyBoundary extends React.Component {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    return this.state.failed ? null : this.props.children
  }
}

export const HeavenSky = ({ file = 'heaven_sky_1k.hdr', lightingOnly = false }) => (
  <SkyBoundary>
    <Suspense fallback={null}>
      <Environment files={`${process.env.PUBLIC_URL}/hdri/${file}`} background={!lightingOnly} />
    </Suspense>
  </SkyBoundary>
)
