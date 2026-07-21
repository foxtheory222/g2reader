import { describe, expect, it } from 'vitest'
import {
  importRefreshFailureMessage,
  importSuccessMessage,
  removalRefreshFailureMessage,
  removalSuccessMessage,
  startupStorageNotice,
} from './companion-status'

describe('companion storage status', () => {
  it('states session-only import and removal outcomes honestly', () => {
    expect(importSuccessMessage('Notes', 'session-only')).toBe('Imported Notes (this session only — storage unavailable).')
    expect(removalSuccessMessage('Notes', 'session-only')).toBe('Removed Notes for this session only — storage unavailable.')
    expect(importSuccessMessage('Notes', 'durable')).toBe('Imported Notes.')
  })

  it('surfaces a startup durable-read failure', () => {
    expect(startupStorageNotice({ durability: 'session-only', invalidRecordCount: 0 })).toMatch(/storage unavailable/i)
    expect(startupStorageNotice({ durability: 'durable', invalidRecordCount: 0 })).toBeNull()
  })

  it('reports filtered corrupt records distinctly from unavailable storage', () => {
    const notice = startupStorageNotice({ durability: 'durable', invalidRecordCount: 2 })
    expect(notice).toMatch(/2 stored book records were invalid/i)
    expect(notice).not.toMatch(/storage unavailable/i)
  })

  it('preserves committed import and removal outcomes when glasses refresh fails', () => {
    expect(importRefreshFailureMessage('Notes', 'durable')).toMatch(/saved — glasses refresh failed/i)
    expect(removalRefreshFailureMessage('Notes', 'durable')).toMatch(/saved — glasses refresh failed/i)
    expect(importRefreshFailureMessage('Notes', 'session-only')).toMatch(/session only.*storage unavailable/i)
  })
})
