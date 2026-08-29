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
 * The full snapshot. Only its head is rendered here; the ledger, the files and
 * `blocked` are transcribed by the tickets that render them.
 */
export const getRun = (runId: string) => request<Run>(`/api/runs/${runId}`)

/** A browser navigation, not a fetch — it ends in a redirect back to `/runs`. */
export const connectUrl = '/auth/notion/start'
