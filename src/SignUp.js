import { useState } from 'react'

/**
 * The sign-up card that guards the door to your room: a username and a
 * display name, and the door opens. Plain DOM over the canvas — text entry
 * wants the real keyboard, autocorrect and IME, none of which WebGL has.
 */
export function SignUp({ onSubmit, onCancel }) {
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')

  const ready = username.trim().length > 0 && displayName.trim().length > 0

  const submit = (event) => {
    // The card lives in the page; without this, submitting reloads the world.
    event.preventDefault()
    if (!ready) return
    onSubmit({ username: username.trim(), displayName: displayName.trim() })
  }

  return (
    <div className="signup-backdrop">
      <form className="signup" onSubmit={submit}>
        <h2>Your room awaits</h2>
        <p>Pick a name to hang on the door.</p>

        <label htmlFor="signup-username">Username</label>
        <input
          id="signup-username"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          maxLength={20}
          autoComplete="username"
          autoFocus
        />

        <label htmlFor="signup-displayname">Display name</label>
        <input
          id="signup-displayname"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          maxLength={24}
          autoComplete="nickname"
        />

        <div className="signup-buttons">
          <button type="button" className="signup-cancel" onClick={onCancel}>
            Not yet
          </button>
          <button type="submit" className="signup-submit" disabled={!ready}>
            Open the door
          </button>
        </div>
      </form>
    </div>
  )
}
