/**
 * The candidate ledger — every candidate in the batch on one surface, grouped
 * by the Attio object it becomes.
 *
 * The bet, settled on backend #10 against a triage queue and an account
 * dossier: **the reviewer must be able to trust the whole output, not just the
 * exceptions.** Maya has only ever had a spreadsheet, and a screen that hides
 * seventeen of twenty-one candidates asks her to trust a rule set she has
 * never seen fail. So nothing is hidden, flagged rows are highlighted and
 * expand *in place*, and provenance sits on the value rather than in an audit
 * screen elsewhere.
 *
 * Three rules this file is careful about:
 *
 * - **It never derives what the server decides.** `held` and `cleared` are
 *   read, never worked out. The one exception is deliberate and narrow: the
 *   export gate counts answers the reviewer has given on screen but not yet
 *   sent, because a button that lights up only after a round trip is a button
 *   that lies about what the reviewer has done.
 * - **The quote span is never rendered.** It is not on the wire as a value of
 *   its own, and nothing here marks a span inside the notes. The reviewer
 *   reads their own text whole.
 * - **A Warn's answer is held back until Export.** The graph exports the
 *   moment the last Warn is answered, so sending answers as they are given
 *   would make the last click an irreversible export nobody meant. Holds,
 *   edits and Stop answers go straight out — none of them can clear a Warn, so
 *   none of them can trip the gate — which is what lets the hold cascade come
 *   back from the server rather than being guessed at here.
 */

import { useState } from 'react'
import {
  asApiError,
  postReview,
  type Answer,
  type ApiError,
  type BatchFlag,
  type Candidate,
  type Candidates,
  type Decision,
  type Flag,
  type Repair,
  type RunSnapshot,
} from './api.ts'
import {
  allOf,
  nameOf,
  notesOn,
  ownerTally,
  readTally,
  repairsOn,
  rowsBehind,
  sendable,
  SENTENCES,
  REFUSALS,
  siblingNames,
  stateOf,
  unansweredWarns,
} from './ledger.ts'

/**
 * `awaiting_review` is the only status that can be worked. The same ledger is
 * the record afterwards, so it renders read-only at the pauses and states past
 * it rather than being replaced by a summary of itself.
 */
