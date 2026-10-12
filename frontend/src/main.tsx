import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/biz-udpgothic/400.css'
import '@fontsource/biz-udpgothic/700.css'
import './styles/index.css'
import App from './App'

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
