import { useEffect, useState } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '/firebase';
import { useAuth } from '../contexts/AuthContext';
export default function StudentResults() {
  const { user } = useAuth(); const [rows, setRows] = useState([]); const [error, setError] = useState('');
  useEffect(() => onSnapshot(query(collection(db, 'examResults'), where('studentUid', '==', user.uid), where('released', '==', true)), s => setRows(s.docs.map(d => ({ id: d.id, ...d.data() }))), e => setError(e.message)), [user.uid]);
  return <section className="bg-white rounded-2xl p-6 space-y-4"><h2 className="text-2xl font-semibold">Released results</h2><p role="alert">{error}</p>{rows.length ? rows.map(r => <article key={r.id} className="border-t py-4"><h3 className="font-semibold">{r.examTitle}</h3><p>{r.academicSession} · {r.term} · {r.subject}</p><p>{r.finalScore} / {r.maxMarks} — {r.maxMarks > 0 ? `${(r.finalScore / r.maxMarks * 100).toFixed(1)}%` : 'Awaiting valid total'}</p></article>) : <p>No results released yet.</p>}</section>;
}