export default function Ledger({
  run,
  onSnapshot,
  readOnly = false,
}: {
  run: RunSnapshot
  onSnapshot: (snapshot: RunSnapshot) => void
  readOnly?: boolean
}) {
  const { candidates, batchFlags, repairs } = run

  /** Inline edits the reviewer is still typing. Committed on blur. */
  const [drafts, setDrafts] = useState<Record<string, Record<string, string>>>({})
  /** Warn answers given here and not yet sent — see the header. */
  const [pending, setPending] = useState<Record<string, Answer>>({})
  /** Which candidates are open. Flagged ones start open; any can be opened. */
  const [opened, setOpened] = useState<Record<string, boolean>>({})
  /**
   * The notes show on **every** candidate, notice or not — that backstop is
   * what makes the screener safe to ship. Behind one switch rather than always
   * open, because density is a build constraint: eight rows is proven and the
   * sheet's fifty is not, and twenty-one open panels would bury the flags this
   * screen exists to surface. A row opened or closed by hand still wins.
   */
  const [allNotes, setAllNotes] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<ApiError | null>(null)

  /**
   * Every decision document names every hold the reviewer means to keep:
   * `held` is not sparse and replaces what came before. The ids come off the
   * snapshot rather than out of a local set, so a reload leaves the ledger
   * where the reviewer left it.
   */
  const holds = allOf(candidates)
    .filter((candidate) => candidate.heldByReviewer)
    .map((candidate) => candidate.id)

  async function send(decision: Decision) {
    setBusy(true)
    setProblem(null)
    try {
      onSnapshot(await postReview(run.runId, { held: holds, ...decision }))
    } catch (thrown) {
      setProblem(asApiError(thrown))
    } finally {
      setBusy(false)
    }
  }

  const toggleHold = (candidate: Candidate) =>
    send({
      held: candidate.heldByReviewer
        ? holds.filter((id) => id !== candidate.id)
        : [...holds, candidate.id],
    })

  /** An edit is taken exactly as typed and pins; re-typing what was proposed
   *  changes nothing, which is what the server's sparse `edits` makes knowable. */
  function commit(candidate: Candidate, field: string, value: string) {
    setDrafts((was) => {
      const next = { ...was, [candidate.id]: { ...was[candidate.id] } }
      delete next[candidate.id][field]
      if (!Object.keys(next[candidate.id]).length) delete next[candidate.id]
      return next
    })
    if (value !== (candidate as unknown as Record<string, string>)[field]) {
      void send({ edits: { [candidate.id]: { [field]: value } } })
    }
  }

  /** A Stop's answer goes out now: it cannot clear a Warn, so it cannot
   *  export, and the hold it lifts has to come back from the server. */
  const answerStop = (flagId: string, answer: Answer) =>
    send({ answers: { [flagId]: answer } })

  const answerWarn = (flagId: string, answer: Answer) =>
    setPending((given) => ({ ...given, [flagId]: answer }))

  const answered = new Set(Object.keys(pending))
  const open = unansweredWarns(candidates, batchFlags, answered)
  const going = sendable(candidates)

  /** Export is this route with every held-back answer on it. The gate is the
   *  server's; this button is the reviewer's reading of the same rule. */
  const exportBundle = () => send({ answers: pending })

  const shared = { candidates, repairs, drafts, setDrafts, commit, toggleHold, busy, readOnly, allNotes }
  const flagProps = { pending, answerStop, answerWarn, candidates, readOnly, busy }

  return (
    <div className="ledger">
      <div className="lede">
        <div className="grow">
          <h2>Everything this batch will create in Attio</h2>
          <p className="foot">
            Flagged candidates are highlighted and open in place. Any candidate can be opened for
            its full research notes, and held without giving a reason.
          </p>
        </div>
        <div className="tally">
          <Count n={going.length} k="going" tone="ok" />
          <Count n={allOf(candidates).length - going.length} k="held" tone="stop" />
          <Count n={open.length} k="unanswered" tone="warn" />
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

      <label className="allnotes">
        <input
          type="checkbox"
          checked={allNotes}
          onChange={(event) => setAllNotes(event.target.checked)}
        />
        Show the research notes on every candidate
      </label>

      <BatchPanel
        batchFlags={batchFlags}
        candidates={candidates}
        pending={pending}
        answerWarn={answerWarn}
        onOwner={(owner) =>
          send({
            edits: Object.fromEntries(
              candidates.deals.filter((deal) => !deal.held).map((deal) => [deal.id, { owner }]),
            ),
          })
        }
        readOnly={readOnly}
        busy={busy}
      />

      <Section
        title="Companies"
        note="Attio matches companies on the domain, which is why it is the one value here nobody may edit."
        columns={['Name', 'Domain', 'Segment', 'Primary location', 'Account', 'State', '']}
      >
        {candidates.companies.map((company) => (
          <Row
            key={company.id}
            candidate={company}
            opened={opened}
            setOpened={setOpened}
            {...shared}
            flagProps={flagProps}
            cells={[
              <Edit candidate={company} field="name" {...shared} />,
              <Marked candidate={company} field="domain" value={company.domain} repairs={repairs} readonly />,
              <Edit candidate={company} field="segment" {...shared} />,
              <Edit candidate={company} field="primaryLocation" {...shared} />,
              <Collapse company={company} candidates={candidates} repairs={repairs} />,
            ]}
          />
        ))}
      </Section>

      <Section
        title="People"
        note="Attio matches people on the work email address — the second value identity is keyed on, and the second nobody may edit."
        columns={['Name', 'Work email', 'Job title', 'Company', 'From', 'State', '']}
      >
        {candidates.people.map((person) => (
          <Row
            key={person.id}
            candidate={person}
            opened={opened}
            setOpened={setOpened}
            {...shared}
            flagProps={flagProps}
            cells={[
              <Edit candidate={person} field="name" {...shared} />,
              person.email ? (
                <span className="mono">{person.email}</span>
              ) : (
                <span className="mono missing">— none —</span>
              ),
              <Edit candidate={person} field="jobTitle" {...shared} />,
              <span>
                {candidates.companies.find((one) => one.id === person.companyId)?.name ?? '—'}
              </span>,
              <span className="mono from">{person.sourceId}</span>,
            ]}
          />
        ))}
      </Section>

      <Section
        title="Deals"
        note="Attio never matches a deal. Every row here is a permanent create, which is why only this object waits for its account to be whole."
        columns={['Deal', 'Company', 'Owner', 'From', 'State', '']}
      >
        {candidates.deals.map((deal) => (
          <Row
            key={deal.id}
            candidate={deal}
            opened={opened}
            setOpened={setOpened}
            {...shared}
            flagProps={flagProps}
            cells={[
              <span className="mono">{nameOf(deal, candidates)}</span>,
              <span>
                {candidates.companies.find((one) => one.id === deal.companyId)?.name ?? '—'}
              </span>,
              <Edit candidate={deal} field="owner" {...shared} />,
              <span className="mono from">{rowsBehind(deal, candidates, repairs).join(' · ')}</span>,
            ]}
          />
        ))}
      </Section>

      {!readOnly && (
        <div className="exportbar">
          <div className="grow">
            <b>{going.length}</b> candidates would be exported now
            {open.length > 0 && (
              <p className="foot gate">
                {open.length === 1 ? 'One Warn is' : `${open.length} Warns are`} still unanswered.
                A Warn excludes nothing, which is exactly why it has to be answered before the files
                are made — a notice nobody read would leave in the bundle silently.
              </p>
            )}
          </div>
          <button
            className="btn primary"
            disabled={busy || open.length > 0}
            onClick={() => void exportBundle()}
          >
            Make the handoff files
          </button>
        </div>
      )}
    </div>
  )
}

