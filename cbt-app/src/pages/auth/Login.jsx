import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "/firebase";
import AppLogo from "../../components/AppLogo";

function studentLoginEmail(studentId) {
  return `${studentId.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-")}@student.cbt.local`;
}

export default function Login() {
  const navigate = useNavigate();
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const message = window.sessionStorage.getItem("cbt_login_error");
    if (message) { setError(message); window.sessionStorage.removeItem("cbt_login_error"); }
  }, []);

  async function handleLogin(event) {
    event.preventDefault(); setError(""); setLoading(true);
    try {
      const value = loginId.trim();
      const email = value.includes("@") ? value.toLowerCase() : studentLoginEmail(value);
      await signInWithEmailAndPassword(auth, email, password);
      navigate("/");
    } catch (loginError) {
      console.error(loginError);
      setError("Incorrect Student ID/email or password. If this is an older account, use the email originally registered by the administrator.");
    } finally { setLoading(false); }
  }

  return <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-8"><section className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-7 shadow-xl shadow-slate-200/60 md:p-9"><div className="text-center"><AppLogo size="lg" /><h1 className="mt-6 text-3xl font-bold tracking-tight text-slate-950">Welcome to CBT</h1><p className="mt-2 text-sm text-slate-500">Students use their Student ID. Administrators use their email.</p></div>{error && <div role="alert" className="mt-6 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}<form onSubmit={handleLogin} className="mt-7 space-y-4"><label className="block text-sm font-medium text-slate-700">Student ID or admin email<input value={loginId} onChange={(event) => setLoginId(event.target.value)} autoComplete="username" placeholder="e.g. JS1-10427" className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-50" required /></label><label className="block text-sm font-medium text-slate-700">Password<div className="relative mt-2"><input type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" placeholder="Enter your password" className="w-full rounded-xl border border-slate-300 px-4 py-3 pr-14 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-50" required /><button type="button" onClick={() => setShowPassword((value) => !value)} className="absolute inset-y-0 right-3 text-xs font-semibold text-slate-500">{showPassword ? "Hide" : "Show"}</button></div></label><button type="submit" disabled={loading} className="w-full rounded-xl bg-slate-950 px-4 py-3.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60">{loading ? "Signing in…" : "Sign in"}</button></form><p className="mt-6 text-center text-xs leading-5 text-slate-400">Students do not need a personal email address. Your school administrator creates your account.</p></section></main>;
}
