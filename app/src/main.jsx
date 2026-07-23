import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// Инициализация Telegram WebApp как можно раньше
if (window.Telegram?.WebApp) {
  window.Telegram.WebApp.ready();
  console.log("Telegram WebApp initialized in main.jsx");
}

createRoot(document.getElementById('root')).render(
  <App />,
)
