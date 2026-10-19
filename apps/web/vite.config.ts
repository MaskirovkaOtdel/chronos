import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // GitHub Pages serves this repo from https://<user>.github.io/chronos/, which
  // is NOT the domain root. Every emitted asset URL is prefixed with `base`,
  // so this has to be set before the first deploy — landing it after routes
  // and lazy chunks exist is how you get a site that 404s only in production.
  // `base: '/'` locally; flip to `/chronos/` when Pages is wired (phase 4).
})
