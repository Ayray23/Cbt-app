import { useEffect, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "/firebase";
import StatusBanner from "../components/StatusBanner";
import { setStudentLoginAccess } from "../services/sessionService";

export default function Students() {
  const [students, setStudents] = useState([]);
  const [updatingStudentId, setUpdatingStudentId] = useState(null);
  const [banner, setBanner] = useState(null);

  useEffect(() => {
    const studentsQuery = query(collection(db, "users"), where("role", "==", "student"));

    return onSnapshot(studentsQuery, (snapshot) => {
      setStudents(snapshot.docs.map((docItem) => ({ id: docItem.id, ...docItem.data() })));
    });
  }, []);

  async function handleToggleLogin(student) {
    setUpdatingStudentId(student.id);

    try {
      const nextValue = !student.loginDisabled;
      await setStudentLoginAccess(student.id, nextValue);
      setBanner({
        tone: "success",
        message: nextValue
          ? `${student.email ?? "Student"} has been blocked from login.`
          : `${student.email ?? "Student"} can log in again.`,
      });
    } catch (error) {
      console.error(error);
      setBanner({ tone: "error", message: error.message ?? "Could not update student access." });
    } finally {
      setUpdatingStudentId(null);
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
        <h2 className="text-2xl font-semibold text-slate-900">Candidate accounts</h2>
        <p className="mt-2 text-sm text-slate-500">
          Students are created automatically on first sign-in. Admins can block or restore student
          login access whenever needed.
        </p>
      </section>

      <section className="overflow-hidden rounded-2xl bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Display name</th>
                <th className="px-4 py-3">Last login</th>
                <th className="px-4 py-3">Access</th>
                <th className="px-4 py-3">Action</th>
              </tr>
            </thead>
            <tbody>
              {students.map((student) => (
                <tr key={student.id} className="border-t border-slate-200">
                  <td className="px-4 py-4 text-slate-700">{student.email ?? "-"}</td>
                  <td className="px-4 py-4 text-slate-500">{student.displayName ?? "-"}</td>
                  <td className="px-4 py-4 text-slate-500">
                    {student.lastLoginAt?.seconds
                      ? new Date(student.lastLoginAt.seconds * 1000).toLocaleString()
                      : "-"}
                  </td>
                  <td className="px-4 py-4 text-slate-500">
                    {student.loginDisabled ? "Blocked" : "Allowed"}
                  </td>
                  <td className="px-4 py-4">
                    <button
                      onClick={() => handleToggleLogin(student)}
                      disabled={updatingStudentId === student.id}
                      className={[
                        "rounded-lg px-3 py-2 text-xs font-medium text-white disabled:opacity-60",
                        student.loginDisabled ? "bg-emerald-600" : "bg-red-600",
                      ].join(" ")}
                    >
                      {updatingStudentId === student.id
                        ? "Saving..."
                        : student.loginDisabled
                          ? "Allow login"
                          : "Block login"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {students.length === 0 && (
          <div className="p-8 text-sm text-slate-500">No student accounts yet.</div>
        )}
      </section>
    </div>
  );
}
