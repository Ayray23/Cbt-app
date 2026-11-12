import { useState } from 'react';
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from 'firebase/auth';
import { auth } from '/firebase';
import StatusBanner from '../components/StatusBanner';
export default function StudentAccount() {
  const [current, setCurrent] = useState(''); const [next, setNext] = useState(''); const [confirm, setConfirm] = useState(''); const [busy, setBusy] = useState(false); const [banner, setBanner] = useState(null);
  async function save(e) { e.preventDefault(); if (next !== confirm) { setBanner({ tone: 'error', message: 'New passwords do not match.' }); return; } setBusy(true);
    try { await reauthenticateWithCredential(auth.currentUser, EmailAuthProvider.credential(auth.currentUser.email, current)); await updatePassword(auth.currentUser, next); setCurrent(''); setNext(''); setConfirm(''); setBanner({ tone: 'success', message: 'Password changed.' }); } catch { setBanner({ tone: 'error', message: 'Could not change your password. Check the current password and internet connection.' }); } finally { setBusy(false); }
  }
  return <form onSubmit={save} className="max-w-xl bg-white p-6 rounded-2xl space-y-4"><h2 className="text-2xl font-semibold">Change password</h2><StatusBanner {...banner} />{[['Current password', current, setCurrent], ['New password', next, setNext], ['Confirm new password', confirm, setConfirm]].map(([label, value, change]) => <label key={label} className="block">{label}<input required type="password" minLength={label === 'Current password' ? 1 : 8} maxLength={128} value={value} onChange={e => change(e.target.value)} className="block w-full border rounded-xl p-3" /></label>)}<button disabled={busy} className="bg-slate-900 text-white p-3 rounded-xl">{busy ? 'Saving…' : 'Change password'}</button></form>;
}
