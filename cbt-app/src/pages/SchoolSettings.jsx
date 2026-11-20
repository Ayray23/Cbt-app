import { useState } from "react";
import { useSchool } from "../hooks/useSchool";
import { callApi } from "../services/api";
import StatusBanner from "../components/StatusBanner";

const initial = {
  name: "",
  address: "",
  contact: "",
  academicSession: "2026/2027",
  term: "First",
  classes: ["JSS1 A", "JSS2 A", "JSS3 A", "SS1 A", "SS2 A", "SS3 A"],
  subjects: ["English Language", "Mathematics"],
};

const fieldLabels = {
  name: "Name",
  address: "School address",
  contact: "Contact details",
  academicSession: "Academic session (2026/2027)",
};

export default function SchoolSettings() {
  const { school, error } = useSchool();
  const [draft, setDraft] = useState(null);
  const [banner, setBanner] = useState(null);
  const [busy, setBusy] = useState(false);
  const [gradeText, setGradeText] = useState(null);
  const value = draft || school || initial;

  function change(key, next) {
    setDraft({ ...value, [key]: next });
  }

  async function save(event) {
    event.preventDefault();
    setBusy(true);
    try {
      const grades = (
        gradeText ??
        (value.grades || []).map((grade) =>
          `${grade.min}|${grade.label}|${grade.remark}`).join("\n")
      ).split("\n").filter((line) => line.trim()).map((line) => {
        const [min, label = "", remark = ""] = line.split("|");
        return { min: Number(min), label: label.trim(), remark: remark.trim() };
      });
      await callApi("school.save", { ...value, grades });
      setBanner({ tone: "success", message: "School settings saved. Existing exam records keep their original session and term." });
      setDraft(null);
    } catch (err) {
      setBanner({ tone: "error", message: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ui-page">
      <StatusBanner {...banner} />
      <StatusBanner tone="error" message={error} />
      <header className="ui-card border-t-4 border-t-yellow-300">
        <p className="ui-eyebrow">Administration / School profile</p>
        <h2 className="ui-page-heading mt-2">School setup</h2>
        <p className="ui-subtitle max-w-2xl">
          Update the school identity, academic calendar, classes and subjects.
          Existing exam sessions and student enrolments are not modified automatically.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <span className="ui-pill">{(value.classes || []).filter(Boolean).length} classes</span>
          <span className="ui-pill">{(value.subjects || []).filter(Boolean).length} subjects</span>
          <span className="ui-pill">{value.term || "No term selected"} term</span>
        </div>
      </header>

      <form onSubmit={save} className="space-y-5">
        <section className="ui-card">
          <h3 className="ui-section-heading">School details</h3>
          <p className="ui-subtitle">These details identify the school across the CBT workspace.</p>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            {["name", "address", "contact", "academicSession"].map((key) => (
              <label key={key} className="block text-sm font-semibold text-slate-700">
                {fieldLabels[key]}
                <input
                  required={["name", "academicSession"].includes(key)}
                  value={value[key] || ""}
                  onChange={(event) => change(key, event.target.value)}
                  className="ui-field"
                />
              </label>
            ))}
            <label className="block text-sm font-semibold text-slate-700">
              Term
              <select
                value={value.term}
                onChange={(event) => change("term", event.target.value)}
                className="ui-field"
              >
                {["First", "Second", "Third"].map((term) => <option key={term}>{term}</option>)}
              </select>
            </label>
          </div>
        </section>

        <section className="ui-card">
          <h3 className="ui-section-heading">Classes and subjects</h3>
          <p className="ui-subtitle">Enter one class or subject per line, exactly as it should appear when creating exams.</p>
          <div className="mt-5 grid gap-5 md:grid-cols-2">
            {["classes", "subjects"].map((key) => (
              <label key={key} className="block text-sm font-semibold text-slate-700">
                {key === "classes" ? "Classes (one per line)" : "Subjects (one per line)"}
                <textarea
                  rows={8}
                  value={(value[key] || []).join("\n")}
                  onChange={(event) => change(key, event.target.value.split("\n"))}
                  className="ui-field resize-y"
                />
              </label>
            ))}
          </div>
        </section>

        <section className="ui-card">
          <h3 className="ui-section-heading">Grading</h3>
          <p className="ui-subtitle">Optional grade bands. Format each line as minimum percentage | grade | remark.</p>
          <label className="mt-5 block text-sm font-semibold text-slate-700">
            School grade bands
            <textarea
              rows={5}
              placeholder="70|A|Excellent"
              value={gradeText ?? (value.grades || []).map((grade) =>
                `${grade.min}|${grade.label}|${grade.remark}`).join("\n")}
              onChange={(event) => setGradeText(event.target.value)}
              className="ui-field resize-y"
            />
          </label>
        </section>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-blue-100 bg-blue-50/70 p-4">
          <p className="text-sm text-blue-900">Your changes only affect future setup and new enrolments.</p>
          <button type="submit" disabled={busy} className="ui-btn-primary">
            {busy ? "Saving…" : "Save school settings"}
          </button>
        </div>
      </form>
    </div>
  );
}
