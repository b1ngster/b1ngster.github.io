import { useRef } from 'react'
import { input } from './input'

/**
 * The on-screen controls: an analog joystick for the left thumb, Select for
 * the right. Plain absolutely-positioned DOM over the canvas — HTML already
 * knows how to be hit-tested and made round, none of which is worth
 * re-implementing in WebGL.
 */

// How far (in px) the knob may travel from the centre of the base. Also the
// divisor that turns a pixel offset into the -1..1 axes the Scene reads.
const STICK_RADIUS = 48

function Joystick() {
  const base = useRef()
  const knob = useRef()
  // The pointer currently steering the stick. Anything else touching the
  // base (a second finger, a palm) is ignored rather than yanking the knob.
  const activePointer = useRef(null)

  const steer = (event) => {
    const rect = base.current.getBoundingClientRect()
    let dx = event.clientX - (rect.left + rect.width / 2)
    let dy = event.clientY - (rect.top + rect.height / 2)

    // The thumb may wander outside the circle; the knob stays on its rim
    // and the axes stay at full deflection in that direction.
    const length = Math.hypot(dx, dy)
    if (length > STICK_RADIUS) {
      dx = (dx / length) * STICK_RADIUS
      dy = (dy / length) * STICK_RADIUS
    }

    // Move the knob by style, not state: this runs on every pointermove and
    // a React re-render per touch sample is exactly the churn input.js exists
    // to avoid.
    knob.current.style.transform = `translate(${dx}px, ${dy}px)`
    input.x = dx / STICK_RADIUS
    input.y = dy / STICK_RADIUS
  }

  const grab = (event) => {
    if (activePointer.current !== null) return
    activePointer.current = event.pointerId
    // Keep receiving this pointer even when the thumb drifts off the base —
    // losing the stick mid-run because a finger wandered feels like a broken
    // game. Allowed to fail: capture is an enhancement, and on a pointer the
    // browser considers inactive it throws.
    try {
      base.current.setPointerCapture?.(event.pointerId)
    } catch {
      /* the grab still counts */
    }
    steer(event)
  }

  const move = (event) => {
    if (event.pointerId !== activePointer.current) return
    steer(event)
  }

  const release = (event) => {
    if (event.pointerId !== activePointer.current) return
    activePointer.current = null
    // The stick is sprung: letting go stops the character.
    knob.current.style.transform = 'translate(0px, 0px)'
    input.x = 0
    input.y = 0
  }

  return (
    <div
      ref={base}
      className="joystick"
      role="slider"
      aria-label="move"
      // A slider's required value attributes, pinned to rest: the live value
      // is written straight to input.js, and an assistive-tech user steers
      // with WASD rather than by dragging a knob they cannot see.
      aria-valuemin={-1}
      aria-valuemax={1}
      aria-valuenow={0}
      onPointerDown={grab}
      onPointerMove={move}
      onPointerUp={release}
      onPointerCancel={release}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div ref={knob} className="joystick-knob" />
    </div>
  )
}

function SelectButton() {
  const press = (event) => {
    input.select = true
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId)
    } catch {
      /* the press still counts */
    }
  }

  const release = () => {
    input.select = false
  }

  return (
    <button
      type="button"
      className="round-button action-select"
      aria-label="select"
      onPointerDown={press}
      onPointerUp={release}
      onPointerCancel={release}
      onContextMenu={(event) => event.preventDefault()}
    >
      SELECT
    </button>
  )
}

export function Controls() {
  return (
    <div className="controls">
      <Joystick />
      <div className="actions">
        <SelectButton />
      </div>
    </div>
  )
}