const Count = ({ n, k, tone }: { n: number; k: string; tone: string }) => (
  <div>
    <div className={`n ${tone}`}>{n}</div>
    <div className="k">{k}</div>
  </div>
)

/** One Attio object's table, in its own horizontal scroll container: density
 *  at eight rows is proven, and at the sheet's fifty it is not. */
function Section({
  title,
  note,
  columns,
  children,
}: {
  title: string
  note: string
  columns: string[]
  children: React.ReactNode
}) {
  return (
    <section className="lsec">
      <div className="lsechead">
        <h3>{title}</h3>
        <span>{note}</span>
      </div>
      <div className="lscroll">
        <table className="ltbl">
          <thead>
            <tr>
              {columns.map((column, index) => (
                <th key={index}>{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
      </div>
    </section>
  )
}

/**
 * One candidate, and the panel it opens into.
 *
 * The panel is a second `<tr>` immediately below rather than an overlay or a
 * route: nothing above it moves, so the reviewer never loses their place in
 * the batch — which is the whole of *expand in place*.
 */
function Row({
  candidate,
  cells,
  opened,
  setOpened,
  candidates,
  repairs,
  toggleHold,
  busy,
  readOnly,
  allNotes,
  flagProps,
}: {
  candidate: Candidate
  cells: React.ReactNode[]
  opened: Record<string, boolean>
  setOpened: React.Dispatch<React.SetStateAction<Record<string, boolean>>>
  candidates: Candidates
  repairs: Repair[]
  toggleHold: (candidate: Candidate) => void
  busy: boolean
  readOnly: boolean
  allNotes: boolean
  flagProps: FlagProps
} & Record<string, unknown>) {
  const flags = candidate.flags
  const worst = flags.find((flag) => !flag.cleared)
  // A row the reviewer opened or closed by hand outranks both defaults.
  const isOpen = opened[candidate.id] ?? (allNotes || Boolean(worst))
  const state = stateOf(candidate)
  const span = cells.length + 2

  return (
    <>
      <tr
        className={`${worst ? `flagged ${worst.level}` : ''} ${candidate.held ? 'held' : ''}`}
      >
        {cells.map((cell, index) => (
          <td key={index}>{cell}</td>
        ))}
        <td>
          <span className={`pill ${state.tone}`}>{state.label}</span>
          {candidate.heldByReviewer && <span className="byyou">you held this</span>}
        </td>
        <td className="act">
          <button
            className="btn ghost sm"
            aria-expanded={isOpen}
            onClick={() => setOpened((was) => ({ ...was, [candidate.id]: !isOpen }))}
          >
            {isOpen ? 'Close' : flags.length ? 'Open' : 'Notes'}
          </button>
          {!readOnly && (
            <label className="holdlbl">
              <input
                type="checkbox"
                checked={candidate.heldByReviewer}
                disabled={busy}
                onChange={() => toggleHold(candidate)}
              />
              hold
            </label>
          )}
        </td>
      </tr>

      {isOpen && (
        <tr className={candidate.held ? 'held' : ''}>
          <td className="expand" colSpan={span}>
            <div className="expand-in">
              {flags.map((flag) => (
                <FlagPanel key={flag.id} flag={flag} {...flagProps} />
              ))}
              <Notes candidate={candidate} candidates={candidates} />
              <Repairs candidate={candidate} repairs={repairs} />
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

type FlagProps = {
  pending: Record<string, Answer>
  answerStop: (flagId: string, answer: Answer) => void
  answerWarn: (flagId: string, answer: Answer) => void
  candidates: Candidates
  readOnly: boolean
  busy: boolean
}

/**
 * One flag, with its own control and no other way to clear it.
 *
 * Editing a value near a flag answers nothing — the candidate set and the flag
 * set are frozen at the check pass — so the control is the only thing here
 * that clears one, and a value edited beside an open flag stays flagged.
 */
function FlagPanel({
  flag,
  pending,
  answerStop,
  answerWarn,
  candidates,
  readOnly,
  busy,
}: { flag: Flag } & FlagProps) {
  const [email, setEmail] = useState('')
  const sentence = SENTENCES[flag.rule]
  const given = pending[flag.id] !== undefined
  const cleared = flag.cleared || given
  const siblings = siblingNames(flag, candidates)

  const badge =
    flag.level === 'stop' ? 'Stop' : flag.kind === 'decision' ? 'Decision' : 'Notice'

  return (
    <div className={`flagpanel ${cleared ? 'cleared' : flag.level === 'stop' ? 'stop' : flag.kind}`}>
      <div className="flaghead">
        <span className={`pill ${cleared ? 'ok' : flag.level === 'stop' ? 'stop' : 'warn'}`}>
          {cleared ? (flag.kind === 'notice' ? '✓ Read' : '✓ Answered') : badge}
        </span>
        <b>{sentence.title}</b>
      </div>
      <p className="foot">{sentence.detail}</p>

      {siblings.length > 0 && (
        <p className="foot siblings">
          Waiting on {siblings.join(', ')} — completing the account is what clears this.
        </p>
      )}

      {flag.refused && <p className="refused">{REFUSALS[flag.refused]}</p>}

      {!readOnly && !cleared && flag.rule === 'B1' && (
        <div className="actions">
          <input
            className="inp"
            type="email"
            placeholder="work email address"
            value={email}
            disabled={busy}
            onChange={(event) => setEmail(event.target.value)}
          />
          <button
            className="btn"
            disabled={busy || !email}
            onClick={() => answerStop(flag.id, { email })}
          >
            Use this address
          </button>
          {flag.override && (
            <button className="btn" disabled={busy} onClick={() => answerStop(flag.id, true)}>
              Send without one
            </button>
          )}
        </div>
      )}

      {/* D1 is the one flag with no control. It is cleared by its account
          becoming whole, which is what the sibling line above says. */}
      {!readOnly && !cleared && flag.level === 'warn' && (
        <div className="actions">
          <button className="btn" disabled={busy} onClick={() => answerWarn(flag.id, true)}>
            {flag.kind === 'notice' ? 'I have read this' : 'Confirm'}
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * The full `Research notes`, on every candidate, notice or not.
 *
 * This is the backstop that makes the notes screener safe to ship: the model
 * cannot narrow what the reviewer can see, only force an acknowledgement. If
 * it misses a line, the reviewer is left exactly where their spreadsheet left
 * them, which is an acceptable floor — and if the prose were shown only when a
 * notice fired, a recall failure would be invisible.
 *
 * No span is marked inside it. The quote is a check, not a display, and it
 * lands somewhere else between identical runs.
 */
function Notes({ candidate, candidates }: { candidate: Candidate; candidates: Candidates }) {
  const notes = notesOn(candidate, candidates)
  return (
    <div className="notes">
      <div className="eyebrow">Research notes</div>
      {notes.length === 0 ? (
        <p className="foot">No research notes were written on the rows behind this candidate.</p>
      ) : (
        notes.map((note) => (
          <p key={note.sourceId} className="note">
            <span className="mono from">{note.sourceId}</span> {note.text}
          </p>
        ))
      )}
    </div>
  )
}

/** Every repair on this candidate, said in full — the values above carry the
 *  same originals on hover, and this is the same log, not a second one. */
function Repairs({ candidate, repairs }: { candidate: Candidate; repairs: Repair[] }) {
  const mine = repairs.filter((repair) => repair.candidateId === candidate.id)
  if (mine.length === 0) return null
  return (
    <div className="repairs">
      <div className="eyebrow">Repaired before you saw it</div>
      {mine.map((repair, index) => (
        <p key={index} className="foot">
          <span className="mono from">{repair.sourceId}</span> {repair.field} ·{' '}
          <span className="mono was-from">{repair.from}</span> → <span className="mono">{repair.to}</span>
        </p>
      ))}
    </div>
  )
}

/**
 * A value with its repair marked on it, and the original on hover. Provenance
 * sits on the value; there is no audit screen to open.
 *
 * Two repairs on one value is Brightyard's collapse, said where the value is:
 * two spellings of one website became one domain, and both are here.
 */
function Marked({
  candidate,
  field,
  value,
  repairs,
  readonly = false,
}: {
  candidate: Candidate
  field: string
  value: string
  repairs: Repair[]
  readonly?: boolean
}) {
  const mine = repairsOn(repairs, candidate.id, field)
  const body = <span className="mono">{value}</span>
  if (mine.length === 0) return readonly ? <span className="ro">{body}</span> : body
  return (
    <span className={readonly ? 'ro' : undefined}>
      <span className="was" title={mine.map((repair) => `was ${repair.from}`).join('\n')}>
        {value}
      </span>
    </span>
  )
}

/**
 * A field the files carry, edited where it sits. Committed on blur, so a
 * half-typed value never leaves — and re-typing what the pipeline proposed
 * sends nothing, which is what keeps *touched* a fact.
 */
function Edit({
  candidate,
  field,
  drafts,
  setDrafts,
  commit,
  repairs,
  busy,
  readOnly,
}: {
  candidate: Candidate
  field: string
  drafts: Record<string, Record<string, string>>
  setDrafts: React.Dispatch<React.SetStateAction<Record<string, Record<string, string>>>>
  commit: (candidate: Candidate, field: string, value: string) => void
  repairs: Repair[]
  busy: boolean
  readOnly: boolean
} & Record<string, unknown>) {
  const stored = (candidate as unknown as Record<string, string>)[field] ?? ''
  const value = drafts[candidate.id]?.[field] ?? stored
  const pinned = candidate.overrides.includes(field)

  if (readOnly) return <Marked candidate={candidate} field={field} value={stored} repairs={repairs} />

  return (
    <span className={`celledit ${pinned ? 'pinned' : ''}`}>
      <input
        className="cellinp"
        value={value}
        disabled={busy}
        title={
          repairsOn(repairs, candidate.id, field)
            .map((repair) => `was ${repair.from}`)
            .join('\n') || undefined
        }
        onChange={(event) =>
          setDrafts((was) => ({
            ...was,
            [candidate.id]: { ...was[candidate.id], [field]: event.target.value },
          }))
        }
        onBlur={(event) => commit(candidate, field, event.target.value)}
      />
    </span>
  )
}

/** What a Company's account is — the collapse, rendered rather than implied. */
function Collapse({
  company,
  candidates,
  repairs,
}: {
  company: Candidate
  candidates: Candidates
  repairs: Repair[]
}) {
  const people = candidates.people.filter((person) => person.companyId === company.id)
  const deals = candidates.deals.filter((deal) => deal.companyId === company.id)
  const rows = rowsBehind(company, candidates, repairs)

  return (
    <span className="collapse">
      <span className="mono from">{rows.join(' · ')}</span>
      <span className={rows.length > 1 ? 'merged' : 'foot'}>
        {rows.length > 1 ? `${rows.length} source rows merged · ` : ''}
        {people.length} {people.length === 1 ? 'person' : 'people'} · {deals.length}{' '}
        {deals.length === 1 ? 'deal' : 'deals'}
      </span>
    </span>
  )
}

/**
 * The batch flags, asked once, in one place, before the files are made.
 *
 * The owner and the stage sit together because they are one question (#18),
 * and they are answered differently because their provenance differs. `Deal
 * stage` has no Notion column, so it is the flag's own payload. `Deal owner`
 * is already on every Deal candidate, so the panel edits *those* rather than
 * carrying a second copy — and the tally beside it is derived from the deals
 * as they stand, so it moves as candidates are held and cleared.
 */
function BatchPanel({
  batchFlags,
  candidates,
  pending,
  answerWarn,
  onOwner,
  readOnly,
  busy,
}: {
  batchFlags: BatchFlag[]
  candidates: Candidates
  pending: Record<string, Answer>
  answerWarn: (flagId: string, answer: Answer) => void
  onOwner: (owner: string) => void
  readOnly: boolean
  busy: boolean
}) {
  const decision = batchFlags.find((flag) => flag.rule === 'P1+P2')
  const [stage, setStage] = useState(decision?.stage ?? '')
  const [owner, setOwner] = useState<string | null>(null)

  const tally = ownerTally(candidates.deals)
  const going = candidates.deals.filter((deal) => !deal.held).length
  const single = tally.length === 1

  return (
    <div className="batchflags">
      {batchFlags.map((flag) => {
        const cleared = flag.cleared || pending[flag.id] !== undefined
        const sentence = SENTENCES[flag.rule]
        return (
          <div key={flag.id} className={`batchflag ${cleared ? 'cleared' : ''}`}>
            <div className="flaghead">
              <span className={`pill ${cleared ? 'ok' : 'warn'}`}>
                {cleared ? (flag.kind === 'notice' ? '✓ Read' : '✓ Answered') : flag.kind === 'notice' ? 'Notice' : 'Decision'}
              </span>
              <b>{sentence.title}</b>
            </div>
            <p className="foot">{sentence.detail}</p>
            {flag.refused && <p className="refused">{REFUSALS[flag.refused]}</p>}

            {flag.rule === 'P1+P2' && (
              <>
                {/* Derived, and it moves: it describes the batch as it stands,
                    so storing it beside the flag would let the two disagree. */}
                <p className="derived">
                  <b>{going}</b> {going === 1 ? 'deal' : 'deals'} → owner{' '}
                  <b>{tally.length ? readTally(tally) : '—'}</b>, stage <b>{stage || '—'}</b>
                </p>
                {!readOnly && (
                  <div className="actions">
                    <label className="field">
                      Deal owner
                      <input
                        className="inp"
                        value={owner ?? (single ? tally[0].owner : readTally(tally))}
                        disabled={busy || !single}
                        title={single ? undefined : 'This batch names more than one owner — edit them on their own Deal rows.'}
                        onChange={(event) => setOwner(event.target.value)}
                        onBlur={(event) => {
                          if (single && event.target.value !== tally[0].owner) {
                            onOwner(event.target.value)
                            setOwner(null)
                          }
                        }}
                      />
                    </label>
                    <label className="field">
                      Deal stage
                      <input
                        className="inp"
                        value={stage}
                        disabled={busy}
                        onChange={(event) => setStage(event.target.value)}
                      />
                    </label>
                    <button
                      className="btn"
                      disabled={busy || cleared || !stage}
                      onClick={() => answerWarn(flag.id, { stage })}
                    >
                      Confirm both
                    </button>
                  </div>
                )}
              </>
            )}

            {flag.rule === 'N0' && !readOnly && !cleared && (
              <div className="actions">
                <button className="btn" disabled={busy} onClick={() => answerWarn(flag.id, true)}>
                  I have read this
                </button>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
