import { BrowserRouter, Routes, Route } from 'react-router';
import { AuthProvider } from './AuthContext.jsx';
import RequireAuth from './RequireAuth.jsx';
import Login from './pages/Login.jsx';
import JobsBoard from './jobs/JobsBoard.jsx';
import JobDetail from './jobs/JobDetail.jsx';
import NewJobForm from './jobs/NewJobForm.jsx';
import VetsList from './vets/VetsList.jsx';
import VetDetail from './vets/VetDetail.jsx';
import NewVetForm from './vets/NewVetForm.jsx';
import CalendarPage from './calendar/CalendarPage.jsx';
import SettingsPage from './settings/SettingsPage.jsx';
import ActivityPage from './activity/ActivityPage.jsx';
import PayoutsPage from './payouts/PayoutsPage.jsx';
import RequestsPage from './requests/RequestsPage.jsx';
import ReviewsPage from './reviews/ReviewsPage.jsx';
import InvoicesPage from './invoices/InvoicesPage.jsx';
import ClinicsPage from './clinics/ClinicsPage.jsx';
import ResetPassword from './pages/ResetPassword.jsx';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/forgot-password" element={<ResetPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<RequireAuth><JobsBoard /></RequireAuth>} />
          <Route path="/jobs/new" element={<RequireAuth><NewJobForm /></RequireAuth>} />
          <Route path="/jobs/:id" element={<RequireAuth><JobDetail /></RequireAuth>} />
          <Route path="/vets" element={<RequireAuth><VetsList /></RequireAuth>} />
          <Route path="/vets/new" element={<RequireAuth><NewVetForm /></RequireAuth>} />
          <Route path="/vets/:id" element={<RequireAuth><VetDetail /></RequireAuth>} />
          <Route path="/calendar" element={<RequireAuth><CalendarPage /></RequireAuth>} />
          <Route path="/settings" element={<RequireAuth><SettingsPage /></RequireAuth>} />
          <Route path="/clinics" element={<RequireAuth><ClinicsPage /></RequireAuth>} />
          <Route path="/invoices" element={<RequireAuth><InvoicesPage /></RequireAuth>} />
          <Route path="/reviews" element={<RequireAuth><ReviewsPage /></RequireAuth>} />
          <Route path="/requests" element={<RequireAuth><RequestsPage /></RequireAuth>} />
          <Route path="/payouts" element={<RequireAuth><PayoutsPage /></RequireAuth>} />
          <Route path="/activity" element={<RequireAuth><ActivityPage /></RequireAuth>} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
