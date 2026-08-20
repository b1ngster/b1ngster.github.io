/**
 * The gates of the lobby: a sky full of drifting CSS clouds and one card
 * asking for an email. Sits over everything while the heavy 3D assets
 * stream in the background, so the wait IS the welcome.
 */
import { useState } from 'react'
import './heaven.css'

// A fixed cast of clouds — deterministic sizes/lanes so the sky doesn't
// reshuffle on re-render.
const CLOUDS = [
  { top: '12%', size: 26, duration: 95, delay: -20 },
  { top: '25%', size: 38, duration: 130, delay: -75 },
  { top: '44%', size: 30, duration: 110, delay: -40 },
  { top: '60%', size: 44, duration: 150, delay: -110 },
  { top: '74%', size: 32, duration: 120, delay: -15 },
  { top: '85%', size: 50, duration: 170, delay: -90 },
]

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export const Entry = ({ onEnter }) => {
  const [email, setEmail] = useState('')
  const [touched, setTouched] = useState(false)
  const valid = EMAIL_RE.test(email.trim())

  const submit = (e) => {
    e.preventDefault()
    setTouched(true)
    if (valid) onEnter(email.trim())
  }

  return (
    <div className="heaven">
      {CLOUDS.map((c, i) => (
        <div
          key={i}
          className="heaven-cloud"
          style={{
            top: c.top,
            width: `${c.size}vmin`,
            height: `${c.size * 0.38}vmin`,
            animationDuration: `${c.duration}s`,
            animationDelay: `${c.delay}s`,
          }}
        />
      ))}
      <form className="heaven-card" onSubmit={submit}>
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
