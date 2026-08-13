import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './AuthContext.jsx';
import RequireAuth from './RequireAuth.jsx';
import Login from './pages/Login.jsx';
import JobsBoard from './jobs/JobsBoard.jsx';
import JobDetail from './jobs/JobDetail.jsx';
import NewJobForm from './jobs/NewJobForm.jsx';
import VetsList from './vets/VetsList.jsx';
import VetDetail from './vets/VetDetail.jsx';
import NewVetForm from './vets/NewVetForm.jsx';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<RequireAuth><JobsBoard /></RequireAuth>} />
          <Route path="/jobs/new" element={<RequireAuth><NewJobForm /></RequireAuth>} />
          <Route path="/jobs/:id" element={<RequireAuth><JobDetail /></RequireAuth>} />
          <Route path="/vets" element={<RequireAuth><VetsList /></RequireAuth>} />
          <Route path="/vets/new" element={<RequireAuth><NewVetForm /></RequireAuth>} />
          <Route path="/vets/:id" element={<RequireAuth><VetDetail /></RequireAuth>} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
