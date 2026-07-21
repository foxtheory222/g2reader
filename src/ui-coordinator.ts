import { createMutationQueue } from './mutation-queue'

export interface UiTransition {
  display(): Promise<void>
  commit(): void
  rollback(): void
}

export interface UiCoordinator {
  readonly pending: boolean
  runTransition(transition: UiTransition): Promise<void>
  runMutation<T>(operation: () => Promise<T>): Promise<T>
}

export function createUiCoordinator(onPendingChange: (pending: boolean) => void): UiCoordinator {
  const queue = createMutationQueue(onPendingChange)

  return {
    get pending() {
      return queue.pending
    },

    runTransition(transition) {
      return queue.enqueue(async () => {
        try {
          await transition.display()
          transition.commit()
        } catch (error) {
          transition.rollback()
          throw error
        }
      })
    },

    runMutation(operation) {
      return queue.enqueue(operation)
    },
  }
}
