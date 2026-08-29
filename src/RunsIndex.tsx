/**
 * The front door.
 *
 * The list of runs and the place a run is started are one surface, and the
 * question it answers first is *what needs a human*, not *what would you like
 * to start*. A run whose link was lost is impossible to miss here rather than
 * merely recoverable — which is the whole reason this is the root.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  ApiError,
  connectUrl,
  continueRun as postContinue,
  disconnect,
  getBatches,
  getConnection,
  getRuns,
  startRun as postRun,
  type Batch,
  type Connection,
  type Run,
} from './api.ts'
import { bannerFor, outcomeIn } from './connection.ts'
import { navigate } from './router.ts'
import { CONSEQUENCE, awaitingConfirmation, reading, relativeTime, sortRuns } from './runs.ts'

const asApiError = (thrown: unknown) =>
  thrown instanceof ApiError ? thrown : new ApiError('internal_error', String(thrown))

export default function RunsIndex() {
  const [connection, setConnection] = useState<Connection | null>(null)
  const [batches, setBatches] = useState<Batch[] | null>(null)
  const [batchesError, setBatchesError] = useState<ApiError | null>(null)
  const [runs, setRuns] = useState<Run[] | null>(null)
  const [chosen, setChosen] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState<{ batch: string; runId?: string } | null>(null)
  const [stranded, setStranded] = useState<Run[] | null>(null)

  // Read once: the consent round trip's answer is a fact about a moment, not
  // about now. It is taken off the address bar so a reload cannot replay it.
  const [outcome] = useState(() => outcomeIn(window.location.search))
  useEffect(() => {
    if (window.location.search) navigate('/runs', { replace: true })
  }, [])

  const loadRuns = useCallback(
    () =>
      getRuns()
        .catch((): Run[] => [])
        .then(setRuns),
    [],
  )

  /**
   * The connection and the batches are one read: the batch list is a live
   * Notion query made with the grant, so it is what a dead or empty grant is
   * discovered through. Its failure is the banner's evidence, not an error to
   * swallow.
   */
  const loadConnection = useCallback(
    () =>
      getConnection()
        .catch((): Connection => ({ connected: false, workspace: null }))
        .then((live) => {
          setConnection(live)
          setBatches(null)
          setBatchesError(null)
          return getBatches()
        })
        .then(setBatches)
        .catch((thrown: unknown) => {
          setBatchesError(asApiError(thrown))
          setBatches([])
        }),
    [],
  )

  useEffect(() => {
    void loadConnection()
    void loadRuns()
  }, [loadConnection, loadRuns])

  // A started run appears as a row and then moves, so the list follows it for
  // as long as something is in flight and no longer.
  const live = runs?.some((run) => run.status === 'running') ?? false
  useEffect(() => {
    if (!live) return
    const poll = setInterval(() => void loadRuns(), 2000)
    return () => clearInterval(poll)
  }, [live, loadRuns])

  const banner = bannerFor(connection, batchesError, outcome)
  const ready = batches !== null && batches.length > 0
  const batch = chosen ?? batches?.[0]?.batch ?? ''

  const ordered = sortRuns(runs ?? [])
  /**
   * At most one primary button is on screen at a time, and the sort has
   * already decided which row deserves it: the first one that needs a human.
   * A refusal takes it instead — it is answering the click just made.
   */
  const primary = refusal
    ? null
    : ordered.find((run) => reading(run.status).action !== 'open')?.runId

  /**
   * `POST /api/runs` answers `202` and the browser **stays on `/runs`**. The
   * address bar changes only when a person opens a run to work it.
   */
  async function start() {
    setBusy(true)
    setRefusal(null)
    try {
      await postRun(batch)
      await loadRuns()
    } catch (thrown) {
      const error = asApiError(thrown)
      if (error.code === 'batch_in_progress') setRefusal({ batch, runId: error.runId })
      else setBatchesError(error)
    } finally {
      setBusy(false)
    }
  }

  async function resume(runId: string) {
    setBusy(true)
    try {
      await postContinue(runId)
      await loadRuns()
    } finally {
      setBusy(false)
    }
  }

  /**
   * A run at `awaiting_confirmation` holds a bundle that is already in Attio.
   * Once the grant is gone its write-back can never be made, so the runs are
   * named before the grant is, not after.
   */
  function askToDisconnect() {
    const waiting = awaitingConfirmation(runs ?? [])
    if (waiting.length > 0) setStranded(waiting)
    else void reallyDisconnect()
  }

  async function reallyDisconnect() {
    setStranded(null)
    setBusy(true)
    try {
      await disconnect()
      await loadConnection()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page">
      <header className="top">
        <h1>Runs</h1>
        {connection === null ? (
          <span className="pill neutral">Checking the connection…</span>
        ) : connection.connected && connection.workspace ? (
          <>
            <span className="pill ok">
              <span className="dot" />
              {connection.workspace.icon ?? ''} {connection.workspace.name}
            </span>
            <button className="btn ghost" onClick={askToDisconnect} disabled={busy}>
              Disconnect
            </button>
          </>
        ) : (
          <>
            <span className="pill stop">
              <span className="dot" />
              Not connected
            </span>
            <a className="btn ghost" href={connectUrl}>
              Connect Notion
            </a>
          </>
        )}
        <span className="grow" />
        <div className="start">
          <select
            aria-label="Batch"
            value={batch}
            onChange={(event) => setChosen(event.target.value)}
            disabled={!ready}
          >
            {ready ? (
              batches.map((option) => (
                <option key={option.batch} value={option.batch}>
                  {option.batch} — {option.ready} ready
                </option>
              ))
            ) : (
              <option value="">{batches === null ? 'Loading batches…' : 'No batches ready'}</option>
            )}
          </select>
          <button className="btn primary" onClick={() => void start()} disabled={!ready || busy}>
            Start run
          </button>
        </div>
      </header>

      {banner && (
        <div className={`banner ${banner.tone}`}>
          <div className="grow">
            <h2>{banner.head}</h2>
            <p>{banner.body}</p>
          </div>
          {banner.action && (
            <a className="btn" href={connectUrl}>
              {banner.action}
            </a>
          )}
        </div>
      )}

      {stranded && (
        <div className="banner warn">
          <div className="grow">
            <h2>
              {stranded.length === 1
                ? 'One run is waiting for you to confirm its import'
                : `${stranded.length} runs are waiting for you to confirm their import`}
            </h2>
            <p>
              Their files are already in Attio. Disconnecting revokes the grant, so their write-back
              can never be made and their rows keep reading <code>Ready for CRM</code>.
            </p>
            <ul className="ids">
              {stranded.map((run) => (
                <li key={run.runId}>
                  <a
                    href={`/runs/${run.runId}`}
                    onClick={(event) => {
                      event.preventDefault()
                      navigate(`/runs/${run.runId}`)
                    }}
                  >
                    {run.runId.slice(0, 8)}
                  </a>{' '}
                  · {run.batch}
                </li>
              ))}
            </ul>
          </div>
          <button className="btn" onClick={() => setStranded(null)}>
            Keep the connection
          </button>
          <button className="btn danger" onClick={() => void reallyDisconnect()} disabled={busy}>
            Disconnect anyway
          </button>
        </div>
      )}

      {refusal && (
        <div className="banner warn">
          <div className="grow">
            <h2>{refusal.batch} is already being handed off</h2>
            <p>
              One run holds a batch until it is done, so the same rows cannot be handed off twice —
              nothing in Attio can be undone.
            </p>
          </div>
          {refusal.runId && (
            <button className="btn primary" onClick={() => navigate(`/runs/${refusal.runId}`)}>
              Open that run
            </button>
          )}
          <button className="btn" onClick={() => setRefusal(null)}>
            Dismiss
          </button>
        </div>
      )}

      <table className="runs">
        <thead>
          <tr>
            <th>Run</th>
            <th>Batch</th>
            <th>Started</th>
            <th>State</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {runs === null && (
            <tr>
              <td colSpan={5} className="empty">
                Loading runs…
              </td>
            </tr>
          )}
          {runs?.length === 0 && (
            <tr>
              <td colSpan={5} className="empty">
                No runs yet. Starting one puts it at the top of this table.
              </td>
            </tr>
          )}
          {ordered.map((run) => (
            <Row
              key={run.runId}
              run={run}
              onContinue={resume}
              busy={busy}
              primary={run.runId === primary}
            />
          ))}
        </tbody>
      </table>

      <p className="foot">
        Runs are kept until they are deleted. A run's link works from any browser — nothing here
        lives in this tab.
      </p>
    </div>
  )
}

