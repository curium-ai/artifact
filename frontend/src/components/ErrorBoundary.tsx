import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

// Catches render-time errors anywhere below it so a single broken view can't
// take the whole app down with a blank screen. Shows a recoverable fallback.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    // Surface the error for debugging; no external logging is configured.
    console.error('Unhandled UI error:', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="app-error">
          <div className="app-error__box">
            <h2 className="app-error__title">Something went wrong</h2>
            <p className="app-error__sub">An unexpected error occurred. Reloading usually fixes it.</p>
            <button className="btn btn--primary btn--medium" onClick={() => window.location.reload()}>
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
