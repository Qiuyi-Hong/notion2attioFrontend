/**
 * The connection banner, decided in one place.
 *
 * This screen is the first thing that touches Notion, so it is the first place
 * a connection failure can appear. Two sources say what happened, and they say
 * different things:
 *
 * - **The consent round trip** answers by redirecting to `/runs?connection=…`.
 *   `cancelled`, `expired` and `failed` all mean *nothing was stored* and have
 *   no live equivalent — nothing can be probed for a grant that was never made.
 * - **`GET /api/batches`** answers for a grant that exists. `no_databases` and
 *   `expired` arrive as `details.reason` on a `409 not_connected`.
 *
 * The live probe wins wherever both could speak, so a stale query string
 * cannot outlive the reconnection that fixed it.
 */

import type { ApiError, Connection } from './api.ts'

/** The closed list the backend redirects with. */
export type Outcome = 'connected' | 'no_databases' | 'cancelled' | 'expired' | 'failed'

export type Banner = {
  tone: 'stop' | 'warn'
  head: string
  body: string
  /** Every repair on this screen is the same one: authorise again. */
  action: string | null
}

const isOutcome = (value: string | null): value is Outcome =>
  value === 'connected' ||
  value === 'no_databases' ||
  value === 'cancelled' ||
  value === 'expired' ||
  value === 'failed'

/** The `?connection=` the callback landed on, or `null`. */
export const outcomeIn = (search: string): Outcome | null => {
  const value = new URLSearchParams(search).get('connection')
  return isOutcome(value) ? value : null
}

const ROUND_TRIP: Partial<Record<Outcome, Banner>> = {
  cancelled: {
    tone: 'stop',
    head: 'Notion authorisation was cancelled',
    body: 'The consent screen was closed without approving. Nothing was connected and nothing was stored.',
    action: 'Connect Notion',
  },
  expired: {
    tone: 'stop',
    head: 'That authorisation attempt expired',
    body: 'The consent round trip was already spent, or took more than ten minutes. Nothing was stored — start it again.',
    action: 'Connect Notion',
  },
  failed: {
    tone: 'stop',
    head: 'Notion refused the authorisation',
    body: 'The code exchange did not complete, so nothing was stored. Trying again is safe.',
    action: 'Connect Notion',
  },
}

/**
 * `null` while the app is still asking, and while everything is well. The
 * table renders either way: reading past runs needs no connection.
 */
export function bannerFor(
  connection: Connection | null,
  batchesError: ApiError | null,
  outcome: Outcome | null,
): Banner | null {
  if (!connection) return null

  if (!connection.connected) {
    return (
      (outcome && ROUND_TRIP[outcome]) ?? {
        tone: 'stop',
        head: 'Connect Notion to start a run',
        body: 'The pipeline reads the batch from a Notion workspace and writes CRM status back to it. Nothing can run until one workspace is connected.',
        action: 'Connect Notion',
      }
    )
  }

  if (!batchesError) return null

  const workspace = connection.workspace?.name ?? 'the workspace'

  if (batchesError.reason === 'no_databases') {
    return {
      tone: 'warn',
      head: `Connected to ${workspace}, but no databases were shared`,
      body: 'Notion only grants access to the pages ticked on the consent screen. None were ticked, so there is no database to read.',
      action: 'Choose pages',
    }
  }

  if (batchesError.code === 'not_connected') {
    return {
      tone: 'stop',
      head: 'The Notion connection is no longer valid',
      body: `Notion refused the grant for ${workspace}. It was most likely withdrawn from the Notion side. Reconnect to carry on.`,
      action: 'Connect Notion',
    }
  }

  // Notion answered, and it was not about the grant. There is no repair here
  // to offer, so the banner says what happened and stops.
  return {
    tone: 'stop',
    head: 'Notion could not be read',
    body: batchesError.message,
    action: null,
  }
}
