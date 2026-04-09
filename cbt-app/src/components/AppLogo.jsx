export default function AppLogo({ size = "md", showText = true, tone = "dark" }) {
  const sizeClassName =
    size === "sm" ? "h-10 w-10" : size === "lg" ? "h-14 w-14" : "h-12 w-12";
  const titleClassName =
    tone === "light" ? "text-white" : "text-slate-900";
  const subtitleClassName =
    tone === "light" ? "text-slate-300" : "text-slate-500";

  return (
    <div className="flex items-center gap-3">
      <img src="/app-icon.svg" alt="CBT App logo" className={`${sizeClassName} rounded-2xl`} />
      {showText && (
        <div>
          <p className={`text-lg font-semibold ${titleClassName}`}>CBT App</p>
          <p className={`text-xs uppercase tracking-[0.3em] ${subtitleClassName}`}>Exam Platform</p>
        </div>
      )}
    </div>
  );
}
