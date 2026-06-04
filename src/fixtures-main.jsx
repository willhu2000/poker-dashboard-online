import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import FixturesApp from './FixturesApp.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <FixturesApp />
  </StrictMode>,
)
