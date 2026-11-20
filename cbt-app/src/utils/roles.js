// The school uses four staff roles plus students. Accounts created earlier may
// still carry a retired role name; translate it here so they keep working.
//   examofficer -> admin, teacher_admin -> teacher
export const STAFF_ROLES = ["superadmin", "admin", "teacher", "invigilator"];
export const ASSIGNABLE_ROLES = ["admin", "teacher", "invigilator"];
const LEGACY_ROLES = { examofficer: "admin", teacher_admin: "teacher" };

export const canonicalRole = (role) => LEGACY_ROLES[role] || role;
export const isKnownRole = (role) => {
  const value = canonicalRole(role);
  return value === "student" || STAFF_ROLES.includes(value);
};
export const roleLabel = (role) =>
  ({ superadmin: "Superadmin", admin: "Admin", teacher: "Teacher", invigilator: "Invigilator", student: "Student" })[
    canonicalRole(role)
  ] || role;
