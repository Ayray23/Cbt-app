import { useEffect, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "/firebase";
import StatusBanner from "../components/StatusBanner";
import { setUserRole } from "../services/sessionService";

export default function Admins() {
  const [admins, setAdmins] = useState([]);
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [banner, setBanner] = useState(null);

  useEffect(() => {
    const usersQuery = query(
      collection(db, "users"),
      where("role", "in", ["admin", "superadmin"])
    );

    return onSnapshot(usersQuery, (snapshot) => {
      setAdmins(snapshot.docs.map((docItem) => ({ id: docItem.id, ...docItem.data() })));
    });
  }, []);

  async function updateRole(nextRole) {
    if (!email.trim()) {
      setBanner({ tone: "error", message: "Enter the user's email address." });
      return;
    }

    setLoading(true);

    try {
      await setUserRole(email.trim(), nextRole);
      setEmail("");
      setBanner({
        tone: "success",
        message: nextRole === "admin" ? "User promoted to admin." : "Admin access revoked.",
      });
    } catch (error) {
      console.error(error);
      setBanner({ tone: "error", message: error.message ?? "Could not update role." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <StatusBanner
        tone={banner?.tone}
        message={banner?.message}
        onClose={() => setBanner(null)}
      />

      <section className="rounded-2xl bg-white p-6 shadow-sm">
        <h2 className="text-2xl font-semibold text-slate-900">Admin access control</h2>
        <p className="mt-2 text-sm text-slate-500">
          Promote only users who have already created an account. Role changes are handled directly
          through secured Firestore writes in this free-plan setup.
        </p>
      </section>

      <section className="rounded-2xl bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row">
          <input
            type="email"
            placeholder="existing-user@example.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="flex-1 rounded-xl border border-slate-300 px-4 py-3"
          />

          <button
            onClick={() => updateRole("admin")}
            disabled={loading}
            className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-medium text-white disabled:opacity-60"
          >
            Make admin
          </button>

          <button
            onClick={() => updateRole("student")}
            disabled={loading}
            className="rounded-xl border border-slate-300 px-5 py-3 text-sm font-medium text-slate-700 disabled:opacity-60"
          >
            Revoke admin
          </button>
        </div>
      </section>

      <section className="rounded-2xl bg-white p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-slate-900">Current admins</h3>
        <div className="mt-4 space-y-3">
          {admins.map((admin) => (
            <div
              key={admin.id}
              className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3"
            >
              <span className="text-sm text-slate-700">{admin.email}</span>
              <span className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-400">
                {admin.role}
              </span>
            </div>
          ))}

          {admins.length === 0 && (
            <p className="text-sm text-slate-500">No admin accounts found yet.</p>
          )}
        </div>
      </section>
    </div>
  );
}
