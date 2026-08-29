/**
 * How the ledger reads: what a flag says, what state a candidate is in, and
 * the handful of values that are *derived* rather than sent.
 *
 * Pure, so the rules that carry the ticket's argument can be read — and
 * checked — without a browser. `ledger.check.ts` is the check.
 *
 * The one rule this file does **not** hold is the hold cascade. `held` is
 * computed server-side, in one place, and re-deriving it here would let the
 * two disagree about what reaches Attio. Everything below reads `held`; it
 * never works it out.
 *
 * `CONTEXT.md` and `docs/http-contract.md` in the backend repo are
 * authoritative.
 */

import type {
  BatchFlag,
  Candidate,
  Candidates,
  Company,
  Deal,
  Flag,
  Person,
  Refusal,
  Repair,
} from './api.ts'

/**
 * The fixed sentence a rule renders as.
 *
 * No prose travels on the wire — a flag carries a rule name and nothing to
 * narrate with — so every word the reviewer reads about a flag is written
 * here. That is what keeps the screener's model unable to put a sentence in
 * front of them: it selects a kind, and this table says what a kind means.
 *
 * `detail` is always the *consequence*, never a restatement of the title. A
 * reviewer deciding whether to force past a Stop is deciding about what
 * happens in Attio, and Attio is where the cost is.
 */
export type Sentence = { title: string; detail: string }

/**
 * One sentence, shared by all three notices, and the reason the quote it was
 * raised on is not beside it. A notice relays a suspicion the pipeline cannot
 * check, and the span the model pointed at moves between identical runs — so
 * the reviewer is sent to their own notes, which are on screen in full, rather
 * than to a highlight that would be somewhere else tomorrow.
 */
const NOTICE =
  'Nothing changes either way — this pipeline never reads Attio, so it can relay the note but cannot check it. The full notes are below, and reading them is the whole of the answer.'

export const SENTENCES: Record<Flag['rule'] | BatchFlag['rule'], Sentence> = {
  B1: {
    title: 'No work email.',
    detail:
      'Attio matches People on the email address. Without one this person can never be matched again, so every future import creates another copy of them.',
  },
  W1: {
    title: 'Two or more People on this Company.',
    detail:
      'Attio merges the people itself. Deals have no unique attribute and always create, so this confirms one opportunity rather than one per source row.',
  },
  D1: {
    title: 'This account is not whole.',
    detail:
      'A Deal is sent only once every candidate in its account is Clear — a Deal attached to nobody is a record no one can undo. Completing the account is what clears this; there is no way to force past it.',
  },
  N1: {
    title: 'The research notes mention an earlier contact under a different email address.',
    detail: NOTICE,
  },
  N2: {
    title: 'The research notes mention a match with an earlier campaign.',
    detail: NOTICE,
  },
  'N1+N2': {
    title:
      'The research notes mention an earlier contact under a different email address, and a match with an earlier campaign.',
    detail: NOTICE,
  },
  'P1+P2': {
    title: 'Attio needs a Deal owner and a Deal stage on every deal.',
    detail:
      'Notion holds neither, so both are asked here, once, and applied to the whole batch. Nothing exports until they are confirmed.',
  },
  N0: {
    title: 'The research notes were not read.',
    detail:
      'No model key was configured for this run, so nothing screened them. A batch that skipped the notes never looks clean — read them in the ledger and acknowledge this.',
  },
}

/** What a refused answer says on the flag it was given to. */
export const REFUSALS: Record<Refusal, string> = {
  invalid_email: 'That is not an address Attio can match a person on.',
  duplicate_email: 'Another Person in this batch already holds that address.',
  new_owner:
    'A Deal has become sendable under an owner your answer did not name. A count that moves is not a reason to ask again; a new name on a record Attio always creates is.',
}

// ── Candidate state ────────────────────────────────────────────────────────

/** The three words the reviewer reads, replacing the sheet's `READY`/`CHECK`. */
export type State = { label: 'Clear' | 'Needs decision' | 'Held'; tone: 'ok' | 'warn' | 'stop' }

/**
 * Read off the candidate, never worked out here. `held` already carries the
 * Stops, the reviewer's holds and the Company cascade, decided server-side;
 * all that is left is which of the three words to say.
 *
 * `answered` is what the reviewer has answered on screen but not yet sent —
 * the same reading the export gate takes, for the same reason. Without it the
 * row would still read *Needs decision* while the flag's own panel read
 * *Answered* and the header count had already moved: three places on one
 * screen disagreeing about one act the reviewer just performed.
 *
 * It cannot make a candidate un-Held. A hold is the server's to lift.
 */
export const stateOf = (
  candidate: Candidate,
  answered: ReadonlySet<string> = new Set(),
): State =>
  candidate.held
    ? { label: 'Held', tone: 'stop' }
    : candidate.flags.some((flag) => !flag.cleared && !answered.has(flag.id))
      ? { label: 'Needs decision', tone: 'warn' }
      : { label: 'Clear', tone: 'ok' }

/** Every candidate in the batch, whichever object it becomes. */
export const allOf = (candidates: Candidates): Candidate[] => [
  ...candidates.companies,
  ...candidates.people,
  ...candidates.deals,
]

/** A candidate's name as the ledger shows it — a Deal has none of its own. */
export const nameOf = (candidate: Candidate, candidates: Candidates): string => {
  if ('domain' in candidate) return candidate.name
  if ('email' in candidate) return candidate.name
  const company = candidates.companies.find((one) => one.id === candidate.companyId)
  return company ? `${company.name} — New business` : candidate.id
}

