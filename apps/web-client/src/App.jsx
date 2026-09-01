import { BrowserRouter, Routes, Route } from 'react-router';
import QolPage from './QolPage.jsx';
import JourneyPage from './JourneyPage.jsx';
import RequestPage from './RequestPage.jsx';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Declared BEFORE /:token — Express-style ordering doesn't
            apply here, but react-router would happily match "request"
            as a journey token and show "this link isn't valid". */}
        <Route path="/quality-of-life" element={<QolPage />} />
        <Route path="/request" element={<RequestPage />} />
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
