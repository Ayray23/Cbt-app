import { useAuth } from "../contexts/AuthContext";
import { useEffect, useRef, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "/firebase";
import { examOwnerFilter } from "../utils/examVisibility.mjs";
import StatusBanner from "../components/StatusBanner";
import { parseQuestionText, validateQuestionImportFile } from "../utils/questionImport";
import { downloadCsv } from "../utils/csv";
import { addQuestion } from "../services/cbtService";

export default function AddQuestion() {
  const requestId = useRef(null);
  const { role, user } = useAuth();
  const [preview, setPreview] = useState([]);
  const [entryMethod, setEntryMethod] = useState("import");
  const [image, setImage] = useState("");
  const [imageAlt, setImageAlt] = useState("");
  const [exams, setExams] = useState([]);
  const [examId, setExamId] = useState("");
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState({ A: "", B: "", C: "", D: "" });
  const [correctAnswer, setCorrectAnswer] = useState("");
  const [marks, setMarks] = useState(1);
  const [importFile, setWordFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [banner, setBanner] = useState(null);
  const importFileInputRef = useRef(null);
  const diagramFileInputRef = useRef(null);

  useEffect(() => {
    const examsQuery = query(
      collection(db, "exams"),
      ...(role === "teacher"
        ? examOwnerFilter(role, user.uid).map(([field, operator, value]) => where(field, operator, value))
        : [where("status", "in", ["draft", "published"])]),
    );

    return onSnapshot(examsQuery, (snapshot) => {
      setExams(
        snapshot.docs.map((docItem) => ({ id: docItem.id, ...docItem.data() })),
      );
    });
  }, [role, user.uid]);

  function validate(payload) {
    if (!payload.examId) {
      return "Select an exam.";
    }

    if (!payload.question.trim()) {
      return "Question is required.";
    }

    const filledOptions = Object.values(payload.options).filter((option) =>
      option.trim(),
    );
    if (filledOptions.length < 4) {
      return "All four options are required.";
    }

    if (
      !payload.correctAnswer ||
      !payload.options[payload.correctAnswer]?.trim()
    ) {
      return "Select a valid correct answer.";
    }

    if (!Number.isFinite(Number(payload.marks)) || Number(payload.marks) <= 0) {
      return "Marks must be greater than zero.";
    }

    return null;
  }

  async function handleManualSave() {
    const payload = {
      examId,
      question,
      options,
      correctAnswer,
      marks,
      image,
      imageAlt,
    };
    const validationError = validate(payload);

    if (validationError) {
      setBanner({ tone: "error", message: validationError });
      return;
    }

    setLoading(true);

    try {
      requestId.current ||= crypto.randomUUID();
      await addQuestion({ ...payload, requestId: requestId.current });
      requestId.current = null;
      setQuestion("");
      setImage("");
      setImageAlt("");
      if (diagramFileInputRef.current) diagramFileInputRef.current.value = "";
      setOptions({ A: "", B: "", C: "", D: "" });
      setCorrectAnswer("");
      setMarks(1);
      setBanner({ tone: "success", message: "Question saved successfully." });
    } catch (error) {
      console.error(error);
      setBanner({
        tone: "error",
        message: error.message || "Could not save question.",
      });
    } finally {
      setLoading(false);
    }
  }

  async function handleImportUpload() {
    if (!examId) {
      setBanner({ tone: "error", message: "Select an exam first." });
      return;
    }

    if (!importFile) {
      setBanner({ tone: "error", message: "Choose a Word .docx document or Excel .xlsx workbook." });
      return;
    }

    setLoading(true);

    try {
      const fileError = validateQuestionImportFile(importFile);
      if (fileError) throw new Error(fileError);
      const excel = importFile.name.toLowerCase().endsWith(".xlsx");
      const raw = excel
        ? await import("../utils/excelImport").then((m) => m.readExcelTable(importFile, 300))
        : await (async () => {
            const { default: mammoth } = await import("mammoth");
            const result = await mammoth.extractRawText({ arrayBuffer: await importFile.arrayBuffer() });
            return parseQuestionText(result.value, examId);
          })();
      const seen = new Set();
      const parsed = raw.map((row) => {
        const payload = excel
          ? {
              examId,
              question: row.question || "",
              options: {
                A: row.optionA || "", B: row.optionB || "",
                C: row.optionC || "", D: row.optionD || "",
              },
              correctAnswer: String(row.correctAnswer || "").trim().toUpperCase(),
              marks: row.marks === "" || row.marks == null ? 1 : Number(row.marks),
              sourceRow: row.__rowNumber,
            }
          : row;
        const key = payload.question.toLowerCase().trim();
        const error = validate(payload) ||
          (seen.has(key) ? "Duplicate question in this file." : "");
        seen.add(key);
        return {
          ...payload,
          error,
          saved: false,
          requestId: crypto.randomUUID(),
        };
      });
      if (!parsed.length) throw new Error("The document contains no questions.");
      setPreview(parsed);
      setBanner({
        tone: "info",
        message:
          "Review every question and answer before saving. Invalid rows are listed below.",
      });
      setWordFile(null);
      if (importFileInputRef.current) {
        importFileInputRef.current.value = "";
      }
    } catch (error) {
      console.error(error);
      setBanner({
        tone: "error",
        message: error.message || "Document preview failed.",
      });
    } finally {
      setLoading(false);
    }
  }

  function editPreview(index, patch) {
    setPreview((current) => {
      const seen = new Set();
      return current.map((row, i) => {
        const updated =
          i === index
            ? { ...row, ...patch, requestId: crypto.randomUUID() }
            : row;
        const key = updated.question.toLowerCase().trim();
        const error =
          validate(updated) ||
          (seen.has(key) ? "Duplicate question in this file." : "");
        seen.add(key);
        return { ...updated, error };
      });
    });
  }
  async function savePreview() {
    setLoading(true);
    const rows = [...preview];
    try {
      for (let i = 0; i < rows.length; i++) {
        if (rows[i].saved || rows[i].error) continue;
        await addQuestion(rows[i]);
        rows[i] = { ...rows[i], saved: true };
        setPreview([...rows]);
      }
      // Only clear the preview after every question has been saved successfully.
      // On partial failure, keep the saved flags and the remaining rows for retry.
      setPreview([]);
      setWordFile(null);
      if (importFileInputRef.current) importFileInputRef.current.value = "";
      setBanner({
        tone: "success",
        message: `${rows.length} question(s) saved. The import form is ready for another file.`,
      });
    } catch (e) {
      setBanner({
        tone: "error",
        message: `Import stopped: ${e.message}. Saved rows are marked; retry will skip them.`,
      });
    } finally {
      setLoading(false);
    }
  }
  async function chooseImage(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (
      !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
      file.size > 100000
    ) {
      setBanner({
        tone: "error",
        message:
          "Use PNG, JPEG or WebP up to 100 KB. Large papers must be split.",
      });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setImage(String(reader.result));
    reader.readAsDataURL(file);
  }
  function handleCancelImportUpload() {
    setWordFile(null);
    if (importFileInputRef.current) {
      importFileInputRef.current.value = "";
    }
    setBanner({ tone: "info", message: "Selected import file removed." });
  }

  return (
    <div className="ui-page">
      <StatusBanner
        tone={banner?.tone}
        message={banner?.message}
        onClose={() => setBanner(null)}
      />

      <section className="ui-card">
        <h2 className="ui-page-heading">Add questions</h2>
        <p className="mt-2 text-sm text-slate-500">
          Build the question bank manually, import Word .docx, or upload an Excel .xlsx question sheet.
        </p>
      </section>

      <section className="ui-card">
        <label className="mb-2 block text-sm font-medium text-slate-700">
          Exam
        </label>
        <select
          value={examId}
          onChange={(event) => {
            setExamId(event.target.value);
            setPreview([]);
          }}
          className="w-full rounded-xl border border-slate-300 px-4 py-3"
        >
          <option value="">Select exam</option>
          {exams.map((exam) => (
            <option key={exam.id} value={exam.id}>
              {exam.title}
            </option>
          ))}
        </select>
      </section>

      <section className="ui-card">
        <h3 className="ui-section-heading">Choose how to add questions</h3>
        <p className="mt-2 text-sm text-slate-600">
          Select an exam above, then choose a method. Word and Excel files
          upload in their own section, not through the manual diagram picker.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2" aria-label="Question entry method">
          <button
            type="button"
            aria-pressed={entryMethod === "import"}
            onClick={() => { setEntryMethod("import"); setBanner(null); }}
            className={`rounded-xl border-2 p-4 text-left transition-colors ${entryMethod === "import" ? "border-emerald-600 bg-emerald-50 text-emerald-950" : "border-slate-200 bg-white text-slate-800 hover:border-slate-400"}`}
          >
            <span className="block text-base font-semibold">Upload Word or Excel</span>
            <span className="mt-1 block text-sm">Import multiple questions from a .docx or .xlsx file (up to 2 MB).</span>
          </button>
          <button
            type="button"
            aria-pressed={entryMethod === "manual"}
            onClick={() => { setEntryMethod("manual"); setBanner(null); }}
            className={`rounded-xl border-2 p-4 text-left transition-colors ${entryMethod === "manual" ? "border-slate-800 bg-slate-100 text-slate-950" : "border-slate-200 bg-white text-slate-800 hover:border-slate-400"}`}
          >
            <span className="block text-base font-semibold">Type a question manually</span>
            <span className="mt-1 block text-sm">Enter one question, four options, and its correct answer.</span>
          </button>
        </div>
      </section>

      {entryMethod === "manual" && (
      <section className="ui-card">
        <h3 className="ui-section-heading">Manual entry</h3>

        <div className="mt-4 space-y-4">
          <textarea
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="Type the question prompt"
            className="min-h-32 w-full rounded-xl border border-slate-300 px-4 py-3"
          />

          <label className="block">
            Optional image for this single question (PNG/JPEG/WebP, up to 100 KB)
            <input
              ref={diagramFileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={chooseImage}
            />
          </label>
          {image && (
            <>
              <img
                src={image}
                alt={imageAlt || "Question diagram preview"}
                className="max-h-60"
              />
              <input
                placeholder="Describe the diagram for accessibility"
                value={imageAlt}
                onChange={(e) => setImageAlt(e.target.value)}
                className="border p-3 rounded-xl w-full"
              />
              <button
                  type="button"
                  onClick={() => {
                    setImage("");
                    setImageAlt("");
                    if (diagramFileInputRef.current) diagramFileInputRef.current.value = "";
                  }}
                >
                  Remove image
                </button>
            </>
          )}
          <p className="text-sm text-slate-500">
            This image picker is not for Word documents. To upload a .docx or
            .xlsx file containing questions, choose "Upload Word or Excel" above.
            Use line breaks for passages and Unicode for special characters.
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            {["A", "B", "C", "D"].map((optionKey) => (
              <input
                key={optionKey}
                value={options[optionKey]}
                onChange={(event) =>
                  setOptions((current) => ({
                    ...current,
                    [optionKey]: event.target.value,
                  }))
                }
                placeholder={`Option ${optionKey}`}
                className="rounded-xl border border-slate-300 px-4 py-3"
              />
            ))}
          </div>

          <div className="flex flex-col gap-4 md:flex-row">
            <select
              value={correctAnswer}
              onChange={(event) => setCorrectAnswer(event.target.value)}
              className="rounded-xl border border-slate-300 px-4 py-3"
            >
              <option value="">Correct answer</option>
              <option value="A">A</option>
              <option value="B">B</option>
              <option value="C">C</option>
              <option value="D">D</option>
            </select>

            <input
              type="number"
              min="1"
              value={marks}
              onChange={(event) => setMarks(Number(event.target.value))}
              className="rounded-xl border border-slate-300 px-4 py-3"
            />

            <button
              onClick={handleManualSave}
              disabled={loading}
              className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-medium text-white disabled:opacity-60"
            >
              {loading ? "Saving..." : "Save question"}
            </button>
          </div>
        </div>
      </section>
      )}

      {entryMethod === "import" && (
      <section className="ui-card border-2 border-blue-200">
        <h3 className="ui-section-heading">Upload Word or Excel questions</h3>
        <p className="mt-2 text-sm text-slate-500">
          Word accepts numbered questions with A–D options. Excel .xlsx uses
          columns: question, optionA, optionB, optionC, optionD, correctAnswer,
          marks. Review the correct answer for each question before saving.
          Embedded Excel images are not imported.
        </p>

        <button
          type="button"
          className="underline text-sm mt-3"
          onClick={() => downloadCsv("question-template.csv", [
            ["question", "optionA", "optionB", "optionC", "optionD", "correctAnswer", "marks"],
            ["2 + 2 = ?", "4", "5", "3", "6", "A", 1],
          ])}
        >
          Download Excel-ready question template
        </button>
        <div className="mt-5 rounded-xl border border-dashed border-emerald-300 bg-emerald-50/50 p-4">
          <label htmlFor="question-import-file" className="mb-2 block font-medium text-slate-800">
            Select your question document (.docx or .xlsx, maximum 2 MB)
          </label>
          <input
            id="question-import-file"
            ref={importFileInputRef}
            type="file"
            accept=".docx,.xlsx"
            onChange={(event) => setWordFile(event.target.files?.[0] ?? null)}
            className="block w-full text-sm text-slate-700"
          />
          <p className="mt-2 text-xs text-slate-600">
            Word and Excel questions only. For diagrams attached to an individual question,
            use manual entry.
          </p>

          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={handleImportUpload}
              disabled={loading || !importFile}
              className="rounded-xl bg-emerald-600 px-5 py-3 text-sm font-medium text-white disabled:opacity-60"
            >
              {loading ? "Uploading..." : "Preview questions"}
            </button>

            <button
              type="button"
              onClick={handleCancelImportUpload}
              disabled={loading || !importFile}
              className="rounded-xl border border-slate-300 px-5 py-3 text-sm font-medium text-slate-700 disabled:opacity-60"
            >
              Cancel
            </button>
          </div>
        </div>

        {!!preview.length && (
          <div className="mt-5 space-y-4">
            <h4 className="font-semibold">Import preview ({preview.length})</h4>
            {preview.map((r, i) => (
              <article key={i} className="border rounded-xl p-4">
                <label>
                  Question {i + 1}{r.sourceRow ? ` (Excel row ${r.sourceRow})` : ""}
                  <textarea
                    disabled={r.saved}
                    className="block border w-full p-2"
                    value={r.question}
                    onChange={(e) =>
                      editPreview(i, { question: e.target.value })
                    }
                  />
                </label>
                {Object.entries(r.options).map(([k, v]) => (
                  <label key={k}>
                    Option {k}
                    <textarea
                      className="block border w-full p-2"
                      disabled={r.saved}
                      value={v}
                      onChange={(e) =>
                        editPreview(i, {
                          options: { ...r.options, [k]: e.target.value },
                        })
                      }
                    />
                  </label>
                ))}
                <label>
                  Answer
                  <select
                    disabled={r.saved}
                    value={r.correctAnswer}
                    onChange={(e) =>
                      editPreview(i, { correctAnswer: e.target.value })
                    }
                  >
                    <option value="">Choose</option>
                    {["A", "B", "C", "D"].map((k) => (
                      <option key={k}>{k}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Marks
                  <input
                    type="number"
                    min="1"
                    disabled={r.saved}
                    value={r.marks}
                    onChange={(e) =>
                      editPreview(i, { marks: Number(e.target.value) })
                    }
                  />
                </label>
                <p>{r.saved ? "Saved" : r.error || "Ready"}</p>
              </article>
            ))}
            <button
              disabled={loading || preview.some((r) => r.error)}
              onClick={savePreview}
              className="bg-slate-900 text-white p-3 rounded-xl"
            >
              Confirm and save preview
            </button>
            <button
              disabled={loading}
              onClick={() => setPreview([])}
              className="ml-4"
            >
              Clear preview
            </button>
          </div>
        )}
        {importFile && (
          <p className="mt-3 text-sm text-slate-500">
            Selected file:{" "}
            <span className="font-medium text-slate-700">{importFile.name}</span>
          </p>
        )}
      </section>
      )}
    </div>
  );
}
