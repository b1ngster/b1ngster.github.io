import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { Billboard, Text, useAnimations, useGLTF } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment'
import { input, attachKeyboard } from './input'
import midnightSun from './timing/midnightSun.json'
import { createSinger } from './faceScore'

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
const MODEL_VERSION = 13
const MODEL_URL = `${process.env.PUBLIC_URL}/models/male.glb?v=${MODEL_VERSION}`
const RECEPTIONIST_URL = `${process.env.PUBLIC_URL}/models/female.glb?v=${MODEL_VERSION}`

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
const Character = ({ url, motion, sing, onReady }) => {
  const { scene, animations } = useGLTF(url)
  // Mounting means the GLB resolved (we render inside Suspense) — let the
  // intro crossfade know the real character is on stage.
  useEffect(() => { onReady?.() }, [onReady])
  // A singer's jaw and head-lean bones belong to singFrame alone: the idle
  // clip keys every bone, so its rest-pose tracks would fight the sung
  // motion within each frame. Strip them (on clones — useGLTF caches the
  // originals).
  const clips = useMemo(() => {
    if (!sing) return animations
    return animations.map((clip) => {
      const c = clip.clone()
      c.tracks = c.tracks.filter(
        (t) => !t.name.startsWith('jaw.') && !t.name.startsWith('neck03.'))
      return c
    })
  }, [animations, sing])
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

const CharacterWithIntro = ({ url, motion, sing }) => {
  const placeholder = useRef()
  const model = useRef()
  const ready = useRef(false)
  const fade = useRef(0)

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05)
    fade.current = THREE.MathUtils.damp(fade.current, ready.current ? 1 : 0, 5, dt)
    const k = fade.current
    const settled = k > 0.995
    if (placeholder.current) {
      placeholder.current.visible = !settled
      if (!settled) setGroupOpacity(placeholder.current, 1 - k, false)
    }
    if (model.current) setGroupOpacity(model.current, k, settled)
  })

  return (
    <>
      <group ref={placeholder}>
        <PlaceholderFigure />
      </group>
      <Suspense fallback={null}>
        <group ref={model}>
          <Character
            url={url} motion={motion} sing={sing}
            onReady={() => { ready.current = true }}
          />
        </group>
      </Suspense>
    </>
  )
}

// If the GLB fails to load (offline, blocked, corrupted), fall back to the
// placeholder instead of letting the error unmount the whole canvas.
class CharacterBoundary extends React.Component {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    return this.state.failed ? <PlaceholderFigure /> : this.props.children
  }
}

// Image-based lighting built on the GPU at startup — no network fetch, so
// nothing here can fail and blank the page (which is exactly what happened
// with a CDN-hosted HDR on iPad).
const RoomLighting = () => {
  const gl = useThree((state) => state.gl)
  const scene = useThree((state) => state.scene)

  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl)
    const envMap = pmrem.fromScene(new RoomEnvironment()).texture
    scene.environment = envMap
    return () => {
      scene.environment = null
      envMap.dispose()
      pmrem.dispose()
    }
  }, [gl, scene])

  return null
}

const ROOM_HW = 9 // half-width of the room, along x
const ROOM_HD = 7 // half-depth, along z
const WALL_H = 4

const PLAYER_RADIUS = 0.35
const RUN_SPEED = 3 // at full stick deflection; the stick's magnitude scales it

const DOOR_W = 2
const DOOR_H = 2.6
const NEAR_DISTANCE = 2.6 // close enough for Select to reach the door

// Solid furniture the player runs into, not through: axis-aligned footprints
// as [centreX, centreZ, halfX, halfZ].
const COLLIDERS = [
  [5.5, -4.5, 1.6, 0.6], // reception desk
  [5.5, -5.6, 0.35, 0.35], // the receptionist behind it
  [-8.2, -6.2, 0.5, 0.5], // plant, far corner
  [8.2, 6.2, 0.5, 0.5], // plant, near corner
]

