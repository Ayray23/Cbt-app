import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";

function tabClassName({ isActive }) {
  return [
    "rounded-lg px-4 py-2 text-sm font-medium transition",
    isActive
      ? "bg-slate-900 text-white"
      : "bg-white text-slate-700 hover:bg-slate-100",
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
        className="flex flex-wrap gap-2 rounded-2xl border bg-slate-50 p-2"
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
