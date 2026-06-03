import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

export default defineConfig({
  base: '/',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:4173',
      '/LogoPacific.png': 'http://localhost:4173',
      '/LogoPacificSmall.png': 'http://localhost:4173',
      '/LogoPacificDark.png': 'http://localhost:4173',
      '/LogoPacificSmallDark.png': 'http://localhost:4173',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
