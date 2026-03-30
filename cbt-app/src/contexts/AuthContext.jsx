/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useState } from "react";
import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { auth, db } from "/firebase";

const AuthContext = createContext(null);

function buildDefaultProfile(currentUser) {
  return {
    email: currentUser.email ?? "",
    displayName:
      currentUser.displayName ??
      currentUser.email?.split("@")[0] ??
      "Candidate",
    role: "student",
    createdAt: serverTimestamp(),
    lastLoginAt: serverTimestamp(),
  };
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState("");

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (!currentUser) {
        setUser(null);
        setRole(null);
        setProfile(null);
        setAuthError("");
        setLoading(false);
        return;
      }

      setUser(currentUser);
      setAuthError("");

      try {
        const userRef = doc(db, "users", currentUser.uid);
        const snapshot = await getDoc(userRef);

        if (!snapshot.exists()) {
          const defaultProfile = buildDefaultProfile(currentUser);
          await setDoc(userRef, defaultProfile);
          setProfile(defaultProfile);
          setRole(defaultProfile.role);
        } else {
          const currentProfile = snapshot.data();

          await setDoc(
            userRef,
            {
              email: currentUser.email ?? currentProfile.email ?? "",
              displayName:
                currentUser.displayName ??
                currentProfile.displayName ??
                currentUser.email?.split("@")[0] ??
                "Candidate",
              lastLoginAt: serverTimestamp(),
            },
            { merge: true }
          );

          setProfile(currentProfile);
          setRole(currentProfile.role ?? "student");
        }
      } catch (error) {
        console.error("Failed to initialize user profile", error);
        setProfile(null);
        setRole(null);
        setAuthError(
          "We could not verify your account role or profile right now. Check your Firestore rules and your users profile, then sign in again."
        );
      } finally {
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  const logout = () => signOut(auth);

  return (
    <AuthContext.Provider
      value={{
        user,
        role,
        profile,
        loading,
        authError,
        logout,
        isAdmin: role === "admin" || role === "superadmin",
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