function Row({
  run,
  onContinue,
  busy,
  primary,
}: {
  run: Run
  onContinue: (runId: string) => Promise<void>
  busy: boolean
  primary: boolean
}) {
  const { label, tone, action } = reading(run.status)
  const open = () => navigate(`/runs/${run.runId}`)
  const emphasis = primary ? 'btn primary' : 'btn'

  return (
    <tr className={action === 'confirm' ? 'needy' : run.status === 'running' ? 'live' : undefined}>
      <td className="mono">{run.runId.slice(0, 8)}</td>
      <td className="mono">{run.batch}</td>
      <td className="when">{relativeTime(run.createdAt)}</td>
      <td>
        <span className={`pill ${tone}`}>
          {run.status === 'running' && <span className="dot pulse" />}
          {label}
        </span>
        {action === 'confirm' && (
          <div className="consequence">
            {CONSEQUENCE}
            <code>Ready for CRM</code>
          </div>
        )}
      </td>
      <td className="act">
        {action === 'continue' ? (
          <button className={emphasis} onClick={() => void onContinue(run.runId)} disabled={busy}>
            Continue
          </button>
        ) : action === 'open' ? (
          <button className="btn ghost" onClick={open}>
            Open
          </button>
        ) : (
          <button className={emphasis} onClick={open}>
            {action === 'confirm' ? 'Confirm import' : 'Review'}
          </button>
        )}
      </td>
    </tr>
  )
}
