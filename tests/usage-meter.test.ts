import { expect, mock, test } from 'claude-code/testing'
import type { On, SessionUsage } from 'claude-code'

import { bar, fmtClock, SHARING_NOTE } from '../hooks/register'

const usage = { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'claude-opus-5-5' }

const RUN = {
  command: 'usage-meter',
  args: '',
  origin: { kind: 'composer' },
  presentation: { isFullscreen: false, columns: 120 },
} as const

const fakeEngine = (on: On, state: { fiveHour: number; usd: number }) => {
  mock.clock(on)
  on('session.usage', (): { value: SessionUsage } => ({ value: {
    startedAt: 0,
    context: { tokens: 42_000, window: 200_000, percent: 21 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: state.fiveHour },
      { kind: 'seven_day', percentUsed: 5 },
    ],
    cost: { usd: state.usd },
  } }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
}

test('a finished task is recorded, then the next task shows an estimate', async ($, on) => {
  const state = { fiveHour: 40, usd: 0.1 }
  fakeEngine(on, state)

  await $.turn.start({ text: 'first', turnId: 't1' })
  state.fiveHour = 42
  state.usd = 0.15
  await $.turn.complete({ answer: 'done', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer', usage })

  const after = await $.command.run(RUN)
  expect(after.text).toContain('5h 42% used (58% left)')
  expect(after.text).toContain('7d 5% used (95% left)')
  expect(after.text).toContain('Context (this window) 21% (42K / 200K)')
  expect(after.text).toContain('Last task: 1.5K tok (out 500, 0 req) · $0.050 · 5h +2.0%')
  expect(after.text).toContain('~29 more such tasks fit in the 5h window')
  expect(after.text).toContain('Average task (last 1): ~1.5K tok')

  await $.turn.start({ text: 'second', turnId: 't2' })
  const running = await $.command.run(RUN)
  expect(running.text).toContain('Task running: 0 tok')
  expect(running.text).toContain('est. total ~1.5K / $0.050 (avg of 1)')
})

test('an aborted task is not counted toward the average', async ($, on) => {
  fakeEngine(on, { fiveHour: 10, usd: 0 })
  await $.turn.start({ text: 'x', turnId: 'a1' })
  await $.turn.complete({ answer: '', durationMs: 10, isAborted: true, turnId: 'a1', reason: 'aborted', usage })

  const out = await $.command.run(RUN)
  expect(out.text).not.toContain('Average task')
})

test('bars fill in proportion and clamp at both ends', async () => {

  expect(bar(42, 10)).toEqual({ filled: '████', empty: '░░░░░░' })
  expect(bar(150, 10)).toEqual({ filled: '██████████', empty: '' })
  expect(bar(-5, 10)).toEqual({ filled: '', empty: '░░░░░░░░░░' })
})

const START = { cwd: '/work', surface: 'terminal', isInteractive: true } as const

const liveEngine = (on: On, state: { fiveHour: number }, stored: Record<string, unknown> = {}) => {
  const clock = mock.clock(on)
  const calls = { model: 0 }
  on('session.usage', (): { value: SessionUsage } => ({ value: {
    startedAt: 0,
    context: { tokens: 42_000, window: 200_000, percent: 21 },
    rateLimits: [{ kind: 'five_hour', percentUsed: state.fiveHour }],
    cost: { usd: 0.2 },
  } }))
  on('session.surfaces', () => ({ value: ['terminal'] as const }))
  on('command.register', () => ({ value: { command: 'usage-meter' } }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('store.get', (_$, e) => ({ value: stored[e.key] }))
  on('store.set', (_$, e) => {
    stored[e.key] = JSON.parse(JSON.stringify(e.value))
    return { value: undefined }
  })
  on('model.complete', () => {
    calls.model++
    return { value: { isAnswered: true as const, text: 'OK', usage } }
  })
  return { clock, calls, stored }
}

test('a newer reading from another window wins and names its source', async ($, on) => {
  const { clock, stored } = liveEngine(on, { fiveHour: 40 })
  await $.session.start(START)

  const first = await $.command.run(RUN)
  expect(first.text).toContain('5h 40% used')
  expect(first.text).toContain(`as of ${fmtClock(0)} (CLI)`)
  expect(first.text).toContain(SHARING_NOTE)

  await clock.advance(30_000)
  stored.limits = { at: 30_000, source: 'app', limits: [{ kind: 'five_hour', percentUsed: 55 }] }
  await clock.advance(30_000)

  const later = await $.command.run(RUN)
  expect(later.text).toContain('5h 55% used')
  expect(later.text).toContain(`as of ${fmtClock(30_000)} (app)`)
  expect(later.text).not.toContain('5h 40% used')
})

test('an older local reading never overwrites a newer stored one', async ($, on) => {
  const app = { at: 5_000, source: 'app', limits: [{ kind: 'five_hour', percentUsed: 60 }] }
  const { stored } = liveEngine(on, { fiveHour: 40 }, { limits: app })
  await $.session.start(START)
  expect(stored.limits).toEqual(app)
  const out = await $.command.run(RUN)
  expect(out.text).toContain('5h 60% used')
  expect(out.text).toContain('(app)')
})

test('the minute timer shares a new reading from this window and never calls a model', async ($, on) => {
  const state = { fiveHour: 40 }
  const { clock, calls, stored } = liveEngine(on, state)
  await $.session.start(START)
  expect(stored.limits).toEqual({ at: 0, source: 'CLI', limits: [{ kind: 'five_hour', percentUsed: 40 }] })

  await clock.advance(10 * 60_000)
  expect(calls.model).toBe(0)
  expect(stored.limits).toEqual({ at: 0, source: 'CLI', limits: [{ kind: 'five_hour', percentUsed: 40 }] })

  state.fiveHour = 47
  await clock.advance(60_000)
  expect(stored.limits).toEqual({ at: 11 * 60_000, source: 'CLI', limits: [{ kind: 'five_hour', percentUsed: 47 }] })

  await clock.advance(30 * 60_000)
  expect(calls.model).toBe(0)
})
