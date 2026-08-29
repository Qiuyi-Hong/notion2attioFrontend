/**
 * How the second pause reads: which files are on offer and in what order, what
 * disables **Confirm** and why, what a half-finished write-back left behind,
 * and the two opposite assertions the reviewer chooses between.
 *
 * Pure, so the rules that carry the ticket's argument can be read — and
 * checked — without a browser. `confirm.check.ts` is the check.
 *
 * Two rules this file deliberately does **not** hold:
 *
 * - **Whether the workspace is the right one.** The comparison is on
 *   `workspace_id`, server-side; no id reaches the browser. `blocked` arrives
 *   decided and this file only says how it reads.
 * - **Whether an abandonment will be accepted.** The route holds the copy that
 *   enforces. `canAbandon` decides only whether the *control is offered*, from
 *   the same two facts, so the reviewer is not sent to a `400` to find out.
 *
 * `docs/http-contract.md` and `docs/run-surfaces.md` in the backend repo are
 * authoritative.
 */

import type { Blocked, Connection, HandoffFile, WriteBack, WriteCause } from './api.ts'

// ── The files ──────────────────────────────────────────────────────────────

/**
 * The bundle: one ZIP named for the batch, which is the download the reviewer
 * takes. Found by its extension rather than by its position, because the wire
 * order is not a promise the contract makes.
 */
export const bundleIn = (files: HandoffFile[]): HandoffFile | undefined =>
  files.find((file) => file.filename.endsWith('.zip'))

/**
 * Its members, **in import order** — companies, then people, then deals, then
 * the notes. Attio resolves a Person's company and a Deal's participants as it
 * imports, so a file taken out of order is an import that fails on references
 * that do not exist yet.
 *
 * The order is the numeric prefix the emit node writes into the names, sorted
 * here rather than trusted from the array: the surface's claim is that these
 * are in import order, and reading the order off the name is what makes that
 * true rather than incidental. The notes carry no prefix and sort last, which
 * is right — they are the one file that is never imported.
 */
export const membersIn = (files: HandoffFile[]): HandoffFile[] =>
  files
    .filter((file) => !file.filename.endsWith('.zip'))
    .sort((a, b) => step(a.filename) - step(b.filename) || a.filename.localeCompare(b.filename))

const step = (filename: string): number =>
  Number(/^(\d+)-/.exec(filename)?.[1] ?? Number.MAX_SAFE_INTEGER)

