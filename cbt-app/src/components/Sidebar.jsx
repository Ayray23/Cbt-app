import { NavLink } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import AppLogo from "./AppLogo";

function linkClassName({ isActive }) {
  return [
    "flex min-h-11 items-center rounded-xl px-3.5 py-2.5 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-300",
    isActive ? "bg-yellow-300 text-[#253371] shadow-sm" : "text-blue-50 hover:bg-white/10 hover:text-white",
  ].join(" ");
}

export default function Sidebar() {
  const { role, isAdmin } = useAuth();

  const adminLinks = [
    { to: "/teacher-account", label: "My password" },
    { to: "/school", label: "School setup" },
    { to: "/audit", label: "Audit trail" },
    { to: "/dashboard", label: "Overview" },
    { to: "/monitoring", label: "Monitoring" },
    { to: "/students", label: "Students" },
    { to: "/exams", label: "Exams" },
    { to: "/results", label: "Results" },
  ];

  const studentLinks = [
    { to: "/portal", label: "Available Exams" },
    { to: "/my-results", label: "My results" },
    { to: "/account", label: "My account" },
  ];

  return (
    <aside className="border-r border-blue-950/20 bg-[#253371] px-4 py-6 text-white md:sticky md:top-0 md:h-screen md:w-72 md:shrink-0 md:overflow-y-auto">
      <div className="mb-6 border-b border-white/15 pb-6">
        <AppLogo size="md" tone="light" />
        <h1 className="mt-5 text-xl font-extrabold tracking-tight">
          {role === "teacher"
            ? "Teacher workspace"
            : role !== "student"
              ? "Staff workspace"
              : "Exam Portal"}
        </h1>
        <p className="mt-2 text-xs leading-5 text-blue-100/90">
          {role !== "student"
            ? "Create exams, manage candidates, and review submissions."
            : "Start published exams and submit your answers once."}
        </p>
      </div>

      <nav aria-label="Main navigation" className="space-y-1.5">
        {(isAdmin
          ? adminLinks
          : role === "teacher"
            ? adminLinks.filter((l) =>
                ["/exams", "/teacher-account"].includes(l.to),
              )
            : role === "invigilator"
              ? adminLinks.filter((l) => l.to === "/monitoring")
              : studentLinks
        ).map((link) => (
          <NavLink key={link.to} to={link.to} className={linkClassName}>
            {link.label}
          </NavLink>
        ))}

        {role === "superadmin" && (
          <>
            {import.meta.env.VITE_ENABLE_LAN === "true" && (
              <NavLink to="/lan-exams" className={linkClassName}>
                Offline LAN exams
              </NavLink>
            )}
            <NavLink to="/admins" className={linkClassName}>
              Teacher oversight
            </NavLink>
          </>
        )}
      </nav>
    </aside>
  );
}
