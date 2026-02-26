import { useState } from 'react';

const ADMIN_KEY = import.meta.env.VITE_ADMIN_KEY;
const SESSION_KEY = 'brochure_admin_auth';

function isAuthenticated() {
  return sessionStorage.getItem(SESSION_KEY) === ADMIN_KEY;
}

export default function AdminGuard({ children }) {
  const [authed, setAuthed] = useState(isAuthenticated);
  const [input, setInput] = useState('');
  const [error, setError] = useState(false);

  if (authed) return children;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (input === ADMIN_KEY) {
      sessionStorage.setItem(SESSION_KEY, ADMIN_KEY);
      setAuthed(true);
    } else {
      setError(true);
      setInput('');
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--bg)',
      padding: 24,
    }}>
      <div style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        padding: '40px 36px',
        width: '100%',
        maxWidth: 360,
        boxShadow: 'var(--shadow)',
      }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ fontSize: '2rem', marginBottom: 8 }}>🔒</div>
          <h1 style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--text)' }}>
            Admin Access
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: 6 }}>
            Enter the admin key to continue
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 16 }}>
            <input
              className="input"
              type="password"
              value={input}
              onChange={e => { setInput(e.target.value); setError(false); }}
              placeholder="Admin key"
              autoFocus
              style={{ textAlign: 'center', letterSpacing: '0.1em' }}
            />
            {error && (
              <p style={{
                color: 'var(--danger)',
                fontSize: '0.8rem',
                marginTop: 8,
                textAlign: 'center',
              }}>
                Incorrect key. Try again.
              </p>
            )}
          </div>
          <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>
            Enter
          </button>
        </form>
      </div>
    </div>
  );
}
