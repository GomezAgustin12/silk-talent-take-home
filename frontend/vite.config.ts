import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 3300,
    proxy: {
      '/workflows': {
        target: 'http://localhost:3310',
        changeOrigin: true,
      },
    },
  },
})