/** A size, so a bundle with something in it reads differently from one without. */
export const size = (bytes: number): string =>
  bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} kB`

// ── What stops the click ───────────────────────────────────────────────────

/**
 * Whether **Confirm** may be clicked, and — when it may not — the reason,
 * before the click rather than after it. A guard the reviewer reads is a
 * screen; the same guard reached by clicking is an error.
 *
 * `connection` is `null` while the app is still asking. That is not a refusal,
 * so it says so rather than inventing one.
 */
export type Gate = {
  can: boolean
  reason: string | null
  /** Every repair on this surface is the same one: authorise again. */
  reconnect: boolean
}

export const confirmGate = (blocked: Blocked | null, connection: Connection | null): Gate => {
  // The per-run block outranks the per-screen one: a live Connection naming
  // another workspace is not a missing Connection, and saying *connect Notion*
  // to someone who is connected would send them round a loop that changes
  // nothing. `reconnect` is false because the block carries its own repair, in
  // its own banner — a second link here would be the same click twice.
  if (blocked) return { can: false, reason: blockedReading(blocked).short, reconnect: false }
  if (!connection) return { can: false, reason: 'Checking the Notion connection…', reconnect: false }
  if (!connection.connected) {
    return {
      can: false,
      reason:
        'Confirming writes CRM status back to Notion, and there is no live connection to write through. A run can reach this pause and lose its connection underneath it — reconnecting is the whole of the repair.',
      reconnect: true,
    }
  }
  return { can: true, reason: null, reconnect: false }
}

/**
 * The wrong-workspace refusal, worded as an instruction: **both** workspaces
 * named, and the repair — which is one click — leading.
 *
 * Either name can be absent, so neither is interpolated bare. A refusal that
 * names one workspace and a blank is a refusal the reviewer cannot act on.
 *
 * `short` is the same refusal beside the disabled button, in different words:
 * the reason has to be where the click would be, and repeating the banner
 * verbatim a few lines below it reads as a rendering fault rather than as
 * emphasis.
 */
export const blockedReading = (blocked: Blocked) => {
  const read = blocked.readWorkspace
  const live = blocked.liveWorkspace
  return {
    head: `This run read ${read ?? 'a different Notion workspace'}. You are connected to ${
      live ?? 'another one'
    }.`,
    repair: read
      ? `Connect to ${read} again to confirm it.`
      : 'Connect to the workspace this run read from again to confirm it.',
    short: `Blocked while ${live ?? 'another workspace'} is the connected one — see above.`,
  }
}

// ── What a write-back left behind ──────────────────────────────────────────

/** The rows that went unwritten. Empty when no write-back has been attempted,
 *  which is the same picture as one that finished. */
export const failuresIn = (writeBack: WriteBack | null) => writeBack?.failed ?? []

/**
 * A partial write-back turns the panel into a Retry panel, and this is the
 * whole of the derivation: a run with failures is paused at the confirmation
 * interrupt, so nothing extra is stored to say so.
 */
export const retrying = (writeBack: WriteBack | null): boolean =>
  failuresIn(writeBack).length > 0

/**
 * The rows a write-back did not reach, in order — the ones still reading
 * `Ready for CRM`, which is what a person marking Notion by hand is holding.
 * The retry panel names them under their cause; an abandoned run names them
 * as the whole of what is unfinished.
 */
export const unwrittenRows = (writeBack: WriteBack | null): string[] =>
  failuresIn(writeBack)
    .map((failure) => failure.sourceId)
    .sort()

/**
 * The failures grouped by cause, rows in order.
 *
 * The first three causes are batch-wide — true of every remaining row, so the
 * node stops at the first rather than collecting seven identical errors — and
 * grouping renders that as the one sentence it is, without the surface needing
 * to know which causes those are.
 */
export const byCause = (
  writeBack: WriteBack | null,
): { cause: WriteCause; rows: string[] }[] => {
  const grouped = new Map<WriteCause, string[]>()
  for (const { cause, sourceId } of failuresIn(writeBack)) {
    grouped.set(cause, [...(grouped.get(cause) ?? []), sourceId])
  }
  return [...grouped].map(([cause, rows]) => ({ cause, rows: [...rows].sort() }))
}

/**
 * The fixed sentence a cause renders as. No prose travels on the wire, so
 * every word the reviewer reads about a failure is written here — and each one
 * says what to do about it, because the reviewer is holding rows Attio has and
 * Notion does not.
 */
export const CAUSES: Record<WriteCause, string> = {
  not_connected:
    'There was no live Notion connection when the write ran, or the grant reached no database we can read. Authorise again over the source database, then retry.',
  wrong_workspace:
    'The live connection named a different Notion workspace from the one this run read. Connect to the original workspace, then retry.',
  unauthorised:
    'Notion refused the grant — it was withdrawn or re-issued while the write was running. Reconnect, then retry.',
  rate_limited:
    'Notion rate-limited the write past its retry budget. Nothing is wrong with the rows; retrying in a few minutes is the whole of the repair.',
  notion_unavailable:
    'Notion answered with a server error twice over. Retrying later is safe — the write only touches rows that still read Ready for CRM.',
  notion_refused:
    'Notion refused the write for a reason it did not retry. The rows are named below, and setting their CRM status by hand is the exit if retrying does not clear it.',
}

// ── The two exits ──────────────────────────────────────────────────────────

/**
 * Whether **Abandon write-back** is offered: when a write-back has failed, or
 * when one can never begin. It is refused otherwise — there is nothing to
 * abandon while the write can still be attempted — and offering a control the
 * route would refuse would put the refusal after the click.
 *
 * The app cannot know whether the original workspace is gone for good, so it
 * never withholds this exit. It never leads with it either: reconnecting is
 * the repair, and abandoning is the admission that there is nothing left to
 * reconnect to.
 */
export const canAbandon = (writeBack: WriteBack | null, blocked: Blocked | null): boolean =>
  retrying(writeBack) || blocked !== null

/**
 * Cancelling and confirming assert opposite things about a fact only the
 * reviewer holds — *these files never reached Attio* against *they did* — and
 * nothing but their wording keeps the two apart. Neither says *cancel* or
 * *confirm*: those name what the app does, and the reviewer is answering what
 * they did.
 *
 * `detail` is the consequence in Attio and in Notion, never a restatement of
 * the label, because the cost of choosing wrong is a duplicate deal nothing
 * can undo.
 */
export type Assertion = { label: string; detail: string }

export const CONFIRM: Assertion = {
  label: 'I imported these files into Attio',
  detail:
    'Notion gets CRM status = Imported on every source row whose candidates all reached Attio. A row you held keeps Ready for CRM and comes back when this batch is re-run. Imported is never taken back.',
}

export const CANCEL: Assertion = {
  label: 'These files never reached Attio',
  detail:
    'This run is deleted and its batch is released, so the next run over it creates each deal exactly once. Say this only if nothing was imported — a deal in Attio cannot be undone, and releasing the batch after an import is what creates the second one.',
}

/**
 * Retry is not a second attestation. The reviewer already stated that the
 * import happened; what failed was our write to Notion, so the control says
 * what it retries rather than asking them to swear to Attio again.
 */
export const RETRY: Assertion = {
  label: 'Retry the write-back',
  detail:
    'The same route with the same payload — nothing is attested a second time. The write re-queries Notion first and touches only rows that still read Ready for CRM, so a retry can never mark a row twice.',
}

export const ABANDON: Assertion = {
  label: 'Abandon the write-back',
  detail:
    'The files reached Attio and Notion will never be marked. The run ends abandoned — over, but not done — and its batch stays reserved, so nobody hands these deals off twice. The rows this run handed off keep Ready for CRM until a person sets them in Notion by hand.',
}
