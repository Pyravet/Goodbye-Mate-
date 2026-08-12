import { useAuth } from '../AuthContext.jsx';

export default function Dashboard() {
  const { user, logout } = useAuth();

  return (
    <div style={{ padding: 32, fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ fontSize: 20 }}>Goodbye Mate — Admin</h1>
        <button onClick={logout} style={{ padding: '6px 12px', cursor: 'pointer' }}>Log out</button>
      </div>
      <p style={{ marginTop: 16, color: '#555' }}>
        Signed in as <strong>{user.fullName}</strong> ({user.role}).
      </p>
      <p style={{ marginTop: 24, color: '#888', fontSize: 14 }}>
        Phase 1 checkpoint — auth is real, DB is real, deploy skeleton is ready.
        Jobs, vets, pricing, dispatch, and everything else from the prototype
        land in Phase 2.
      </p>
    </div>
  );
}
