import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { Billboard, ContactShadows, Text, useAnimations, useGLTF, useTexture } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { SkeletonUtils } from 'three-stdlib'
import { CloudField, SKY, HeavenSky } from './heaven'
import { input, attachKeyboard } from './input'
import midnightSun from './timing/midnightSun.json'
import { createSinger } from './faceScore'
import { modelUrlFor, applyBody, dominantEthnicity, stoopAngle } from './profile'

// Timing lifted straight from the "Midnight Sun" Renoise project: chord
// changes (accents) and bass note onsets (downbeats), in seconds. No audio
// plays — the room just grooves to the song's own rhythm on a silent loop,
// so a chord-change swell should feel bigger than a plain bass pulse.
const { duration: GROOVE_DURATION, beatPeriod: GROOVE_BEAT, accents: GROOVE_ACCENTS, downbeats: GROOVE_DOWNBEATS } = midnightSun

// Decaying pulse from whichever event (in `times`) most recently passed,
// wrapping around the loop point so the tail end of one pass blends into
// the next rather than snapping back to zero.
const pulseEnvelope = (times, t, tau, window) => {
  let best = 0
  for (let i = 0; i < times.length; i++) {
    let dt = t - times[i]
    if (dt < 0) dt += GROOVE_DURATION
    if (dt < window) {
      const e = Math.exp(-dt / tau)
      if (e > best) best = e
    }
  }
  return best
}

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

// MakeHuman characters, exported from the makehuman-web container via MPFB
// as textured GLBs. glTF convention puts their faces on +z, which is what
// the run code expects. The male is the player; the female is the
// receptionist behind the lobby desk.
// The GLB filenames are stable across deploys, so a version tag busts
// browser caches whenever a model is re-exported — bump it on every model
// change or clients keep their cached copy for however long they please.
export const MODEL_VERSION = 20
const MODEL_URL = `${process.env.PUBLIC_URL}/models/male.glb?v=${MODEL_VERSION}`
// The receptionist keeps her own copy of the viseme-carrying female —
// the player models are being replaced by morph-target rebuilds.
const RECEPTIONIST_URL = `${process.env.PUBLIC_URL}/models/female_reception.glb?v=${MODEL_VERSION}`

// The receptionist "sings" Midnight Sun. faceScore turns the Renoise
// project's own performance data — velocity, legato, octave doubles, the
// violins' vibrato LFO, phrase gaps, pan spread — into morph goals plus
// jaw and head-lean channels; this side only smooths them onto the rig.
const singFrame = (s, elapsed, dt) => {
  const dict = s.mesh.morphTargetDictionary
  const inf = s.mesh.morphTargetInfluences
  const g = s.singer.sample(elapsed, dt)

  for (const name in g) {
    const i = dict[name]
    if (i === undefined) continue // jaw/tilt aren't morphs; old GLBs lack some
    inf[i] = THREE.MathUtils.damp(inf[i], g[name], 18, dt)
  }

  if (s.jaw) {
    s.jawAngle = THREE.MathUtils.damp(s.jawAngle, g.jaw, 18, dt)
    s.jaw.quaternion.copy(s.jawRest)
    s.jaw.rotateX(s.jawAngle)
  }
  if (s.neck) {
    s.tilt = THREE.MathUtils.damp(s.tilt, g.tilt, 4, dt)
    s.neck.quaternion.copy(s.neckRest)
    s.neck.rotateZ(s.tilt)
  }
}