export const Scene = ({ identity, onSignUp }) => {
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

    if (input.select && !selectWasDown.current) {
      if (near) {
        // No identity yet: the door stays shut and Select hands you the
        // sign-up card instead. The door opens when the form comes back filled.
        if (identity) setDoorOpen((open) => !open)
        else onSignUp()
      } else if (nearAct) {
        setActDoorOpen((open) => !open)
      }
    }
    selectWasDown.current = input.select

    // Slide, don't snap: the doors ease sideways into their walls.
    door.current.position.x = THREE.MathUtils.damp(
      door.current.position.x, doorOpen ? DOOR_W + 0.15 : 0, 8, dt)
    if (actDoor.current) {
      actDoor.current.position.z = THREE.MathUtils.damp(
        actDoor.current.position.z, actDoorOpen ? DOOR_W + 0.15 : 0, 8, dt)
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

  // The wall around the doorway: a segment either side plus a lintel above,
  // leaving a real gap the door slides across. Same trick on the left wall
  // for the activity room, with depth taking width's place.
  const sideW = ROOM_HW - DOOR_W / 2
  const sideD = ROOM_HD - DOOR_W / 2

  return (
    <>
      <color attach="background" args={['#15181e']} />
      {/* Image-based lighting, so the character's skin and cloth pick up
          believable bounce light instead of flat lamp shading. */}
      <RoomLighting />
      <ambientLight intensity={0.35} />
      {/* The main ceiling lamp; the only shadow-caster, which one room can afford. */}
      <pointLight
        ref={lamp}
        castShadow
        position={[0, WALL_H - 0.6, 0]}
        intensity={0.9}
        distance={24}
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
      />
      <pointLight position={[5.5, WALL_H - 1, -4]} intensity={0.35} distance={10} color="#ffe9c4" />

      {/* --- The room shell: single-sided planes facing inward ---------- */}
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[ROOM_HW * 2, ROOM_HD * 2]} />
        <meshStandardMaterial color="#7a5c3e" envMapIntensity={0.3} />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, WALL_H, 0]}>
        <planeGeometry args={[ROOM_HW * 2, ROOM_HD * 2]} />
        <meshStandardMaterial color="#cfc8bc" envMapIntensity={0.3} />
      </mesh>

      {/* Back wall, in three pieces around the doorway */}
      <mesh receiveShadow position={[-(DOOR_W / 2 + sideW / 2), WALL_H / 2, -ROOM_HD]}>
        <planeGeometry args={[sideW, WALL_H]} />
        <meshStandardMaterial color="#9d8f7b" envMapIntensity={0.3} />
      </mesh>
      <mesh receiveShadow position={[DOOR_W / 2 + sideW / 2, WALL_H / 2, -ROOM_HD]}>
        <planeGeometry args={[sideW, WALL_H]} />
        <meshStandardMaterial color="#9d8f7b" envMapIntensity={0.3} />
      </mesh>
      <mesh receiveShadow position={[0, DOOR_H + (WALL_H - DOOR_H) / 2, -ROOM_HD]}>
        <planeGeometry args={[DOOR_W, WALL_H - DOOR_H]} />
        <meshStandardMaterial color="#9d8f7b" envMapIntensity={0.3} />
      </mesh>

      {/* Front and side walls */}
      <mesh rotation={[0, Math.PI, 0]} position={[0, WALL_H / 2, ROOM_HD]}>
        <planeGeometry args={[ROOM_HW * 2, WALL_H]} />
        <meshStandardMaterial color="#a89a85" envMapIntensity={0.3} />
      </mesh>
      {/* Left wall, in three pieces around the activity room doorway */}
      <mesh receiveShadow rotation={[0, Math.PI / 2, 0]} position={[-ROOM_HW, WALL_H / 2, -(DOOR_W / 2 + sideD / 2)]}>
        <planeGeometry args={[sideD, WALL_H]} />
        <meshStandardMaterial color="#a89a85" envMapIntensity={0.3} />
      </mesh>
      <mesh receiveShadow rotation={[0, Math.PI / 2, 0]} position={[-ROOM_HW, WALL_H / 2, DOOR_W / 2 + sideD / 2]}>
        <planeGeometry args={[sideD, WALL_H]} />
        <meshStandardMaterial color="#a89a85" envMapIntensity={0.3} />
      </mesh>
      <mesh receiveShadow rotation={[0, Math.PI / 2, 0]} position={[-ROOM_HW, DOOR_H + (WALL_H - DOOR_H) / 2, 0]}>
        <planeGeometry args={[DOOR_W, WALL_H - DOOR_H]} />
        <meshStandardMaterial color="#a89a85" envMapIntensity={0.3} />
      </mesh>
      <mesh receiveShadow rotation={[0, -Math.PI / 2, 0]} position={[ROOM_HW, WALL_H / 2, 0]}>
        <planeGeometry args={[ROOM_HD * 2, WALL_H]} />
        <meshStandardMaterial color="#a89a85" envMapIntensity={0.3} />
      </mesh>

      {/* --- The activity room door -------------------------------------- */}
      {/* The dark of the activity room, glimpsed through the gap when open */}
      <mesh rotation={[0, Math.PI / 2, 0]} position={[-ROOM_HW - 0.5, DOOR_H / 2, 0]}>
        <planeGeometry args={[DOOR_W + 1.2, DOOR_H + 0.6]} />
        <meshStandardMaterial color="#07080c" />
      </mesh>
      <Text
        rotation={[0, Math.PI / 2, 0]}
        position={[-ROOM_HW - 0.45, 1.5, 0]}
        fontSize={0.24}
        color="#5f8f6f"
        anchorX="center"
        anchorY="middle"
      >
        ACTIVITY ROOM
      </Text>
      {/* The door itself, just outside the wall so it can slide in behind it */}
      <mesh ref={actDoor} castShadow rotation={[0, Math.PI / 2, 0]} position={[-ROOM_HW - 0.12, DOOR_H / 2, 0]}>
        <boxGeometry args={[DOOR_W, DOOR_H, 0.1]} />
        <meshStandardMaterial
          color="#2f9d5c"
          emissive={nearActDoor ? '#2f9d5c' : '#000000'}
          emissiveIntensity={0.3}
        />
      </mesh>
      {/* The door's plate on the lobby side of the wall */}
      <Text
        rotation={[0, Math.PI / 2, 0]}
        position={[-ROOM_HW + 0.06, 2.78, 0]}
        fontSize={0.17}
        color="#d6ffe8"
        outlineWidth={0.008}
        outlineColor="#1a2e1a"
        anchorX="center"
        anchorY="middle"
      >
        ACTIVITY ROOM
      </Text>
      {/* The prompt, floating by the door once you are within reach */}
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
          <CharacterWithIntro url={MODEL_URL} motion={paceRef} />
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

