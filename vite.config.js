import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

export default defineConfig({
  plugins: [
    react(),
    nodePolyfills({
      include: ['crypto', 'stream', 'events', 'buffer', 'util', 'process']
    })
  ],
  server: { port: 5173 },
  resolve: {
    alias: {
      process: 'process/browser',
    }
  }
})
