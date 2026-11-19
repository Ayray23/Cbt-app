/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { auth, db } from "/firebase";
import { flushPendingSubmissions } from "../services/sessionService";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState("");

  useEffect(() => {
    let unsubscribeProfile;
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      unsubscribeProfile?.();
      setLoading(Boolean(currentUser));
      setUser(currentUser);
      setRole(null);
      setProfile(null);
      setAuthError("");
      if (!currentUser) return;
      unsubscribeProfile = onSnapshot(doc(db, "users", currentUser.uid), { includeMetadataChanges: true }, (snapshot) => {
        if (auth.currentUser?.uid !== currentUser.uid) return;
        const record = snapshot.data();
        const cacheKey = `cbt_student_profile_v2:${currentUser.uid}`;
        if (!record && snapshot.metadata.fromCache) {
          // This only restores student UI for an existing Firebase login. Server/rule checks remain authoritative.
          try {
            const cached = JSON.parse(window.localStorage.getItem(cacheKey) || "null");
            if (cached?.role === "student" && !cached.loginDisabled) {
              setProfile(cached); setRole("student"); setLoading(false); return;
            }
          } catch { /* Continue with the authoritative profile lookup. */ }
          if (window.navigator.onLine) return;
        }
        if (!record || !["student", "admin", "superadmin", "teacher", "invigilator", "examofficer"].includes(record.role)) {
          setAuthError("Your account has not been provisioned. Contact your school administrator.");
          setRole(null);
          setProfile(null);
        } else if (record.loginDisabled) {
          window.localStorage.removeItem(cacheKey);
          window.sessionStorage.setItem("cbt_login_error", "Your account access is blocked. Contact your administrator.");
          void signOut(auth);
        } else {
          if (record.role === "student" && !snapshot.metadata.fromCache) {
            try { window.localStorage.setItem(cacheKey, JSON.stringify({ role: "student", displayName: record.displayName,
              username: record.username || "", email: record.email || "", loginDisabled: false })); }
            catch { /* The exam page reports storage failures before accepting answers. */ }
          }
          setProfile(record);
          setRole(record.role);
          setAuthError("");
        }
        setLoading(false);
      }, (error) => {
        if (auth.currentUser?.uid !== currentUser.uid) return;
        console.error("Account profile unavailable", error.code);
        setRole(null);
        setProfile(null);
        setAuthError("We could not verify your account. Connect to the internet and try again, or contact your administrator.");
        setLoading(false);
      });
    });
    return () => { unsubscribe(); unsubscribeProfile?.(); };
  }, []);

  useEffect(() => {
    if (!user || !role || authError) return undefined;
    const flush = () => void flushPendingSubmissions().catch((error) => console.error("Pending sync deferred", error));
    flush();
    window.addEventListener("online", flush);
    window.addEventListener("focus", flush);
    const retry = window.setInterval(flush, 30000);
    return () => {
      window.removeEventListener("online", flush);
      window.removeEventListener("focus", flush);
      window.clearInterval(retry);
    };
  }, [user, role, authError]);

  return <AuthContext.Provider value={{ user, role, profile, loading, authError, logout: () => signOut(auth),
    isAdmin: role === "admin" || role === "superadmin" }}>{children}</AuthContext.Provider>;
}

export function useAuth() { return useContext(AuthContext); }
