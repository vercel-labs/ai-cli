import type { ReactNode } from "react";

export function Window({
  title,
  bar = true,
  children,
}: {
  readonly title: string;
  readonly bar?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <div className="min-w-0 overflow-hidden rounded-lg border border-white/10 bg-[#0A0A0A] shadow-[0_40px_80px_rgba(0,0,0,0.55)] ring-1 ring-white/5">
      {bar ? (
        <div className="flex items-center justify-between border-b border-white/[0.06] bg-black/10 px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="h-3 w-3 rounded-full bg-white/15" />
            <div className="h-3 w-3 rounded-full bg-white/15" />
            <div className="h-3 w-3 rounded-full bg-white/15" />
          </div>
          <div className="text-xs text-white/35">{title}</div>
          <div className="w-10" />
        </div>
      ) : null}
      {children}
    </div>
  );
}
