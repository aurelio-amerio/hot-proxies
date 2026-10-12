import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import { createBrowserServices } from './app/services'
import './assets/fonts.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App services={createBrowserServices()} />
  </StrictMode>,
)
