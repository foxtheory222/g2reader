export interface LibraryRefreshDependencies<TSnapshot> {
  publishCompanion(snapshot: TSnapshot): void
  displayStructural(snapshot: TSnapshot): Promise<void>
  commitRouting(snapshot: TSnapshot): void
}

export interface LibraryRefreshCoordinator<TSnapshot> {
  readonly pending: boolean
  stage(snapshot: TSnapshot): Promise<void>
  retry(): Promise<boolean>
}

export function createLibraryRefreshCoordinator<TSnapshot>(
  dependencies: LibraryRefreshDependencies<TSnapshot>,
): LibraryRefreshCoordinator<TSnapshot> {
  let pendingSnapshot: TSnapshot | null = null

  async function retry(): Promise<boolean> {
    const candidate = pendingSnapshot
    if (candidate === null) return false
    await dependencies.displayStructural(candidate)
    if (pendingSnapshot !== candidate) return false
    dependencies.commitRouting(candidate)
    pendingSnapshot = null
    return true
  }

  return {
    get pending() {
      return pendingSnapshot !== null
    },

    async stage(snapshot) {
      pendingSnapshot = snapshot
      dependencies.publishCompanion(snapshot)
      await retry()
    },

    retry,
  }
}
