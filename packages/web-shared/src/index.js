export { apiFetch, setAccessToken, getAccessToken, API_URL } from './api.js';
export { AuthProvider, useAuth } from './AuthContext.jsx';
export { default as RequireAuth } from './RequireAuth.jsx';
export { default as ErrorBoundary } from './ErrorBoundary.jsx';
export {
  registerServiceWorker,
  getPushSubscriptionStatus,
  enablePushNotifications,
} from './push.js';

// theme.css is imported directly by path (side-effect CSS import), e.g.:
//   import '@goodbye-mate/web-shared/src/theme.css';
// since CSS can't be re-exported through a JS barrel file.
