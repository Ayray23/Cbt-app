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
    { to: "/dashboard", label: "Overview" },
    { to: "/monitoring", label: "Monitoring" },
    { to: "/students", label: "Students" },
    { to: "/exams/create", label: "Exams" },
    { to: "/questions/add", label: "Add Questions" },
    { to: "/questions", label: "Question Bank" },
    { to: "/results", label: "Results" },
  ];

  const studentLinks = [{ to: "/portal", label: "Available Exams" }];

  return (
    <aside className="bg-slate-950 px-4 py-6 text-white md:min-h-screen md:w-72">
      <div className="mb-8">
        <AppLogo size="md" tone="light" />
        <h1 className="mt-4 text-2xl font-semibold">
          {isAdmin ? "Admin Control" : "Exam Portal"}
        </h1>
        <p className="mt-2 text-sm text-slate-400">
          {isAdmin
            ? "Create exams, manage candidates, and review submissions."
            : "Start published exams and submit your answers once."}
        </p>
      </div>

      <nav className="space-y-2">
        {(isAdmin ? adminLinks : studentLinks).map((link) => (
          <NavLink key={link.to} to={link.to} className={linkClassName}>
            {link.label}
          </NavLink>
        ))}

        {role === "superadmin" && (
          <NavLink to="/admins" className={linkClassName}>
            Admin Access
          </NavLink>
        )}
      </nav>
    </aside>
  );
}
