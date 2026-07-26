import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/registry': { target: 'https://fontainor-protocol.vercel.app', changeOrigin: true },
      '/manifest': { target: 'https://fontainor-protocol.vercel.app', changeOrigin: true },
    },
  },
})
