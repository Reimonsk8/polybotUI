import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      process: "process/browser",
      stream: "stream-browserify",
      util: "util",
      buffer: "buffer/",
      events: "events",
    },
  },
  define: {
    global: 'window',
    'process.env': {},
  },
  base: '/polybotUI/',
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
      },
      '/clob': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
      },
      '/gamma-api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
      },
      '/relayer': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
      }
    },
  },
})
