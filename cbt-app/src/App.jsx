import { lazy, Suspense } from "react";
import {
  BrowserRouter,
  Link,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import { useAuth } from "./contexts/AuthContext";
import Sidebar from "./components/Sidebar";
import SplashScreen from "./components/SplashScreen";
import InstallAppButton from "./components/InstallAppButton";
import NetworkStatusBanner from "./components/NetworkStatusBanner";
import AppLogo from "./components/AppLogo";

const OfflineRecovery = lazy(() => import("./pages/OfflineRecovery"));
const LanExams = lazy(() => import("./pages/LanExams"));
const TeacherSignup = lazy(() => import("./pages/auth/TeacherSignup"));
const TeacherAccess = lazy(() => import("./pages/auth/TeacherAccess"));
const StudentAccount = lazy(() => import("./pages/StudentAccount"));
const StudentResults = lazy(() => import("./pages/StudentResults"));
const SchoolSettings = lazy(() => import("./pages/SchoolSettings"));
const AuditLogs = lazy(() => import("./pages/AuditLogs"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const StudentDashboard = lazy(() => import("./pages/StudentDashboard"));
const Students = lazy(() => import("./pages/Students"));
const Questions = lazy(() => import("./pages/Questions"));
const Results = lazy(() => import("./pages/Results"));
const Admins = lazy(() => import("./pages/Admins"));
const CreateExam = lazy(() => import("./pages/CreateExam"));
const AddQuestion = lazy(() => import("./pages/AddQuestion"));
const Monitoring = lazy(() => import("./pages/Monitoring"));
const ExamPins = lazy(() => import("./pages/ExamPins"));
const Login = lazy(() => import("./pages/auth/Login"));
const TakeExam = lazy(() => import("./pages/TakeExam"));

function LandingRedirect() {
  const { user, role, profile, loading, isAdmin, authError } = useAuth();

  if (loading) {
    return (
      <SplashScreen
        title="Opening your portal"
        message="We are confirming your account type and loading the correct workspace for you."
      />
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (authError) {
    return <Navigate to="/account-error" replace />;
  }

  if (profile?.approvalStatus && profile.approvalStatus !== "approved")
    return <Navigate to="/teacher-access" replace />;
  if (["teacher", "teacher_admin"].includes(role))
    return <Navigate to="/exams/create" replace />;
  if (role === "invigilator") return <Navigate to="/monitoring" replace />;
  if (role === "examofficer") return <Navigate to="/exams/create" replace />;
  if (role === "superadmin" || role === "admin" || isAdmin) {
    return <Navigate to="/dashboard" replace />;
  }

  return <Navigate to="/portal" replace />;
}

function RequireAuth() {
  const { user, profile, loading, authError } = useAuth();

  if (loading) {
    return (
      <SplashScreen
        title="Checking your account"
        message="Please wait while we verify your access level and prepare your dashboard."
      />
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (authError) {
    return <Navigate to="/account-error" replace />;
  }

  if (profile?.approvalStatus && profile.approvalStatus !== "approved")
    return <Navigate to="/teacher-access" replace />;
  return <Outlet />;
}

function RequireRole({ allowedRoles }) {
  const { role, isAdmin } = useAuth();
  const normalizedRole = isAdmin ? "admin" : role;

  if (!allowedRoles.includes(normalizedRole) && !allowedRoles.includes(role)) {
    return <Navigate to={role === "student" ? "/portal" : "/"} replace />;
  }

  return <Outlet />;
}

function StudentShell() {
  const { user, profile, logout } = useAuth();
  const inExam = useLocation().pathname.startsWith("/exam/");

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="border-b border-slate-200 bg-white px-4 py-4 md:px-8">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <AppLogo size="sm" />
            <p className="mt-3 text-xs uppercase tracking-[0.3em] text-slate-400">
              Student Portal
            </p>
            <h1 className="text-2xl font-semibold text-slate-900">
              {profile?.displayName ?? profile?.username ?? "CBT Portal"}
            </h1>
          </div>

          <div className="flex items-center gap-3">
            {!inExam && (
              <>
                <InstallAppButton />
                <Link to="/portal">Exams</Link>
                <Link to="/my-results">Results</Link>
                <Link to="/account">Password</Link>
                <Link to="/recovery">Device recovery</Link>
              </>
            )}
            <p className="text-sm font-medium text-slate-700">
              {profile?.username || profile?.email || user?.email}
            </p>
            {!inExam && (
              <button
                onClick={logout}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white"
              >
                Sign out
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl p-4 md:p-8">
        <NetworkStatusBanner />
        <Outlet />
      </main>
    </div>
  );
}

function AdminShell() {
  const { user, role, profile, logout } = useAuth();

  return (
    <div className="min-h-screen bg-slate-100 md:flex">
      <Sidebar />

      <div className="flex-1">
        <header className="border-b border-slate-200 bg-white px-4 py-4 md:px-8">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <AppLogo size="sm" />
              <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
                {role === "superadmin" || role === "admin"
                  ? "Admin Workspace"
                  : "Staff Workspace"}
              </p>
              <h1 className="text-2xl font-semibold text-slate-900">
                {profile?.displayName ?? user?.email ?? "CBT Portal"}
              </h1>
            </div>

            <div className="flex items-center gap-3">
              <InstallAppButton />
              <div className="text-right">
                <p className="text-sm font-medium text-slate-700">
                  {user?.email}
                </p>
                <p className="text-xs uppercase tracking-[0.25em] text-slate-400">
                  {role ?? "student"}
                </p>
              </div>

              <button
                onClick={logout}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white"
              >
                Sign out
              </button>
            </div>
          </div>
        </header>

        <main className="p-4 md:p-8">
          <NetworkStatusBanner />
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function AccountErrorScreen() {
  const { user, authError, logout } = useAuth();

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-2xl rounded-3xl bg-white p-8 shadow-xl shadow-slate-200/70">
        <p className="text-xs uppercase tracking-[0.35em] text-slate-400">
          Account Sync Issue
        </p>
        <h1 className="mt-3 text-3xl font-semibold text-slate-900">
          We could not load your access profile
        </h1>
        <p className="mt-4 text-sm text-slate-600">
          {authError ||
            "Your account signed in successfully, but the app could not read the role/profile document needed to open the correct workspace."}
        </p>
        <div className="mt-6 rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">
          <p>
            Account:{" "}
            {user?.displayName ||
              user?.email?.replace("@students.cbt.invalid", "") ||
              "Unknown user"}
          </p>
          <p className="mt-2">
            Contact your school administrator to verify this account's access.
          </p>
        </div>
        <div className="mt-8 flex gap-3">
          <button
            onClick={logout}
            className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-medium text-white"
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Suspense
        fallback={
          <SplashScreen
            title="Opening your workspace"
            message="Loading the page..."
          />
        }
      >
        <Routes>
          <Route path="/" element={<LandingRedirect />} />
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<TeacherSignup />} />
          <Route path="/teacher-access" element={<TeacherAccess />} />
          <Route path="/account-error" element={<AccountErrorScreen />} />

          <Route element={<RequireAuth />}>
            <Route element={<StudentShell />}>
              <Route element={<RequireRole allowedRoles={["student"]} />}>
                <Route path="/my-results" element={<StudentResults />} />
                <Route path="/account" element={<StudentAccount />} />
                <Route path="/recovery" element={<OfflineRecovery />} />
                <Route path="/portal" element={<StudentDashboard />} />
                <Route path="/exam/:examId" element={<TakeExam />} />
              </Route>
            </Route>

            <Route element={<AdminShell />}>
              <Route
                element={
                  <RequireRole
                    allowedRoles={[
                      "admin",
                      "superadmin",
                      "teacher",
                      "teacher_admin",
                      "examofficer",
                    ]}
                  />
                }
              >
                <Route path="/teacher-account" element={<StudentAccount />} />
                <Route path="/exams/create" element={<CreateExam />} />
                <Route path="/questions/add" element={<AddQuestion />} />
                <Route path="/questions" element={<Questions />} />
              </Route>
              <Route
                element={
                  <RequireRole
                    allowedRoles={[
                      "admin",
                      "superadmin",
                      "examofficer",
                      "invigilator",
                    ]}
                  />
                }
              >
                <Route path="/monitoring" element={<Monitoring />} />
              </Route>
              <Route
                element={
                  <RequireRole
                    allowedRoles={["admin", "superadmin", "examofficer"]}
                  />
                }
              >
                <Route path="/exam-pins" element={<ExamPins />} />
                <Route path="/results" element={<Results />} />
                <Route path="/audit" element={<AuditLogs />} />
              </Route>
              <Route
                element={<RequireRole allowedRoles={["admin", "superadmin"]} />}
              >
                <Route path="/school" element={<SchoolSettings />} />

                <Route path="/dashboard" element={<Dashboard />} />

                <Route path="/students" element={<Students />} />
              </Route>

              <Route element={<RequireRole allowedRoles={["superadmin"]} />}>
                <Route path="/lan-exams" element={<LanExams />} />
                <Route path="/admins" element={<Admins />} />
              </Route>
            </Route>
          </Route>

          <Route path="*" element={<LandingRedirect />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
