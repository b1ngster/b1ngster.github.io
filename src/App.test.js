import { render, screen, fireEvent } from '@testing-library/react'
import { Controls } from './Controls'
import { input } from './input'

/*
 * The Canvas needs WebGL, which jsdom does not have, so App as a whole is not
 * renderable here. The controls are plain DOM and the input object is plain
 * state, and between them they are the contract the scene runs on — a stick
 * that no longer writes its axes breaks the game with no console error at all.
 *
 * In jsdom every element's bounding rect is 0×0 at the origin, so the stick's
 * centre is (0, 0) and clientX/clientY are the thumb's offset from it
 * directly. The knob's travel radius is 48px.
 */

// jsdom has no PointerEvent constructor, and testing-library's fallback
// (a bare Event) drops clientX/clientY on the floor. A MouseEvent carrying a
// pointer event's type keeps the coordinates, and React dispatches it to the
// onPointer* handlers all the same.
const firePointer = (element, type, { pointerId = 1, x = 0, y = 0 } = {}) => {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
  })
  Object.defineProperty(event, 'pointerId', { value: pointerId })
  fireEvent(element, event)
}

afterEach(() => {
  input.x = 0
  input.y = 0
  input.select = false
})

test('the controls offer a joystick and select', () => {
  render(<Controls />)

  expect(screen.getByRole('slider', { name: 'move' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'select' })).toBeInTheDocument()
})

test('the stick mirrors the thumb, scaled to -1..1', () => {
  render(<Controls />)
  const stick = screen.getByRole('slider', { name: 'move' })

  firePointer(stick, 'pointerdown', { pointerId: 1, x: 24, y: 0 })
  expect(input.x).toBeCloseTo(0.5)
  expect(input.y).toBeCloseTo(0)

  firePointer(stick, 'pointermove', { pointerId: 1, x: 0, y: -48 })
  expect(input.x).toBeCloseTo(0)
  expect(input.y).toBeCloseTo(-1)
})

test('a thumb outside the circle pins the stick to its rim', () => {
  render(<Controls />)
  const stick = screen.getByRole('slider', { name: 'move' })

  firePointer(stick, 'pointerdown', { pointerId: 1, x: 300, y: 300 })
  expect(Math.hypot(input.x, input.y)).toBeCloseTo(1)
})

test('letting go springs the stick back to centre', () => {
  render(<Controls />)
  const stick = screen.getByRole('slider', { name: 'move' })

  firePointer(stick, 'pointerdown', { pointerId: 1, x: 48, y: 0 })
  firePointer(stick, 'pointerup', { pointerId: 1 })

  expect(input.x).toBe(0)
  expect(input.y).toBe(0)
})

test('a cancelled touch does not leave the character running', () => {
  render(<Controls />)
  const stick = screen.getByRole('slider', { name: 'move' })

  firePointer(stick, 'pointerdown', { pointerId: 1, x: 48, y: 0 })
  // The system stealing the pointer (notification shade, palm rejection)
  // fires pointercancel, never pointerup.
  firePointer(stick, 'pointercancel', { pointerId: 1 })

  expect(input.x).toBe(0)
  expect(input.y).toBe(0)
})

test('a second finger cannot yank the stick from the first', () => {
  render(<Controls />)
  const stick = screen.getByRole('slider', { name: 'move' })

  firePointer(stick, 'pointerdown', { pointerId: 1, x: 48, y: 0 })
  firePointer(stick, 'pointerdown', { pointerId: 2, x: -48, y: 0 })
  expect(input.x).toBeCloseTo(1)

  // Nor can lifting it release the stick the first finger still holds.
  firePointer(stick, 'pointerup', { pointerId: 2 })
  expect(input.x).toBeCloseTo(1)
})

test('holding select holds its flag, releasing clears it', () => {
  render(<Controls />)
  const select = screen.getByRole('button', { name: 'select' })

  firePointer(select, 'pointerdown')
  expect(input.select).toBe(true)

  firePointer(select, 'pointerup')
  expect(input.select).toBe(false)
})

test('the stick and select work at the same time', () => {
  render(<Controls />)

  firePointer(screen.getByRole('slider', { name: 'move' }), 'pointerdown', {
    pointerId: 1,
    x: 0,
    y: -48,
  })
  firePointer(screen.getByRole('button', { name: 'select' }), 'pointerdown', {
    pointerId: 2,
  })

  expect(input.y).toBeCloseTo(-1)
  expect(input.select).toBe(true)
})
