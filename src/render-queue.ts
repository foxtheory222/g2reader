export interface RenderJob<State> {
  readonly body: string
  readonly footer: string
  readonly state: State
}

interface RenderQueueOptions<State> {
  writeBody(content: string): Promise<boolean>
  writeFooter(content: string): Promise<boolean>
  onCommit(state: State): void
  timeoutMs?: number
}

export type RenderOutcome = 'committed' | 'superseded'

export interface RenderQueue<State> {
  readonly exitPending: boolean
  // Only the latest not-yet-started snapshot is retained. A replaced snapshot
  // resolves as superseded because no bridge write was attempted for it.
  render(job: RenderJob<State>): Promise<RenderOutcome>
  requestShutdown(shutdown: () => Promise<boolean>): Promise<void>
  confirmHostExit(): void
}

interface Deferred<T> {
  promise: Promise<T>
  resolve(value: T): void
  reject(reason: unknown): void
}

interface PendingRender<State> extends Deferred<RenderOutcome> {
  snapshot: RenderJob<State>
}

interface PendingShutdown extends Deferred<void> {
  operation: () => Promise<boolean>
}

type OperationResult<T> =
  | { status: 'fulfilled'; value: T }
  | { status: 'rejected'; reason: unknown }
  | { status: 'timed-out' }

const DEFAULT_TIMEOUT_MS = 10_000

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

async function settleOperation<T>(
  operation: () => Promise<T>,
  label: string,
  timeoutMs: number,
  onTimeout: (error: Error) => void,
): Promise<OperationResult<T>> {
  const underlying = Promise.resolve().then(operation)
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<{ status: 'timed-out' }>(resolve => {
    timer = setTimeout(() => resolve({ status: 'timed-out' }), timeoutMs)
  })
  const settlement: Promise<OperationResult<T>> = underlying.then(
    value => ({ status: 'fulfilled', value }),
    reason => ({ status: 'rejected', reason }),
  )
  const result = await Promise.race([settlement, timeout])
  if (timer !== undefined) clearTimeout(timer)

  if (result.status === 'timed-out') {
    onTimeout(new Error(`${label} timed out after ${timeoutMs}ms`))
    // The SDK operation cannot be cancelled. Keep the bridge lane occupied
    // until it really settles so a stale late write cannot follow a new page.
    await settlement
  }
  return result
}

function hostExitError() {
  return new Error('Bridge queue stopped after host exit')
}

export function createRenderQueue<State>(options: RenderQueueOptions<State>): RenderQueue<State> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  let pendingRender: PendingRender<State> | undefined
  let pendingShutdown: PendingShutdown | undefined
  let draining = false
  let pendingExit = false
  let hostExited = false

  function supersedePendingRender() {
    pendingRender?.resolve('superseded')
    pendingRender = undefined
  }

  function rejectPendingAfterHostExit() {
    const error = hostExitError()
    pendingRender?.reject(error)
    pendingRender = undefined
    pendingShutdown?.reject(error)
    pendingShutdown = undefined
  }

  async function runRender(task: PendingRender<State>) {
    if (hostExited) {
      task.reject(hostExitError())
      return
    }

    const bodyResult = await settleOperation(
      () => options.writeBody(task.snapshot.body),
      'body textContainerUpgrade',
      timeoutMs,
      error => task.reject(error),
    )
    if (bodyResult.status === 'timed-out') return
    if (bodyResult.status === 'rejected') {
      task.reject(bodyResult.reason)
      return
    }
    if (!bodyResult.value) {
      task.reject(new Error('body textContainerUpgrade returned false'))
      return
    }
    if (hostExited) {
      task.reject(hostExitError())
      return
    }

    const footerResult = await settleOperation(
      () => options.writeFooter(task.snapshot.footer),
      'footer textContainerUpgrade',
      timeoutMs,
      error => task.reject(error),
    )
    if (footerResult.status === 'timed-out') return
    if (footerResult.status === 'rejected') {
      task.reject(footerResult.reason)
      return
    }
    if (!footerResult.value) {
      task.reject(new Error('footer textContainerUpgrade returned false'))
      return
    }
    if (hostExited) {
      task.reject(hostExitError())
      return
    }

    try {
      options.onCommit(task.snapshot.state)
      task.resolve('committed')
    } catch (error) {
      task.reject(error)
    }
  }

  async function runShutdown(task: PendingShutdown) {
    if (hostExited) {
      task.reject(hostExitError())
      return
    }

    const result = await settleOperation(
      task.operation,
      'shutdown',
      timeoutMs,
      error => {
        task.reject(error)
      },
    )
    if (result.status === 'timed-out') {
      if (!hostExited) pendingExit = false
      return
    }
    if (result.status === 'rejected') {
      if (!hostExited) pendingExit = false
      task.reject(result.reason)
      return
    }
    if (!result.value) {
      if (!hostExited) pendingExit = false
      task.reject(new Error('shutdown returned false'))
      return
    }
    task.resolve()
  }

  async function drain() {
    while (!hostExited) {
      if (pendingShutdown) {
        const task = pendingShutdown
        pendingShutdown = undefined
        await runShutdown(task)
        continue
      }
      if (pendingRender) {
        const task = pendingRender
        pendingRender = undefined
        await runRender(task)
        continue
      }
      return
    }
    rejectPendingAfterHostExit()
  }

  function scheduleDrain() {
    if (draining) return
    draining = true
    void drain().finally(() => {
      draining = false
      if (hostExited) rejectPendingAfterHostExit()
      else if (pendingShutdown || pendingRender) scheduleDrain()
    })
  }

  return {
    get exitPending() {
      return pendingExit
    },

    render(job) {
      if (hostExited) return Promise.reject(hostExitError())
      if (pendingExit) return Promise.reject(new Error('Render suppressed while exit pending'))

      supersedePendingRender()
      const completion = deferred<RenderOutcome>()
      pendingRender = {
        ...completion,
        snapshot: { body: job.body, footer: job.footer, state: job.state },
      }
      scheduleDrain()
      return completion.promise
    },

    requestShutdown(shutdown) {
      if (hostExited) return Promise.reject(hostExitError())
      if (pendingExit) return Promise.reject(new Error('Shutdown already pending'))
      pendingExit = true
      supersedePendingRender()

      const completion = deferred<void>()
      pendingShutdown = { ...completion, operation: shutdown }
      scheduleDrain()
      return completion.promise
    },

    confirmHostExit() {
      hostExited = true
      pendingExit = true
      rejectPendingAfterHostExit()
    },
  }
}
