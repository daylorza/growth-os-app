// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { Drawer } from './ui'

afterEach(cleanup)

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
