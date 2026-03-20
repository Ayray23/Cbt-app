import React, { useState } from "react";
import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { storage } from "/firebase";

export default function UploadStudents(){
  const [file, setFile] = useState(null);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("");

  const handleUpload = async () => {
    if (!file) return alert("Select a file (CSV or XLSX).");
    setStatus("Uploading...");
    const path = `uploads/students/${Date.now()}-${file.name}`;
    const fileRef = ref(storage, path);
    const task = uploadBytesResumable(fileRef, file);

    task.on('state_changed',
      snapshot => setProgress((snapshot.bytesTransferred / snapshot.totalBytes) * 100),
      err => { console.error(err); setStatus("Upload failed"); },
      async () => {
        try {
          const url = await getDownloadURL(task.snapshot.ref);
          setStatus("Uploaded. File URL: " + url);
          // Optionally call Cloud Function endpoint to parse the file:
          // await fetch('/.netlify/functions/triggerParse', { method: 'POST', body: JSON.stringify({ fileUrl: url }) })
          // For now the Cloud Function (if deployed) will handle storage finalize trigger.
        } catch(e) {
          console.error(e); setStatus("Could not get file URL");
        }
      }
    );
  };

  return (
    <div className="p-6 bg-white rounded shadow">
      <h2 className="text-xl font-semibold">Upload Students</h2>
      <p className="text-sm text-gray-500 mt-1">CSV or XLSX. Use headers: StudentNumber, Name, Email, Class</p>

      <div className="mt-4">
        <input type="file" accept=".csv, .xlsx, .xls" onChange={(e)=>setFile(e.target.files?.[0] || null)} />
      </div>

      <div className="mt-4 flex items-center space-x-3">
        <button onClick={handleUpload} className="px-4 py-2 bg-blue-600 text-white rounded">Upload & Parse</button>
        <div className="text-sm text-gray-600">{progress ? `Progress: ${Math.round(progress)}%` : ''}</div>
      </div>

      <div className="mt-3 text-sm text-gray-700">{status}</div>
    </div>
  );
}
