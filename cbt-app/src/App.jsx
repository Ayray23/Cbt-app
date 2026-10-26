import { useEffect } from "react";
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./contexts/AuthContext";
import Sidebar from "./components/Sidebar";
import Dashboard from "./pages/Dashboard";
import StudentDashboard from "./pages/StudentDashboard";
import Students from "./pages/Students";
import ExamCodes from "./pages/ExamCodes";
import Questions from "./pages/Questions";
import Results from "./pages/Results";
import Admins from "./pages/Admins";
import CreateExam from "./pages/CreateExam";
import AddQuestion from "./pages/AddQuestion";
import TakeExam from "./pages/TakeExam";
import Login from "./pages/auth/Login";
import SplashScreen from "./components/SplashScreen";
import InstallAppButton from "./components/InstallAppButton";
import NetworkStatusBanner from "./components/NetworkStatusBanner";
import AppLogo from "./components/AppLogo";
import ExamSessionGuard from "./components/ExamSessionGuard";
import { ToastProvider } from "./components/ToastProvider";
import { flushPendingSubmissions } from "./services/sessionService";

function LandingRedirect() {
  const { user, role, loading, isAdmin } = useAuth();
  if (loading) return <SplashScreen title="Loading CBT" message="Preparing your account…" />;
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={role === "admin" || role === "superadmin" || isAdmin ? "/dashboard" : "/portal"} replace />;
}

function RequireAuth() {
  const { user, loading } = useAuth();
  if (loading) return <SplashScreen title="Checking account" message="Please wait…" />;
  return user ? <Outlet /> : <Navigate to="/login" replace />;
}

function RequireRole({ roles }) {
  const { role, isAdmin } = useAuth();
  const current = isAdmin ? (role === "superadmin" ? "superadmin" : "admin") : role;
  return roles.includes(current) ? <Outlet /> : <Navigate to={current === "student" ? "/portal" : "/dashboard"} replace />;
}

function StudentShell() {
  const { profile, logout } = useAuth();
  const location = useLocation();
  if (location.pathname.startsWith("/exam/")) return <div className="min-h-screen"><Outlet /></div>;
  return <div className="min-h-screen bg-slate-100"><header className="border-b border-slate-200 bg-white"><div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 md:px-8"><div><AppLogo size="sm" /><p className="mt-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Student Portal</p></div><div className="flex items-center gap-3"><span className="hidden rounded-lg bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-700 sm:inline">{profile?.studentId || profile?.displayName || "Student"}</span><InstallAppButton /><button onClick={logout} className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white">Sign out</button></div></div></header><main className="mx-auto max-w-6xl p-4 md:p-8"><NetworkStatusBanner /><Outlet /></main></div>;
}

function AdminShell() {
  const { profile, role, logout } = useAuth();
  return <div className="min-h-screen bg-slate-100 md:flex"><Sidebar /><div className="min-w-0 flex-1"><header className="border-b border-slate-200 bg-white"><div className="flex items-center justify-between gap-4 px-4 py-4 md:px-8"><div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">School CBT</p><h1 className="text-lg font-bold text-slate-950">{profile?.displayName || "Administrator"}</h1></div><div className="flex items-center gap-3"><span className="hidden text-xs font-semibold uppercase tracking-wider text-slate-400 sm:inline">{role}</span><InstallAppButton /><button onClick={logout} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700">Sign out</button></div></div></header><main className="p-4 md:p-8"><NetworkStatusBanner /><Outlet /></main></div></div>;
}

function ConnectivitySync() {
  const { user } = useAuth();
  useEffect(() => {
    if (!user) return undefined;
    const sync = () => { if (navigator.onLine) void flushPendingSubmissions(); };
    sync(); window.addEventListener("online", sync); const timer = window.setInterval(sync, 30000);
    return () => { window.removeEventListener("online", sync); window.clearInterval(timer); };
  }, [user]);
  return null;
}

export default function App() {
  return <ToastProvider><BrowserRouter><ConnectivitySync /><Routes>
    <Route path="/" element={<LandingRedirect />} /><Route path="/login" element={<Login />} />
    <Route element={<RequireAuth />}>
      <Route element={<StudentShell />}><Route path="/portal" element={<StudentDashboard />} /><Route path="/exam/:examId" element={<ExamSessionGuard><TakeExam /></ExamSessionGuard>} /></Route>
      <Route element={<AdminShell />}><Route element={<RequireRole roles={["admin", "superadmin"]} />}>
        <Route path="/dashboard" element={<Dashboard />} /><Route path="/students" element={<Students />} /><Route path="/exams/create" element={<CreateExam />} /><Route path="/questions" element={<Questions />} /><Route path="/questions/add" element={<AddQuestion />} /><Route path="/results" element={<Results />} />
        <Route path="/exam-codes" element={<ExamCodes />} />
      </Route><Route element={<RequireRole roles={["superadmin"]} />}><Route path="/admins" element={<Admins />} /></Route></Route>
    </Route><Route path="*" element={<LandingRedirect />} />
  </Routes></BrowserRouter></ToastProvider>;
}
