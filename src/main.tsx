import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

import { redirigirAlDominioCanonico } from './utils/dominio'

// Antes de montar: si se entró por una dirección vieja, se va al dominio propio.
redirigirAlDominioCanonico()


createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
