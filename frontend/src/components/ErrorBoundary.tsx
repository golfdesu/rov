import { StableButtonLabel } from "./StableButtonLabel";
import { Component, type ContextType, type ErrorInfo, type ReactNode } from "react";
import { LanguageContext } from "../i18n/language";
import { isStaleChunkError, tryRecoverFromStaleChunk } from "../utils/chunkRecovery";

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
  static contextType = LanguageContext;
  declare context: ContextType<typeof LanguageContext>;
  state: ErrorBoundaryState = { error: null, resetKey: this.props.resetKey };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  static getDerivedStateFromProps(props: ErrorBoundaryProps, state: ErrorBoundaryState) {
    return props.resetKey !== state.resetKey ? { error: null, resetKey: props.resetKey } : null;
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (isStaleChunkError(error) && tryRecoverFromStaleChunk()) return;
    console.error("UI error:", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    const { t } = this.context;
    const staleChunk = isStaleChunkError(this.state.error);
    return (
      <div role="alert" className="m-4 border border-red/40 bg-red/10 p-4 text-sm text-red">
        <p className="font-semibold">{t("เกิดข้อผิดพลาดในส่วนนี้")}</p>
        <p className="mt-1 font-mono text-xs break-words text-muted">{this.state.error.message}</p>
        <button
          type="button"
          onClick={() => {
            if (staleChunk) {
              window.location.reload();
              return;
            }
            this.setState({ error: null });
          }}
          className="mt-3 inline-flex min-h-8 items-center border border-line-strong px-3 py-1 text-xs text-ink hover:bg-panel-2"
        >
          <StableButtonLabel message="ลองใหม่" />
        </button>
      </div>
    );
  }
}
