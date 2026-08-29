/**
 * Three routes and one redirect. A router dependency would carry matching,
 * nesting, loaders and lazy boundaries for a surface that has none of them,
 * so this is `history.pushState` and `popstate` with a subscription React can
 * read.
 *
 * The only rule worth naming: **starting a run does not navigate.** The list
 * is the handle and the URL is a convenience, so `navigate` is called when a
 * person opens a run to work it, and at no other time.
 */

import { useSyncExternalStore } from 'react'

const listeners = new Set<() => void>()
const announce = () => listeners.forEach((notify) => notify())

function subscribe(notify: () => void) {
  listeners.add(notify)
  window.addEventListener('popstate', announce)
  return () => {
    listeners.delete(notify)
    if (listeners.size === 0) window.removeEventListener('popstate', announce)
  }
}

const currentPath = () => window.location.pathname

/** The path the browser is on, re-read on every navigation. */
export const usePath = () => useSyncExternalStore(subscribe, currentPath)

export function navigate(path: string, { replace = false } = {}) {
  if (path === currentPath() + window.location.search) return
  if (replace) window.history.replaceState(null, '', path)
  else window.history.pushState(null, '', path)
  announce()
}

/** `/runs/:runId`, or `null` for anything else. */
export const runIdIn = (path: string): string | null =>
  /^\/runs\/([^/]+)$/.exec(path)?.[1] ?? null
