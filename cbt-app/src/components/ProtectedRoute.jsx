// src/components/ProtectedRoute.jsx
import React from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";

export default function ProtectedRoute({ children }) {
  const { user, initializing } = useAuth();

  if (initializing) return <div className="p-6">Checking auth…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}
