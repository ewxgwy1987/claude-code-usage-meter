export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

export type Snapshot = {
  contextTokens: number | null
  contextWindow: number
  contextPercent: number | null
  limits: Limit[]
  usd: number | null
}

export type Task = {
  startedAt: number
  startUsd: number | null
  startFiveHour: number | null
  tokens: number
  output: number
  requests: number
  isRunning: boolean
  usd: number | null
  fiveHourDelta: number | null
  durationMs: number
}

export type Reading = { at: number; limits: Limit[]; source: string }

export type TaskRecord = { tokens: number; usd: number | null; fiveHourDelta: number | null }

declare module 'claude-code' {
  interface PluginState {
    'usage-meter': {
      snapshot: Snapshot | null
      task: Task | null
      history: TaskRecord[]
      local: Reading | null
      shown: Reading | null
    }
  }
}
