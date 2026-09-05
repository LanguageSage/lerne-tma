import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { ErrorBoundary } from './components/common/ErrorBoundary'

// Инициализация Telegram WebApp как можно раньше
if (window.Telegram?.WebApp) {
  window.Telegram.WebApp.ready();
  console.log("Telegram WebApp initialized in main.jsx");
}

// Handle chunk load errors caused by new deployments / stale caches
window.addEventListener('vite:preloadError', (event) => {
  console.warn('Vite preload error detected, reloading page...', event);
  event.preventDefault();
  window.location.reload();
});

createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
)
