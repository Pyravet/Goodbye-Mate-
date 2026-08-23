import { BrowserRouter, Routes, Route } from 'react-router';
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

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/" element={<RequireAuth><DaySheet /></RequireAuth>} />
          <Route path="/jobs/past" element={<RequireAuth><PastJobs /></RequireAuth>} />
          <Route path="/jobs/:id" element={<RequireAuth><JobDetail /></RequireAuth>} />
          <Route path="/calendar" element={<RequireAuth><Calendar /></RequireAuth>} />
          <Route path="/earnings" element={<RequireAuth><Earnings /></RequireAuth>} />
          <Route path="/jobs/all" element={<RequireAuth><JobsList /></RequireAuth>} />
          <Route path="/offers" element={<RequireAuth><OffersPage /></RequireAuth>} />
          <Route path="/messages" element={<RequireAuth><MessagesPage /></RequireAuth>} />
          <Route path="/messages/:id" element={<RequireAuth><MessagesPage /></RequireAuth>} />
          <Route path="/profile" element={<RequireAuth><Profile /></RequireAuth>} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
