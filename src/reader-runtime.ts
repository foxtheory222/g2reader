import type { PositionStore } from './position-store'
import type { Density, ProgressStyle } from './reader-ui'

export interface ConfirmedRenderSnapshot<State extends object> {
  readonly state: Readonly<State>
  readonly body: string
  readonly footer: string
  readonly bookId: string
  readonly pageIndex: number
  readonly pageCount: number
  readonly density: Density
  readonly progressStyle: ProgressStyle
}

export function createConfirmedRenderSnapshot<State extends object>(
  snapshot: ConfirmedRenderSnapshot<State>,
): ConfirmedRenderSnapshot<State> {
  return Object.freeze({
    ...snapshot,
    state: Object.freeze({ ...snapshot.state }),
  })
}

export function persistConfirmedPosition(positionStore: PositionStore) {
  return <State extends object>(snapshot: ConfirmedRenderSnapshot<State>) => {
    positionStore.save(
      snapshot.bookId,
      snapshot.pageIndex,
      snapshot.pageCount,
      snapshot.density,
    )
  }
}
