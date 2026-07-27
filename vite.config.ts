import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

export default defineConfig({
  // node polyfills are required by the (lazily loaded) Irys upload SDK;
  // they land in the lazy chunk, not the main bundle.
  plugins: [react(), tailwindcss(), nodePolyfills()],
  build: process.env.SINGLE_FILE
    ? {
        // one-file build used for self-contained HTML previews
        rollupOptions: { output: { inlineDynamicImports: true } },
      }
    : {
        // sourcemaps stay on so minified stacks from user error reports
        // (errlog / error screen) can be decoded — repo is public anyway
        sourcemap: true,
        rollupOptions: {
          output: {
            manualChunks: {
              vendor: ['react', 'react-dom', 'react-router-dom'],
            },
          },
        },
      },
  server: {
    port: 5173,
    proxy: {
      '/registry': { target: 'https://fontainor-protocol.vercel.app', changeOrigin: true },
      '/manifest': { target: 'https://fontainor-protocol.vercel.app', changeOrigin: true },
    },
  },
})
