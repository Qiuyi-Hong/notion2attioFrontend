/**
 * How a run reads on the index: what it is called, where it sorts, and which
 * one control it offers. Pure, so the two rules that carry the ticket's whole
 * argument can be read — and checked — without a browser.
 *
 * `docs/run-surfaces.md` in the backend repo is authoritative.
 */

import type { Run, RunStatus } from './api.ts'

/** Which pill the state cell wears. */
export type Tone = 'live' | 'warn' | 'stop' | 'ok' | 'neutral'

/** The one action a row offers. At most one primary button is on screen. */
export type Action = 'open' | 'review' | 'confirm' | 'continue'

type Reading = {
  /** What the reviewer is asked to do, ranked. `0` is what needs a human. */
  rank: 0 | 1 | 2 | 3
  label: string
  tone: Tone
  action: Action
  /** What the row's one control is called. */
  control: string
}

/**
 * Seven states on the wire, six of them reachable here, five words on screen.
 *
 * `stalled` and `failed` both read as **Stopped**: the backend keeps no
 * failure record of its own, so after a restart the two are the same picture,
 * and the reviewer's action is **Continue** either way. The cause is named in
 * prose on the run's own page when it is known.
 *
 * Rank is *what needs a human*, never time. A run awaiting confirmation is
 * first because the cost of leaving it is duplicate deals next week; `done`
 * and `abandoned` are last because both are over.
 */
const READINGS: Record<RunStatus, Reading> = {
  awaiting_confirmation: {
    rank: 0, label: 'Waiting on you', tone: 'warn', action: 'confirm', control: 'Confirm import',
  },
  running: { rank: 1, label: 'Running', tone: 'live', action: 'open', control: 'Open' },
  awaiting_review: {
    rank: 1, label: 'Ready for review', tone: 'live', action: 'review', control: 'Review',
  },
  stalled: { rank: 2, label: 'Stopped', tone: 'stop', action: 'continue', control: 'Continue' },
  failed: { rank: 2, label: 'Stopped', tone: 'stop', action: 'continue', control: 'Continue' },
  done: { rank: 3, label: 'Done', tone: 'ok', action: 'open', control: 'Open' },
  abandoned: { rank: 3, label: 'Abandoned', tone: 'neutral', action: 'open', control: 'Open' },
}

export const reading = (status: RunStatus): Reading => READINGS[status]

/** What needs a human first, newest first within each group. */
export const sortRuns = (runs: Run[]): Run[] =>
  [...runs].sort(
    (a, b) =>
      reading(a.status).rank - reading(b.status).rank ||
      Date.parse(b.createdAt) - Date.parse(a.createdAt),
  )

/** The runs a disconnect would strand: their bundle is already in Attio. */
export const awaitingConfirmation = (runs: Run[]): Run[] =>
  runs.filter((run) => run.status === 'awaiting_confirmation')

export function relativeTime(createdAt: string, now: number = Date.now()): string {
  const ms = now - Date.parse(createdAt)
  const minutes = Math.round(ms / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}
