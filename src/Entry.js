/**
 * The gates of the lobby: the same photographic sky the ascension rose
 * through — continuity, not a cartoon backdrop — and one card asking for
 * an email, docking in from deep sky.
 */
import { useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { HeavenSky } from './heaven'
import './heaven.css'

// The sky keeps breathing: a slow pan across the photographic clouds.
const SkyDrift = () => {
  const { camera } = useThree()
  useFrame(({ clock }) => {
    const t = clock.elapsedTime * 0.02
    camera.lookAt(Math.sin(t) * 10, 3 + Math.cos(t * 0.7) * 2, -12)
  })
  return null
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export const Entry = ({ onEnter }) => {
  const [email, setEmail] = useState('')
  const [touched, setTouched] = useState(false)
  // The card arrives like a craft reversing in to dock: flown in from
  // deep sky with a bank and a decelerating settle — then the hull doors
  // slide open to reveal the form.
  const [docked, setDocked] = useState(false)
  const valid = EMAIL_RE.test(email.trim())

  const submit = (e) => {
    e.preventDefault()
    setTouched(true)
    if (valid) onEnter(email.trim())
  }

  return (
    <div className="heaven">
      <div className="heaven-sky-canvas" aria-hidden="true">
        <Canvas camera={{ position: [0, 1.5, 0], fov: 68 }}>
          <HeavenSky file="heaven_clouds_1k.hdr" />
          <SkyDrift />
        </Canvas>
      </div>
      <form
        className={`heaven-card heaven-card-arrive${docked ? ' docked' : ''}`}
        onAnimationEnd={() => setDocked(true)}
        onSubmit={submit}
      >
        <div className={`card-doors${docked ? ' open' : ''}`} aria-hidden="true">
          <div className="card-door left" />
          <div className="card-door right" />
        </div>
        <h1>B1NGSTER</h1>
        <p>The cloud portal for heroes bound for Earth. Leave your email at the gate.</p>
        <input
          type="email"
          placeholder="you@somewhere.com"
          value={email}
          autoFocus
          onChange={(e) => setEmail(e.target.value)}
        />
        {touched && !valid && (
          <p className="heaven-error">That doesn't look like an email yet.</p>
        )}
        <button className="heaven-button" type="submit" disabled={touched && !valid}>
          ENTER THE CLOUDS
        </button>
      </form>
    </div>
  )
}
