import { NavLink } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import AppLogo from "./AppLogo";

function linkClassName({ isActive }) {
  return [
    "block rounded-lg px-3 py-2 text-sm font-medium transition",
    isActive ? "bg-white text-slate-900" : "text-slate-200 hover:bg-slate-800",
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
    <aside className="bg-slate-950 px-4 py-6 text-white md:sticky md:top-0 md:h-screen md:overflow-y-auto md:w-72">
      <div className="mb-8">
        <AppLogo size="md" tone="light" />
        <h1 className="mt-4 text-2xl font-semibold">
          {role === "teacher"
            ? "Teacher workspace"
            : role !== "student"
              ? "Staff workspace"
              : "Exam Portal"}
        </h1>
        <p className="mt-2 text-sm text-slate-400">
          {role !== "student"
            ? "Create exams, manage candidates, and review submissions."
            : "Start published exams and submit your answers once."}
        </p>
      </div>

      <nav className="space-y-2">
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