/** Naming the siblings a Stop waits on, which is what makes completing the
 *  account visibly the thing that clears it. */
export const siblingNames = (flag: Flag, candidates: Candidates): string[] =>
  flag.siblings.flatMap((id) => {
    const sibling = allOf(candidates).find((one) => one.id === id)
    return sibling ? [nameOf(sibling, candidates)] : []
  })

// ── The account ────────────────────────────────────────────────────────────

/** One Company with the People and the Deal derived alongside it. */
export type Account = { company: Company; people: Person[]; deal: Deal | undefined }

export const accountOf = (companyId: string, candidates: Candidates): Account | undefined => {
  const company = candidates.companies.find((one) => one.id === companyId)
  if (!company) return undefined
  return {
    company,
    people: candidates.people.filter((one) => one.companyId === companyId),
    deal: candidates.deals.find((one) => one.companyId === companyId),
  }
}

/**
 * The source rows behind a candidate, which is where a collapse becomes
 * visible: Brightyard's two rows are one Company, and this is the count that
 * says so.
 *
 * Derived from what the wire already carries rather than sent — a Person names
 * its row, its notes name theirs, and a repair names the row it repaired. A
 * Company is the union of its account's; a Deal's account is the same one.
 */
export const rowsBehind = (
  candidate: Candidate,
  candidates: Candidates,
  repairs: Repair[],
): string[] => {
  const rows = new Set<string>()
  const fromPerson = (person: Person) => {
    rows.add(person.sourceId)
    person.notes.forEach((note) => rows.add(note.sourceId))
  }

  /** The repairs that landed on one candidate, whoever it is. */
  const fromRepairs = (candidateId: string) =>
    repairs
      .filter((repair) => repair.candidateId === candidateId)
      .forEach((repair) => rows.add(repair.sourceId))

  if ('email' in candidate) fromPerson(candidate)
  else {
    const companyId = 'domain' in candidate ? candidate.id : candidate.companyId
    // The account's People, and their repairs: a row that collapsed onto a
    // Person and was only ever seen through a repair belongs in the count too.
    accountOf(companyId, candidates)?.people.forEach((person) => {
      fromPerson(person)
      fromRepairs(person.id)
    })
  }
  fromRepairs(candidate.id)

  return [...rows].sort()
}

/**
 * The notes a candidate shows — the full `Research notes`, for every
 * candidate, whether or not a notice was raised. That backstop is what makes
 * the screener safe to ship: a recall failure leaves the reviewer exactly
 * where their spreadsheet left them, rather than leaving it invisible.
 *
 * A Person's own; a Company's and a Deal's are their account's People's,
 * reached through rather than copied.
 */
export const notesOn = (candidate: Candidate, candidates: Candidates) => {
  if ('email' in candidate) return candidate.notes
  const companyId = 'domain' in candidate ? candidate.id : candidate.companyId
  return accountOf(companyId, candidates)?.people.flatMap((person) => person.notes) ?? []
}

/** The repairs that landed on one field, so the value can be marked in place. */
export const repairsOn = (repairs: Repair[], candidateId: string, field: string): Repair[] =>
  repairs.filter((repair) => repair.candidateId === candidateId && repair.field === field)

// ── The export gate, and the counts that move ──────────────────────────────

/**
 * The batch refuses to export while any Warn is unanswered.
 *
 * A **Stop** is not in this reading, and that is the design: an uncleared Stop
 * makes its candidate Held, so it removes a candidate from the files instead
 * of blocking them. A Warn excludes nothing, which is exactly why it has to be
 * answered — a notice nobody read would otherwise leave in the bundle
 * silently.
 *
 * `answered` is what the reviewer has answered on this screen but not yet
 * sent. The gate is the reviewer's own reading of their work, so it counts
 * both; the server enforces the same rule when the decision lands.
 */
export const unansweredWarns = (
  candidates: Candidates,
  batchFlags: BatchFlag[],
  answered: ReadonlySet<string> = new Set(),
): (Flag | BatchFlag)[] =>
  [...allOf(candidates).flatMap((candidate) => candidate.flags), ...batchFlags].filter(
    (flag) => flag.level === 'warn' && !flag.cleared && !answered.has(flag.id),
  )

/** What would be exported now — the bundle holds every Clear and answered
 *  candidate, and no Held one. */
export const sendable = (candidates: Candidates): Candidate[] =>
  allOf(candidates).filter((candidate) => !candidate.held)

/**
 * The owners the batch would create deals under, with a count each.
 *
 * A **derived value**: it describes the batch as it stands and moves while the
 * reviewer works, so storing it beside the flag would let the two disagree.
 * Held deals are not in it — the count tracks what would be exported now.
 */
export const ownerTally = (deals: Deal[]): { owner: string; deals: number }[] => {
  const counted = new Map<string, number>()
  for (const deal of deals.filter((one) => !one.held)) {
    counted.set(deal.owner, (counted.get(deal.owner) ?? 0) + 1)
  }
  return [...counted]
    .map(([owner, count]) => ({ owner, deals: count }))
    .sort((a, b) => b.deals - a.deals || a.owner.localeCompare(b.owner))
}

/** `Maya (6), Tom (2)` — or just `Maya` where the batch names one. */
export const readTally = (tally: { owner: string; deals: number }[]): string =>
  tally.length === 1
    ? tally[0].owner
    : tally.map(({ owner, deals }) => `${owner} (${deals})`).join(', ')
