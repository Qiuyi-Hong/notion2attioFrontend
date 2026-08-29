/**
 * Three browser routes, and a root that redirects.
 *
 * Nothing lives at `/`: the runs index is the front door, so the root sends
 * the browser there rather than rendering a second home page beside it.
 */

import { useEffect } from 'react'
import RunPage from './RunPage.tsx'
import RunsIndex from './RunsIndex.tsx'
import { navigate, runIdIn, usePath } from './router.ts'

export default function App() {
  const path = usePath()
  const root = path === '/' || path === ''

  useEffect(() => {
    // Replaced, not pushed: Back from the index should leave the app, not
    // bounce through the redirect again.
    if (root) navigate('/runs' + window.location.search, { replace: true })
  }, [root])

  if (root) return null
  if (path === '/runs') return <RunsIndex />

  const runId = runIdIn(path)
  if (runId) return <RunPage key={runId} runId={runId} />

  return (
    <div className="page">
      <header className="top">
        <h1>Not found</h1>
        <span className="grow" />
        <button className="btn ghost" onClick={() => navigate('/runs')}>
          ← All runs
        </button>
      </header>
      <p className="foot">
        <code>{path}</code> is not a page here.
      </p>
    </div>
  )
}
