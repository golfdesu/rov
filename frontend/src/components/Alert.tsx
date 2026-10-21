import type { ReactNode } from "react";

const TONE_STYLE = {
  error: "border-red/40 bg-red/10 text-red",
  warning: "border-yellow-500/40 bg-yellow-500/10 text-yellow-400",
} as const;

interface AlertProps {
  tone?: keyof typeof TONE_STYLE;
  children: ReactNode;
}

export function Alert({ tone = "error", children }: AlertProps) {
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`border px-3 py-2 text-xs ${TONE_STYLE[tone]}`}>
      {children}
    </div>
  );
}
