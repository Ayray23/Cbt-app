import { useEffect, useState } from 'react';
import { toast } from '../utils/toast';
import { collection, query, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { db } from '/firebase';
export default function AuditLogs() {
  const [rows, setRows] = useState([]);
  useEffect(() => onSnapshot(query(collection(db, 'auditLogs'), orderBy('createdAtMs', 'desc'), limit(200)), s => setRows(s.docs.map(d => ({ id: d.id, ...d.data() }))), e => toast.error(e.message)), []);
  return <section className="bg-white rounded-2xl p-6 space-y-4"><h2 className="text-2xl font-semibold">Audit trail</h2><p>Latest 200 recorded school, student, result and exam interventions.</p>{rows.map(r => <article key={r.id} className="border-b py-3"><strong>{r.action}</strong><p>{new Date(r.createdAtMs).toLocaleString('en-NG', { timeZone: 'Africa/Lagos' })} · Staff: {r.actorUid} · Record: {r.target}</p><pre className="whitespace-pre-wrap text-sm">{JSON.stringify(r.details, null, 2)}</pre></article>)}</section>;
}