// `motion` is an optional ref holding the current pace (0..1). With one, the
// walk clip fades in and speeds up with movement; without one (or without
// clips in the GLB) the character just breathes through its idle loop.
// `sing` opts the character into the Midnight Sun face performance — it
// needs a GLB whose body mesh carries the vis_*/exp_* morph targets.
const Character = ({ url, motion, sing, body, onReady }) => {
  const { scene: template, animations } = useGLTF(url)
  // Clone the cached GLB (SkeletonUtils — plain clone() breaks skinning),
  // materials included, so the player and the receptionist can wear the
  // same GLB at once and a skin tint on one never bleeds onto the other.
  const scene = useMemo(() => {
    const c = SkeletonUtils.clone(template)
    c.traverse((o) => {
      if (o.isMesh && o.material) o.material = o.material.clone()
    })
    return c
  }, [template])
  // The heavenly onboarding's choices: skin tint, height, and weight.
  useEffect(() => {
    if (body) applyBody(scene, body)
  }, [scene, body])
  // Mounting means the GLB resolved (we render inside Suspense) — let the
  // intro crossfade know the real character is on stage.
  useEffect(() => { onReady?.() }, [onReady])
  // The clips key every bone's scale with static 1s, which would overwrite
  // applyBody's skeleton shaping every frame — strip all scale tracks. A
  // singer's jaw and head-lean bones likewise belong to singFrame alone:
  // strip their rest-pose tracks too. (On clones — useGLTF caches the
  // originals.)
  const clips = useMemo(() =>
    animations.map((clip) => {
      const c = clip.clone()
      c.tracks = c.tracks.filter((t) =>
        !t.name.endsWith('.scale') &&
        (!sing || (!t.name.startsWith('jaw.') && !t.name.startsWith('neck03.'))))
      return c
    }), [animations, sing])
  const { actions } = useAnimations(clips, scene)
  useMemo(() => {
    scene.traverse((obj) => {
      if (obj.isMesh) {
        obj.castShadow = true
        obj.receiveShadow = true
      }
    })
  }, [scene])

  const singState = useMemo(() => {
    if (!sing) return null
    let mesh = null
    scene.traverse((o) => {
      if (o.isMesh && o.morphTargetDictionary && 'vis_open' in o.morphTargetDictionary) {
        mesh = o
      }
    })
    if (!mesh) return null // old GLB without morphs: sway only, no singing
    const jaw = scene.getObjectByName('jaw')
    const neck = scene.getObjectByName('neck03')
    return {
      mesh,
      jaw,
      jawRest: jaw ? jaw.quaternion.clone() : null,
      jawAngle: 0,
      neck,
      neckRest: neck ? neck.quaternion.clone() : null,
      tilt: 0,
      singer: createSinger(midnightSun),
    }
  }, [scene, sing])

  useEffect(() => {
    actions.idle?.play()
    if (actions.walk) {
      actions.walk.setEffectiveWeight(0)
      actions.walk.play()
    }
  }, [actions])

  useFrame((state, delta) => {
    if (singState) {
      singFrame(singState, state.clock.elapsedTime, Math.min(delta, 0.05))
    }
    // The elder stoop, post-mixer: the clips rewrite every bone rotation
    // each frame, so the lean is layered back on top. Idempotent — the
    // mixer resets the quaternion before we rotate it.
    if (body) {
      const lean = stoopAngle(body.age ?? 0.5)
      if (lean > 0.001) {
        scene.getObjectByName('spine02')?.rotateX(lean)
        scene.getObjectByName('neck02')?.rotateX(-lean * 0.55)
      }
    }
    const walk = actions.walk
    if (!walk || !motion) return
    const dt = Math.min(delta, 0.05)
    const pace = motion.current
    // Ease the walk in and out rather than snapping at the first stick twitch.
    const weight = THREE.MathUtils.damp(
      walk.getEffectiveWeight(), pace > 0.05 ? 1 : 0, 8, dt)
    walk.setEffectiveWeight(weight)
    actions.idle?.setEffectiveWeight(1 - weight)
    // Stride pace follows run speed; never slower than a deliberate amble.
    walk.timeScale = 0.7 + 1.1 * pace
  })

  return <primitive object={scene} />
}
useGLTF.preload(MODEL_URL)
useGLTF.preload(RECEPTIONIST_URL)

// Crossfades the streaming stand-in into the real character instead of the
// old hard swap: the placeholder's stripes dissolve while the GLB fades up
// underneath. Fading needs `transparent`, which breaks the hair's alpha-
// masked sorting, so every material's original flags are restored the
// moment the fade lands.
const setGroupOpacity = (root, k, done) => {
  root.traverse((o) => {
    if (!o.isMesh || !o.material) return
    const m = o.material
    if (m.userData.introFlags === undefined) {
      m.userData.introFlags = { transparent: m.transparent, opacity: m.opacity }
    }
    if (done) {
      m.transparent = m.userData.introFlags.transparent
      m.opacity = m.userData.introFlags.opacity
    } else {
      m.transparent = true
      m.opacity = k
    }
  })
}

