import { Component } from 'react';

// Without this, an unhandled error anywhere in the tree unmounts the
// whole app to a blank white screen with no clue why. This catches it,
// logs the real error to the console for debugging, and shows the
// person a way to recover instead of a dead page.
//
// appName: used only in the console.error log line, to tell which app
//   crashed when reading server-side/browser logs (e.g. "vet app").
// message: the user-facing recovery copy, since what's helpful to tell
//   a vet ("let admin know what you were doing") isn't the same as
//   what's helpful to tell a client on the public journey page.
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
    console.error(`Goodbye Mate ${this.props.appName || 'app'} crashed:`, error, info?.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={styles.wrap}>
          <div style={styles.card}>
            <h1 style={styles.title}>Something went wrong</h1>
            <p style={styles.body}>
              {this.props.message || "This screen hit an error and couldn't load. Try reloading — if it keeps happening, let us know."}
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
