import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  signOut,
} from "firebase/auth";
import { auth } from "/firebase";
import { callApi } from "../../services/api";
import { useAuth } from "../../contexts/AuthContext";
import { toast } from "../../utils/toast";
import { friendlyAuthError } from "../../utils/authErrors";
import AppLogo from "../../components/AppLogo";

const initialForm = { displayName: "", email: "", password: "", confirm: "" };
const inputClass = "mt-2 block w-full rounded-xl border border-slate-300 bg-white px-4 py-3 outline-none focus:border-blue-800 focus:ring-2 focus:ring-blue-100";

export default function TeacherSignup() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState(initialForm);
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    if (!user && form.password !== form.confirm) {
      toast.error("Your passwords do not match. Please re-enter them.");
      return;
    }
    setBusy(true);
    try {
      // A network failure after Firebase account creation must not cause a
      // second duplicate account to be created. Signed-in teachers may retry
      // profile registration without repeating the Firebase sign-up step.
      const account = auth.currentUser ||
        (await createUserWithEmailAndPassword(auth, form.email.trim().toLowerCase(), form.password)).user;
      if (account.email?.endsWith("@students.cbt.invalid")) {
        toast.error("Student accounts cannot register as teachers. Sign out and use a personal email address.");
        return;
      }
      await callApi("teachers.register", { displayName: form.displayName.trim() });
      if (!account.emailVerified) {
        try {
          await sendEmailVerification(account);
        } catch (error) {
          toast.warning("Your teacher account was created, but the verification email could not be sent. Open Teacher account access and retry. " + friendlyAuthError(error));
          navigate("/teacher-access", { replace: true });
          return;
        }
      }
      toast.success("Teacher account created. Check your email for a verification link, then request administrator approval.");
      navigate("/teacher-access", { replace: true });
    } catch (error) {
      toast.error(friendlyAuthError(error, "Could not create your teacher account. Try again or contact your school administrator."));
    } finally {
      setBusy(false);
    }
  }

  if (profile) {
    return (
      <main className="mx-auto max-w-lg rounded-2xl bg-white p-8 shadow-sm">
        <p>You already have a school account.</p>
        <Link
          to={profile.approvalStatus && profile.approvalStatus !== "approved" ? "/teacher-access" : "/"}
          className="font-semibold text-blue-800 underline"
        >
          Open your account
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-xl rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <AppLogo size="lg" />
      <h1 className="mt-6 text-2xl font-bold text-slate-950 sm:text-3xl">
        Create your teacher account
      </h1>
      <p className="my-4 text-sm leading-6 text-slate-600">
        Your questions are private from other teachers. The superadmin reviews your work.
        Verify your email and wait for approval before using the school workspace.
      </p>
      <form onSubmit={submit} className="mt-5 space-y-4">
        <label className="block text-sm font-medium text-slate-800">
          Full name
          <input
            required minLength={2} maxLength={120} autoComplete="name"
            className={inputClass} value={form.displayName}
            onChange={(event) => setForm((previous) => ({ ...previous, displayName: event.target.value }))}
          />
        </label>
        {!user ? (
          <>
            {[
              { key: "email", label: "Email address", type: "email", autocomplete: "email" },
              { key: "password", label: "Password", type: "password", autocomplete: "new-password" },
              { key: "confirm", label: "Confirm password", type: "password", autocomplete: "new-password" },
            ].map(({ key, label, type, autocomplete }) => (
              <label key={key} className="block text-sm font-medium text-slate-800">
                {label}
                <input
                  required type={type} minLength={type === "password" ? 8 : undefined}
                  autoComplete={autocomplete}
                  className={inputClass} value={form[key]}
                  onChange={(event) => setForm((previous) => ({ ...previous, [key]: event.target.value }))}
                />
              </label>
            ))}
          </>
        ) : (
          <p className="rounded-xl bg-blue-50 p-4 text-sm text-blue-950">
            Finish registration for <strong>{user.email}</strong>. If your previous attempt
            failed after account creation, submit again to resume without creating a duplicate account.
            <button
              type="button" className="ml-2 font-semibold underline"
              onClick={() => void signOut(auth).catch((error) => toast.error(friendlyAuthError(error)))}
            >
              Use a different account
            </button>
          </p>
        )}
        <button
          type="submit" disabled={busy}
          className="w-full rounded-xl bg-blue-900 px-5 py-3 font-semibold text-white hover:bg-blue-950 disabled:opacity-60"
        >
          {busy ? "Creating account…" : "Create teacher account"}
        </button>
      </form>
      <Link to="/login" className="mt-5 block text-sm font-semibold text-blue-800 underline">
        Already registered? Sign in
      </Link>
    </main>
  );
}
