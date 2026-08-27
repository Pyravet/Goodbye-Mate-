import { BrowserRouter, Routes, Route } from 'react-router';
import ResetPassword from './pages/ResetPassword.jsx';
import { AuthProvider } from './AuthContext.jsx';
import RequireAuth from './RequireAuth.jsx';
import Login from './pages/Login.jsx';
import Signup from './pages/Signup.jsx';
import Profile from './pages/Profile.jsx';
import JobsList from './jobs/JobsList.jsx';
import JobDetail from './jobs/JobDetail.jsx';
import Calendar from './calendar/Calendar.jsx';
import Earnings from './earnings/Earnings.jsx';
import PastJobs from './jobs/PastJobs.jsx';
import MessagesPage from './messages/MessagesPage.jsx';
import OffersPage from './jobs/OffersPage.jsx';
import DaySheet from './jobs/DaySheet.jsx';
import ClinicPortal from './clinic/ClinicPortal.jsx';
import { useAuth } from './AuthContext.jsx';

/**
 * Send each role to its own home.
 *
 * Clinic logins share this app because they share its authentication —
 * login, refresh, password reset — and a fourth deploy target would be
 * more to go wrong than it's worth for a portal this size. But a clinic
 * user must never see a vet screen: the routing below is what enforces
 * that on the client, and every clinic API route is scoped by session on
 * the server regardless.
 */
function RoleHome() {
  const { user } = useAuth();
  return user?.role === 'clinic' ? <ClinicPortal /> : <DaySheet />;
}

/**
 * Vet-only screens.
 *
 * Gating the root alone wasn't enough: a clinic user typing /earnings
 * would reach a vet screen that fires vet API calls, all of which 403.
 * They'd see a broken page rather than being told they're in the wrong
 * place. Anything vet-only now falls back to the portal.
 */
function VetOnly({ children }) {
  const { user } = useAuth();
  return user?.role === 'clinic' ? <ClinicPortal /> : children;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/forgot-password" element={<ResetPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/" element={<RequireAuth><RoleHome /></RequireAuth>} />
          <Route path="/jobs/past" element={<RequireAuth><VetOnly><PastJobs /></VetOnly></RequireAuth>} />
          <Route path="/jobs/:id" element={<RequireAuth><VetOnly><JobDetail /></VetOnly></RequireAuth>} />
          <Route path="/calendar" element={<RequireAuth><VetOnly><Calendar /></VetOnly></RequireAuth>} />
          <Route path="/earnings" element={<RequireAuth><VetOnly><Earnings /></VetOnly></RequireAuth>} />
          <Route path="/jobs/all" element={<RequireAuth><VetOnly><JobsList /></VetOnly></RequireAuth>} />
          <Route path="/offers" element={<RequireAuth><VetOnly><OffersPage /></VetOnly></RequireAuth>} />
          <Route path="/messages" element={<RequireAuth><VetOnly><MessagesPage /></VetOnly></RequireAuth>} />
          <Route path="/messages/:id" element={<RequireAuth><VetOnly><MessagesPage /></VetOnly></RequireAuth>} />
          <Route path="/profile" element={<RequireAuth><VetOnly><Profile /></VetOnly></RequireAuth>} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
