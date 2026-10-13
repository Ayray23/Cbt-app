import { useEffect, useRef, useState } from "react";
import mammoth from "mammoth";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "/firebase";
import StatusBanner from "../components/StatusBanner";
import { addQuestion } from "../services/cbtService";
import { useNavigate } from "react-router-dom";

function normalizeLine(line) {
  return line.replace(/\u00a0/g, " ").trim();
}

function isQuestionStart(line) {
  return /^\d+[).\s]/.test(line) || /^question\s+\d+/i.test(line);
}

function cleanQuestionLine(line) {
  return normalizeLine(line)
    .replace(/^\d+[).\s]+/, "")
    .replace(/^question\s+\d+[\s:.-]*/i, "")
    .trim();
}

function extractOption(lines, letter) {
  const optionLine = lines.find((line) => {
    const regex = new RegExp(`^${letter}[).:-\\s]`, "i");
    return regex.test(normalizeLine(line));
  });

  if (!optionLine) {
    return "";
  }

  return normalizeLine(optionLine)
    .replace(new RegExp(`^${letter}[).:-\\s]+`, "i"), "")
    .trim();
}

function extractAnswer(lines) {
  const answerLine = lines.find((line) => /answer/i.test(line));
  if (!answerLine) {
    return "";
  }

  const match = normalizeLine(answerLine).match(/answer\s*[:=-]?\s*([A-D])/i);
  return match ? match[1].toUpperCase() : "";
}

function extractMarks(lines) {
  const marksLine = lines.find((line) => /marks?/i.test(line));
  if (!marksLine) {
    return 1;
  }

  const match = normalizeLine(marksLine).match(/marks?\s*[:=-]?\s*(\d+)/i);
  return match ? Number(match[1]) : 1;
}

function buildBlocksFromLines(lines) {
  const blocks = [];
  let current = [];

  for (const rawLine of lines) {
    const line = normalizeLine(rawLine);
    if (!line) {
      continue;
    }

    if (current.length > 0 && isQuestionStart(line)) {
      const hasOptions = current.some((entry) => /^[A-D][).:-\s]/i.test(entry));
      const hasAnswer = current.some((entry) => /^answer/i.test(entry));
      if (hasOptions || hasAnswer) {
        blocks.push(current);
        current = [];
      }
    }

    current.push(line);
  }

  if (current.length > 0) {
    blocks.push(current);
  }

  return blocks;
}

function buildBlocksFromText(text) {
  const normalizedText = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const baseLines = normalizedText.split("\n").map(normalizeLine);
  return buildBlocksFromLines(baseLines).filter((block) => block.length > 0);
}

