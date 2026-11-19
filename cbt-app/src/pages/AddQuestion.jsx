import { useAuth } from "../contexts/AuthContext";
import { useEffect, useRef, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "/firebase";
import StatusBanner from "../components/StatusBanner";
import { addQuestion } from "../services/cbtService";

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
  const { role, user } = useAuth();
  const [preview, setPreview] = useState([]);
  const [image, setImage] = useState("");
  const [imageAlt, setImageAlt] = useState("");
  const [exams, setExams] = useState([]);
  const [examId, setExamId] = useState("");
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState({ A: "", B: "", C: "", D: "" });
  const [correctAnswer, setCorrectAnswer] = useState("");
  const [marks, setMarks] = useState(1);
  const [wordFile, setWordFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [banner, setBanner] = useState(null);
  const wordFileInputRef = useRef(null);

  useEffect(() => {
    const examsQuery = query(
      collection(db, "exams"),
      ...(role === "teacher" ? [where("createdBy", "==", user.uid)] : [where("status", "in", ["draft", "published"])])
    );

    return onSnapshot(examsQuery, (snapshot) => {
      setExams(snapshot.docs.map((docItem) => ({ id: docItem.id, ...docItem.data() })));
    });
  }, [role, user.uid]);

  function validate(payload) {
    if (!payload.examId) {
      return "Select an exam.";
    }

    if (!payload.question.trim()) {
      return "Question is required.";
    }

    const filledOptions = Object.values(payload.options).filter((option) => option.trim());
    if (filledOptions.length < 4) {
      return "All four options are required.";
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
    const payload = { examId, question, options, correctAnswer, marks, image, imageAlt };
    const validationError = validate(payload);

    if (validationError) {
      setBanner({ tone: "error", message: validationError });
      return;
    }

    setLoading(true);

    try {
      await addQuestion(payload);
      setQuestion(""); setImage(""); setImageAlt("");
      setOptions({ A: "", B: "", C: "", D: "" });
      setCorrectAnswer("");
      setMarks(1);
      setBanner({ tone: "success", message: "Question saved successfully." });
    } catch (error) {
      console.error(error);
      setBanner({ tone: "error", message: "Could not save question." });
    } finally {
      setLoading(false);
    }
  }

  async function handleWordUpload() {
    if (!examId) {
      setBanner({ tone: "error", message: "Select an exam first." });
      return;
    }

    if (!wordFile) {
      setBanner({ tone: "error", message: "Choose a Word document." });
      return;
    }

    setLoading(true);

    try {
      if (!wordFile.name.toLowerCase().endsWith(".docx") || wordFile.size > 2000000) throw new Error("Choose a DOCX file smaller than 2 MB.");
      const arrayBuffer = await wordFile.arrayBuffer();
      const { default: mammoth } = await import("mammoth");
      const result = await mammoth.extractRawText({ arrayBuffer });
      const blocks = buildBlocksFromText(result.value);

      const parsed = [];
      const seen = new Set();

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

        const key = payload.question.toLowerCase().trim();
        parsed.push({ ...payload, error: validate(payload) || (seen.has(key) ? 'Duplicate question in this file.' : ''), saved: false });
        seen.add(key);
      }
      setPreview(parsed);
      setBanner({ tone: 'info', message: 'Review every question and answer before saving. Invalid rows are listed below.' });
      setWordFile(null);
      if (wordFileInputRef.current) {
        wordFileInputRef.current.value = "";
      }
    } catch (error) {
      console.error(error);
      setBanner({ tone: "error", message: error.message || "Word preview failed." });
    } finally {
      setLoading(false);
    }
  }

  async function savePreview() {
    setLoading(true);
    const rows = [...preview];
    try { for (let i = 0; i < rows.length; i++) { if (rows[i].saved || rows[i].error) continue; await addQuestion(rows[i]); rows[i] = { ...rows[i], saved: true }; setPreview([...rows]); } setBanner({ tone: 'success', message: 'Preview questions saved.' }); }
    catch (e) { setBanner({ tone: 'error', message: `Import stopped: ${e.message}. Saved rows are marked; retry will skip them.` }); }
    finally { setLoading(false); }
  }
  async function chooseImage(event) {
    const file = event.target.files?.[0]; if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 100000) { setBanner({ tone: 'error', message: 'Use PNG, JPEG or WebP up to 100 KB. Large papers must be split.' }); return; }
    const reader = new FileReader(); reader.onload = () => setImage(String(reader.result)); reader.readAsDataURL(file);
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
          onChange={(event) => { setExamId(event.target.value); setPreview([]); }}
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

          <label className="block">Question diagram (optional; PNG/JPEG/WebP, 100 KB maximum)<input type="file" accept="image/png,image/jpeg,image/webp" onChange={chooseImage} /></label>
          {image && <><img src={image} alt={imageAlt || 'Question diagram preview'} className="max-h-60" /><input placeholder="Describe the diagram for accessibility" value={imageAlt} onChange={e => setImageAlt(e.target.value)} className="border p-3 rounded-xl w-full" /><button onClick={() => setImage('')}>Remove image</button></>}
          <p className="text-sm text-slate-500">Use line breaks for passages and Unicode for language accents, fractions and scientific symbols. DOCX import extracts text; add diagrams separately.</p>
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
            accept=".docx"
            onChange={(event) => setWordFile(event.target.files?.[0] ?? null)}
            className="flex-1 text-sm"
          />

          <div className="flex gap-3">
            <button
              onClick={handleWordUpload}
              disabled={loading || !wordFile}
              className="rounded-xl bg-emerald-600 px-5 py-3 text-sm font-medium text-white disabled:opacity-60"
            >
              {loading ? "Uploading..." : "Preview questions"}
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

        {!!preview.length && <div className="mt-5 space-y-4"><h4 className="font-semibold">Import preview ({preview.length})</h4>{preview.map((r, i) => <article key={i} className="border rounded-xl p-4"><p className="whitespace-pre-wrap">{i + 1}. {r.question}</p>{Object.entries(r.options).map(([k, v]) => <p key={k}>{k}. {v}</p>)}<p>Answer: {r.correctAnswer} · Marks: {r.marks} · {r.saved ? 'Saved' : r.error || 'Ready'}</p></article>)}<button disabled={loading || preview.some(r => r.error)} onClick={savePreview} className="bg-slate-900 text-white p-3 rounded-xl">Confirm and save preview</button><button disabled={loading} onClick={() => setPreview([])} className="ml-4">Clear preview</button></div>}
        {wordFile && (
          <p className="mt-3 text-sm text-slate-500">
            Selected file: <span className="font-medium text-slate-700">{wordFile.name}</span>
          </p>
        )}
      </section>
    </div>
  );
}
