import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Dev: /api is proxied to the backend on the GB10 (override with VITE_BACKEND=http://host:8790).
// Prod: `npm run build` -> ui/dist, served by the backend itself, so all API paths stay relative.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const target = env.VITE_BACKEND || process.env.VITE_BACKEND || 'http://172.20.65.119:8790'
  return {
    plugins: [react(), tailwindcss()],
    server: {
      host: true,
      port: 5173,
      proxy: {
        '/api': {
          target,
          changeOrigin: true,
          // SSE must stream: no buffering, no compression on the way through.
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => proxyReq.setHeader('accept-encoding', 'identity'))
            proxy.on('proxyRes', (res) => {
              if (String(res.headers['content-type'] || '').includes('text/event-stream')) {
                res.headers['cache-control'] = 'no-cache'
                res.headers['x-accel-buffering'] = 'no'
              }
            })
          },
        },
      },
    },
    build: { outDir: 'dist', chunkSizeWarningLimit: 4000 },
  }
})
