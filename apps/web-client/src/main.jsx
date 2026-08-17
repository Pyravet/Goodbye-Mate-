import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './theme.css';
import ErrorBoundary from './ErrorBoundary.jsx';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary appName="client journey" message="This page hit an error. Please try reloading, or contact us directly if it keeps happening.">
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
