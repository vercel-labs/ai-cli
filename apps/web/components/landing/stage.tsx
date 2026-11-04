import type { ReactNode } from "react";

const tones = {
  slate: {
    backgroundColor: "#b8b8b8",
    backgroundImage:
      "radial-gradient(900px 420px at 26% 18%, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0) 62%), radial-gradient(720px 520px at 82% 72%, rgba(0,0,0,0.18) 0%, rgba(0,0,0,0) 58%), linear-gradient(180deg, rgba(0,0,0,0.12) 0%, rgba(0,0,0,0) 55%)",
  },
  ash: {
    backgroundColor: "#a8a8a8",
    backgroundImage:
      "radial-gradient(900px 420px at 22% 20%, rgba(255,255,255,0.6) 0%, rgba(255,255,255,0) 62%), radial-gradient(820px 560px at 80% 74%, rgba(0,0,0,0.16) 0%, rgba(0,0,0,0) 60%), linear-gradient(180deg, rgba(0,0,0,0.1) 0%, rgba(0,0,0,0) 55%)",
  },
  iron: {
    backgroundColor: "#b0b0b0",
    backgroundImage:
      "radial-gradient(900px 420px at 24% 18%, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0) 62%), radial-gradient(780px 560px at 82% 72%, rgba(0,0,0,0.17) 0%, rgba(0,0,0,0) 60%), linear-gradient(180deg, rgba(0,0,0,0.12) 0%, rgba(0,0,0,0) 55%)",
  },
} as const;

export function Stage({
  tone = "slate",
  children,
}: {
  readonly tone?: keyof typeof tones;
  readonly children: ReactNode;
}) {
  const styles = tones[tone];

  return (
    <div
      className="landing-stage relative overflow-hidden rounded-xl border border-white/[0.06] p-4 sm:p-6 md:p-10"
      style={{
        backgroundColor: styles.backgroundColor,
        backgroundImage: styles.backgroundImage,
      }}
    >
      <div className="grain absolute inset-0 pointer-events-none opacity-70" />
      <div className="absolute inset-0 bg-black/10" />
      <div className="relative">{children}</div>
    </div>
  );
}
