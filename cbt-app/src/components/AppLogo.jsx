import { BRANDING } from "../config/branding";

export default function AppLogo({ size = "md", showText = true, tone = "dark" }) {
  const sizeClassName =
    size === "sm" ? "h-11 w-11" : size === "lg" ? "h-16 w-16" : "h-12 w-12";
  const titleClassName = tone === "light" ? "text-white" : "text-[#253371]";
  const subtitleClassName = tone === "light" ? "text-yellow-200" : "text-slate-600";

  return (
    <div className="flex min-w-0 items-center gap-3">
      <img
        src={BRANDING.logoUrl}
        alt={`${BRANDING.schoolName} logo`}
        width="64"
        height="64"
        className={`${sizeClassName} shrink-0 rounded-full border-2 border-yellow-300 bg-white object-contain`}
      />
      {showText && (
        <div className="min-w-0">
          <p className={`text-base font-extrabold leading-tight ${titleClassName}`}>
            {BRANDING.shortName}
          </p>
          <p className={`mt-1 text-[10px] font-semibold uppercase tracking-wider ${subtitleClassName}`}>
            {BRANDING.subtitle}
          </p>
        </div>
      )}
    </div>
  );
}
