/**
 * The whole HTTP surface, and the handful of types this app renders.
 *
 * The types are hand-written from `docs/http-contract.md` in the backend repo
 * rather than shared: the two repos have no workspace between them, so a
 * shared package would need publishing or a git dependency — more plumbing
 * than the duplication costs. The contract is authoritative; this file is a
 * transcription of it, and holds no pipeline logic.
 *
 * Every path is relative, so the app is same-origin in dev (through the Vite
 * proxy) and in a build served by Express alike.
 */

/** The wire's closed list. Five of the seven reach the screen; see `runs.ts`. */
export type RunStatus =
  | 'running'
  | 'awaiting_review'
  | 'awaiting_confirmation'
  | 'done'
  | 'abandoned'
  | 'failed'
  | 'stalled'

export type Run = {
  runId: string
  batch: string
  createdAt: string
  status: RunStatus
}

export type Batch = { batch: string; ready: number }

export type Connection = {
  connected: boolean
  workspace: { name: string; icon: string | null } | null
}

export type ErrorCode =
  | 'not_connected'
  | 'wrong_workspace'
  | 'no_such_run'
  | 'wrong_stage'
  | 'batch_in_progress'
  | 'invalid_payload'
  | 'notion_failed'
  | 'internal_error'

/**
 * A failed request carries the server's own name for what went wrong. The
 * surfaces branch on `code` and `details`, never on the status or the message
 * — the message is copy, the code is the decision.
 */
export class ApiError extends Error {
  readonly code: ErrorCode
  readonly details: Record<string, unknown> | undefined

  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message)
    this.code = code
    this.details = details
  }

  /** `details.reason` where the backend supplies one, e.g. `no_databases`. */
  get reason(): string | undefined {
    const reason = this.details?.reason
    return typeof reason === 'string' ? reason : undefined
  }

  /** `details.runId` — the run already holding a refused batch. */
  get runId(): string | undefined {
    const runId = this.details?.runId
    return typeof runId === 'string' ? runId : undefined
  }
}

/** Anything that leaves a request has to be one of these, or every caller
 *  needs a second failure path. */
export const asApiError = (thrown: unknown): ApiError =>
  thrown instanceof ApiError
    ? thrown
    : new ApiError('internal_error', 'The server could not be reached.')

type ErrorBody = {
  error?: { code?: ErrorCode; message?: string; details?: Record<string, unknown> }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
  })
  if (!response.ok) {
    // A proxy or a dead server answers with something that is not our shape.
    // It still has to leave here as an ApiError, or every caller needs a
    // second failure path.
    const body = (await response.json().catch(() => ({}))) as ErrorBody
    throw new ApiError(
      body.error?.code ?? 'internal_error',
      body.error?.message ?? `The server answered ${response.status}.`,
      body.error?.details,
    )
  }
  return (await response.json()) as T
}

export const getConnection = () => request<Connection>('/api/connection')

/** Answers `{ strandedRuns }`; the warning happens before this is called. */
export const disconnect = () =>
  request<{ disconnected: true; strandedRuns: string[] }>('/api/connection', {
    method: 'DELETE',
  })

/** `409 not_connected` with `details.reason` when the grant cannot answer. */
export const getBatches = () => request<Batch[]>('/api/batches')

export const getRuns = () => request<Run[]>('/api/runs')

/** `202 { runId }`, or `409 batch_in_progress` naming the run that holds it. */
export const startRun = (batch: string) =>
  request<{ runId: string }>('/api/runs', {
    method: 'POST',
    body: JSON.stringify({ batch }),
  })

export const continueRun = (runId: string) =>
  request<{ runId: string }>(`/api/runs/${runId}/continue`, { method: 'POST' })

/**
 * One problem found on one candidate.
 *
 * No prose travels: `rule` names the rule that raised it and the surface
 * renders a fixed sentence for it, which is also what keeps the screener's
 * model unable to narrate. The quote it pointed at is not here and is not on
 * the wire as a value of its own — it is a check, not a display, and it moves
 * between identical runs.
 */
export type Flag = {
  id: string
  rule: 'B1' | 'W1' | 'D1' | 'N1' | 'N2' | 'N1+N2'
  level: 'stop' | 'warn'
  /** A Warn is a decision or a notice. A Stop is neither. */
  kind: 'decision' | 'notice' | null
  /** Only a Stop asks it; `false` on every Warn and on `D1`. */
  override: boolean
  /** The candidates that *caused* it, by id, where that is not this one. */
  siblings: string[]
  cleared: boolean
  /** An answer that did not stand, named on the candidate rather than in a
   *  `400` on a response the reviewer never sees again. */
  refused: Refusal | null
}

