// Admin and superadmin can review all school exam papers.
// Teachers remain restricted to the papers they authored.
export function examOwnerFilter(role, uid) {
  return role === "teacher" ? [["createdBy", "==", uid]] : [];
}
