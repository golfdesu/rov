import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { LanguageProvider } from './i18n/LanguageProvider'
import { initAnalytics } from './utils/analytics'
import { initPwaInstallListener, registerServiceWorker } from './utils/pwa'

initAnalytics()
initPwaInstallListener()
registerServiceWorker()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LanguageProvider>
      <App />
    </LanguageProvider>
  </StrictMode>,
)
