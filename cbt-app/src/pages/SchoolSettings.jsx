import { useState } from 'react';
import { useSchool } from '../hooks/useSchool';
import { callApi } from '../services/api';
import StatusBanner from '../components/StatusBanner';
const initial = { name: '', address: '', contact: '', academicSession: '2026/2027', term: 'First', classes: ['JSS1 A', 'JSS2 A', 'JSS3 A', 'SS1 A', 'SS2 A', 'SS3 A'], subjects: ['English Language', 'Mathematics'] };
export default function SchoolSettings() {
  const { school, error } = useSchool();
  const [draft, setDraft] = useState(null);
  const [banner, setBanner] = useState(null);
  const [busy, setBusy] = useState(false);
  const [gradeText, setGradeText] = useState(null);
  const value = draft || school || initial;
  const change = (key, v) => setDraft({ ...value, [key]: v });
  async function save(e) { e.preventDefault(); setBusy(true); try { const grades = (gradeText ?? (value.grades || []).map(g => `${g.min}|${g.label}|${g.remark}`).join('\n')).split('\n').filter(v => v.trim()).map(line => { const [min, label = '', remark = ''] = line.split('|'); return { min: Number(min), label: label.trim(), remark: remark.trim() }; }); await callApi('school.save', { ...value, grades }); setBanner({ tone: 'success', message: 'School settings saved. Existing exam records keep their original session and term.' }); setDraft(null); } catch (e) { setBanner({ tone: 'error', message: e.message }); } finally { setBusy(false); } }
  return <div className="space-y-5"><StatusBanner {...banner} /><StatusBanner tone="error" message={error} /><form onSubmit={save} className="rounded-2xl bg-white p-6 space-y-5"><h2 className="text-2xl font-semibold">School setup</h2><p>Configure one school. Add the subjects your school offers and its class arms. Changes here do not promote students automatically.</p>
    {['name', 'address', 'contact', 'academicSession'].map(key => <label key={key} className="block capitalize">{key === 'academicSession' ? 'Academic session (2026/2027)' : key}<input required={['name', 'academicSession'].includes(key)} value={value[key]} onChange={e => change(key, e.target.value)} className="block w-full border rounded-xl p-3 mt-2" /></label>)}
    <label className="block">Term<select value={value.term} onChange={e => change('term', e.target.value)} className="block border rounded-xl p-3">{['First', 'Second', 'Third'].map(t => <option key={t}>{t}</option>)}</select></label>
    {['classes', 'subjects'].map(key => <label className="block capitalize" key={key}>{key} (one per line)<textarea rows={7} value={value[key].join('\n')} onChange={e => change(key, e.target.value.split('\n'))} className="block w-full border rounded-xl p-3 mt-2" /></label>)}
    <label className="block">School grade bands (optional, one per line: minimum percentage|grade|remark)<textarea className="block w-full border rounded-xl p-3" rows={6} placeholder="70|A|Excellent" value={gradeText ?? (value.grades || []).map(g => `${g.min}|${g.label}|${g.remark}`).join('\n')} onChange={e => setGradeText(e.target.value)} /></label>
    <button disabled={busy} className="rounded-xl bg-slate-900 text-white p-3">{busy ? 'Saving…' : 'Save school settings'}</button></form></div>;
}
