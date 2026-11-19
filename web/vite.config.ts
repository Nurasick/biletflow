import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  const { API_PROXY_TARGET = 'http://127.0.0.1:8000' } = loadEnv(mode, process.cwd(), 'API_PROXY_TARGET')
  return {
    plugins: [react(), tailwindcss()],
    server: {
      host: '0.0.0.0',
      proxy: { '/api/': API_PROXY_TARGET, '/media/': API_PROXY_TARGET },
      watch: {
        // Bind-mounted files may not emit filesystem events on Docker Desktop.
        usePolling: process.env.VITE_USE_POLLING === 'true',
      },
    },
  }
})
