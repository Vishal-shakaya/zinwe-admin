import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  /** Changing this (the route path) clears a caught error, so navigating away recovers. */
  resetKey: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
  key: string;
}

/** Keeps a page crash inside the content area (sidebar stays usable) instead of a blank screen. */
export class PageErrorBoundary extends Component<Props, State> {
  state: State = { error: null, key: this.props.resetKey };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey !== state.key ? { error: null, key: props.resetKey } : null;
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Admin page crashed:", error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div className="card empty" role="alert">
        <b>This page couldn't be shown</b>
        <span className="muted">
          If the backend was just updated, restart it (rerun start-local-env) and reload. Details: {this.state.error.message}
        </span>
        <div>
          <button type="button" className="btn btn--primary btn--sm" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      </div>
    );
  }
}
