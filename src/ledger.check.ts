/**
 * The rules the ledger is *for*, checked without a browser: the export gate,
 * the counts that move, the notes reaching every candidate, and the two things
 * that must never be re-derived here.
 *
 * Run it with `npm run check`, beside `runs.check.ts`. Node strips the types;
 * there is no test framework here and none is wanted — the surface itself is
 * verified by hand, per the ticket.
 *
 * The batch below is 2026-W34's shape rather than its bytes: two rows on one
 * company (Brightyard), one Person with no work email (Tern), and one notice.
 * That is every case the ticket names, and it is the smallest fixture that
 * holds them.
 */

import type { BatchFlag, Candidates, Deal, Flag, Person, Repair } from './api.ts'
import {
  notesOn,
  ownerTally,
  readTally,
  repairsOn,
  rowsBehind,
  sendable,
  SENTENCES,
  siblingNames,
  stateOf,
  unansweredWarns,
} from './ledger.ts'

let failures = 0
function ok(claim: string, passed: boolean) {
  if (!passed) failures++
  console.log(`${passed ? 'ok  ' : 'FAIL'}  ${claim}`)
}

// ── The batch ──────────────────────────────────────────────────────────────

const clear = { held: false, heldByReviewer: false, overrides: [], flags: [] }

const flag = (over: Partial<Flag> & Pick<Flag, 'id' | 'rule' | 'level'>): Flag => ({
  kind: null,
  override: false,
  siblings: [],
  cleared: false,
  refused: null,
  ...over,
})

const person = (over: Partial<Person> & Pick<Person, 'id' | 'sourceId' | 'companyId' | 'name'>): Person => ({
  ...clear,
  email: `${over.name.split(' ')[0].toLowerCase()}@example.com`,
  jobTitle: 'Head of Ops',
  linkedIn: '',
  leadSource: 'Event',
  notes: [],
  ...over,
})

const deal = (over: Partial<Deal> & Pick<Deal, 'id' | 'companyId'>): Deal => ({
  ...clear,
  owner: 'Maya',
  ...over,
})

/** Tern's Person carries the one Stop with a control; its Deal carries D1. */
const b1 = flag({ id: 'B1:person:tern', rule: 'B1', level: 'stop', override: true })
const d1 = flag({
  id: 'D1:deal:tern',
  rule: 'D1',
  level: 'stop',
  siblings: ['person:tern'],
})
/** Brightyard's two People put a decision Warn on its Deal. */
const w1 = flag({ id: 'W1:deal:brightyard', rule: 'W1', level: 'warn', kind: 'decision' })
/** Heliograph's Person carries the notice. */
const n1 = flag({ id: 'N1:person:heliograph', rule: 'N1', level: 'warn', kind: 'notice' })

const candidates: Candidates = {
  companies: [
    { ...clear, id: 'company:brightyard', name: 'Brightyard', domain: 'brightyard.example.com', segment: 'Mid-market', primaryLocation: 'Leeds' },
    { ...clear, id: 'company:tern', name: 'Tern Mobility', domain: 'tern.example.com', segment: 'SMB', primaryLocation: 'Bristol' },
    { ...clear, id: 'company:heliograph', name: 'Heliograph Systems', domain: 'heliograph.example.com', segment: 'Enterprise', primaryLocation: 'Manchester' },
  ],
  people: [
    person({ id: 'person:rae', sourceId: 'AC-1', companyId: 'company:brightyard', name: 'Rae Okonkwo', notes: [{ sourceId: 'AC-1', text: 'Met at the Leeds meetup.' }] }),
    person({ id: 'person:dev', sourceId: 'AC-2', companyId: 'company:brightyard', name: 'Dev Alvarez', notes: [{ sourceId: 'AC-2', text: 'Second contact at the same account.' }] }),
    person({ ...clear, id: 'person:tern', sourceId: 'AC-3', companyId: 'company:tern', name: 'Amina Yusuf', email: '', flags: [b1], held: true, notes: [{ sourceId: 'AC-3', text: 'No work email was captured; LinkedIn is verified.' }] }),
    person({ id: 'person:heliograph', sourceId: 'AC-4', companyId: 'company:heliograph', name: 'Noor Haddad', flags: [n1], notes: [{ sourceId: 'AC-4', text: 'She previously spoke to the team under another email address.' }] }),
  ],
  deals: [
    deal({ id: 'deal:brightyard', companyId: 'company:brightyard', flags: [w1] }),
    deal({ id: 'deal:tern', companyId: 'company:tern', flags: [d1], held: true }),
    deal({ id: 'deal:heliograph', companyId: 'company:heliograph', owner: 'Tom' }),
  ],
}

const batchFlags: BatchFlag[] = [
  { id: 'P1+P2:batch', rule: 'P1+P2', level: 'warn', kind: 'decision', stage: 'Lead', cleared: false, refused: null },
]

