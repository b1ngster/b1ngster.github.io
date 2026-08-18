// One mutable object shared between the DOM controls and the three.js frame
// loop. Deliberately not React state: movement is read sixty times a second
// inside useFrame, and a re-render per stick move would fight the render
// loop for no benefit. The controls write here; the Scene only reads.
//
// x/y are analog, -1..1, matching the thumb's position on the joystick:
// +x is right, +y is towards the camera. Magnitude is speed — a half-pushed
// stick walks, a pinned one runs.
export const input = {
  x: 0,
  y: 0,
  select: false,
  // Horizontal drag distance (in px) accumulated since the scene last
  // consumed it — dragging anywhere that isn't a control orbits the camera.
  // The scene reads it every frame and zeroes it.
  look: 0,
  // Zoom accumulated the same way: pinch spread (px) and wheel ticks both
  // land here. Positive brings the camera closer.
  zoom: 0,
}

// Keyboard equivalents, so the scene is playable on a desktop where an
// on-screen stick is a poor second to WASD. Keys are digital, so the axes
// they produce are simply -1, 0 or 1.
const KEYS = {
  ArrowUp: 'up',
  KeyW: 'up',
  ArrowDown: 'down',
  KeyS: 'down',
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
  Enter: 'select',
  KeyE: 'select',
  Space: 'select',
}

/** Wire the keyboard up; returns the cleanup for useEffect. */
export function attachKeyboard() {
  // Held direction keys, recomputed into axes on every change: holding A and
  // then tapping D must return to "left", not "stopped", when D lifts.
  const held = new Set()

  const applyHeld = () => {
    input.x = (held.has('right') ? 1 : 0) - (held.has('left') ? 1 : 0)
    input.y = (held.has('down') ? 1 : 0) - (held.has('up') ? 1 : 0)
  }

  const onKey = (down) => (event) => {
    const name = KEYS[event.code]
    if (!name) return
    // Typing in a form (the sign-up card) must stay typing: "w" belongs in
    // the username, Enter submits the form, and neither may steer the game.
    if (event.target.closest?.('input, textarea, select, [contenteditable]')) return
    // Arrows and Space scroll the page — and this page lives in an iframe on
    // the homepage, where a scrolling game is unplayable.
    event.preventDefault()

    if (name === 'select') {
      input.select = down
      return
    }
    if (down) held.add(name)
    else held.delete(name)
    applyHeld()
  }

  const keydown = onKey(true)
  const keyup = onKey(false)

  window.addEventListener('keydown', keydown)
  window.addEventListener('keyup', keyup)

  return () => {
    window.removeEventListener('keydown', keydown)
    window.removeEventListener('keyup', keyup)
  }
}
