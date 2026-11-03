import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// base './' → 어떤 경로(서브디렉토리, 정적 호스팅)에 올려도 동작
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  build: { outDir: 'dist', sourcemap: false },
  server: { proxy: { '/api': 'http://localhost:3000' } },
})
