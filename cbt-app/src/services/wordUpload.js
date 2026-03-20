import mammoth from "mammoth";
import { addQuestion } from "./cbtService";

export async function uploadWordQuestions(file, examId) {
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });

  const lines = result.value.split("\n").filter(Boolean);

  for (let i = 0; i < lines.length; i += 6) {
    await addQuestion({
      examId,
      question: lines[i],
      options: {
        A: lines[i + 1],
        B: lines[i + 2],
        C: lines[i + 3],
        D: lines[i + 4],
      },
      correctAnswer: lines[i + 5],
    });
  }
}
