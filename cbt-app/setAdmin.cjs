/* eslint-env node */
// Bootstrap script: set a user's role (default superadmin).
// Usage: node setAdmin.cjs <email> [student|admin|superadmin]
// Needs cbt-app/serviceAccountKey.json (never commit this file).
const admin = require("firebase-admin");
const path = require("path");

const [, , emailArg, roleArg = "superadmin"] = process.argv;
const email = (emailArg || "").trim().toLowerCase();
const role = (roleArg || "superadmin").trim().toLowerCase();
const allowedRoles = new Set(["student", "admin", "superadmin"]);

if (!email || !allowedRoles.has(role)) {
  console.error("Usage: node setAdmin.cjs <email> [student|admin|superadmin]");
  process.exit(1);
}

const serviceAccountPath = path.resolve(__dirname, "serviceAccountKey.json");
const serviceAccount = require(serviceAccountPath);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

async function main() {
  // Resolve the account through Firebase Auth, not the users.email field.
  let authUser;
  try {
    authUser = await admin.auth().getUserByEmail(email);
  } catch (error) {
    if (error && error.code === "auth/user-not-found") {
      throw new Error("No account exists for this email.");
    }
    throw error;
  }

  const userRef = admin.firestore().collection("users").doc(authUser.uid);
  const userDoc = await userRef.get();

  if (!userDoc.exists) {
    throw new Error(
      "User profile not found. Ask the user to sign in first so their Firestore user record exists."
    );
  }

  await userRef.set(
    {
      role,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  console.log(`Updated ${email} to role: ${role}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
