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

export interface RenderQueue<State> {
  readonly exitPending: boolean
  render(job: RenderJob<State>): Promise<void>
  requestShutdown(shutdown: () => Promise<boolean>): Promise<void>
  confirmHostExit(): void
}

const DEFAULT_TIMEOUT_MS = 10_000

function operationTimeout<T>(operation: Promise<T>, label: string, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs)
  })
  return Promise.race([operation, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer)
  })
}

export function createRenderQueue<State>(options: RenderQueueOptions<State>): RenderQueue<State> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  let tail: Promise<void> = Promise.resolve()
  let pendingExit = false
  let hostExited = false

  function enqueue(operation: () => Promise<void>): Promise<void> {
    const task = tail.then(operation)
    tail = task.then(() => undefined, () => undefined)
    return task
  }

  function assertActive() {
    if (hostExited) throw new Error('Bridge queue stopped after host exit')
  }

  return {
    get exitPending() {
      return pendingExit
    },

    render(job) {
      if (hostExited) return Promise.reject(new Error('Bridge queue stopped after host exit'))
      if (pendingExit) return Promise.reject(new Error('Render suppressed while exit pending'))
      const snapshot = { body: job.body, footer: job.footer, state: job.state }

      return enqueue(async () => {
        assertActive()
        const bodyWritten = await operationTimeout(
          options.writeBody(snapshot.body),
          'body textContainerUpgrade',
          timeoutMs,
        )
        if (!bodyWritten) throw new Error('body textContainerUpgrade returned false')

        assertActive()
        const footerWritten = await operationTimeout(
          options.writeFooter(snapshot.footer),
          'footer textContainerUpgrade',
          timeoutMs,
        )
        if (!footerWritten) throw new Error('footer textContainerUpgrade returned false')

        assertActive()
        options.onCommit(snapshot.state)
      })
    },

    requestShutdown(shutdown) {
      if (hostExited) return Promise.reject(new Error('Bridge queue stopped after host exit'))
      if (pendingExit) return Promise.reject(new Error('Shutdown already pending'))
      pendingExit = true

      const task = enqueue(async () => {
        assertActive()
        const accepted = await operationTimeout(shutdown(), 'shutdown', timeoutMs)
        if (!accepted) throw new Error('shutdown returned false')
      })
      return task.catch(error => {
        pendingExit = false
        throw error
      })
    },

    confirmHostExit() {
      hostExited = true
      pendingExit = true
    },
  }
}
