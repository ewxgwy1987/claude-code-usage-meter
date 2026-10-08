import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelUsage, Register, RenderSurface, SessionMeasureInput } from 'claude-code'

import type { Limit, Reading, Snapshot, Task, TaskRecord } from '../types'

const snapshotAtom = atom({ plugin: 'usage-meter', key: 'snapshot' } as const, null)
const taskAtom = atom({ plugin: 'usage-meter', key: 'task' } as const, null)
const historyAtom = atom({ plugin: 'usage-meter', key: 'history' } as const, [])
const localAtom = atom({ plugin: 'usage-meter', key: 'local' } as const, null)
const shownAtom = atom({ plugin: 'usage-meter', key: 'shown' } as const, null)

const HISTORY_SIZE = 20
const STORE_KEY = 'limits'
const TICK_MS = 60_000

export const SHARING_NOTE =
  'Plan limits update when any Claude Code window on this computer gets a model reply; usage from other computers shows up after your next message here.'

let stopTick: (() => void) | null = null

type Measured = Pick<SessionMeasureInput, 'context' | 'rateLimits' | 'cost'>

const toSnapshot = (u: Measured): Snapshot => ({
  contextTokens: u.context.tokens ?? null,
  contextWindow: u.context.window,
  contextPercent: u.context.percent ?? null,
  limits: u.rateLimits.map(r => ({ kind: r.kind, percentUsed: r.percentUsed, resetsAt: r.resetsAt })),
  usd: u.cost?.usd ?? null,
})

const limitsKey = (ls: Limit[]) =>
  JSON.stringify([...ls].sort((a, b) => a.kind.localeCompare(b.kind)).map(l => [l.kind, l.percentUsed, l.resetsAt ?? null]))

export const sameLimits = (a: Limit[], b: Limit[]) => limitsKey(a) === limitsKey(b)

const isLimit = (v: unknown): v is Limit => {
  if (typeof v !== 'object' || v === null) return false
  const l = v as Record<string, unknown>
  return typeof l.kind === 'string' && typeof l.percentUsed === 'number' && (l.resetsAt === undefined || typeof l.resetsAt === 'string')
}

export const parseReading = (v: unknown): Reading | null => {
  if (typeof v !== 'object' || v === null) return null
  const r = v as Record<string, unknown>
  if (typeof r.at !== 'number' || typeof r.source !== 'string' || !Array.isArray(r.limits)) return null
  const limits = r.limits.filter(isLimit)
  if (limits.length === 0) return null
  return { at: r.at, source: r.source, limits: limits.map(l => ({ kind: l.kind, percentUsed: l.percentUsed, resetsAt: l.resetsAt })) }
}

export const newest = (current: Reading | null, ...candidates: (Reading | null)[]) =>
  candidates.reduce<Reading | null>((best, r) => (r && (!best || r.at > best.at) ? r : best), current)

export const sourceOf = (surfaces: readonly RenderSurface[]) =>
  surfaces[0] === 'terminal' ? 'CLI' : surfaces.includes('desktop') ? 'app' : (surfaces[0] ?? 'headless')

const pad2 = (n: number) => `${n}`.padStart(2, '0')

export const fmtClock = (ms: number) => {
  const d = new Date(ms)
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
}

const asOf = (r: Reading) => `as of ${fmtClock(r.at)} (${r.source})`

const viewOf = (snap: Snapshot, shown: Reading | null): Snapshot => (shown ? { ...snap, limits: shown.limits } : snap)

const totalTokens = (u: ModelUsage) =>
  u.input_tokens + u.output_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens

const fiveHour = (s: Snapshot | null) => s?.limits.find(l => l.kind === 'five_hour')?.percentUsed ?? null

