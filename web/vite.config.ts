import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // 内网穿透（pinggy 等）访问时 Host 是外部域名，开发服务器放行
    allowedHosts: true,
    proxy: {
      '/api': 'http://127.0.0.1:8100',
    },
  },
})
