import { useState } from "react";
import mammoth from "mammoth";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";
import { db } from "/firebase";

export default function WordUpload() {
  const [examId, setExamId] = useState("");
  const [uploading, setUploading] = useState(false);

  const handleFile = async (e) => {
    const file = e.target.files[0];
    if (!file || !examId) {
      alert("Select file and enter Exam ID");
      return;
    }

    setUploading(true);

    try {
      const arrayBuffer = await file.arrayBuffer();
      const result = await mammoth.extractRawText({ arrayBuffer });
      const text = result.value;

      const blocks = text.split("\n\n");

      for (const block of blocks) {
        const lines = block.split("\n").map(l => l.trim());
        if (lines.length < 6) continue;

        const question = lines[0];
        const options = {
          A: lines[1]?.replace("A.", "").trim(),
          B: lines[2]?.replace("B.", "").trim(),
          C: lines[3]?.replace("C.", "").trim(),
          D: lines[4]?.replace("D.", "").trim(),
        };

        const correctAnswer = lines.find(l => l.startsWith("ANSWER"))
          ?.split(":")[1]?.trim();

        const marks = Number(
          lines.find(l => l.startsWith("MARKS"))
            ?.split(":")[1]?.trim()
        ) || 1;

        await addDoc(collection(db, "questions"), {
          examId,
          question,
          options,
          correctAnswer,
          marks,
          createdAt: serverTimestamp(),
        });
      }

      alert("Questions uploaded successfully");
      e.target.value = "";
    } catch (err) {
      console.error(err);
      alert("Upload failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="max-w-xl bg-white p-6 rounded shadow">
      <h2 className="text-xl font-bold mb-4">Upload Questions (Word)</h2>

      <input
        placeholder="Exam ID (e.g math12)"
        value={examId}
        onChange={(e) => setExamId(e.target.value)}
        className="w-full border p-2 mb-3"
      />

      <input
        type="file"
        accept=".docx"
        onChange={handleFile}
        className="w-full"
        disabled={uploading}
      />

      {uploading && <p className="mt-2 text-sm">Uploading…</p>}
    </div>
  );
}
