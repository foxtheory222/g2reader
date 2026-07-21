import {
  DEFAULT_DENSITY,
  DEFAULT_PROGRESS_STYLE,
  DENSITY_PRESETS,
  PROGRESS_STYLES,
  type Density,
  type ProgressStyle,
} from './reader-ui'

export interface ReaderSettings {
  progressStyle: ProgressStyle
  density: Density
  lastActiveBookId: string | null
}

export interface SettingsStore {
  read(): ReaderSettings
  update(changes: Partial<ReaderSettings>): void
}

const SETTINGS_KEY = 'g2reader:settings'
const DEFAULT_SETTINGS: ReaderSettings = {
  progressStyle: DEFAULT_PROGRESS_STYLE,
  density: DEFAULT_DENSITY,
  lastActiveBookId: null,
}

function browserStorage(): Storage | null {
  try {
    return globalThis.localStorage
  } catch {
    return null
  }
}

function normalizeSettings(value: unknown): ReaderSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...DEFAULT_SETTINGS }
  const candidate = value as Partial<ReaderSettings>
  return {
    progressStyle: PROGRESS_STYLES.includes(candidate.progressStyle as ProgressStyle)
      ? candidate.progressStyle as ProgressStyle
      : DEFAULT_PROGRESS_STYLE,
    density: DENSITY_PRESETS.includes(candidate.density as Density)
      ? candidate.density as Density
      : DEFAULT_DENSITY,
    lastActiveBookId: typeof candidate.lastActiveBookId === 'string' && candidate.lastActiveBookId.length > 0
      ? candidate.lastActiveBookId
      : null,
  }
}

function parseSettings(raw: string | null): ReaderSettings {
  if (!raw) return { ...DEFAULT_SETTINGS }
  try {
    return normalizeSettings(JSON.parse(raw) as unknown)
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function createSettingsStore(storage?: Storage | null): SettingsStore {
  const durable = storage === undefined ? browserStorage() : storage
  let session: ReaderSettings | null = null

  function read(): ReaderSettings {
    if (session) return { ...session }
    let raw: string | null = null
    try {
      raw = durable?.getItem(SETTINGS_KEY) ?? null
    } catch {
      raw = null
    }
    session = parseSettings(raw)
    return { ...session }
  }

  return {
    read,
    update(changes) {
      session = normalizeSettings({ ...read(), ...changes })
      try {
        durable?.setItem(SETTINGS_KEY, JSON.stringify(session))
      } catch {
        // Session state remains authoritative if durable storage is denied or full.
      }
    },
  }
}
