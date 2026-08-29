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

/**
 * The four steps a run moves through, against the graph node that is pending
 * while each one is in flight. This is the entire progress model: the snapshot
 * carries the checkpoint's pending node, so a step is a lookup and nothing
 * about progress is written down.
 *
 * `screen` and `check` are named here before the graph has them — they arrive
 * with backend #9 and #53 — so the checklist is the four steps
 * `run-surfaces.md` specified from the first day rather than a list that grows
 * under the Reviewer. Until then they are pending and then complete, which is
 * what a run that does not screen actually does.
 */
export type Step = { node: string; name: string; detail: string }

export const STEPS: Step[] = [
  {
    node: 'read',
    name: 'Reading the batch from Notion',
    detail: 'one data-source query, filtered to CRM status = Ready for CRM',
  },
  {
    node: 'transform',
    name: 'Building candidates',
    detail: 'deterministic — the rows split into Company, Person and Deal',
  },
  {
    node: 'screen',
    name: 'Screening research notes',
    /**
     * The sentence this surface exists to show. The checkpoint moves only at
     * node boundaries and this one node makes a model call per row, so the
     * indicator sits still for most of the wait. Saying so is the whole fix —
     * a still indicator *with* its explanation reads as honesty, and the same
     * indicator without one reads as a hang.
     */
    detail: 'one model call per source row — nothing to report until they are all back',
  },
  { node: 'check', name: 'Running checks', detail: 'flags and candidate states' },
]

/**
 * Which step a run is on, read from the checkpoint's pending node.
 *
 * `STEPS.length` — past the end — for a run whose pending node is not one of
 * them: `review` and the pauses are not steps, and neither is the empty `next`
 * of a graph that ran to the end. Both mean the same thing on screen, which is
 * that the work is behind it.
 */
export const stepIndexOf = (next: string[]): number => {
  const at = STEPS.findIndex((step) => step.node === next[0])
  return at >= 0 ? at : STEPS.length
}

/**
 * How long a run has been going, as `m:ss` — `h:mm:ss` once it has been going
 * long enough for that to be a lie. Derived from `createdAt`, which is the
 * only time the wire carries; there is no per-step clock, because there is no
 * per-step timestamp and inventing one in the browser would drift.
 */
export function elapsed(createdAt: string, now: number = Date.now()): string {
  const total = Math.max(0, Math.floor((now - Date.parse(createdAt)) / 1000))
  const pad = (value: number) => String(value).padStart(2, '0')
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor(total / 60) % 60
  const seconds = total % 60
  return hours ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`
}
