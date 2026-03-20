import { useEffect, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "/firebase";

export default function Students() {
  const [students, setStudents] = useState([]);

  useEffect(() => {
    const studentsQuery = query(collection(db, "users"), where("role", "==", "student"));

    return onSnapshot(studentsQuery, (snapshot) => {
      setStudents(snapshot.docs.map((docItem) => ({ id: docItem.id, ...docItem.data() })));
    });
  }, []);

  return (
    <div className="space-y-6">
      <section className="rounded-2xl bg-white p-6 shadow-sm">
        <h2 className="text-2xl font-semibold text-slate-900">Candidate accounts</h2>
        <p className="mt-2 text-sm text-slate-500">
          Students are created automatically on first sign-in and can later be promoted by a
          superadmin if needed.
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
