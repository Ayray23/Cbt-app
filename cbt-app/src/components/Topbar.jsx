import { useAuth } from "../contexts/AuthContext";

export default function Topbar() {
  const { user, logout } = useAuth();

  return (
    <div className="h-14 bg-white shadow flex items-center justify-between px-6">
      <h1 className="font-semibold">Admin Dashboard</h1>

      <div className="flex items-center gap-4">
        <span className="text-sm">{user?.email}</span>
        <button
          onClick={logout}
          className="px-3 py-1 bg-red-500 text-white rounded"
        >
          Logout
        </button>
      </div>
    </div>
  );
}
