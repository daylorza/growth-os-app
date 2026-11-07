// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ConfirmButton, Drawer, ProgressBar } from './ui'

afterEach(cleanup)

it('requires inline confirmation and allows cancellation', () => {
  const action = vi.fn()
  render(<ConfirmButton message="Delete this item?" onConfirm={action}>Delete</ConfirmButton>)
  fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
  expect(screen.getByRole('alert').textContent).toContain('Delete this item?')
  expect(action).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(action).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
  expect(action).toHaveBeenCalledOnce()
})

it('does not confirm an action that became disabled while awaiting confirmation', () => {
  const action = vi.fn()
  const view = render(<ConfirmButton message="Continue?" onConfirm={action}>Act</ConfirmButton>)
  fireEvent.click(screen.getByRole('button', { name: 'Act' }))
  view.rerender(<ConfirmButton message="Continue?" onConfirm={action} disabled>Act</ConfirmButton>)
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
  expect(action).not.toHaveBeenCalled()
})

it('names the drawer, keeps keyboard focus inside it, and returns focus on close', () => {
  const onClose = vi.fn()
  const trigger = document.createElement('button')
  document.body.appendChild(trigger)
  trigger.focus()
  const view = render(<Drawer open title="Edit brief" onClose={onClose}><input aria-label="Title" /></Drawer>)
  const dialog = screen.getByRole('dialog', { name: 'Edit brief' })
  expect(document.activeElement).toBe(dialog)
  const close = screen.getByRole('button', { name: 'Close' })
  const input = screen.getByLabelText('Title')
  input.focus()
  fireEvent.keyDown(window, { key: 'Tab' })
  expect(document.activeElement).toBe(close)
  fireEvent.keyDown(window, { key: 'Tab', shiftKey: true })
  expect(document.activeElement).toBe(input)
  fireEvent.keyDown(window, { key: 'Escape' })
  expect(onClose).toHaveBeenCalledOnce()
  view.unmount()
  expect(document.activeElement).toBe(trigger)
  trigger.remove()
})

it('shows an unknown follower baseline as unknown, not as a zero-valued bar', () => {
  const view = render(<ProgressBar pct={null} label="Goal" />)
  expect(screen.queryByRole('progressbar')).toBeNull()
  expect(screen.getByRole('img', { name: 'Goal: unknown' })).toBeTruthy()
  view.rerender(<ProgressBar pct={0} label="Goal" />)
  const bar = screen.getByRole('progressbar', { name: 'Goal' })
  expect(bar.getAttribute('aria-valuenow')).toBe('0')
})