export type Refusal = 'invalid_email' | 'duplicate_email' | 'new_owner'

/** Asked once, in one place, before the files are made. At most two. */
export type BatchFlag = { id: string; cleared: boolean; refused: Refusal | null } & (
  | { rule: 'P1+P2'; level: 'warn'; kind: 'decision'; stage: string }
  | { rule: 'N0'; level: 'warn'; kind: 'notice' }
)

/**
 * What the review writes onto every candidate, whichever object it becomes.
 *
 * `held` is candidate state, computed server-side in one place: a candidate
 * carrying an uncleared Stop is Held, so is one the reviewer held, and so is
 * every candidate in a Company's account when the Company is. Nothing here
 * re-derives it.
 *
 * `heldByReviewer` is the reviewer's own hold alone. It exists because a
 * decision document's `held` is **not** sparse and replaces what came before,
 * so a reload that could see only `held` would either post the cascade back as
 * holds in its own right or post the reviewer's holds away.
 */
type Reviewable = {
  flags: Flag[]
  held: boolean
  heldByReviewer: boolean
  /** The fields the reviewer pinned by editing them. */
  overrides: string[]
}

export type Company = Reviewable & {
  id: string
  name: string
  /** Identity-keyed, so read-only: editing it changes which candidates exist. */
  domain: string
  segment: string
  primaryLocation: string
}

/** One source row's `Research notes`, verbatim, naming the row they came from. */
export type ResearchNotes = { sourceId: string; text: string }

export type Person = Reviewable & {
  id: string
  sourceId: string
  companyId: string
  name: string
  /** Identity-keyed. It changes only through `B1`'s own control. */
  email: string
  jobTitle: string
  linkedIn: string
  leadSource: string
  /**
   * One entry per source row that collapsed onto this Person and carried
   * notes. They live here, and a Company and a Deal reach their account's
   * notes through their People rather than holding a copy.
   */
  notes: ResearchNotes[]
}

/** Its name, its company and its participants all resolve when files are made. */
export type Deal = Reviewable & { id: string; companyId: string; owner: string }

export type Candidates = { companies: Company[]; people: Person[]; deals: Deal[] }

/** Any candidate, where only the fields all three share are read. */
export type Candidate = Company | Person | Deal

/**
 * One silent repair, against the **candidate field** the repaired value sits
 * on — `domain`, not the `Website` it came from — so the ledger marks it in
 * place rather than in an audit screen elsewhere.
 *
 * One entry per source row repaired, so a candidate several rows collapsed
 * onto carries one for each. That is what makes the collapse legible.
 */
export type Repair = {
  sourceId: string
  candidateId: string
  field: string
  from: string
  to: string
}

/**
 * The snapshot, which is the index row plus everything only one run's own page
 * needs. `next` is the checkpoint's pending node, passed through from
 * LangGraph's `snap.next` — it is the whole of the progress model, derived on
 * every read and persisted nowhere.
 *
 * `files`, `writeBack` and `blocked` are transcribed by the ticket that
 * renders them; hand-writing a field before something reads it would be a type
 * claiming a surface exists.
 */
export type RunSnapshot = Run & {
  next: string[]
  candidates: Candidates
  batchFlags: BatchFlag[]
  repairs: Repair[]
}

export const getRun = (runId: string) => request<RunSnapshot>(`/api/runs/${runId}`)

/**
 * What one flag's own control sends back. `true` is the answer with nothing to
 * supply — a Warn read or decided, or a Stop the reviewer forces past. The two
 * objects are the two controls carrying a value: `B1`'s work email, which is
 * the one identity change the freeze permits, and the batch flag's stage.
 */
export type Answer = true | { email: string } | { stage: string }

/**
 * The reviewer's decision document — answers, holds and sparse edits, in one
 * request, because they are one decision.
 *
 * `edits` is sparse so that *touched* is a fact rather than an inference: a
 * whole candidate would leave the server unable to tell a retyped value from
 * an untouched one, and every repair's marking would turn on that guess.
 * `held` is complete and replaces what came before. `answers` accumulate — an
 * answer is an act performed, and nobody can un-read a notice.
 */
export type Decision = {
  edits?: Record<string, Record<string, string>>
  held?: string[]
  answers?: Record<string, Answer>
}

/** `200` and the snapshot the decision produced, so a refusal arrives in the
 *  same answer rather than on the next poll. */
export const postReview = (runId: string, decision: Decision) =>
  request<RunSnapshot>(`/api/runs/${runId}/review`, {
    method: 'POST',
    body: JSON.stringify(decision),
  })

/** A browser navigation, not a fetch — it ends in a redirect back to `/runs`. */
export const connectUrl = '/auth/notion/start'
