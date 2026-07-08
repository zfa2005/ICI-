import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // The AI assistant's /api calls are served by the Node backend
    // (server.js, port 3000) — run `npm start` in the repo root alongside
    // this dev server.
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
})
