import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import { defineConfig } from 'vite'

// The browser only ever talks to one origin, so there is no CORS configuration
// on either side. Two prefixes are forwarded rather than one: `/api` is
// everything the app fetches, and `/auth` is the Notion consent round trip,
// pinned outside any namespace of ours by the Notion portal (backend #14).
//
// Every request the app makes is same-origin and relative, so a build served
// by Express works unchanged — the backend's FRONTEND_ORIGIN defaults to this
// dev server's origin and is the only place the origin is named.
export default defineConfig({
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] })
  ],
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
      '/auth': 'http://localhost:3000',
    },
  },
})