const CharacterWithIntro = ({ url, motion, sing, body }) => {
  const model = useRef()
  const ready = useRef(false)
  const fade = useRef(0)

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05)
    fade.current = THREE.MathUtils.damp(fade.current, ready.current ? 1 : 0, 5, dt)
    const k = fade.current
    if (model.current) setGroupOpacity(model.current, k, k > 0.995)
  })

  return (
    <Suspense fallback={null}>
      <group ref={model}>
        <Character
          url={url} motion={motion} sing={sing} body={body}
          onReady={() => { ready.current = true }}
        />
      </group>
    </Suspense>
  )
}

// If the GLB fails to load (offline, blocked, corrupted), show nothing
// rather than letting the error unmount the whole canvas.
class CharacterBoundary extends React.Component {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    return this.state.failed ? null : this.props.children
  }
}

const ROOM_HW = 9 // half-width of the room, along x
const ROOM_HD = 7 // half-depth, along z
const WALL_H = 4

const PLAYER_RADIUS = 0.35
const RUN_SPEED = 3 // at full stick deflection; the stick's magnitude scales it

const DOOR_W = 2
const DOOR_H = 2.6
const NEAR_DISTANCE = 2.6 // close enough for Select to reach the door

// The wall around each doorway: a segment either side plus a lintel above,
// leaving a real gap the door slides across. sideW spans the back wall's
// x, sideD the left wall's z.
const sideW = ROOM_HW - DOOR_W / 2
const sideD = ROOM_HD - DOOR_W / 2

// Solid furniture the player runs into, not through: axis-aligned footprints
// as [centreX, centreZ, halfX, halfZ].
const COLLIDERS = [
  [5.5, -4.5, 1.6, 0.6], // reception desk
  [5.5, -5.6, 0.35, 0.35], // the receptionist behind it
  [-8.2, -6.2, 0.5, 0.5], // plant, far corner
  [8.2, 6.2, 0.5, 0.5], // plant, near corner
]

// --- Room surfaces: CC0 PBR texture sets, self-hosted under public/ ------
// (never a runtime CDN — an unreachable third-party host once blanked the
// whole site on iPad). Loaded through Suspense with the flat-colour shell
// as both loading fallback and error fallback, so a failed fetch degrades
// to the old look instead of unmounting the canvas.
const TEX = (name) => `${process.env.PUBLIC_URL}/textures/${name}.webp`
const ROOM_TEXTURES = {
  deskDiff: TEX('marble_01_diff'),
  deskNor: TEX('marble_01_nor_gl'),
  deskRough: TEX('marble_01_rough'),
}
const TEXTURE_REPEATS = { desk: [1.5, 1] }

const useRoomMaps = () => {
  const maps = useTexture(ROOM_TEXTURES)
  return useMemo(() => {
    for (const key in maps) {
      const t = maps[key]
      const [rx, ry] = TEXTURE_REPEATS[key.replace(/Diff|Nor|Rough/, '')]
      t.wrapS = t.wrapT = THREE.RepeatWrapping
      t.repeat.set(rx, ry)
      t.anisotropy = 4
      if (key.endsWith('Diff')) t.encoding = THREE.sRGBEncoding
    }
    return maps
  }, [maps])
}

// A surface material: full PBR when the maps are in, plain tinted colour
// when they are not (loading, or failed). The tint multiplies the map, so
// the room keeps its palette either way.
const SurfaceMaterial = ({ maps, base, color, roughness, normalScale = 0.7 }) =>
  maps ? (
    <meshStandardMaterial
      map={maps[base + 'Diff']}
      normalMap={maps[base + 'Nor']}
      roughnessMap={maps[base + 'Rough']}
      normalScale={[normalScale, normalScale]}
      color={color}
      envMapIntensity={0.3}
    />
  ) : (
    <meshStandardMaterial color={color} roughness={roughness ?? 0.9} envMapIntensity={0.3} />
  )

class AssetBoundary extends React.Component {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

// Everything static about the god-lobby: a cloud floor open to the sky —
// no walls, no ceiling — with a golden halo where the rug used to lie, a
// marble-and-gold reception desk, gilded planters, and banks of cloud
// where walls once stood. Dynamic pieces (the gates, signage, prompts)
// stay in Scene.
const RoomShell = ({ maps }) => (
  <>
    {/* the cloud floor, edges dissolving into the banks beyond */}
    <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[ROOM_HW * 2 + 16, ROOM_HD * 2 + 16]} />
      <meshStandardMaterial color="#f2f7fd" roughness={1} />
    </mesh>
    {/* a golden halo inlaid in the cloud, where the rug used to lie */}
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
      <ringGeometry args={[2.2, 2.6, 48]} />
      <meshStandardMaterial color="#e8c05a" metalness={0.5} roughness={0.35} />
    </mesh>

