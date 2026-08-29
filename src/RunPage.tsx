/**
 * One run, addressed by its own identifier — the link that works from any
 * browser, and `404` for an identifier that names no run.
 *
 * What fills this page is not this ticket's: the checklist while a run is in
 * flight, the candidate ledger at the two pauses, the files and the
 * confirmation. This renders the run's head and says plainly what is missing,
 * rather than pretending the surface is finished.
 */

import { useEffect, useState } from 'react'
import { ApiError, getRun, type Run } from './api.ts'
import { navigate } from './router.ts'
import { reading, relativeTime } from './runs.ts'

export default function RunPage({ runId }: { runId: string }) {
  const [run, setRun] = useState<Run | null>(null)
  const [error, setError] = useState<ApiError | null>(null)

  // App keys this component by `runId`, so a different run arrives as a fresh
  // mount and there is no stale run to clear here.
  useEffect(() => {
    getRun(runId)
      .then(setRun)
      .catch((thrown: unknown) =>
        setError(thrown instanceof ApiError ? thrown : new ApiError('internal_error', 'Failed.')),
      )
  }, [runId])

  const back = (
    <button className="btn ghost" onClick={() => navigate('/runs')}>
      ← All runs
    </button>
  )

  if (error) {
    return (
      <div className="page">
        <header className="top">
          <h1>{error.code === 'no_such_run' ? 'No such run' : 'That run could not be read'}</h1>
          <span className="grow" />
          {back}
        </header>
        <p className="foot">{error.message}</p>
      </div>
    )
  }

  if (!run) return <div className="page foot">Loading run…</div>

  const { label, tone } = reading(run.status)

  return (
    <div className="page">
      <header className="top">
        <h1 className="mono">{run.runId.slice(0, 8)}</h1>
        <span className={`pill ${tone}`}>{label}</span>
        <span className="grow" />
        {back}
      </header>
      <dl className="head">
        <dt>Batch</dt>
        <dd className="mono">{run.batch}</dd>
        <dt>Started</dt>
        <dd>{relativeTime(run.createdAt)}</dd>
      </dl>
      <p className="foot">
        The checklist, the ledger and the confirmation land here with the tickets that give them
        something to carry. The runs index is the surface this one is reached from.
      </p>
    </div>
  )
}
