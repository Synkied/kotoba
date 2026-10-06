import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// In development the Django API runs on :8780 (python manage.py runserver 8780).
const api = process.env.KOTOBA_API ?? 'http://127.0.0.1:8780'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { '/api': api, '/files': api },
  },
})
