export interface MutationQueue {
  readonly pending: boolean
  enqueue<T>(operation: () => Promise<T>): Promise<T>
}

export function createMutationQueue(onPendingChange: (pending: boolean) => void): MutationQueue {
  let lane: Promise<unknown> = Promise.resolve()
  let pendingCount = 0

  return {
    get pending() {
      return pendingCount > 0
    },
    enqueue<T>(operation: () => Promise<T>) {
      pendingCount += 1
      if (pendingCount === 1) onPendingChange(true)
      const next = lane.then(operation, operation)
      lane = next.then(() => undefined, () => undefined)
      return next.finally(() => {
        pendingCount -= 1
        if (pendingCount === 0) onPendingChange(false)
      })
    },
  }
}