    {/* Reception, in god-lobby white marble under a golden counter */}
    <group position={[5.5, 0, -4.5]}>
      <mesh castShadow position={[0, 0.5, 0]}>
        <boxGeometry args={[3, 1, 1]} />
        <SurfaceMaterial maps={maps} base="desk" color="#ffffff" roughness={0.35} />
      </mesh>
      <mesh castShadow position={[0, 1.02, 0]}>
        <boxGeometry args={[3.2, 0.08, 1.2]} />
        <meshStandardMaterial color="#e8c05a" metalness={0.5} roughness={0.3} />
      </mesh>
    </group>
    {/* Planters, gilded (footprints mirrored in COLLIDERS) */}
    {[[-8.2, -6.2], [8.2, 6.2]].map(([x, z]) => (
      <group key={`${x},${z}`} position={[x, 0, z]}>
        <mesh castShadow position={[0, 0.25, 0]}>
          <cylinderGeometry args={[0.32, 0.26, 0.5, 12]} />
          <meshStandardMaterial color="#d9bd7a" metalness={0.45} roughness={0.35} />
        </mesh>
        <mesh castShadow position={[0, 0.85, 0]}>
          <sphereGeometry args={[0.45, 12, 12]} />
          <meshStandardMaterial color="#3fae6a" roughness={0.9} />
        </mesh>
      </group>
    ))}

    {/* Where walls once stood: banks of cloud ringing the floor */}
    <CloudField count={24} center={[0, 1.4, ROOM_HD + 3]} spread={[ROOM_HW * 2 + 10, 2.6, 4]} opacity={0.9} drift={0.25} />
    <CloudField count={24} center={[0, 1.4, -(ROOM_HD + 3)]} spread={[ROOM_HW * 2 + 10, 2.6, 4]} opacity={0.9} drift={0.25} />
    <CloudField count={18} center={[ROOM_HW + 3, 1.4, 0]} spread={[4, 2.6, ROOM_HD * 2 + 8]} opacity={0.9} drift={0.2} />
    <CloudField count={18} center={[-(ROOM_HW + 3), 1.4, 0]} spread={[4, 2.6, ROOM_HD * 2 + 8]} opacity={0.9} drift={0.2} />
    {/* low wisps sliding across the floor itself */}
    <CloudField count={12} center={[0, 0.3, 0]} spread={[ROOM_HW * 2, 0.4, ROOM_HD * 2]} scale={[2, 5]} opacity={0.3} drift={0.3} />
  </>
)

const TexturedRoomShell = () => <RoomShell maps={useRoomMaps()} />

// A heaven's gate: golden pillars and lintel crowned with a finial, pure
// light where a room's darkness used to be, and a leaf that swings open
// on its hinge. Local space faces +z; the caller positions and rotates.
const HeavensGate = ({ leafRef, near, accent }) => (
  <>
    <mesh position={[0, DOOR_H / 2 + 0.25, -0.45]}>
      <planeGeometry args={[DOOR_W + 1.6, DOOR_H + 1.4]} />
      <meshBasicMaterial color="#fff7dd" toneMapped={false} />
    </mesh>
    {[-1, 1].map((side) => (
      <mesh key={side} castShadow position={[side * (DOOR_W / 2 + 0.2), (DOOR_H + 0.4) / 2, 0]}>
        <boxGeometry args={[0.34, DOOR_H + 0.4, 0.34]} />
        <meshStandardMaterial color="#e8c05a" metalness={0.5} roughness={0.32} />
      </mesh>
    ))}
    <mesh castShadow position={[0, DOOR_H + 0.55, 0]}>
      <boxGeometry args={[DOOR_W + 1.0, 0.3, 0.34]} />
      <meshStandardMaterial color="#e8c05a" metalness={0.5} roughness={0.32} />
    </mesh>
    <mesh castShadow position={[0, DOOR_H + 0.9, 0]}>
      <sphereGeometry args={[0.22, 16, 16]} />
      <meshStandardMaterial color="#f4d98c" metalness={0.6} roughness={0.25} />
    </mesh>
    <group position={[-DOOR_W / 2, 0, 0.08]}>
      <group ref={leafRef}>
        <mesh castShadow position={[DOOR_W / 2, DOOR_H / 2, 0]}>
          <boxGeometry args={[DOOR_W, DOOR_H, 0.09]} />
          <meshStandardMaterial
            color="#f6f1e4"
            roughness={0.45}
            emissive={near ? accent : '#000000'}
            emissiveIntensity={0.35}
          />
        </mesh>
      </group>
    </group>
  </>
)

