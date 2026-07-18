import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

export default defineConfig({
  plugins: [
    react(),
    nodePolyfills({
      include: ['stream', 'crypto', 'events', 'buffer', 'util']
    })
  ],
  server: { port: 5173 },
  resolve: {
    alias: {
      process: 'process/browser',
    }
  }
})
