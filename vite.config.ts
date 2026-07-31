import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

/**
 * โฟลเดอร์ที่แอปถูกวางบนเว็บ
 * - ค่าเริ่มต้น '/' = วางที่รากโดเมน (Netlify / Cloudflare / โฮสต์ของตัวเอง) และตอน npm run dev
 * - GitHub Pages เป็น URL แบบ /<ชื่อ repo>/ จึงต้องตั้งผ่าน env ตอน build เท่านั้น
 *   (ดู .github/workflows/deploy.yml — ตั้ง DEPLOY_BASE=/DUYPOS/)
 * ห้าม hard-code ไว้ในไฟล์นี้ ไม่งั้น dev server กับโฮสต์อื่นจะโหลดไฟล์ไม่เจอ
 */
const base = process.env.DEPLOY_BASE || '/'

export default defineConfig({
  base,
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'ระบบขายหน้าร้าน POS',
        short_name: 'POS',
        description: 'ระบบขายหน้าร้าน ใช้งานได้แม้ไม่มีอินเทอร์เน็ต (Hybrid POS)',
        theme_color: '#059669',
        background_color: '#f8fafc',
        display: 'standalone',
        lang: 'th',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
      },
    }),
  ],
  server: { port: 5173 },
})
