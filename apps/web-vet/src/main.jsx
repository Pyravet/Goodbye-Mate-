import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './theme.css';
import { registerServiceWorker } from './push.js';
import ErrorBoundary from './ErrorBoundary.jsx';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary appName="vet app" message="This screen hit an error and couldn't load. Try reloading — if it keeps happening, let admin know what you were doing right before this appeared.">
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);

registerServiceWorker();
