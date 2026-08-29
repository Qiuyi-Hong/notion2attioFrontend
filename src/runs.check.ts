/**
 * The two rules the index is *for*, checked without a browser: what needs a
 * human sorts first, and `stalled` and `failed` read as one word.
 *
 * Run it with `npm run check`. Node strips the types; there is no test
 * framework here and none is wanted — the surfaces themselves are verified by
 * hand, per the ticket. This covers the ordering only.
 */

import type { Run, RunStatus } from './api.ts'
import { reading, sortRuns } from './runs.ts'

let failures = 0
function ok(claim: string, passed: boolean) {
  if (!passed) failures++
  console.log(`${passed ? 'ok  ' : 'FAIL'}  ${claim}`)
}

const at = (status: RunStatus, minutesAgo: number): Run => ({
  runId: `${status}-${minutesAgo}`,
  batch: '2026-W34',
  createdAt: new Date(Date.now() - minutesAgo * 60000).toISOString(),
  status,
})

// Deliberately seeded newest-first by time, so a sort that fell back to time
// would leave it untouched and pass by accident.
const runs: Run[] = [
  at('done', 1),
  at('stalled', 2),
  at('running', 3),
  at('awaiting_confirmation', 4),
  at('awaiting_review', 5),
  at('failed', 6),
  at('abandoned', 7),
]

const order = sortRuns(runs).map((run) => run.status)

ok(
  'a run awaiting confirmation sorts first, however old',
  order[0] === 'awaiting_confirmation',
)
ok(
  'in flight beats stopped beats over',
  order.slice(1, 3).every((s) => s === 'running' || s === 'awaiting_review') &&
    order.slice(3, 5).every((s) => s === 'stalled' || s === 'failed') &&
    order.slice(5).every((s) => s === 'done' || s === 'abandoned'),
)
ok(
  'newest first within a group',
  order[1] === 'running' && order[3] === 'stalled' && order[5] === 'done',
)
ok(
  'stalled and failed read as one word, with one action',
  reading('stalled').label === 'Stopped' &&
    reading('failed').label === 'Stopped' &&
    reading('stalled').action === reading('failed').action,
)
ok('sorting does not mutate its input', runs[0].status === 'done')

if (failures) throw new Error(`${failures} failed`)
console.log('\nall ok')
