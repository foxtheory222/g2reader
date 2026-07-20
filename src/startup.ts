interface StartupOptions {
  create(): Promise<number>
  subscribe(): () => void
  onReady(): void
  onFailed(reason: unknown): void
}

export async function initializeStartup(options: StartupOptions): Promise<(() => void) | null> {
  try {
    const result = await options.create()
    if (result !== 0) {
      options.onFailed(result)
      return null
    }

    const unsubscribe = options.subscribe()
    options.onReady()
    return unsubscribe
  } catch (error) {
    options.onFailed(error)
    return null
  }
}
