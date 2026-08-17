import { BrowserRouter, Routes, Route } from 'react-router';
import JourneyPage from './JourneyPage.jsx';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/:token" element={<JourneyPage />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
}

function NotFound() {
  return (
    <div style={{ display: 'flex', minHeight: '100dvh', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center' }}>
      <p style={{ color: 'var(--gm-ink-soft)', fontSize: 14, maxWidth: 320 }}>
        This link is missing a booking reference. Please use the link sent to you by SMS or email.
      </p>
    </div>
  );
}