export const fmtTokens = (n: number) => {
  if (n < 1000) return `${Math.round(n)}`
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}K`
  return `${(n / 1_000_000).toFixed(2)}M`
}

const fmtUsd = (n: number) => `$${n < 1 ? n.toFixed(3) : n.toFixed(2)}`

const fmtDuration = (ms: number) => {
  const minutes = Math.max(0, Math.round(ms / 60_000))
  const d = Math.floor(minutes / 1440)
  const h = Math.floor((minutes % 1440) / 60)
  const m = minutes % 60
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

const limitLabel = (kind: string) =>
  ({ five_hour: '5h', seven_day: '7d', seven_day_opus: '7d Opus', seven_day_sonnet: '7d Sonnet', spend_limit: 'Spend' })[kind] ??
  kind.replace(/_/g, ' ')

const levelColor = (pct: number) => (pct >= 90 ? 'red' : pct >= 70 ? 'yellow' : 'green')

export const bar = (pct: number, width: number) => {
  const filled = Math.round((Math.min(100, Math.max(0, pct)) / 100) * width)
  return { filled: '█'.repeat(filled), empty: '░'.repeat(width - filled) }
}

const barText = (pct: number, width: number) => {
  const b = bar(pct, width)
  return b.filled + b.empty
}

export type Estimate = { tasks: number; avgTokens: number; avgUsd: number | null; avgFiveHour: number | null }

export const estimate = (history: TaskRecord[]): Estimate | null => {
  const done = history.filter(h => h.tokens > 0)
  if (done.length === 0) return null
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
  return {
    tasks: done.length,
    avgTokens: avg(done.map(h => h.tokens)) ?? 0,
    avgUsd: avg(done.flatMap(h => (h.usd === null ? [] : [h.usd]))),
    avgFiveHour: avg(done.flatMap(h => (h.fiveHourDelta === null ? [] : [h.fiveHourDelta]))),
  }
}

const limitLine = (l: Limit, now: number) => {
  const left = Math.max(0, 100 - l.percentUsed)
  const reset = l.resetsAt ? `, resets in ${fmtDuration(Date.parse(l.resetsAt) - now)}` : ''
  return `${limitLabel(l.kind)} ${l.percentUsed}% used (${left.toFixed(0)}% left${reset})`
}

const tasksLeft = (snap: Snapshot | null, est: Estimate | null) => {
  const used = fiveHour(snap)
  if (used === null || !est?.avgFiveHour || est.avgFiveHour <= 0) return null
  return Math.floor(Math.max(0, 100 - used) / est.avgFiveHour)
}

const taskLine = (task: Task | null, snap: Snapshot | null, est: Estimate | null) => {
  if (!task) return 'Task: no task yet; estimates appear after the first one'
  const liveUsd = task.isRunning
    ? snap?.usd != null && task.startUsd != null
      ? snap.usd - task.startUsd
      : null
    : task.usd
  const parts = [
    `${fmtTokens(task.tokens)} tok (out ${fmtTokens(task.output)}, ${task.requests} req)`,
    ...(liveUsd != null ? [fmtUsd(liveUsd)] : []),
  ]
  if (task.isRunning) {
    if (est) {
      const projected = Math.max(task.tokens, est.avgTokens)
      const usd = est.avgUsd != null ? ` / ${fmtUsd(Math.max(liveUsd ?? 0, est.avgUsd))}` : ''
      parts.push(`est. total ~${fmtTokens(projected)}${usd} (avg of ${est.tasks})`)
    }
    return `Task running: ${parts.join(' · ')}`
  }
  if (task.fiveHourDelta != null) parts.push(`5h +${task.fiveHourDelta.toFixed(1)}%`)
  const left = tasksLeft(snap, est)
  if (left !== null) parts.push(`~${left} more such tasks fit in the 5h window`)
  return `Last task: ${parts.join(' · ')}`
}

const sessionLine = (snap: Snapshot) => {
  const ctx =
    snap.contextTokens != null
      ? `Context (this window) ${snap.contextPercent ?? 0}% (${fmtTokens(snap.contextTokens)} / ${fmtTokens(snap.contextWindow)})`
      : `Context (this window): ${fmtTokens(snap.contextWindow)} window`
  const cost = snap.usd != null ? `Session ${fmtUsd(snap.usd)}` : 'Session cost n/a'
  return `${cost} · ${ctx}`
}

const sourceLabel = async ($: EngineInterface) => {
  try {
    return sourceOf(await $.session.surfaces())
  } catch {
    return sourceOf([])
  }
}

const readStored = async ($: EngineInterface) => {
  try {
    return parseReading(await $.store.get(STORE_KEY))
  } catch {
    return null
  }
}

const publish = async ($: EngineInterface, reading: Reading) => {
  try {
    const stored = await readStored($)
    if (stored && stored.at >= reading.at) return
    await $.store.set(STORE_KEY, reading)
  } catch {}
}

const show = ($: EngineInterface, ...candidates: (Reading | null)[]) =>
  update($, shownAtom, current => newest(current ?? null, ...candidates))

const observe = async ($: EngineInterface, limits: Limit[], isFresh: boolean) => {
  if (limits.length === 0) return
  const prev = await read($, localAtom)
  if (!isFresh && prev && sameLimits(prev.limits, limits)) return
  const reading: Reading = { at: await $.clock.now(), limits, source: await sourceLabel($) }
  await update($, localAtom, () => reading)
  await publish($, reading)
  await show($, reading)
}

const refresh = async ($: EngineInterface) => {
  const snap = toSnapshot(await $.session.usage())
  await update($, snapshotAtom, () => snap)
  await observe($, snap.limits, false)
  await show($, await readStored($))
  return snap
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'usage-meter',
      description: 'Plan usage, remaining limits, session cost and task token estimates',
      immediate: true,
    })
    await refresh($)
    stopTick?.()
    const timer = $.clock.every(TICK_MS, () => {
      refresh($).catch(() => {})
    })
    stopTick = () => timer.cancel()
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    const snap = toSnapshot(e)
    await update($, snapshotAtom, () => snap)
    await observe($, snap.limits, e.changed.includes('rateLimits') || e.changed.includes('context'))
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    const usage = await $.session.usage()
    const snap = toSnapshot(usage)
    await update($, snapshotAtom, () => snap)
    const task: Task = {
      startedAt: await $.clock.now(),
      startUsd: snap.usd,
      startFiveHour: fiveHour(snap),
      tokens: 0,
      output: 0,
      requests: 0,
      isRunning: true,
      usd: null,
      fiveHourDelta: null,
      durationMs: 0,
    }
    await update($, taskAtom, () => task)
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    const usage = result.usage
    if (usage) {
      await update($, taskAtom, t =>
        t?.isRunning
          ? { ...t, tokens: t.tokens + totalTokens(usage), output: t.output + usage.output_tokens, requests: t.requests + 1 }
          : t,
      )
    }
    return result
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId) return next(e)
    const snap = toSnapshot(await $.session.usage())
    await update($, snapshotAtom, () => snap)
    await observe($, snap.limits, false)
    const now = await $.clock.now()
    const finished = await update($, taskAtom, t => {
      if (!t?.isRunning) return t
      const tokens = t.tokens === 0 && e.usage ? totalTokens(e.usage) : t.tokens
      const output = t.output === 0 && e.usage ? e.usage.output_tokens : t.output
      const endFiveHour = fiveHour(snap)
      const delta = endFiveHour !== null && t.startFiveHour !== null ? endFiveHour - t.startFiveHour : null
      return {
        ...t,
        tokens,
        output,
        isRunning: false,
        usd: snap.usd != null && t.startUsd != null ? snap.usd - t.startUsd : null,
        fiveHourDelta: delta !== null && delta >= 0 ? delta : null,
        durationMs: now - t.startedAt,
      }
    })
    if (finished && !finished.isRunning && finished.tokens > 0 && !e.isAborted) {
      const record: TaskRecord = { tokens: finished.tokens, usd: finished.usd, fiveHourDelta: finished.fiveHourDelta }
      await update($, historyAtom, h => [...h, record].slice(-HISTORY_SIZE))
    }
    return next(e)
  })

  on('command.run', { command: 'usage-meter' }, async $ => {
    const snap = await refresh($)
    const shown = await read($, shownAtom)
    const view = viewOf(snap, shown)
    const task = await read($, taskAtom)
    const history = await read($, historyAtom)
    const est = estimate(history)
    const now = await $.clock.now()
    const age = shown ? (now - shown.at < 60_000 ? 'just now' : `${fmtDuration(now - shown.at)} ago`) : ''
    const lines = [shown ? `Plan usage · ${asOf(shown)}, ${age}` : 'Plan usage']
    if (view.limits.length === 0) {
      lines.push('  No plan rate limits reported (API-key billing, or no response yet).')
      lines.push('  A prepaid credit balance is not exposed to Claude Code; check the Console billing page.')
    } else {
      for (const l of view.limits) lines.push(`  ${barText(l.percentUsed, 20)} ${limitLine(l, now)}`)
    }
    lines.push('', sessionLine(snap), taskLine(task, view, est))
    if (est) {
      const usd = est.avgUsd != null ? `, ${fmtUsd(est.avgUsd)}` : ''
      const pct = est.avgFiveHour != null ? `, ${est.avgFiveHour.toFixed(1)}% of 5h window` : ''
      lines.push(`Average task (last ${est.tasks}): ~${fmtTokens(est.avgTokens)} tok${usd}${pct}`)
    }
    lines.push('', SHARING_NOTE)
    return { text: lines.join('\n') }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const snap = await read($, snapshotAtom)
    if (e.props.hasSurvey || !snap) return next(e)

    const shown = await read($, shownAtom)
    const view = viewOf(snap, shown)
    const task = await read($, taskAtom)
    const est = estimate(await read($, historyAtom))
    const { Box, Text } = $.ui.resolve(e)
    const now = await $.clock.now()

    const width = Math.min(30, Math.max(10, e.props.bodyColumns - 50))

    const meter = (key: string, label: string, pct: number, color: string, detail: string) => {
      const b = bar(pct, width)
      return (
        <Box key={key}>
          <Text dimColor>{label.padEnd(9)}</Text>
          <Text color={color}>{b.filled}</Text>
          <Text dimColor>{b.empty}</Text>
          <Text color={color} bold>
            {` ${Math.round(pct)}%`.padStart(5)}
          </Text>
          <Text dimColor> {detail}</Text>
        </Box>
      )
    }

    const rows = view.limits.length
      ? view.limits.map((l, i) => {
          const left = Math.max(0, 100 - l.percentUsed).toFixed(0)
          const reset = l.resetsAt ? ` · resets in ${fmtDuration(Date.parse(l.resetsAt) - now)}` : ''
          const note = i === 0 && shown ? ` · ${asOf(shown)}` : ''
          return meter(`limit-${l.kind}`, limitLabel(l.kind), l.percentUsed, levelColor(l.percentUsed), `${left}% left${reset}${note}`)
        })
      : [
          <Box key="plan">
            <Text dimColor>{'Plan'.padEnd(9)}no rate limits reported (API billing; credit balance not exposed)</Text>
          </Box>,
        ]

    if (snap.contextTokens != null) {
      const pct = snap.contextPercent ?? 0
      rows.push(meter('context', 'Context', pct, levelColor(pct), `${fmtTokens(snap.contextTokens)} / ${fmtTokens(snap.contextWindow)} · this window`))
    }

    const cost = snap.usd != null ? `Session ${fmtUsd(snap.usd)}` : 'Session cost n/a'
    if (task?.isRunning && est) {
      const ratio = (task.tokens / est.avgTokens) * 100
      const color = ratio > 100 ? 'red' : ratio >= 80 ? 'yellow' : 'cyan'
      rows.push(meter('task', 'Task', ratio, color, `${fmtTokens(task.tokens)} / ~${fmtTokens(est.avgTokens)} tok est. (avg of ${est.tasks})`))
      rows.push(
        <Box key="footer">
          <Text dimColor>{cost}</Text>
        </Box>,
      )
    } else {
      rows.push(
        <Box key="footer">
          <Text dimColor={!task?.isRunning} color={task?.isRunning ? 'cyan' : undefined}>
            {`${cost} · ${taskLine(task, view, est)}`}
          </Text>
        </Box>,
      )
    }

    return <Box flexDirection="column">{rows.slice(0, Math.max(1, e.props.maxRows))}</Box>
  })
}
