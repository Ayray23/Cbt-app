/* eslint-env node */
const admin = require("firebase-admin");
const path = require("path");

const [, , emailArg, roleArg = "superadmin"] = process.argv;
const email = (emailArg || "").trim().toLowerCase();
const role = (roleArg || "superadmin").trim().toLowerCase();
const allowedRoles = new Set(["student", "admin", "superadmin"]);

if (!email || !allowedRoles.has(role)) {
  console.error("Usage: node setAdmin.js <email> [student|admin|superadmin]");
  process.exit(1);
}

const serviceAccountPath = path.resolve(__dirname, "serviceAccountKey.json");
const serviceAccount = require(serviceAccountPath);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

async function main() {
  const db = admin.firestore();
  const snapshot = await db.collection("users").where("email", "==", email).limit(1).get();

  if (snapshot.empty) {
    throw new Error(
      "User profile not found. Ask the user to sign in first so their Firestore user record exists."
    );
  }

  const userDoc = snapshot.docs[0];

  await userDoc.ref.set(
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
