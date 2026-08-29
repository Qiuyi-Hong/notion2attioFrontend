/**
 * The rules the confirmation is *for*, checked without a browser: import
 * order, the gate that disables Confirm with its reason, the retry panel
 * derived from the failure list, who may abandon, and the two opposite
 * assertions.
 *
 * Run it with `npm run check`, beside `runs.check.ts` and `ledger.check.ts`.
 * Node strips the types; there is no test framework here and none is wanted —
 * the surface itself is verified by hand, per the ticket.
 *
 * The bundle below is what the emit node makes: one ZIP named for the batch,
 * and its four members alongside it.
 */

import type { Blocked, Connection, HandoffFile, WriteBack } from './api.ts'
import {
  ABANDON,
  bundleIn,
  byCause,
  canAbandon,
  CANCEL,
  CAUSES,
  CONFIRM,
  blockedReading,
  confirmGate,
  membersIn,
  RETRY,
  retrying,
  size,
} from './confirm.ts'

let failures = 0
function ok(claim: string, passed: boolean) {
  if (!passed) failures++
  console.log(`${passed ? 'ok  ' : 'FAIL'}  ${claim}`)
}

// ── The bundle ─────────────────────────────────────────────────────────────

const file = (filename: string, bytes = 512): HandoffFile => ({
  fileId: `f_${filename}`,
  filename,
  bytes,
})

/** Deliberately shuffled: the surface's claim is import order, and reading it
 *  off the array would make the claim true only by accident. */
const files = [
  file('3-deals.csv'),
  file('handoff-notes.md'),
  file('handoff-2026-W34.zip', 4096),
  file('1-companies.csv'),
  file('2-people.csv'),
]

ok(
  'the bundle is the one ZIP, found by name rather than by position',
  bundleIn(files)?.filename === 'handoff-2026-W34.zip',
)
ok(
  'its members list in import order — companies, people, deals, then the notes',
  membersIn(files)
    .map((one) => one.filename)
    .join() === '1-companies.csv,2-people.csv,3-deals.csv,handoff-notes.md',
)
ok('the bundle is not one of its own members', !membersIn(files).some((one) => one.filename.endsWith('.zip')))
ok('every file is offered — nothing is dropped by the split', membersIn(files).length + 1 === files.length)
ok('sizes read as sizes', size(512) === '512 B' && size(4096) === '4.0 kB')

// ── Confirm is disabled with its reason, before the click ──────────────────

const connected: Connection = { connected: true, workspace: { name: 'Carpe Lab', icon: null } }
const disconnected: Connection = { connected: false, workspace: null }
const blocked: Blocked = {
  reason: 'wrong_workspace',
  readWorkspace: 'Carpe Lab',
  liveWorkspace: 'Demo Space',
}

ok('a live connection and no block is the only state that confirms', confirmGate(null, connected).can)
ok(
  'no connection disables Confirm, and says that writing CRM status is why',
  !confirmGate(null, disconnected).can &&
    /CRM status/.test(confirmGate(null, disconnected).reason ?? '') &&
    confirmGate(null, disconnected).reconnect,
)
ok(
  'a gate that is still asking says so rather than inventing a refusal',
  !confirmGate(null, null).can && !confirmGate(null, null).reconnect,
)
ok(
  'every refusal carries its reason — a disabled button with no reason is not a screen',
  [confirmGate(null, disconnected), confirmGate(blocked, connected)].every(
    (gate) => !gate.can && (gate.reason ?? '') !== '',
  ),
)

// ── The wrong workspace names both, and leads with the repair ──────────────

