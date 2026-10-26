import { NavLink } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import AppLogo from "./AppLogo";

const linkClass = ({ isActive }) => `block rounded-xl px-3.5 py-3 text-sm font-semibold transition ${isActive ? "bg-white text-slate-950 shadow-sm" : "text-slate-300 hover:bg-white/10 hover:text-white"}`;

export default function Sidebar() {
  const { role } = useAuth();
  const links = [
    ["/dashboard", "Dashboard"],
    ["/students", "Students"],
    ["/exams/create", "Exams"],
    ["/questions", "Questions"],
    ["/results", "Results"],
  ];

  return (
    <aside className="w-full shrink-0 bg-slate-950 px-4 py-5 text-white md:sticky md:top-0 md:h-screen md:w-64">
      <div className="mb-8 px-2"><AppLogo size="md" tone="light" /><p className="mt-5 text-xl font-bold">School CBT</p><p className="mt-1 text-sm leading-5 text-slate-400">Simple exam management</p></div>
      <nav className="space-y-1.5" aria-label="Main navigation">{links.map(([to, label]) => <NavLink key={to} to={to} className={linkClass}>{label}</NavLink>)}{role === "superadmin" && <NavLink to="/admins" className={linkClass}>Administrators</NavLink>}</nav>
      <div className="mt-8 rounded-2xl border border-white/10 bg-white/5 p-4 text-xs leading-5 text-slate-400">Create classes through student records, create an exam for a class, add questions, then publish.</div>
    </aside>
  );
}
