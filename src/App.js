import { useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { Scene } from './Scene'
import { Controls } from './Controls'
import { SignUp } from './SignUp'
import { loadIdentity, saveIdentity } from './identity'
import './App.css'

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
        }}
      >
        <Scene identity={identity} onSignUp={() => setSigningUp(true)} />
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
