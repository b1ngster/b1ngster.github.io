import { render, screen, fireEvent } from '@testing-library/react'
import { SignUp } from './SignUp'

/*
 * The sign-up card is the lock on the door to your room: the Scene opens the
 * door only when this form hands back a filled-in identity, so "no submit
 * until both names exist" is game logic, not just form polish.
 */

test('the door stays shut until both names are filled in', () => {
  render(<SignUp onSubmit={jest.fn()} onCancel={jest.fn()} />)
  const submit = screen.getByRole('button', { name: /open the door/i })

  expect(submit).toBeDisabled()

  fireEvent.change(screen.getByLabelText('Username'), {
    target: { value: 'b1ngster' },
  })
  expect(submit).toBeDisabled()

  fireEvent.change(screen.getByLabelText('Display name'), {
    target: { value: 'Bing' },
  })
  expect(submit).toBeEnabled()
})

test('whitespace alone does not count as a name', () => {
  render(<SignUp onSubmit={jest.fn()} onCancel={jest.fn()} />)

  fireEvent.change(screen.getByLabelText('Username'), {
    target: { value: '   ' },
  })
  fireEvent.change(screen.getByLabelText('Display name'), {
    target: { value: 'Bing' },
  })

  expect(screen.getByRole('button', { name: /open the door/i })).toBeDisabled()
})

test('submitting hands back the trimmed identity', () => {
  const onSubmit = jest.fn()
  render(<SignUp onSubmit={onSubmit} onCancel={jest.fn()} />)

  fireEvent.change(screen.getByLabelText('Username'), {
    target: { value: '  b1ngster ' },
  })
  fireEvent.change(screen.getByLabelText('Display name'), {
    target: { value: ' Bing ' },
  })
  fireEvent.click(screen.getByRole('button', { name: /open the door/i }))

  expect(onSubmit).toHaveBeenCalledWith({
    username: 'b1ngster',
    displayName: 'Bing',
  })
})

test('backing out signs nothing up', () => {
  const onSubmit = jest.fn()
  const onCancel = jest.fn()
  render(<SignUp onSubmit={onSubmit} onCancel={onCancel} />)

  fireEvent.click(screen.getByRole('button', { name: /not yet/i }))

  expect(onCancel).toHaveBeenCalled()
  expect(onSubmit).not.toHaveBeenCalled()
})
