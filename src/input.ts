import { OsEventTypeList } from '@evenrealities/even_hub_sdk'

export type InputAction = 'next' | 'prev' | 'exit' | null

interface EventEnvelope {
  eventType?: number
  eventSource?: number
}

export interface WireEvent {
  sysEvent?: EventEnvelope
  textEvent?: EventEnvelope
}

export type InputClassification =
  | { kind: 'lifecycle'; type: number }
  | { kind: 'user'; action: Exclude<InputAction, null> }
  | { kind: 'none' }

export function routeInput(event: WireEvent): InputAction {
  const sysType = event.sysEvent ? (event.sysEvent.eventType ?? OsEventTypeList.CLICK_EVENT) : null
  const textType = event.textEvent?.eventType ?? null

  if (sysType !== null && sysType >= OsEventTypeList.FOREGROUND_ENTER_EVENT && sysType <= OsEventTypeList.IMU_DATA_REPORT) {
    return null
  }

  if (sysType === OsEventTypeList.DOUBLE_CLICK_EVENT || textType === OsEventTypeList.DOUBLE_CLICK_EVENT) {
    return 'exit'
  }
  if (textType === OsEventTypeList.SCROLL_TOP_EVENT) return 'prev'
  if (textType === OsEventTypeList.SCROLL_BOTTOM_EVENT) return 'next'
  if (sysType === OsEventTypeList.CLICK_EVENT) return 'next'
  return null
}

export function classifyInput(event: WireEvent): InputClassification {
  const sysType = event.sysEvent ? (event.sysEvent.eventType ?? OsEventTypeList.CLICK_EVENT) : null
  if (sysType !== null && sysType >= OsEventTypeList.FOREGROUND_ENTER_EVENT && sysType <= OsEventTypeList.IMU_DATA_REPORT) {
    return { kind: 'lifecycle', type: sysType }
  }

  const action = routeInput(event)
  return action === null ? { kind: 'none' } : { kind: 'user', action }
}
