import React, { useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { EffectComposer, SSAO, Bloom, Vignette, SMAA } from '@react-three/postprocessing'
import { Scene } from './Scene'
import { Controls } from './Controls'
import { SignUp } from './SignUp'
import { loadIdentity, saveIdentity } from './identity'
import './App.css'

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

// Subtle chain: contact-scale ambient occlusion, a bloom only the lamp and
// emissive door glows can reach, a gentle vignette, SMAA for the edges.
const Effects = () => (
  <FxBoundary>
    <EffectComposer multisampling={0}>
      <SSAO samples={12} radius={0.1} intensity={16} luminanceInfluence={0.6} />
      <Bloom luminanceThreshold={0.85} luminanceSmoothing={0.2} intensity={0.35} height={300} />
      <Vignette offset={0.25} darkness={0.5} />
      <SMAA />
    </EffectComposer>
  </FxBoundary>
)

function App() {
  // Who the player is — null until they sign up at the door to their room.
  const [identity, setIdentity] = useState(loadIdentity)
  const [signingUp, setSigningUp] = useState(false)

  const finishSignUp = (newIdentity) => {
    saveIdentity(newIdentity)
    setIdentity(newIdentity)
    setSigningUp(false)
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
        <Scene identity={identity} onSignUp={() => setSigningUp(true)} />
        <Effects />
      </Canvas>
      {/* DOM overlays, not part of the Canvas: controls and forms live in HTML. */}
      <Controls />
      {signingUp && (
        <SignUp onSubmit={finishSignUp} onCancel={() => setSigningUp(false)} />
      )}
    </div>
  )
}

export default App
