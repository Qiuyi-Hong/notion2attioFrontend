/**
 * One run, addressed by its own identifier — the link that works from any
 * browser, and `404` for an identifier that names no run.
 *
 * The page renders **by status**, in the five names the Reviewer reads. What
 * a run needs from a person is different in each of them, so the page is not
 * one layout with a changing badge: a moving run gets a clock and a checklist,
 * a Stopped one gets its cause and **Continue**, and the two pauses get the
 * ledger — the surface backend #10 owns, stubbed here rather than faked.
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

  return (
    <div className="page narrow">
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

      <Body run={run} at={at} now={now} busy={busy} onContinue={resume} />
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
}: {
  run: RunSnapshot
  at: number
  now: number
  busy: boolean
  onContinue: () => Promise<void>
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
        <Stub>the files, the ledger and the confirmation land here — backend #10 owns them</Stub>
      </>
    )
  }

  if (run.status === 'awaiting_review') {
    return (
      <>
        <Checklist at={at} />
        <Stub>the candidate ledger lands here — backend #10 owns it</Stub>
      </>
    )
  }

  if (run.status === 'abandoned') {
    return (
      <Stub>
        The write-back was given up on. Some handed-off rows still read{' '}
        <code>Ready for CRM</code> in Notion, and this batch stays reserved until a person marks
        them and deletes this run.
      </Stub>
    )
  }

  return <Stub>the ledger, read-only, lands here — backend #10 owns it</Stub>
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
          <li key={step.node} className={state}>
            <span className={`mark ${state}`} aria-hidden>
              {state === 'done' ? '✓' : state === 'active' ? (stopped ? '⏸' : <Spinner />) : '○'}
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

const Spinner = () => <span className="spinner" />

/** A surface another ticket owns, said plainly rather than mocked up. */
const Stub = ({ children }: { children: React.ReactNode }) => (
  <div className="stub">{children}</div>
)
