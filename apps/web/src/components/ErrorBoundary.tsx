import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

/** Keeps a failure in one panel from taking down the editor. */
export class ErrorBoundary extends Component<
  { children: ReactNode; label: string },
  { error: Error | null }
> {
  override state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[${this.props.label}]`, error, info.componentStack);
  }

  override render() {
    if (this.state.error) {
      return (
        <div className="vl-notice" role="alert">
          <span>Something went wrong in {this.props.label}.</span>
          <button className="vl-btn" onClick={() => this.setState({ error: null })}>
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
