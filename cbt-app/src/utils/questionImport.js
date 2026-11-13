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
