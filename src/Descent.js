/**
 * The run to the lobby: first person, feet on cloud, a golden gate glow
 * growing on the horizon. Head-bob and a rising pace sell the running;
 * a white-out hands over to the lobby, where the player wakes standing
 * outside their dressing room.
 */
import React, { useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Text } from '@react-three/drei'
import { CloudField, SKY, HeavenSky } from './heaven'

const RUN_SECONDS = 8

const Runner = ({ onArrive }) => {
  const state = useRef({ t: 0, done: false })

  useFrame(({ camera, clock }, delta) => {
    const s = state.current
    s.t += Math.min(delta, 0.05)
    const k = Math.min(1, s.t / RUN_SECONDS)
    // pace eases in, then sprints
    const speed = 4 + 14 * k * k
    camera.position.z -= speed * Math.min(delta, 0.05)
    // head-bob: frequency rises with the pace
    const bobT = clock.elapsedTime * (6 + 4 * k)
    camera.position.y = 1.55 + Math.sin(bobT) * 0.05 * (0.5 + k)
    camera.position.x = Math.sin(bobT * 0.5) * 0.04
    camera.rotation.z = Math.sin(bobT * 0.5) * 0.012
    camera.lookAt(0, 1.6, camera.position.z - 10)
    if (k >= 1 && !s.done) {
      s.done = true
      onArrive()
    }
  })
  return null
}

export const Descent = ({ onArrive }) => (
  <Canvas camera={{ position: [0, 1.55, 0], fov: 68 }}>
    <color attach="background" args={[SKY.top]} />
    <HeavenSky />
    <fog attach="fog" args={[SKY.horizon, 10, 60]} />
    <ambientLight intensity={0.85} />
    <directionalLight position={[3, 8, 2]} intensity={1.0} color="#fff2d8" />
    {/* the cloud floor rushing underfoot */}
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, -80]}>
      <planeGeometry args={[60, 240]} />
      <meshStandardMaterial color="#eef6ff" roughness={1} />
    </mesh>
    {/* banks either side of the running line, and wisps overhead */}
    <CloudField count={40} center={[-9, 2.5, -70]} spread={[10, 6, 150]} opacity={0.9} drift={0} />
    <CloudField count={40} center={[9, 2.5, -70]} spread={[10, 6, 150]} opacity={0.9} drift={0} />
    <CloudField count={24} center={[0, 7, -70]} spread={[24, 3, 150]} opacity={0.65} drift={0} />
    {/* the lobby gate: a golden glow at the end of the run */}
    <mesh position={[0, 3, -170]}>
      <circleGeometry args={[16, 48]} />
      <meshBasicMaterial color="#ffe9b0" toneMapped={false} />
    </mesh>
    <Text position={[0, 7.5, -160]} fontSize={2.2} color="#ffffff" outlineWidth={0.06} outlineColor="#c9982f" anchorX="center">
      TO EARTH
    </Text>
    <Runner onArrive={onArrive} />
  </Canvas>
)