export default function AddQuestion() {
  const [exams, setExams] = useState([]);
  const [examId, setExamId] = useState("");
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState({ A: "", B: "", C: "", D: "" });
  const [correctAnswer, setCorrectAnswer] = useState("");
  const [marks, setMarks] = useState(1);
  const [wordFile, setWordFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [banner, setBanner] = useState(null);
  const [uploadModal, setUploadModal] = useState(null);
  const navigate = useNavigate();
  const wordFileInputRef = useRef(null);

  useEffect(() => {
    if (uploadModal?.type !== "success") return undefined;

    const redirectTimer = window.setTimeout(() => {
      navigate("/dashboard", { replace: true });
    }, 2200);

    return () => window.clearTimeout(redirectTimer);
  }, [uploadModal, navigate]);

  useEffect(() => {
    const examsQuery = query(
      collection(db, "exams"),
      where("status", "in", ["draft", "published"])
    );

    return onSnapshot(examsQuery, (snapshot) => {
      setExams(snapshot.docs.map((docItem) => ({ id: docItem.id, ...docItem.data() })));
    });
  }, []);

  function validate(payload) {
    if (!payload.examId) {
      return "Select an exam.";
    }

    if (!payload.question.trim()) {
      return "Question is required.";
    }

    const filledOptions = Object.values(payload.options).filter((option) => option.trim());
    if (filledOptions.length < 2) {
      return "At least two options are required.";
    }

    if (!payload.correctAnswer || !payload.options[payload.correctAnswer]?.trim()) {
      return "Select a valid correct answer.";
    }

    if (Number(payload.marks) <= 0) {
      return "Marks must be greater than zero.";
    }

    return null;
  }

  async function handleManualSave() {
    const payload = { examId, question, options, correctAnswer, marks };
    const validationError = validate(payload);

    if (validationError) {
      setUploadModal({ type: "error", title: "Check the question details", message: validationError });
      return;
    }

    setLoading(true);

    try {
      await addQuestion(payload);
      setQuestion("");
      setOptions({ A: "", B: "", C: "", D: "" });
      setCorrectAnswer("");
      setMarks(1);
      setBanner(null);
      setUploadModal({
        type: "success",
        title: "Question saved successfully",
        message: "Your question has been added. Taking you back to the admin overview…",
      });
    } catch (error) {
      console.error(error);
      setUploadModal({
        type: "error",
        title: "Question was not saved",
        message: "The question could not be saved. Check your connection and try again. Your entries have been kept on this page.",
      });
    } finally {
      setLoading(false);
    }
  }

  async function handleWordUpload() {
    if (!examId) {
      setUploadModal({ type: "error", title: "Select an exam", message: "Choose the exam you want to add questions to, then try again." });
      return;
    }

    if (!wordFile) {
      setUploadModal({ type: "error", title: "Choose a Word document", message: "Select a .doc or .docx file before uploading." });
      return;
    }

    setLoading(true);

    try {
      const arrayBuffer = await wordFile.arrayBuffer();
      const result = await mammoth.extractRawText({ arrayBuffer });
      const blocks = buildBlocksFromText(result.value);

      let saved = 0;
      let skipped = 0;

      for (const block of blocks) {
        const lines = block.map(normalizeLine).filter(Boolean);
        const firstNonMetaLine =
          lines.find(
            (line) =>
              !/^[A-D][).:-\s]/i.test(line) &&
              !/^answer/i.test(line) &&
              !/^marks?/i.test(line)
          ) ?? "";

        const payload = {
          examId,
          question: cleanQuestionLine(firstNonMetaLine),
          options: {
            A: extractOption(lines, "A"),
            B: extractOption(lines, "B"),
            C: extractOption(lines, "C"),
            D: extractOption(lines, "D"),
          },
          correctAnswer: extractAnswer(lines),
          marks: extractMarks(lines),
        };

        if (validate(payload)) {
          skipped += 1;
          continue;
        }

        await addQuestion(payload);
        saved += 1;
      }

      if (saved > 0 && skipped === 0) {
        setBanner(null);
        setUploadModal({
          type: "success",
          title: "Questions uploaded successfully",
          message: `${saved} question(s) were added to the selected exam. Taking you back to the admin overview…`,
        });
        setWordFile(null);
        if (wordFileInputRef.current) {
          wordFileInputRef.current.value = "";
        }
      } else {
        setUploadModal({
          type: "error",
          title: saved > 0 ? "Upload partly completed" : "Upload failed",
          message: saved > 0
            ? `${saved} question(s) were saved, but ${skipped} block(s) were skipped. You are still on this page. Fix the skipped questions and upload only those questions to avoid duplicates.`
            : `No questions were uploaded; ${skipped} block(s) were skipped. Check the Word format and try again. You are still on this page.`,
        });
      }
    } catch (error) {
      console.error(error);
      setUploadModal({
        type: "error",
        title: "Word upload failed",
        message: "The document could not be processed or fully saved. Check your connection and file format. If the upload stopped unexpectedly, review the question list before retrying the whole file so you do not create duplicates. You are still on this page.",
      });
    } finally {
      setLoading(false);
    }
  }

  function handleCancelWordUpload() {
    setWordFile(null);
    if (wordFileInputRef.current) {
      wordFileInputRef.current.value = "";
    }
    setBanner({ tone: "info", message: "Selected Word document removed." });
  }

  return (
    <div className="space-y-6">
      <StatusBanner
        tone={banner?.tone}
        message={banner?.message}
        onClose={() => setBanner(null)}
      />

      {uploadModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="upload-result-title"
        >
          <div className="w-full max-w-md rounded-3xl bg-white p-7 shadow-2xl">
            <div className={`mx-auto flex h-14 w-14 items-center justify-center rounded-full text-2xl font-bold ${uploadModal.type === "success" ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>
              {uploadModal.type === "success" ? "✓" : "!"}
            </div>
            <h2 id="upload-result-title" className="mt-5 text-center text-xl font-semibold text-slate-900">
              {uploadModal.title}
            </h2>
            <p className="mt-3 text-center text-sm leading-6 text-slate-600">
              {uploadModal.message}
            </p>
            {uploadModal.type === "success" ? (
              <p className="mt-4 text-center text-xs text-slate-400">Redirecting in a moment…</p>
            ) : (
              <button
                type="button"
                onClick={() => setUploadModal(null)}
                className="mt-6 w-full rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white"
              >
                Stay here and try again
              </button>
            )}
          </div>
        </div>
      )}

      <section className="rounded-2xl bg-white p-6 shadow-sm">
        <h2 className="text-2xl font-semibold text-slate-900">Add questions</h2>
        <p className="mt-2 text-sm text-slate-500">
          Build the question bank manually or import a `.docx` file using the template format.
        </p>
      </section>

      <section className="rounded-2xl bg-white p-6 shadow-sm">
        <label className="mb-2 block text-sm font-medium text-slate-700">Exam</label>
        <select
          value={examId}
          onChange={(event) => setExamId(event.target.value)}
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

      <section className="rounded-2xl bg-white p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-slate-900">Manual entry</h3>

        <div className="mt-4 space-y-4">
          <textarea
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="Type the question prompt"
            className="min-h-32 w-full rounded-xl border border-slate-300 px-4 py-3"
          />

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

      <section className="rounded-2xl bg-white p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-slate-900">Word import</h3>
        <p className="mt-2 text-sm text-slate-500">
          Accepts `1. Question`, `Question 1`, `A.` or `A)`, with or without blank lines.
        </p>

        <div className="mt-4 flex flex-col gap-4 md:flex-row md:items-center">
          <input
            ref={wordFileInputRef}
            type="file"
            accept=".doc,.docx"
            onChange={(event) => setWordFile(event.target.files?.[0] ?? null)}
            className="flex-1 text-sm"
          />

          <div className="flex gap-3">
            <button
              onClick={handleWordUpload}
              disabled={loading || !wordFile}
              className="rounded-xl bg-emerald-600 px-5 py-3 text-sm font-medium text-white disabled:opacity-60"
            >
              {loading ? "Uploading..." : "Upload questions"}
            </button>

            <button
              onClick={handleCancelWordUpload}
              disabled={loading || !wordFile}
              className="rounded-xl border border-slate-300 px-5 py-3 text-sm font-medium text-slate-700 disabled:opacity-60"
            >
              Cancel
            </button>
          </div>
        </div>

        {wordFile && (
          <p className="mt-3 text-sm text-slate-500">
            Selected file: <span className="font-medium text-slate-700">{wordFile.name}</span>
          </p>
        )}
      </section>
    </div>
  );
}
