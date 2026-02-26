import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Cover from './pages/Cover.jsx';
import ViewerFlip from './pages/ViewerFlip.jsx';
import Viewer from './pages/Viewer.jsx';
import Admin from './pages/Admin.jsx';
import BrochureAdmin from './pages/BrochureAdmin.jsx';
import AdminGuard from './components/AdminGuard.jsx';
import { S } from './utils/strings.js';

function PublicNotFound() {
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--bg)',
      gap: 12,
    }}>
      <div style={{ fontSize: '3rem' }}>📄</div>
      <h1 style={{ fontSize: '1.4rem', color: 'var(--text)' }}>{S.pageNotFound}</h1>
      <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
        {S.brochureNotFoundSub}
      </p>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* ── Public routes ─────────────────────────── */}
        <Route path="/brochure/:id"       element={<Cover />} />
        <Route path="/view/:id"           element={<ViewerFlip />} />
        <Route path="/view-classic/:id"   element={<Viewer />} />

        {/* ── Admin routes (key-protected) ──────────── */}
        <Route
          path="/admin"
          element={<AdminGuard><Admin /></AdminGuard>}
        />
        <Route
          path="/admin/:id"
          element={<AdminGuard><BrochureAdmin /></AdminGuard>}
        />

        {/* ── Root → admin ──────────────────────────── */}
        <Route path="/" element={<Navigate to="/admin" replace />} />

        {/* ── Everything else → public 404 ──────────── */}
        <Route path="*" element={<PublicNotFound />} />
      </Routes>
    </BrowserRouter>
  );
}
