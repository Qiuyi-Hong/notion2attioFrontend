/**
 * The second pause, **on the surface the reviewer already reviewed on**. They
 * are not sent to a second screen to finish: this sits under the same ledger,
 * so the record of what they decided is still in front of them at the moment
 * they attest to it.
 *
 * Three things arrive together on the snapshot and this panel is all three:
 * `files` to take, `writeBack` — which is the only thing that makes this a
 * Retry panel — and `blocked`, which disables **Confirm** with its reason
 * *before* the click. A guard the reviewer reads is a screen; the same guard
 * reached by clicking is an error.
 *
 * Every rule here lives in `confirm.ts`, checked without a browser. This file
 * is the arrangement of them and nothing else.
 */

import { useEffect, useState } from 'react'
import {
  asApiError,
  cancelRun,
  confirmRun,
  connectUrl,
  fileUrl,
  getConnection,
  type ApiError,
  type Connection,
  type RunSnapshot,
} from './api.ts'
import {
  ABANDON,
  blockedReading,
  bundleIn,
  byCause,
  canAbandon,
  CANCEL,
  CAUSES,
  CONFIRM,
  confirmGate,
  membersIn,
  RETRY,
  retrying,
  size,
} from './confirm.ts'
import { navigate } from './router.ts'

export default function Confirm({
  run,
  onSnapshot,
}: {
  run: RunSnapshot
  /** An attestation answers with the snapshot it produced, so a partial
   *  failure lands as the response to the click that caused it. */
  onSnapshot: (snapshot: RunSnapshot) => void
}) {
  const [connection, setConnection] = useState<Connection | null>(null)
  const [problem, setProblem] = useState<ApiError | null>(null)
  const [busy, setBusy] = useState(false)
  /** Cancelling deletes the run and releases the batch, which is the one act
   *  on this screen that can put a second copy of these deals into Attio. Its
   *  wording is the guard the ticket asks for; the second click is the guard
   *  against the hand. */
  const [cancelling, setCancelling] = useState(false)

  useEffect(() => {
    getConnection()
      .then(setConnection)
      .catch((thrown: unknown) => {
        setProblem(asApiError(thrown))
        // A connection that could not be probed is not one we may write
        // through. Failing closed here disables Confirm with a reason, which
        // is the same answer the click would have reached anyway.
        setConnection({ connected: false, workspace: null })
      })
  }, [])

  const files = run.files ?? []
  const bundle = bundleIn(files)
  const members = membersIn(files)
  const retry = retrying(run.writeBack)
  const gate = confirmGate(run.blocked, connection)
  const abandonable = canAbandon(run.writeBack, run.blocked)

  async function act<T>(request: () => Promise<T>, then: (result: T) => void) {
    setBusy(true)
    setProblem(null)
    try {
      then(await request())
    } catch (thrown) {
      setProblem(asApiError(thrown))
    } finally {
      setBusy(false)
    }
  }

  /** Confirm and Retry are the same route with the same payload — after a
   *  partial failure the run is genuinely back at this pause. */
  const attest = (attestation: { confirmed: true } | { abandoned: true }) =>
    act(() => confirmRun(run.runId, attestation), onSnapshot)

  const release = () => act(() => cancelRun(run.runId), () => navigate('/runs'))

  return (
    <section className="confirm">
      <div className="lede">
        <div className="grow">
          <h2>{retry ? 'The write-back did not finish' : 'Take the files, then say what happened'}</h2>
          <p className="foot">
            {retry
              ? 'Attio has the bundle — that is what you attested. What failed is our write to Notion, and the rows it did not reach are named below.'
              : 'Import the bundle into Attio, then answer here. Nothing in Notion changes until you do, and nothing here can undo an import.'}
          </p>
        </div>
      </div>

      {problem && (
        <div className="banner stop">
          <div className="grow">
            <h2>That did not go through</h2>
            <p>{problem.message}</p>
          </div>
          <button className="btn" onClick={() => setProblem(null)}>
            Dismiss
          </button>
        </div>
      )}

      {bundle && (
        <div className="bundle">
          <div className="grow">
            <div className="eyebrow">The handoff bundle</div>
            <p className="foot">
              One ZIP named for the batch, {size(bundle.bytes)}. The bytes come from this run's own
              checkpoint rather than being made again, so downloading it twice returns the same
              bytes and moves the run nowhere — a misplaced file is not a crisis.
            </p>
          </div>
          {/* A plain link, because the route is a repeatable `GET` answering
              `Content-Disposition: attachment`. A fetch and a blob would add a
              second copy of the bytes for nothing. */}
          <a className="btn primary" href={fileUrl(run.runId, bundle.fileId)}>
            Download {bundle.filename}
          </a>
        </div>
      )}

      {members.length > 0 && (
        <div className="members">
          <div className="eyebrow">In import order</div>
          <ol>
            {members.map((file) => (
              <li key={file.fileId}>
                {/* The row is a flex line inside the `li` rather than the `li`
                    itself, which would drop the marker — and the marker is the
                    import order made visible. */}
                <span className="line">
                  <span className="mono grow">{file.filename}</span>
                  <span className="foot">{size(file.bytes)}</span>
                  <a className="btn ghost sm" href={fileUrl(run.runId, file.fileId)}>
                    Download
                  </a>
                </span>
              </li>
            ))}
          </ol>
          <p className="foot">
            Attio resolves a person's company and a deal's participants as it imports, so this is
            the order to feed them in. <code>handoff-notes.md</code> is not imported — it is the
            record of what was flagged, repaired and held, and it is Markdown so that nothing
            offers it to the import screen.
          </p>
        </div>
      )}

      {/* The refusal reads as an instruction: both workspaces named, and the
          repair — one click — leading. Abandoning sits below it and never
          instead of it: only the Reviewer knows whether the workspace is gone
          for good. */}
      {run.blocked && (
        <div className="banner stop">
          <div className="grow">
            <h2>{blockedReading(run.blocked).head}</h2>
            <p>
              {blockedReading(run.blocked).repair} A run is confirmable only through the connection
              that read its batch — otherwise this would mark rows in a workspace it never read.
            </p>
          </div>
          <a className="btn primary" href={connectUrl}>
            Connect Notion
          </a>
        </div>
      )}

      {retry && run.writeBack && (
        <div className="writeback">
          <div className="eyebrow">What the write-back left behind</div>
          <p>
            <b>{run.writeBack.written.length}</b>{' '}
            {run.writeBack.written.length === 1 ? 'row now reads' : 'rows now read'}{' '}
            <code>Imported</code> in Notion. <b>{run.writeBack.failed.length}</b> did not, and{' '}
            {run.writeBack.failed.length === 1 ? 'it still reads' : 'they still read'}{' '}
            <code>Ready for CRM</code>.
          </p>
          {byCause(run.writeBack).map(({ cause, rows }) => (
            <div key={cause} className="cause">
              <p>{CAUSES[cause]}</p>
              <p className="mono rows">{rows.join(' · ')}</p>
            </div>
          ))}
        </div>
      )}

      <div className="attest">
        {gate.reason && (
          <p className="foot gate">
            {gate.reason}
            {gate.reconnect && !run.blocked && (
              <>
                {' '}
                <a href={connectUrl}>Connect Notion</a>
              </>
            )}
          </p>
        )}

        <div className="pair">
          <div className="choice">
            <button
              className="btn primary"
              disabled={!gate.can || busy}
              onClick={() => void attest({ confirmed: true })}
            >
              {retry ? RETRY.label : CONFIRM.label}
            </button>
            <p className="foot">{retry ? RETRY.detail : CONFIRM.detail}</p>
          </div>

          {/* Cancelling is hidden once a write-back has been attempted: the
              reviewer has already stated that the files reached Attio, and
              *these files never reached Attio* would contradict it. The exit
              from a failed write is abandoning, below. */}
          {!retry && (
            <div className="choice">
              {cancelling ? (
                <>
                  <div className="arm">
                    <button className="btn danger" disabled={busy} onClick={() => void release()}>
                      Yes — delete this run and release the batch
                    </button>
                    <button className="btn ghost" disabled={busy} onClick={() => setCancelling(false)}>
                      Go back
                    </button>
                  </div>
                  <p className="foot">{CANCEL.detail}</p>
                </>
              ) : (
                <>
                  <button className="btn danger" disabled={busy} onClick={() => setCancelling(true)}>
                    {CANCEL.label}
                  </button>
                  <p className="foot">{CANCEL.detail}</p>
                </>
              )}
            </div>
          )}
        </div>

        {abandonable && (
          <div className="abandon">
            <button className="btn" disabled={busy} onClick={() => void attest({ abandoned: true })}>
              {ABANDON.label}
            </button>
            <p className="foot">{ABANDON.detail}</p>
          </div>
        )}
      </div>
    </section>
  )
}
