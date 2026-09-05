import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '0.0.0.0',
    watch: {
      // Bind-mounted files may not emit filesystem events on Docker Desktop.
      usePolling: process.env.VITE_USE_POLLING === 'true',
    },
  },
})
