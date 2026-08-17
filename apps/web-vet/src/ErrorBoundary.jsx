import { Component } from 'react';

// Without this, an unhandled error anywhere in the tree unmounts the
// whole app to a blank white screen with no clue why — which is exactly
// what "profile page loads then goes blank" looks like from the outside.
// This catches it, logs the real error to the console for debugging, and
// shows the vet a way to recover instead of a dead page.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('Goodbye Mate vet app crashed:', error, info?.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={styles.wrap}>
          <div style={styles.card}>
            <h1 style={styles.title}>Something went wrong</h1>
            <p style={styles.body}>
              This screen hit an error and couldn't load. Try reloading — if it keeps happening, let admin know
              what you were doing right before this appeared.
            </p>
            <button onClick={() => window.location.reload()} style={styles.btn}>Reload</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const styles = {
  wrap: { display: 'flex', minHeight: '100dvh', alignItems: 'center', justifyContent: 'center', padding: 24, background: 'var(--gm-paper, #FAF7F1)' },
  card: { maxWidth: 360, textAlign: 'center' },
  title: { fontSize: 20, marginBottom: 10 },
  body: { fontSize: 14, color: '#6B6559', lineHeight: 1.6, marginBottom: 20 },
  btn: { padding: '11px 22px', borderRadius: 8, border: 'none', background: '#33453A', color: '#fff', fontSize: 14, fontWeight: 500 },
};
