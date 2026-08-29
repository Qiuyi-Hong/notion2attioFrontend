/**
 * One run, addressed by its own identifier — the link that works from any
 * browser, and `404` for an identifier that names no run.
 *
 * The page renders **by status**, in the five names the Reviewer reads. What
 * a run needs from a person is different in each of them, so the page is not
 * one layout with a changing badge: a moving run gets a clock and a checklist,
 * a Stopped one gets its cause and **Continue**, and the two pauses get the
 * ledger — the second with the files and the confirmation inline beneath it,
 * because the reviewer finishes on the surface they reviewed on.
 *
 * Progress comes from the snapshot's pending node and nowhere else. There is
 * no progress field, no second source of truth, and nothing here counts model
 * calls it cannot see.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  asApiError,
  continueRun,
  getRun,
  type ApiError,
  type RunSnapshot,
} from './api.ts'
import Confirm from './Confirm.tsx'
import { failuresIn } from './confirm.ts'
import Ledger from './Ledger.tsx'
import { navigate } from './router.ts'
import { elapsed, reading, relativeTime, stepIndexOf, STEPS } from './runs.ts'

export default function RunPage({ runId }: { runId: string }) {
  const [run, setRun] = useState<RunSnapshot | null>(null)
  /** The run could not be read at all. This one replaces the page. */
  const [error, setError] = useState<ApiError | null>(null)
  /** A refused **Continue**. The run is still on screen, so this is a banner. */
  const [problem, setProblem] = useState<ApiError | null>(null)
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  const load = useCallback(
    () =>
      getRun(runId)
        .then((snapshot) => {
          setRun(snapshot)
          setError(null)
        })
        .catch((thrown: unknown) => setError(asApiError(thrown))),
    [runId],
  )

  // App keys this component by `runId`, so a different run arrives as a fresh
  // mount and there is no stale run to clear here.
  useEffect(() => {
    void load()
  }, [load])

  const live = run?.status === 'running'

  // The snapshot is the only account of a moving run there is — #16 chose
  // 202-and-poll over streaming — so a run that is moving is watched, and one
  // that has stopped moving is left alone.
  useEffect(() => {
    if (!live) return
    const poll = setInterval(() => void load(), 2000)
    return () => clearInterval(poll)
  }, [live, load])

  // The clock is the one thing that moves during the screening step. It ticks
  // off `createdAt` rather than off the poll, so a slow answer does not make
  // the wait look like it stalled too.
  useEffect(() => {
    if (!live) return
    const tick = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(tick)
  }, [live])

  /**
   * A `409 wrong_stage` here means someone else already continued this run.
   * Swallowing it would re-enable the button and say nothing, so the server's
   * own account of the refusal goes on screen.
   */
  async function resume() {
    setBusy(true)
    setProblem(null)
    try {
      await continueRun(runId)
      await load()
    } catch (thrown) {
      setProblem(asApiError(thrown))
    } finally {
      setBusy(false)
    }
  }

  const back = (
    <button className="btn ghost" onClick={() => navigate('/runs')}>
      ← All runs
    </button>
  )

  // An unknown run id is a real lookup miss, and it says so as itself rather
  // than as an empty run: ADR-0009 exists because a run can be lost, and a
  // blank page would be the same picture as a run with nothing in it.
  if (error) {
    const missing = error.code === 'no_such_run'
    return (
      <div className="page narrow">
        <header className="top">
          <h1>{missing ? 'No such run' : 'That run could not be read'}</h1>
          <span className="grow" />
          {back}
        </header>
        <p className="foot">
          {missing ? (
            <>
              <code>/runs/{runId}</code> names no run. It may have been cancelled, or the link may
              be wrong — the runs index lists every run there is.
            </>
          ) : (
            error.message
          )}
        </p>
      </div>
    )
  }

  if (!run) return <div className="page foot">Loading run…</div>

  const { label, tone } = reading(run.status)
  const at = stepIndexOf(run.next)
  /**
   * A run that is moving is a column — the clock and the checklist read badly
   * stretched. A run with a ledger on it is three tables, and the measure the
   * ledger was chosen at. So the page takes the width its body needs rather
   * than one width for both.
   */
  const ledger = ['awaiting_review', 'awaiting_confirmation', 'done', 'abandoned'].includes(
    run.status,
  )

  return (
    <div className={ledger ? 'page' : 'page narrow'}>
      <header className="top">
        <h1 className="mono">{run.runId.slice(0, 8)}</h1>
        <span className={`pill ${tone}`}>
          {run.status === 'running' && <span className="dot pulse" />}
          {label}
        </span>
        <span className="grow" />
        {back}
      </header>

      <dl className="head">
        <dt>Batch</dt>
        <dd className="mono">{run.batch}</dd>
        <dt>Started</dt>
        <dd>{relativeTime(run.createdAt, now)}</dd>
      </dl>

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

      <Body run={run} at={at} now={now} busy={busy} onContinue={resume} onSnapshot={setRun} />
    </div>
  )
}

