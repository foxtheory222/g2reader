import { describe, expect, it } from 'vitest'
import { classifyInput, routeInput } from './input'

describe('routeInput', () => {
  it('routes a sysEvent with omitted eventType as a click', () => {
    expect(routeInput({ sysEvent: { eventSource: 1 } })).toBe('next')
  })

  it('routes text scroll top to previous and scroll bottom to next', () => {
    expect(routeInput({ textEvent: { eventType: 1 } })).toBe('prev')
    expect(routeInput({ textEvent: { eventType: 2 } })).toBe('next')
  })

  it('routes double-click from either supported envelope to exit', () => {
    expect(routeInput({ sysEvent: { eventType: 3 } })).toBe('exit')
    expect(routeInput({ textEvent: { eventType: 3 } })).toBe('exit')
  })

  it('ignores empty events, including a bare textEvent', () => {
    expect(routeInput({})).toBeNull()
    expect(routeInput({ textEvent: {} })).toBeNull()
  })

  it('ignores unknown event types', () => {
    expect(routeInput({ sysEvent: { eventType: 99 } })).toBeNull()
    expect(routeInput({ textEvent: { eventType: 99 } })).toBeNull()
  })
})

describe('classifyInput', () => {
  it.each([4, 5, 6, 7, 8])('prioritizes sys lifecycle type %s over every co-enveloped user action', type => {
    for (const textType of [1, 2, 3]) {
      expect(classifyInput({ sysEvent: { eventType: type }, textEvent: { eventType: textType } })).toEqual({
        kind: 'lifecycle',
        type,
      })
    }
  })

  it.each([
    [{}, null],
    [{ textEvent: {} }, null],
    [{ sysEvent: {} }, 'next'],
    [{ sysEvent: { eventType: 0 } }, 'next'],
    [{ sysEvent: { eventSource: 1 }, textEvent: { eventType: 1 } }, 'prev'],
    [{ textEvent: { eventType: 2 } }, 'next'],
    [{ textEvent: { eventType: 3 } }, 'exit'],
  ] as const)('classifies absent, omitted-zero, and explicit user envelope %#', (event, action) => {
    expect(classifyInput(event)).toEqual(action === null ? { kind: 'none' } : { kind: 'user', action })
  })
})
