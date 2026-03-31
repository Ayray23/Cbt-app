export default function SplashScreen({
  title = "Preparing your workspace",
  message = "Verifying your account and loading the correct portal.",
}) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-950 px-4 text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(16,185,129,0.22),_transparent_32%),radial-gradient(circle_at_bottom_right,_rgba(56,189,248,0.18),_transparent_28%)]" />

      <div className="absolute inset-0 opacity-20">
        <div className="absolute left-10 top-16 h-32 w-32 rounded-full border border-white/20" />
        <div className="absolute bottom-12 right-10 h-48 w-48 rounded-full border border-white/10" />
      </div>

      <div className="relative z-10 w-full max-w-xl rounded-[2rem] border border-white/10 bg-white/5 p-8 shadow-2xl backdrop-blur md:p-10">
        <p className="text-xs uppercase tracking-[0.45em] text-emerald-300">CBT Platform</p>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight text-white md:text-4xl">
          {title}
        </h1>
        <p className="mt-4 max-w-lg text-sm leading-6 text-slate-300 md:text-base">
          {message}
        </p>

        <div className="mt-8 flex items-center gap-3">
          <div className="h-2 w-16 overflow-hidden rounded-full bg-white/10">
            <div className="h-full w-full origin-left animate-pulse rounded-full bg-emerald-400" />
          </div>
          <div className="h-2 w-10 overflow-hidden rounded-full bg-white/10">
            <div className="h-full w-full origin-left animate-pulse rounded-full bg-sky-400 [animation-delay:150ms]" />
          </div>
          <div className="h-2 w-6 overflow-hidden rounded-full bg-white/10">
            <div className="h-full w-full origin-left animate-pulse rounded-full bg-white [animation-delay:300ms]" />
          </div>
        </div>

        <div className="mt-8 grid gap-3 text-xs text-slate-400 md:grid-cols-3">
          <div className="rounded-2xl border border-white/10 bg-black/10 px-4 py-3">
            Identity check
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/10 px-4 py-3">
            Role verification
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/10 px-4 py-3">
            Secure workspace
          </div>
        </div>
      </div>
    </div>
  );
}
