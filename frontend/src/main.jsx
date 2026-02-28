import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';

// App runtime config (safe-to-expose only)
const CONFIG = {
  // Supabase (publishable / anon key ONLY)
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL || '',
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY || '',

  // Optional: if you later want a backend base URL
  apiBase: import.meta.env.VITE_API_BASE || '',
};

// Expose for debugging + for app code to read (without changing App props)
window.__APP_CONFIG__ = CONFIG;

// Helpful warnings (won't break the app)
if (!CONFIG.supabaseUrl || !CONFIG.supabaseAnonKey) {
  console.warn(
    '[CONFIG] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. ' +
      'Set them in Cloudflare Pages Environment Variables and redeploy.'
  );
}

// IMPORTANT SECURITY NOTE:
// Never put sb_secret_* keys in VITE_ env vars (those get bundled to the browser).

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
