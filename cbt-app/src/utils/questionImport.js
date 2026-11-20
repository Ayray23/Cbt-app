// The same validation is used by the question importer and its tests.
// Keep upload errors specific so a small DOCX is never reported as "too large".
export const MAX_QUESTION_IMPORT_BYTES = 2_000_000;

export function validateQuestionImportFile(file) {
  if (!file) return "Choose a Word (.docx) or Excel (.xlsx) question file.";
  if (!/\.(docx|xlsx)$/i.test(String(file.name || ""))) {
    return "Unsupported file type. Select a Word .docx or Excel .xlsx file.";
  }
  if (!file.size) return "The selected question file is empty.";
  if (!Number.isFinite(file.size) || file.size > MAX_QUESTION_IMPORT_BYTES) {
    return "This question file is larger than 2 MB. Choose a smaller .docx or .xlsx file.";
  }
  return null;
}

// The template starts each question with a number; continuation text is preserved.
export function parseQuestionText(text, examId) {
  const blocks = [];
  let current = null;
  let section = "question";
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.replace(/\u00a0/g, " ").trim();
    if (!line) continue;
    const start = line.match(/^(?:question\s+\d+[\s:.)-]*|\d+[.)]\s*)(.*)$/i);
    if (start) {
      current = {
        examId,
        question: start[1],
        options: { A: "", B: "", C: "", D: "" },
        correctAnswer: "",
        marks: 1,
      };
      blocks.push(current);
      section = "question";
      continue;
    }
    if (!current) {
      current = {
        examId,
        question: "",
        options: { A: "", B: "", C: "", D: "" },
        correctAnswer: "",
        marks: 1,
      };
      blocks.push(current);
    }
    const option = line.match(/^([A-D])[).:-]\s*(.*)$/i);
    const answer = line.match(/^answer\s*[:=-]?\s*([A-D])\s*$/i);
    const marks = line.match(/^marks?\s*[:=-]?\s*(\d+(?:\.\d+)?)\s*$/i);
    if (option) {
      section = option[1].toUpperCase();
      current.options[section] = option[2];
    } else if (answer) {
      current.correctAnswer = answer[1].toUpperCase();
      section = "metadata";
    } else if (marks) {
      current.marks = Number(marks[1]);
      section = "metadata";
    } else if (section === "question")
      current.question += (current.question ? "\n" : "") + line;
    else if (section !== "metadata") current.options[section] += "\n" + line;
  }
  return blocks;
}