export const Scene = ({ identity, onSignUp, profile }) => {
  // The onboarding decided who runs around this lobby: their door
  // (gender) picks the GLB, their sliders tint and scale it.
  const playerUrl = profile
    ? modelUrlFor(profile.gender, MODEL_VERSION, dominantEthnicity(profile))
    : MODEL_URL
  // The whole profile is the body record — applyBody reads the macro
  // slider fields and ignores the rest.
  const playerBody = profile
  const player = useRef()
  const door = useRef()
  const nameTag = useRef()
  const receptionist = useRef()
  const lamp = useRef()

  const selectWasDown = useRef(false)
  const hadIdentity = useRef(Boolean(identity))
  // Camera azimuth around the player, driven by drag-to-look. Zero is the
  // spawn framing: camera on +z, looking at the far wall.
  const yaw = useRef(0)
  // Camera distance, driven by pinch/wheel. 3.4 is the spawn framing.
  const camDist = useRef(3.4)
  // Current movement pace, shared with the player Character so its walk
  // cycle can follow — a ref, because it changes sixty times a second.
  const paceRef = useRef(0)

  const [doorOpen, setDoorOpen] = useState(false)
  const [nearDoor, setNearDoor] = useState(false)
  // The activity room, off the left wall: no identity gate, Select just
  // opens it.
  const actDoor = useRef()
  const [actDoorOpen, setActDoorOpen] = useState(false)
  const [nearActDoor, setNearActDoor] = useState(false)
  // The hair salon, off the right wall — heroes arrive bald; hair is
  // earned in the chair. No gate, Select just opens it.
  const salonDoor = useRef()
  const [salonOpen, setSalonOpen] = useState(false)
  const [nearSalon, setNearSalon] = useState(false)

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

    // --- Looking -------------------------------------------------------
    // Drags accumulate in input.look between frames; consume and zero it.
    // Dragging right spins the room to the right, OrbitControls-style.
    yaw.current -= input.look * 0.006
    input.look = 0
    const sy = Math.sin(yaw.current)
    const cy = Math.cos(yaw.current)

    // Pinch/wheel zoom, clamped between a close-up and most of the room.
    camDist.current = THREE.MathUtils.clamp(
      camDist.current - input.zoom * 0.01, 1.6, 6.5)
    input.zoom = 0

    // --- Running -------------------------------------------------------
    // The stick is analog: its direction steers, its deflection sets the
    // pace. Length can exceed 1 when keyboard diagonals stack, so cap it.
    // Axes are camera-relative — up always runs away from the camera, no
    // matter where the camera has been dragged — so rotate them by yaw.
    const move = scratch.move.set(
      input.x * cy + input.y * sy,
      0,
      -input.x * sy + input.y * cy
    )
    const pace = Math.min(move.length(), 1)
    paceRef.current = pace

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

    // --- The doors, only within arm's reach ----------------------------
    const doorDistance = Math.hypot(body.position.x, body.position.z + ROOM_HD)
    const near = doorDistance < NEAR_DISTANCE
    if (near !== nearDoor) setNearDoor(near)
    const actDistance = Math.hypot(body.position.x + ROOM_HW, body.position.z)
    const nearAct = actDistance < NEAR_DISTANCE
    if (nearAct !== nearActDoor) setNearActDoor(nearAct)
    const salonDistance = Math.hypot(body.position.x - ROOM_HW, body.position.z)
    const nearSal = salonDistance < NEAR_DISTANCE
    if (nearSal !== nearSalon) setNearSalon(nearSal)

    if (input.select && !selectWasDown.current) {
      if (near) {
        // No identity yet: the door stays shut and Select hands you the
        // sign-up card instead. The door opens when the form comes back filled.
        if (identity) setDoorOpen((open) => !open)
        else onSignUp()
      } else if (nearAct) {
        setActDoorOpen((open) => !open)
      } else if (nearSal) {
        setSalonOpen((open) => !open)
      }
    }
    selectWasDown.current = input.select

    // Swing, don't snap: heaven's gates ease open on their hinges.
    door.current.rotation.y = THREE.MathUtils.damp(
      door.current.rotation.y, doorOpen ? -1.9 : 0, 6, dt)
    if (actDoor.current) {
      actDoor.current.rotation.y = THREE.MathUtils.damp(
        actDoor.current.rotation.y, actDoorOpen ? -1.9 : 0, 6, dt)
    }
    if (salonDoor.current) {
      salonDoor.current.rotation.y = THREE.MathUtils.damp(
        salonDoor.current.rotation.y, salonOpen ? -1.9 : 0, 6, dt)
    }

    // --- Third-person camera -------------------------------------------
    // A shoulder offset that orbits only when dragged, never with the
    // player's facing: the stick then always means what it shows (up runs
    // away from the camera). The walls the camera ends up behind are
    // single-sided planes facing inward, so it sees straight through them
    // into the room. The offset is deliberately tight — the character
    // should fill the frame rather than read as a speck in the room.
    // The camera rides lower when close (an over-the-shoulder framing) and
    // higher when pulled back, staying under the 4m ceiling.
    const dist = camDist.current
    const height = THREE.MathUtils.clamp(0.6 + 0.42 * dist, 1.3, 3.2)
    const goal = scratch.camera.set(
      body.position.x + dist * sy,
      body.position.y + height,
      body.position.z + dist * cy
    )
    state.camera.position.lerp(goal, 1 - Math.pow(0.0005, dt))
    state.camera.lookAt(body.position.x, body.position.y + 1.2, body.position.z)

    // The name tag rides above the player but lives outside the player group:
    // a Billboard inside a rotating parent would inherit the run direction.
    // The male model stands 1.70m, so the tag sits at 2.05 to clear his head.
    if (nameTag.current) {
      nameTag.current.position.set(body.position.x, 2.05, body.position.z)
    }

    // --- The room's silent groove, ghosted from the song's own rhythm ---
    const loopT = state.clock.elapsedTime % GROOVE_DURATION
    const beatPhase = ((loopT % GROOVE_BEAT) / GROOVE_BEAT) * Math.PI * 2
    const accentEnv = pulseEnvelope(GROOVE_ACCENTS, loopT, 0.55, 2.2)
    const downbeatEnv = pulseEnvelope(GROOVE_DOWNBEATS, loopT, 0.18, 0.6)

    if (receptionist.current) {
      // Groove, not pogo: a hint of lift on accents and a slow sway. The
      // per-beat vertical sin read as odd full-body bouncing at 2.5Hz.
      // 32 whole sway cycles per loop keeps the phase continuous at the wrap.
      const swayPhase = (loopT / GROOVE_DURATION) * Math.PI * 2 * 32
      receptionist.current.position.y = accentEnv * 0.008
      receptionist.current.rotation.y = Math.sin(swayPhase) * 0.02 + accentEnv * 0.03
    }
    if (lamp.current) {
      lamp.current.intensity = 0.9 + downbeatEnv * 0.12 + accentEnv * 0.28
    }
  })

  return (
    <>
      <color attach="background" args={[SKY.top]} />
      {/* The real sky over the god-lobby: HDR background + lighting */}
      <HeavenSky />
      <ambientLight intensity={0.22} />
      {/* The key: a warm ceiling spot, the only shadow-caster one room can
          afford. A spot rather than a bare point so light falls off toward
          the walls the way a real fixture's does. */}
      <spotLight
        ref={lamp}
        castShadow
        position={[0, WALL_H - 0.4, 0]}
        angle={1.15}
        penumbra={0.65}
        intensity={1.1}
        distance={26}
        color="#fff2e0"
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
      />
      {/* A cool, dim fill from the front-left so shadowed sides read as
          bounce light rather than dropping to flat ambient grey. */}
      <directionalLight position={[-6, 3, 5]} intensity={0.18} color="#c8d4e8" />
      <pointLight position={[5.5, WALL_H - 1, -4]} intensity={0.35} distance={10} color="#ffe9c4" />
      {/* Soft blob shadows pooled under the characters and furniture —
          grounding is the cheapest single realism win a scene can buy. */}
      <ContactShadows
        position={[0, 0.015, -2]}
        scale={18}
        far={2.2}
        blur={2.4}
        opacity={0.45}
        resolution={256}
        frames={Infinity}
      />

      {/* --- The room shell, textured when the maps arrive --------------- */}
      <AssetBoundary fallback={<RoomShell maps={null} />}>
        <Suspense fallback={<RoomShell maps={null} />}>
          <TexturedRoomShell />
        </Suspense>
      </AssetBoundary>

      {/* --- The activity room gate --------------------------------------- */}
      <group position={[-ROOM_HW, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
        <HeavensGate leafRef={actDoor} near={nearActDoor} accent="#2f9d5c" />
        <Text position={[0, DOOR_H + 0.55, 0.21]} fontSize={0.2} color="#d6ffe8" outlineWidth={0.008} outlineColor="#1a2e1a" anchorX="center" anchorY="middle">
          ACTIVITY ROOM
        </Text>
      </group>
      {/* The prompt, floating by the gate once you are within reach */}
      {nearActDoor && (
        <Billboard position={[-ROOM_HW + 0.6, DOOR_H + 0.5, 0]}>
          <Text
            fontSize={0.24}
            color="#d6ffe8"
            outlineWidth={0.012}
            outlineColor="#1a2e1a"
            anchorX="center"
            anchorY="middle"
          >
            {actDoorOpen ? 'SELECT to close' : 'SELECT to open'}
          </Text>
        </Billboard>
      )}

      {/* --- The hair salon gate ------------------------------------------ */}
      <group position={[ROOM_HW, 0, 0]} rotation={[0, -Math.PI / 2, 0]}>
        <HeavensGate leafRef={salonDoor} near={nearSalon} accent="#d0568e" />
        <Text position={[0, DOOR_H + 0.55, 0.21]} fontSize={0.2} color="#ffe0ef" outlineWidth={0.008} outlineColor="#3a1a2c" anchorX="center" anchorY="middle">
          HAIR SALON
        </Text>
      </group>
      {/* The prompt, floating by the gate once you are within reach */}
      {nearSalon && (
        <Billboard position={[ROOM_HW - 0.6, DOOR_H + 0.5, 0]}>
          <Text
            fontSize={0.24}
            color="#ffe0ef"
            outlineWidth={0.012}
            outlineColor="#3a1a2c"
            anchorX="center"
            anchorY="middle"
          >
            {salonOpen ? 'SELECT to close' : 'SELECT to open'}
          </Text>
        </Billboard>
      )}

      {/* --- The dressing room gate --------------------------------------- */}
      <group position={[0, 0, -ROOM_HD]}>
        <HeavensGate leafRef={door} near={nearDoor} accent="#2f6fd8" />
        <Text position={[0, DOOR_H + 0.55, 0.21]} fontSize={0.18} color="#fff7d6" outlineWidth={0.008} outlineColor="#1a1a2e" anchorX="center" anchorY="middle">
          {identity ? `${identity.displayName}'s dressing room` : 'DRESSING ROOM'}
        </Text>
      </group>

      {/* The lobby's sign, floating in the sky above the gate */}
      <Text
        position={[0, 4.5, -ROOM_HD + 0.06]}
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
        position={[0, 4.05, -ROOM_HD + 0.06]}
        fontSize={0.2}
        color="#e8b83a"
        anchorX="center"
        anchorY="middle"
      >
        — THE LOBBY —
      </Text>

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
        <Billboard ref={nameTag} position={[0, 2.05, -4]}>
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

      {/* The player: the MakeHuman male character, swapped in for the
          primitive stand-in once its 8.5MB GLB has streamed. It spawns
          just outside the dressing room, facing the lobby — which puts its
          own room exactly at its back. */}
      <group ref={player} position={[0, 0, -4]}>
        <CharacterBoundary>
          <CharacterWithIntro url={playerUrl} motion={paceRef} body={playerBody} />
        </CharacterBoundary>
      </group>

      {/* The receptionist, standing behind the desk facing the room. The
          stand-in holds her spot while her GLB streams, so the desk never
          looks unstaffed. */}
      <group ref={receptionist} position={[5.5, 0, -5.6]}>
        <CharacterBoundary>
          <CharacterWithIntro url={RECEPTIONIST_URL} sing />
        </CharacterBoundary>
      </group>
    </>
  )
}

