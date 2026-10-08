/** Native task timing over the maintained Schedule calendar and recurrence library. */
import {
  ScheduleId, ScheduleInputError, parseAtInput, parseDailyInput, parseWeeklyInput, parseCronInput,
  createDailyScheduleRecord, createWeeklyScheduleRecord, createCronScheduleRecord,
  resolveEveryOccurrence, resolveDailyOccurrence, resolveWeeklyOccurrence, resolveCronOccurrence,
} from '@deepseek-ai/dsh-schedule/timing'
import type { AutomationTiming, AutomationTimingInput } from './types.ts'

/** Protocol minimum for interval scheduling. */
export const MIN_INTERVAL_SECONDS = 60
/** Actionable user timing failure. */
export class TimingInputError extends Error {
  /** @param code - Stable timing failure. @param message - Safe correction text. */
  constructor(readonly code: string, message: string) { super(message); this.name = 'TimingInputError' }
}
const id = ScheduleId('asterhub-timing')
const label = 'Native scheduled task'
const lastInstant = Date.parse('9999-12-31T23:59:59.999Z')

function instant(at: number): string {
  if (!Number.isSafeInteger(at) || at < Date.parse('0001-01-01T00:00:00Z') || at > lastInstant) {
    throw new TimingInputError('time_out_of_range', 'Time must be a representable four-digit-year instant.')
  }
  return new Date(at).toISOString()
}
function future(at: number, now: number): string {
  if (at <= now) throw new TimingInputError('not_future', 'Execution time must be in the future.')
  return instant(at)
}

/**
 * Normalize a submitted rule, retaining the accepted interval phase.
 * @param input - Explicit user timing selector.
 * @param now - Acceptance wall-clock sample.
 * @returns Normalized durable timing; invalid selectors reject.
 */
export function normalizeTiming(input: AutomationTimingInput, now: number): AutomationTiming {
  try {
    switch (input.kind) {
      case 'once': return { kind: 'once', at: future(parseAtInput(input.at), now) }
      case 'delay': {
        if (!Number.isSafeInteger(input.seconds) || input.seconds <= 0) throw new TimingInputError('invalid_delay', 'Delay must be a positive whole number of seconds.')
        return { kind: 'delay', seconds: input.seconds, anchorAt: instant(now), at: future(now + input.seconds * 1000, now) }
      }
      case 'interval': {
        if (!Number.isSafeInteger(input.seconds) || input.seconds < MIN_INTERVAL_SECONDS) throw new TimingInputError('invalid_interval', 'Interval must be at least 60 whole seconds.')
        const first = input.firstAt === undefined ? now + input.seconds * 1000 : parseAtInput(input.firstAt)
        return { kind: 'interval', seconds: input.seconds, firstAt: future(first, now), anchorAt: instant(first - input.seconds * 1000) }
      }
      case 'daily': return { kind: 'daily', ...parseDailyInput({ time: input.time, time_zone: input.timeZone }) }
      case 'weekly': return { kind: 'weekly', ...parseWeeklyInput({ time: input.time, time_zone: input.timeZone, weekdays: [...input.weekdays] }) }
      case 'cron': return { kind: 'cron', ...parseCronInput({ expression: input.expression, time_zone: input.timeZone }) }
    }
  } catch (error) {
    if (error instanceof ScheduleInputError) throw new TimingInputError(error.code, error.message)
    throw error
  }
}

/**
 * Resolve only the latest missed occurrence and its future successor.
 * @param timing - Normalized stored rule.
 * @param target - Committed pending occurrence.
 * @param now - Dispatch wall-clock sample, not before target.
 * @returns Latest due occurrence and next target, or null successor at exhaustion.
 */
export function resolveOccurrence(timing: AutomationTiming, target: string, now: number): { occurrenceAt: string; nextAt: string | null } {
  const common = { id, title: label, prompt: label, scheduledAt: target }
  switch (timing.kind) {
    case 'once': case 'delay': return { occurrenceAt: timing.at, nextAt: null }
    case 'interval': {
      const result = resolveEveryOccurrence({ ...common, everySeconds: timing.seconds }, now)
      return { occurrenceAt: result.occurrenceAt, nextAt: result.nextScheduledAt ?? null }
    }
    case 'daily': {
      const result = resolveDailyOccurrence({ ...common, kind: 'daily', time: timing.time, timeZone: timing.timeZone }, now)
      return { occurrenceAt: result.occurrenceAt, nextAt: result.nextScheduledAt ?? null }
    }
    case 'weekly': {
      const result = resolveWeeklyOccurrence({ ...common, kind: 'weekly', time: timing.time, timeZone: timing.timeZone, weekdays: [...timing.weekdays] }, now)
      return { occurrenceAt: result.occurrenceAt, nextAt: result.nextScheduledAt ?? null }
    }
    case 'cron': {
      const result = resolveCronOccurrence({ ...common, kind: 'cron', expression: timing.expression, timeZone: timing.timeZone }, now)
      return { occurrenceAt: result.occurrenceAt, nextAt: result.nextScheduledAt ?? null }
    }
  }
}

/**
 * Find the strictly future target without enumerating an interval backlog.
 * @param timing - Normalized rule.
 * @param now - Current wall time.
 * @returns Next future UTC target, or null at exhaustion.
 */
export function nextOccurrence(timing: AutomationTiming, now: number): string | null {
  try {
    switch (timing.kind) {
      case 'once': case 'delay': return Date.parse(timing.at) > now ? timing.at : null
      case 'interval': return Date.parse(timing.firstAt) > now ? timing.firstAt : resolveOccurrence(timing, timing.firstAt, now).nextAt
      case 'daily': return createDailyScheduleRecord(id, label, { time: timing.time, time_zone: timing.timeZone }, now, label).scheduledAt
      case 'weekly': return createWeeklyScheduleRecord(id, label, { time: timing.time, time_zone: timing.timeZone, weekdays: [...timing.weekdays] }, now, label).scheduledAt
      case 'cron': return createCronScheduleRecord(id, label, { expression: timing.expression, time_zone: timing.timeZone }, now, label).scheduledAt
    }
  } catch (error) {
    if (error instanceof ScheduleInputError && error.code === 'time_out_of_range') return null
    throw error
  }
}

/**
 * Preview a bounded sequence using the same calendar as dispatch.
 * @param timing - Normalized rule.
 * @param now - Preview wall time.
 * @param count - Number of future occurrences, between one and 100.
 * @returns Future UTC instants, stopping at one-shot/exhaustion.
 */
export function previewTiming(timing: AutomationTiming, now: number, count: number): string[] {
  if (!Number.isSafeInteger(count) || count < 1 || count > 100) throw new TimingInputError('invalid_rule', 'Preview count must be between 1 and 100.')
  const results: string[] = []
  for (let index = 0; index < count; index++) {
    const target = nextOccurrence(timing, now)
    if (target === null) break
    results.push(target)
    now = Date.parse(target)
  }
  return results
}

/**
 * Reset an interval after explicit resume; clock rules retain their zone.
 * @param timing - Stored rule.
 * @param now - Resume wall time.
 * @returns Reanchored interval or the unchanged clock/one-shot rule.
 */
export function reanchorTiming(timing: AutomationTiming, now: number): AutomationTiming {
  return timing.kind === 'interval' ? normalizeTiming({ kind: 'interval', seconds: timing.seconds }, now) : timing
}