/** The half of the page that is different in every status. */
function Body({
  run,
  at,
  now,
  busy,
  onContinue,
  onSnapshot,
}: {
  run: RunSnapshot
  at: number
  now: number
  busy: boolean
  onContinue: () => Promise<void>
  /** The ledger's own answers come back as a snapshot, so a refusal reaches
   *  the reviewer in the response to their click rather than on a poll. */
  onSnapshot: (snapshot: RunSnapshot) => void
}) {
  if (run.status === 'running') {
    const current = STEPS[at]
    return (
      <>
        <div className="clock">{elapsed(run.createdAt, now)}</div>
        <p className="foot centred">
          {current ? `${current.name} — step ${at + 1} of ${STEPS.length}` : 'Finishing up'}
        </p>
        <Checklist at={at} />
        <p className="foot">
          Safe to close. The run keeps going without this tab, and it has its own link —{' '}
          <code>/runs/{run.runId}</code>
        </p>
      </>
    )
  }

  // `stalled` and `failed` are one word and one action. After a restart they
  // are the same picture anyway: the contract keeps no failure record.
  if (run.status === 'stalled' || run.status === 'failed') {
    const stoppedAt = STEPS[at]
    return (
      <>
        <div className="banner stop">
          <div className="grow">
            <h2>{run.status === 'failed' ? 'This run hit an error' : 'This run stopped part-way'}</h2>
            <p>
              {run.status === 'failed'
                ? 'A step threw while the run was in flight. Continuing re-runs that step from the last saved point.'
                : 'The server restarted while this run was working. Nothing is lost — it picks up from its last saved step.'}
              {stoppedAt && (
                <>
                  {' '}
                  It stopped at <b>{stoppedAt.name}</b>.
                </>
              )}
            </p>
          </div>
          <button className="btn primary" onClick={() => void onContinue()} disabled={busy}>
            Continue
          </button>
        </div>
        <Checklist at={at} stopped />
      </>
    )
  }

  if (run.status === 'awaiting_confirmation') {
    return (
      <>
        <div className="banner warn">
          <div className="grow">
            <h2>Waiting for you to confirm the Attio import</h2>
            {/* The sentence that is the point of this state: "waiting on you"
                says a person is needed, this says what happens if they are
                not. Nothing in Attio can be undone. */}
            <p>
              The files for <code>{run.batch}</code> are made · Notion still says{' '}
              <code>Ready for CRM</code>, and stays that way until this is confirmed.
            </p>
          </div>
        </div>
        {/* The same ledger, read-only: it is the record of what was decided,
            and replacing it with a summary of itself would put the reviewer's
            own work out of reach at exactly the moment they are attesting to
            it. The confirmation is inline underneath it rather than on a
            second screen, for the same reason. */}
        <Ledger run={run} onSnapshot={onSnapshot} readOnly />
        <Confirm run={run} onSnapshot={onSnapshot} />
      </>
    )
  }

  if (run.status === 'awaiting_review') {
    return (
      <>
        <Checklist at={at} />
        <Ledger run={run} onSnapshot={onSnapshot} />
      </>
    )
  }

  /**
   * Terminal, and **not** `done`. A `done` run wrote `Imported` to every row
   * it handed off; this one handed the same deals to Attio and could not mark
   * Notion, so its batch stays reserved — releasing it would let the next run
   * emit those deals a second time. Reading this as a finished run is the one
   * misreading that costs something, which is why it says what is unfinished
   * and names the rows.
   */
  if (run.status === 'abandoned') {
    const unwritten = failuresIn(run.writeBack)
    return (
      <>
        <div className="banner neutral">
          <div className="grow">
            <h2>The write-back was abandoned</h2>
            <p>
              This run is over, but it is not done. Its bundle is in Attio; Notion was never
              marked. The batch stays reserved so nobody hands these deals off a second time — a
              person sets the rows below to <code>Imported</code> in Notion by hand, and then
              deletes this run to release it.
            </p>
            {unwritten.length > 0 && (
              <p className="mono rows">
                {unwritten.map((failure) => failure.sourceId).sort().join(' · ')}
              </p>
            )}
          </div>
        </div>
        {/* The ledger stays: it is the record of what went to Attio, and it is
            what a person marking Notion by hand is reading from. */}
        <Ledger run={run} onSnapshot={onSnapshot} readOnly />
      </>
    )
  }

  return <Ledger run={run} onSnapshot={onSnapshot} readOnly />
}

/**
 * The four steps, marked against the pending node.
 *
 * Every step carries its explanation in every state, and the screening step
 * above all: it is the one nothing moves during, so hiding its sentence behind
 * a disclosure would put the explanation exactly where the wait is not.
 */
function Checklist({ at, stopped = false }: { at: number; stopped?: boolean }) {
  return (
    <ul className="steps">
      {STEPS.map((step, index) => {
        const state = index < at ? 'done' : index === at ? 'active' : 'pending'
        return (
          <li key={step.node} className={state} aria-current={state === 'active' && 'step'}>
            <span className={`mark ${state}`} aria-hidden>
              {state === 'done' ? '✓' : state === 'active' ? (stopped ? '⏸' : <span className="spinner" />) : '○'}
            </span>
            <span className="txt">
              <span className="name">{step.name}</span>
              <span className="detail">
                {state === 'active' && stopped ? 'stopped here' : step.detail}
              </span>
            </span>
          </li>
        )
      })}
    </ul>
  )
}
