import React, { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { Billboard, Text } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { input, attachKeyboard } from './input'

/*
 * Room one of the B1ngster world: the Lobby. A third-person character runs
 * around an indoor room — reception desk, rug, plants — steered by the
 * analog joystick (or WASD). You spawn with your back to the dressing room —
 * your own room, where your identity gets made: the first Select on its door
 * asks you to sign up (username and display name, on a DOM card the App
 * owns), and a filled-in form is what opens the door.
 *
 * The spawn faces the camera with the door just behind it: the camera always
 * looks at the far wall, so "the room behind you" has to live on that wall
 * to ever be on screen.
 */

const ROOM_HW = 9 // half-width of the room, along x
const ROOM_HD = 7 // half-depth, along z
const WALL_H = 4

const PLAYER_RADIUS = 0.35
const RUN_SPEED = 6 // at full stick deflection; the stick's magnitude scales it

const DOOR_W = 2
const DOOR_H = 2.6
const NEAR_DISTANCE = 2.6 // close enough for Select to reach the door

// Solid furniture the player runs into, not through: axis-aligned footprints
// as [centreX, centreZ, halfX, halfZ].
const COLLIDERS = [
  [5.5, -4.5, 1.6, 0.6], // reception desk
  [-8.2, -6.2, 0.5, 0.5], // plant, far corner
  [8.2, 6.2, 0.5, 0.5], // plant, near corner
]

export const Scene = ({ identity, onSignUp }) => {
  const player = useRef()
  const door = useRef()
  const nameTag = useRef()

  const selectWasDown = useRef(false)
  const hadIdentity = useRef(Boolean(identity))

  const [doorOpen, setDoorOpen] = useState(false)
  const [nearDoor, setNearDoor] = useState(false)

  useEffect(attachKeyboard, [])

  // Signing up is what unlocks your room: the moment an identity first
  // arrives from the form, the door swings open by itself.
  useEffect(() => {
    if (identity && !hadIdentity.current) setDoorOpen(true)
    hadIdentity.current = Boolean(identity)
  }, [identity])

  // Scratch vectors, allocated once — useFrame runs sixty times a second and
  // a fresh Vector3 each frame is garbage-collector bait.
  const scratch = useMemo(
    () => ({ move: new THREE.Vector3(), camera: new THREE.Vector3() }),
    []
  )

  useFrame((state, delta) => {
    // A backgrounded tab hands back one huge delta; capping it turns "teleport
    // through the wall" into "resume where you were".
    const dt = Math.min(delta, 0.05)
    const body = player.current

    // --- Running -------------------------------------------------------
    // The stick is analog: its direction steers, its deflection sets the
    // pace. Length can exceed 1 when keyboard diagonals stack, so cap it.
    const move = scratch.move.set(input.x, 0, input.y)
    const pace = Math.min(move.length(), 1)

    if (pace > 0.01) {
      move.normalize()
      body.position.addScaledVector(move, RUN_SPEED * pace * dt)
      // Face the way we are running (the model's +z is its face).
      body.rotation.y = Math.atan2(move.x, move.z)
    }

    // --- Staying inside the room, and out of the furniture -------------
    body.position.x = THREE.MathUtils.clamp(
      body.position.x, -(ROOM_HW - PLAYER_RADIUS), ROOM_HW - PLAYER_RADIUS)
    body.position.z = THREE.MathUtils.clamp(
      body.position.z, -(ROOM_HD - PLAYER_RADIUS), ROOM_HD - PLAYER_RADIUS)

    for (const [cx, cz, hx, hz] of COLLIDERS) {
      // Overlap on both axes means we are inside the (radius-grown) box:
      // push out along whichever axis is the shallower escape.
      const dx = body.position.x - cx
      const dz = body.position.z - cz
      const escapeX = hx + PLAYER_RADIUS - Math.abs(dx)
      const escapeZ = hz + PLAYER_RADIUS - Math.abs(dz)
      if (escapeX > 0 && escapeZ > 0) {
        if (escapeX < escapeZ) {
          body.position.x = cx + Math.sign(dx || 1) * (hx + PLAYER_RADIUS)
        } else {
          body.position.z = cz + Math.sign(dz || 1) * (hz + PLAYER_RADIUS)
        }
      }
    }

    // --- The door, only within arm's reach -----------------------------
    const doorDistance = Math.hypot(body.position.x, body.position.z + ROOM_HD)
    const near = doorDistance < NEAR_DISTANCE
    if (near !== nearDoor) setNearDoor(near)

    if (input.select && !selectWasDown.current && near) {
      // No identity yet: the door stays shut and Select hands you the
      // sign-up card instead. The door opens when the form comes back filled.
      if (identity) setDoorOpen((open) => !open)
      else onSignUp()
    }
    selectWasDown.current = input.select

    // Slide, don't snap: the door eases sideways into the wall.
    door.current.position.x = THREE.MathUtils.damp(
      door.current.position.x, doorOpen ? DOOR_W + 0.15 : 0, 8, dt)

    // --- Third-person camera -------------------------------------------
    // A fixed shoulder offset rather than orbiting with the player's facing:
    // the stick then always means what it shows (up runs away from the
    // camera). The walls the camera ends up behind are single-sided planes
    // facing inward, so it sees straight through them into the room.
    const goal = scratch.camera.set(
      body.position.x,
      body.position.y + 2.8,
      body.position.z + 5
    )
    state.camera.position.lerp(goal, 1 - Math.pow(0.0005, dt))
    state.camera.lookAt(body.position.x, body.position.y + 1.1, body.position.z)

    // The name tag rides above the player but lives outside the player group:
    // a Billboard inside a rotating parent would inherit the run direction.
    if (nameTag.current) {
      nameTag.current.position.set(body.position.x, 1.8, body.position.z)
    }
  })

  // The wall around the doorway: a segment either side plus a lintel above,
  // leaving a real gap the door slides across.
  const sideW = ROOM_HW - DOOR_W / 2

  return (
    <>
      <color attach="background" args={['#15181e']} />
      <ambientLight intensity={0.5} />
      {/* The main ceiling lamp; the only shadow-caster, which one room can afford. */}
      <pointLight castShadow position={[0, WALL_H - 0.6, 0]} intensity={0.9} distance={24} />
      <pointLight position={[5.5, WALL_H - 1, -4]} intensity={0.35} distance={10} color="#ffe9c4" />

      {/* --- The room shell: single-sided planes facing inward ---------- */}
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[ROOM_HW * 2, ROOM_HD * 2]} />
        <meshStandardMaterial color="#7a5c3e" />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, WALL_H, 0]}>
        <planeGeometry args={[ROOM_HW * 2, ROOM_HD * 2]} />
        <meshStandardMaterial color="#cfc8bc" />
      </mesh>

      {/* Back wall, in three pieces around the doorway */}
      <mesh receiveShadow position={[-(DOOR_W / 2 + sideW / 2), WALL_H / 2, -ROOM_HD]}>
        <planeGeometry args={[sideW, WALL_H]} />
        <meshStandardMaterial color="#9d8f7b" />
      </mesh>
      <mesh receiveShadow position={[DOOR_W / 2 + sideW / 2, WALL_H / 2, -ROOM_HD]}>
        <planeGeometry args={[sideW, WALL_H]} />
        <meshStandardMaterial color="#9d8f7b" />
      </mesh>
      <mesh receiveShadow position={[0, DOOR_H + (WALL_H - DOOR_H) / 2, -ROOM_HD]}>
        <planeGeometry args={[DOOR_W, WALL_H - DOOR_H]} />
        <meshStandardMaterial color="#9d8f7b" />
      </mesh>

      {/* Front and side walls */}
      <mesh rotation={[0, Math.PI, 0]} position={[0, WALL_H / 2, ROOM_HD]}>
        <planeGeometry args={[ROOM_HW * 2, WALL_H]} />
        <meshStandardMaterial color="#a89a85" />
      </mesh>
      <mesh receiveShadow rotation={[0, Math.PI / 2, 0]} position={[-ROOM_HW, WALL_H / 2, 0]}>
        <planeGeometry args={[ROOM_HD * 2, WALL_H]} />
        <meshStandardMaterial color="#a89a85" />
      </mesh>
      <mesh receiveShadow rotation={[0, -Math.PI / 2, 0]} position={[ROOM_HW, WALL_H / 2, 0]}>
        <planeGeometry args={[ROOM_HD * 2, WALL_H]} />
        <meshStandardMaterial color="#a89a85" />
      </mesh>

      {/* --- The dressing room door -------------------------------------- */}
      {/* The dark of the dressing room, glimpsed through the gap when open */}
      <mesh position={[0, DOOR_H / 2, -ROOM_HD - 0.5]}>
        <planeGeometry args={[DOOR_W + 1.2, DOOR_H + 0.6]} />
        <meshStandardMaterial color="#07080c" />
      </mesh>
      <Text
        position={[0, 1.5, -ROOM_HD - 0.45]}
        fontSize={0.24}
        color="#5f6f8f"
        anchorX="center"
        anchorY="middle"
      >
        {identity ? `${identity.displayName}'s dressing room` : 'DRESSING ROOM'}
      </Text>
      {/* The door itself, just behind the wall so it can slide in behind it */}
      <mesh ref={door} castShadow position={[0, DOOR_H / 2, -ROOM_HD - 0.12]}>
        <boxGeometry args={[DOOR_W, DOOR_H, 0.1]} />
        <meshStandardMaterial
          color="#2f6fd8"
          emissive={nearDoor ? '#2f6fd8' : '#000000'}
          emissiveIntensity={0.3}
        />
      </mesh>

      {/* The lobby's sign, high on the wall, and the door's own plate */}
      <Text
        position={[0, 3.6, -ROOM_HD + 0.06]}
        fontSize={0.45}
        color="white"
        outlineWidth={0.02}
        outlineColor="#1a1a2e"
        anchorX="center"
        anchorY="middle"
      >
        B1NGSTER
      </Text>
      <Text
        position={[0, 3.2, -ROOM_HD + 0.06]}
        fontSize={0.2}
        color="#e8b83a"
        anchorX="center"
        anchorY="middle"
      >
        — THE LOBBY —
      </Text>
      <Text
        position={[0, 2.78, -ROOM_HD + 0.06]}
        fontSize={0.17}
        color="#fff7d6"
        outlineWidth={0.008}
        outlineColor="#1a1a2e"
        anchorX="center"
        anchorY="middle"
      >
        DRESSING ROOM
      </Text>

      {/* --- Furniture (footprints mirrored in COLLIDERS) ---------------- */}
      <group position={[5.5, 0, -4.5]}>
        <mesh castShadow position={[0, 0.5, 0]}>
          <boxGeometry args={[3, 1, 1]} />
          <meshStandardMaterial color="#5b4632" />
        </mesh>
        <mesh castShadow position={[0, 1.02, 0]}>
          <boxGeometry args={[3.2, 0.08, 1.2]} />
          <meshStandardMaterial color="#8a6d4a" />
        </mesh>
      </group>
      {[[-8.2, -6.2], [8.2, 6.2]].map(([x, z]) => (
        <group key={`${x},${z}`} position={[x, 0, z]}>
          <mesh castShadow position={[0, 0.25, 0]}>
            <cylinderGeometry args={[0.32, 0.26, 0.5, 12]} />
            <meshStandardMaterial color="#b0603a" />
          </mesh>
          <mesh castShadow position={[0, 0.85, 0]}>
            <sphereGeometry args={[0.45, 12, 12]} />
            <meshStandardMaterial color="#3fae6a" />
          </mesh>
        </group>
      ))}
      {/* A rug, so the floor visibly slides past while running */}
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
        <circleGeometry args={[2.6, 32]} />
        <meshStandardMaterial color="#8b3a4a" />
      </mesh>

      {/* The prompt, floating by the door once you are within reach */}
      {nearDoor && (
        <Billboard position={[0, DOOR_H + 0.5, -ROOM_HD + 0.6]}>
          <Text
            fontSize={0.24}
            color="#fff7d6"
            outlineWidth={0.012}
            outlineColor="#1a1a2e"
            anchorX="center"
            anchorY="middle"
          >
            {!identity
              ? 'SELECT to sign up'
              : doorOpen
                ? 'SELECT to close'
                : 'SELECT to open'}
          </Text>
        </Billboard>
      )}

      {/* Once you exist, your name floats over your head */}
      {identity && (
        <Billboard ref={nameTag} position={[0, 1.8, -4]}>
          <Text
            fontSize={0.22}
            color="#fff7d6"
            outlineWidth={0.012}
            outlineColor="#1a1a2e"
            anchorX="center"
            anchorY="middle"
          >
            {identity.displayName}
          </Text>
        </Billboard>
      )}

      {/* The player: a capsule with eyes, so which way it faces is visible.
          It spawns just outside the dressing room, facing the lobby — which
          puts its own room exactly at its back. */}
      <group ref={player} position={[0, 0, -4]}>
        <mesh castShadow position={[0, 0.65, 0]}>
          <capsuleGeometry args={[PLAYER_RADIUS, 0.6, 8, 16]} />
          <meshStandardMaterial color="#d95926" />
        </mesh>
        <mesh position={[-0.13, 0.95, 0.28]}>
          <sphereGeometry args={[0.07, 12, 12]} />
          <meshStandardMaterial color="#1a1a2e" />
        </mesh>
        <mesh position={[0.13, 0.95, 0.28]}>
          <sphereGeometry args={[0.07, 12, 12]} />
          <meshStandardMaterial color="#1a1a2e" />
        </mesh>
      </group>
    </>
  )
}