ok(
  'the block names both workspaces',
  ['Carpe Lab', 'Demo Space'].every((name) => blockedReading(blocked).head.includes(name)),
)
ok(
  'and turns the refusal into an instruction naming the one to reconnect to',
  blockedReading(blocked).repair === 'Connect to Carpe Lab again to confirm it.',
)
ok(
  'a missing name never reaches the screen as a blank',
  !/undefined|null|\s{2}|to \./.test(
    Object.values(
      blockedReading({ reason: 'wrong_workspace', readWorkspace: null, liveWorkspace: null }),
    ).join(' '),
  ),
)
ok(
  'the per-run block outranks the per-screen one — it never says "connect Notion" to someone connected',
  confirmGate(blocked, connected).reason === blockedReading(blocked).short,
)
ok(
  'the reason beside the button is not the banner repeated word for word',
  blockedReading(blocked).short !== blockedReading(blocked).head &&
    blockedReading(blocked).short.includes('Demo Space'),
)

// ── A partial write-back is a Retry panel, derived from the failure list ────

const partial: WriteBack = {
  written: ['row-1', 'row-2'],
  failed: [
    { sourceId: 'row-4', cause: 'rate_limited' },
    { sourceId: 'row-3', cause: 'rate_limited' },
    { sourceId: 'row-5', cause: 'notion_refused' },
  ],
}
const wholesale: WriteBack = {
  written: [],
  failed: ['row-1', 'row-2', 'row-3'].map((sourceId) => ({
    sourceId,
    cause: 'unauthorised' as const,
  })),
}
const finished: WriteBack = { written: ['row-1'], failed: [] }

ok('a failure list is the whole of the retry state', retrying(partial) && retrying(wholesale))
ok(
  'and no write-back reads the same as one that finished',
  !retrying(null) && !retrying(finished),
)
ok(
  'failures group by cause, rows in order',
  JSON.stringify(byCause(partial)) ===
    JSON.stringify([
      { cause: 'rate_limited', rows: ['row-3', 'row-4'] },
      { cause: 'notion_refused', rows: ['row-5'] },
    ]),
)
ok(
  'a batch-wide cause is one sentence over every remaining row, not seven identical ones',
  byCause(wholesale).length === 1 && byCause(wholesale)[0].rows.length === 3,
)
ok(
  'every cause the wire can carry has a sentence, and each says what to do',
  (
    [
      'not_connected',
      'wrong_workspace',
      'unauthorised',
      'rate_limited',
      'notion_unavailable',
      'notion_refused',
    ] as const
  ).every((cause) => CAUSES[cause].length > 40),
)

// ── Abandoning is offered where it is accepted, and nowhere else ───────────

ok('a failed write-back may be abandoned', canAbandon(partial, null))
ok('so may one that can never begin', canAbandon(null, blocked))
ok(
  'nothing is abandoned while the write can still be attempted',
  !canAbandon(null, null) && !canAbandon(finished, null),
)

// ── Cancel and Confirm are the opposite assertions they are ────────────────

ok(
  'they assert opposite things about the same fact',
  CONFIRM.label === 'I imported these files into Attio' &&
    CANCEL.label === 'These files never reached Attio',
)
ok(
  'neither is named for what the app does, so neither can be read as the other',
  [CONFIRM, CANCEL].every((one) => !/\b(confirm|cancel)\b/i.test(one.label)),
)
ok(
  'each states its own consequence rather than restating its label',
  [CONFIRM, CANCEL, ABANDON, RETRY].every(
    (one) => one.detail.length > 80 && !one.detail.includes(one.label),
  ),
)
ok(
  'a retry is not a second attestation, and says why it cannot write twice',
  !/Attio/.test(RETRY.label) && /Ready for CRM/.test(RETRY.detail) && /twice/.test(RETRY.detail),
)
ok(
  'cancelling names the batch release, which is the duplicate-deal risk',
  /released/.test(CANCEL.detail) && /undone/.test(CANCEL.detail),
)
ok(
  'confirming promises Imported only where every candidate went',
  /all reached Attio/.test(CONFIRM.detail) && /Ready for CRM/.test(CONFIRM.detail),
)
ok(
  'abandoning reads as terminal and not as done, and keeps the batch reserved',
  /not done/.test(ABANDON.detail) && /reserved/.test(ABANDON.detail),
)

if (failures) throw new Error(`${failures} failed`)
console.log('\nall ok')
