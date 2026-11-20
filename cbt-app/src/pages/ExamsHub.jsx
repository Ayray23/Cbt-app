import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";

function tabClassName({ isActive }) {
  return [
    "ui-btn min-h-11 rounded-xl px-4",
    isActive
      ? "bg-blue-900 text-white shadow-sm"
      : "bg-transparent text-slate-600 hover:bg-white hover:text-blue-900",
  ].join(" ");
}

// One home for everything about running an exam: the papers themselves, the
// questions that go into them, and the personal PINs students use to start.
export default function ExamsHub() {
  const { role } = useAuth();
  const canManagePins = role === "admin" || role === "superadmin";

  return (
    <div className="space-y-4">
      <nav
        aria-label="Exam sections"
        className="flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-slate-100/70 p-2 shadow-sm"
      >
        <NavLink to="/exams/papers" className={tabClassName}>
          Papers
        </NavLink>
        <NavLink to="/exams/questions/add" className={tabClassName}>
          Add Questions
        </NavLink>
        <NavLink to="/exams/questions" end className={tabClassName}>
          Question Bank
        </NavLink>
        {canManagePins && (
          <NavLink to="/exams/pins" className={tabClassName}>
            Exam PINs
          </NavLink>
        )}
      </nav>
      <Outlet />
    </div>
  );
}