/** Two spellings of one website repaired into one domain — the collapse. */
const repairs: Repair[] = [
  { sourceId: 'AC-1', candidateId: 'company:brightyard', field: 'domain', from: 'https://Brightyard.example.com/uk', to: 'brightyard.example.com' },
  { sourceId: 'AC-2', candidateId: 'company:brightyard', field: 'domain', from: 'www.brightyard.example.com', to: 'brightyard.example.com' },
]

const byId = (id: string) =>
  [...candidates.companies, ...candidates.people, ...candidates.deals].find((one) => one.id === id)!

// ── Every candidate is on screen, and reads as one of three words ──────────

ok(
  'every candidate in the batch is in the ledger, grouped by object',
  candidates.companies.length + candidates.people.length + candidates.deals.length === 10,
)
ok(
  'a candidate reads as Clear, Needs decision or Held, and never works the hold out',
  stateOf(byId('person:rae')).label === 'Clear' &&
    stateOf(byId('deal:brightyard')).label === 'Needs decision' &&
    stateOf(byId('person:tern')).label === 'Held' &&
    // Held is read off `held` alone: this Deal's D1 is a Stop, and the server
    // is what decided the account is not whole.
    stateOf(byId('deal:tern')).label === 'Held',
)

// ── The full notes, on every candidate, notice or not ──────────────────────

ok(
  'a Person shows its own notes whether or not a notice was raised',
  notesOn(byId('person:rae'), candidates).length === 1 &&
    notesOn(byId('person:heliograph'), candidates).length === 1,
)
ok(
  "a Company and a Deal reach their account's notes rather than holding a copy",
  notesOn(byId('company:brightyard'), candidates).map((note) => note.sourceId).join() === 'AC-1,AC-2' &&
    notesOn(byId('deal:brightyard'), candidates).map((note) => note.sourceId).join() === 'AC-1,AC-2',
)
ok(
  'every candidate in the batch can show notes',
  [...candidates.companies, ...candidates.people, ...candidates.deals].every(
    (candidate) => notesOn(candidate, candidates).length > 0,
  ),
)

// ── The Brightyard collapse ────────────────────────────────────────────────

ok(
  'two source rows are one Company with two People and one Deal',
  rowsBehind(byId('company:brightyard'), candidates, repairs).join() === 'AC-1,AC-2' &&
    candidates.people.filter((one) => one.companyId === 'company:brightyard').length === 2 &&
    candidates.deals.filter((one) => one.companyId === 'company:brightyard').length === 1,
)
ok(
  'and both originals are kept, so the collapse is markable at the value',
  repairsOn(repairs, 'company:brightyard', 'domain').map((repair) => repair.from).length === 2,
)
ok(
  'a candidate nothing was repaired on is marked nowhere',
  repairsOn(repairs, 'company:tern', 'domain').length === 0,
)

// ── The export gate ────────────────────────────────────────────────────────

const openWarns = () => unansweredWarns(candidates, batchFlags).map((one) => one.id)

ok(
  'export is refused while any Warn is unanswered, candidate and batch alike',
  openWarns().join() === 'N1:person:heliograph,W1:deal:brightyard,P1+P2:batch',
)
ok(
  'a Stop is not in the gate — it removes a candidate, it does not block the batch',
  !openWarns().includes('B1:person:tern') && !openWarns().includes('D1:deal:tern'),
)
ok(
  'an answer given on screen closes the gate before it is sent',
  unansweredWarns(candidates, batchFlags, new Set(openWarns())).length === 0,
)

// ── A Deal's Stop names the sibling that caused it ─────────────────────────

ok(
  "a Deal's Stop names its sibling, so completing the account is visibly what clears it",
  siblingNames(d1, candidates).join() === 'Amina Yusuf',
)
ok('and a flag that names nobody names nobody', siblingNames(w1, candidates).length === 0)

// ── The counts that move ───────────────────────────────────────────────────

ok(
  'the count tracks what would be exported now, not what the batch holds',
  sendable(candidates).length === 8,
)

const tally = ownerTally(candidates.deals)
ok(
  'the owner tally is derived from the deals as they stand, and drops the Held',
  readTally(tally) === 'Maya (1), Tom (1)',
)
ok(
  'a batch naming one owner reads as that one name',
  readTally(ownerTally([deal({ id: 'a', companyId: 'x' }), deal({ id: 'b', companyId: 'y' })])) === 'Maya',
)

// ── No prose travels; every word about a flag is written here ──────────────

ok(
  'every rule the wire can carry has a sentence',
  (['B1', 'W1', 'D1', 'N1', 'N2', 'N1+N2', 'P1+P2', 'N0'] as const).every(
    (rule) => SENTENCES[rule].title !== '' && SENTENCES[rule].detail !== '',
  ),
)
ok(
  'a notice sends the reviewer to their own notes rather than to a quote',
  ['N1', 'N2', 'N1+N2'].every((rule) =>
    /full notes/.test(SENTENCES[rule as 'N1'].detail),
  ),
)

if (failures) throw new Error(`${failures} failed`)
console.log('\nall ok')