// The stand-in shown while the GLB streams: a small figure in the enby
// flag's stripes, eyes marking which way it faces.
const PlaceholderFigure = () => (
  <>
    {/* Legs: the flag's black stripe */}
    <mesh castShadow position={[-0.12, 0.25, 0]}>
      <cylinderGeometry args={[0.09, 0.09, 0.5, 10]} />
      <meshStandardMaterial color="#2c2c2c" />
    </mesh>
    <mesh castShadow position={[0.12, 0.25, 0]}>
      <cylinderGeometry args={[0.09, 0.09, 0.5, 10]} />
      <meshStandardMaterial color="#2c2c2c" />
    </mesh>
    {/* Torso: purple, white, yellow stripes reading upward */}
    <mesh castShadow position={[0, 0.6, 0]}>
      <cylinderGeometry args={[0.27, 0.29, 0.22, 16]} />
      <meshStandardMaterial color="#9c59d1" />
    </mesh>
    <mesh castShadow position={[0, 0.81, 0]}>
      <cylinderGeometry args={[0.26, 0.27, 0.22, 16]} />
      <meshStandardMaterial color="#ffffff" />
    </mesh>
    <mesh castShadow position={[0, 1.02, 0]}>
      <cylinderGeometry args={[0.24, 0.26, 0.22, 16]} />
      <meshStandardMaterial color="#fcf434" />
    </mesh>
    {/* Arms, resting at the sides */}
    <mesh castShadow position={[-0.32, 0.82, 0]}>
      <capsuleGeometry args={[0.06, 0.34, 6, 10]} />
      <meshStandardMaterial color="#ffffff" />
    </mesh>
    <mesh castShadow position={[0.32, 0.82, 0]}>
      <capsuleGeometry args={[0.06, 0.34, 6, 10]} />
      <meshStandardMaterial color="#ffffff" />
    </mesh>
    {/* Head, with a short cropped haircut */}
    <mesh castShadow position={[0, 1.3, 0]}>
      <sphereGeometry args={[0.19, 16, 16]} />
      <meshStandardMaterial color="#e8b98a" />
    </mesh>
    <mesh castShadow position={[0, 1.36, -0.03]}>
      <sphereGeometry args={[0.2, 16, 16, 0, Math.PI * 2, 0, Math.PI * 0.55]} />
      <meshStandardMaterial color="#4a3626" />
    </mesh>
    <mesh position={[-0.07, 1.32, 0.16]}>
      <sphereGeometry args={[0.035, 10, 10]} />
      <meshStandardMaterial color="#1a1a2e" />
    </mesh>
    <mesh position={[0.07, 1.32, 0.16]}>
      <sphereGeometry args={[0.035, 10, 10]} />
      <meshStandardMaterial color="#1a1a2e" />
    </mesh>
  </>
)
