import React, { useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { EffectComposer, Bloom, Vignette, SMAA } from '@react-three/postprocessing'
import { Scene, MODEL_VERSION } from './Scene'
import { Controls } from './Controls'
import { SignUp } from './SignUp'
import { loadIdentity, saveIdentity } from './identity'
import { loadProfile, saveProfile, clearProfile } from './profile'
import { Entry } from './Entry'
import { Ascent } from './Ascent'
import { GenderGate } from './GenderGate'
import { BodyTune } from './BodyTune'
import { Descent } from './Descent'
import './App.css'
import './heaven.css'

// If the post-processing chain fails on some GPU, drop it and let R3F fall
// back to its plain render — an effect must never blank the page.
class FxBoundary extends React.Component {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    return this.state.failed ? null : this.props.children
  }
}

// Subtle chain: a bloom the gate glows and finials can reach, a gentle
// vignette, SMAA for the edges. (No SSAO — it was tuned for the dark
// wooden room, and it dithers ugly grain across the cloud sprites.)
const Effects = () => (
  <FxBoundary>
    <EffectComposer multisampling={0}>
      <Bloom luminanceThreshold={0.85} luminanceSmoothing={0.2} intensity={0.35} height={300} />
      <Vignette offset={0.25} darkness={0.32} />
      <SMAA />
    </EffectComposer>
  </FxBoundary>
)

function App() {
  // Who the player is — null until they sign up at the door to their room.
  const [identity, setIdentity] = useState(loadIdentity)
  const [signingUp, setSigningUp] = useState(false)
  // The heavenly onboarding: entry (email in the clouds) → gender (a door
  // to walk through) → body (ethnicity, height, weight) → descent (the run
  // to the lobby) → lobby. A returning soul with a saved profile lands
  // straight in the lobby.
  const [profile, setProfile] = useState(loadProfile)
  // ?lobby skips the onboarding, ?stage=body (etc.) jumps to one stage —
  // both for returning devs and headless probes.
  const [stage, setStage] = useState(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.has('lobby')) return 'lobby'
    const jump = params.get('stage')
    if (['ascent', 'entry', 'gender', 'body', 'descent'].includes(jump)) return jump
    return loadProfile() ? 'lobby' : 'ascent'
  })
  // A stage jump lands mid-flow, so the draft needs plausible earlier answers.
  const [draft, setDraft] = useState(() => {
    const params = new URLSearchParams(window.location.search)
    if (!params.get('stage')) return {}
    return { email: 'dev@local', gender: params.get('gender') || 'nonbinary' }
  })
  const [flash, setFlash] = useState(false)

  const finishSignUp = (newIdentity) => {
    saveIdentity(newIdentity)
    setIdentity(newIdentity)
    setSigningUp(false)
  }

  // The record carries the macro sliders plus gender — the gender slider
  // may have refined the door choice, so it overrides the draft's.
  const finishBody = (record) => {
    const full = { ...draft, ...record }
    saveProfile(full)
    setProfile(full)
    setStage('descent')
  }

  const arrive = () => {
    setFlash(true)
    setStage('lobby')
  }

  // Back to the very beginning: forget the shaped body and return to the
  // email gate. Identity (the dressing room name) is a separate record and
  // survives — resetting the journey doesn't un-sign you up.
  const startOver = () => {
    if (!window.confirm('Return to the clouds and start over? Your shaped body will be forgotten.')) return
    clearProfile()
    setProfile(null)
    setDraft({})
    setStage('ascent')
  }

  if (stage === 'ascent') {
    return (
      <div className="stage">
        <Ascent onArrive={() => setStage('entry')} />
      </div>
    )
  }
  if (stage === 'entry') {
    return (
      <Entry
        onEnter={(email) => {
          setDraft({ email })
          setStage('gender')
        }}
      />
    )
  }
  if (stage === 'gender') {
    return (
      <div className="stage">
        <GenderGate
          onPick={(gender) => {
            setDraft((d) => ({ ...d, gender }))
            setStage('body')
          }}
        />
      </div>
    )
  }
  if (stage === 'body') {
    return (
      <div className="stage">
        <BodyTune gender={draft.gender} modelVersion={MODEL_VERSION} onDone={finishBody} />
      </div>
    )
  }
  if (stage === 'descent') {
    return (
      <div className="stage">
        <Descent onArrive={arrive} />
      </div>
    )
  }

  return (
    <div className="stage">
      {/* ?capture keeps the drawing buffer readable so headless smoke tests
          can screenshot the canvas; it costs performance, so never default. */}
      <Canvas
        shadows="soft"
        camera={{ position: [0, 2.0, -0.6], fov: 60 }}
        gl={{
          preserveDrawingBuffer: new URLSearchParams(window.location.search).has('capture'),
          toneMappingExposure: 1.05,
        }}
      >
        <Scene identity={identity} onSignUp={() => setSigningUp(true)} profile={profile} />
        <Effects />
      </Canvas>
      {/* The white-out the descent lands in, fading to reveal the lobby */}
      {flash && <div className="heaven-flash" onAnimationEnd={() => setFlash(false)} />}
      {/* DOM overlays, not part of the Canvas: controls and forms live in HTML. */}
      <Controls />
      <button className="heaven-reset" onClick={startOver} title="Start over from the clouds">
        ↺ START OVER
      </button>
      {signingUp && (
        <SignUp onSubmit={finishSignUp} onCancel={() => setSigningUp(false)} />
      )}
    </div>
  )
}

export default App
