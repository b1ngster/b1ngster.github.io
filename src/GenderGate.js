/**
 * Three doors on a cloud platform — walking through one answers the first
 * question. Identical golden doors (a body is not a colour), told apart
 * only by their name plates. Click/tap a door: it swings open, the camera
 * glides through the light, and the choice is made.
 */
import React, { useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Text } from '@react-three/drei'
import * as THREE from 'three'
import { SKY, HeavenSky } from './heaven'

const DOORS = [
  { gender: 'female', label: 'FEMALE', x: -3.2 },
  { gender: 'nonbinary', label: 'NON-BINARY', x: 0 },
  { gender: 'male', label: 'MALE', x: 3.2 },
]

const Door = ({ x, label, chosen, anyChosen, onPick }) => {
  const leaf = useRef()
  const [hover, setHover] = useState(false)

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05)
    if (leaf.current) {
      leaf.current.rotation.y = THREE.MathUtils.damp(
        leaf.current.rotation.y, chosen ? -1.9 : 0, 4, dt)
    }
  })

  return (
    <group position={[x, 0, 0]}>
      {/* frame */}
      {[[-0.62, 1.3, 0.12, 2.6], [0.62, 1.3, 0.12, 2.6]].map(([fx, fy, fw, fh], i) => (
        <mesh key={i} castShadow position={[fx, fy, 0]}>
          <boxGeometry args={[fw, fh, 0.24]} />
          <meshStandardMaterial color="#e8c05a" metalness={0.5} roughness={0.35} />
        </mesh>
      ))}
      <mesh castShadow position={[0, 2.66, 0]}>
        <boxGeometry args={[1.36, 0.12, 0.24]} />
        <meshStandardMaterial color="#e8c05a" metalness={0.5} roughness={0.35} />
      </mesh>
      {/* the light beyond: what an open door in the sky opens onto */}
      <mesh position={[0, 1.3, -0.06]}>
        <planeGeometry args={[1.12, 2.6]} />
        <meshBasicMaterial color="#fff7dd" toneMapped={false} />
      </mesh>
      {/* the leaf, hinged on its left edge */}
      <group position={[-0.56, 0, 0.06]}>
        <group ref={leaf}>
          <mesh
            castShadow
            position={[0.56, 1.3, 0]}
            onPointerOver={() => setHover(true)}
            onPointerOut={() => setHover(false)}
            onPointerDown={() => !anyChosen && onPick()}
          >
            <boxGeometry args={[1.12, 2.6, 0.08]} />
            <meshStandardMaterial
              color="#f6f1e4"
              roughness={0.5}
              emissive={hover && !anyChosen ? '#e8c05a' : '#000000'}
              emissiveIntensity={0.25}
            />
          </mesh>
        </group>
      </group>
      <Text position={[0, 2.95, 0.2]} fontSize={0.22} color="#7a5f1f" anchorX="center">
        {label}
      </Text>
    </group>
  )
}

// After a pick, drift the camera to and through the chosen door.
// The idle framing is responsive: the distance is computed from the
// viewport so all three doors always span the frame — a phone in
// landscape (wide, short) gets pulled in until the doors fill the
// height; portrait backs off until the outer doors fit the width.
const GateCamera = ({ chosenX }) => {
  const { camera, size } = useThree()
  const idleZ = useMemo(() => {
    const vFov = (camera.fov * Math.PI) / 180
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * (size.width / size.height))
    const fitWide = 4.6 / Math.tan(hFov / 2) // outer doors + margin, halved
    const fitTall = 2.95 / Math.tan(vFov / 2) // door top + title, halved
    return Math.min(18, Math.max(fitWide, fitTall) + 0.4)
  }, [camera, size])
  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05)
    const tx = chosenX == null ? 0 : chosenX
    const tz = chosenX == null ? idleZ : -0.6
    camera.position.x = THREE.MathUtils.damp(camera.position.x, tx, 1.6, dt)
    camera.position.z = THREE.MathUtils.damp(camera.position.z, tz, 1.2, dt)
    camera.position.y = THREE.MathUtils.damp(camera.position.y, 1.5, 2, dt)
    camera.lookAt(tx, 1.4, -2)
  })
  return null
}

export const GenderGate = ({ onPick }) => {
  const [chosen, setChosen] = useState(null)

  const pick = (door) => {
    if (chosen) return
    setChosen(door)
    // let the door swing and the camera pass through before advancing
    setTimeout(() => onPick(door.gender), 1800)
  }

  return (
    <Canvas shadows camera={{ position: [0, 1.5, 6.4], fov: 55 }}>
      <color attach="background" args={[SKY.top]} />
      {/* the same photographic sky as the ascension and the gate */}
      <HeavenSky file="heaven_clouds_1k.hdr" />
      <ambientLight intensity={0.75} />
      <directionalLight castShadow position={[4, 8, 6]} intensity={1.1} color="#fff2d8" />
      {/* no floor up here — the doors stand on cloud itself */}
      {DOORS.map((d) => (
        <Door
          key={d.gender}
          x={d.x}
          label={d.label}
          chosen={chosen?.gender === d.gender}
          anyChosen={!!chosen}
          onPick={() => pick(d)}
        />
      ))}
      <GateCamera chosenX={chosen ? chosen.x : null} />
    </Canvas>
  )
}
