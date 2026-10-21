import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Changing this key clears a caught error, e.g. when switching tabs */
  resetKey?: string;
}

interface ErrorBoundaryState {
  error: Error | null;
  resetKey?: string;
}

/** Keeps a crash inside one section from blanking the whole page. */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, resetKey: this.props.resetKey };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  static getDerivedStateFromProps(props: ErrorBoundaryProps, state: ErrorBoundaryState) {
    return props.resetKey !== state.resetKey ? { error: null, resetKey: props.resetKey } : null;
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("UI error:", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="m-4 border border-red/40 bg-red/10 p-4 text-sm text-red">
        <p className="font-semibold">เกิดข้อผิดพลาดในส่วนนี้</p>
        <p className="mt-1 font-mono text-xs text-muted">{this.state.error.message}</p>
        <button
          type="button"
          onClick={() => this.setState({ error: null })}
          className="mt-3 border border-line-strong px-3 py-1 text-xs text-ink hover:bg-panel-2"
        >
          ลองใหม่
        </button>
      </div>
    );
  }
}
