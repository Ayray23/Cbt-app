import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { createUserWithEmailAndPassword, sendEmailVerification, signOut } from 'firebase/auth';
import { auth } from '/firebase';
import { callApi } from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
export default function TeacherSignup() {
  const { user, profile } = useAuth(); const navigate = useNavigate();
  const [form, setForm] = useState({ displayName: '', email: '', password: '', confirm: '' });
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function submit(e) {
    e.preventDefault(); setError('');
    if (!user && form.password !== form.confirm) { setError('Passwords do not match.'); return; }
    setBusy(true);
    try {
      const account = auth.currentUser || (await createUserWithEmailAndPassword(auth, form.email.trim(), form.password)).user;
      await callApi('teachers.register', { displayName: form.displayName });
      if (!account.emailVerified) await sendEmailVerification(account).catch(() => {});
      navigate('/teacher-access', { replace: true });
    } catch (e) { setError(e.code === 'auth/email-already-in-use' ? 'This email already has an account. Sign in to continue.' : e.message); }
    finally { setBusy(false); }
  }
  if (profile) return <main className="max-w-lg mx-auto p-8"><p>You already have a school account.</p><Link to={profile.approvalStatus && profile.approvalStatus !== 'approved' ? '/teacher-access' : '/'} className="underline">Open your account</Link></main>;
  return <main className="max-w-lg mx-auto p-8"><h1 className="text-3xl font-semibold">Create your teacher account</h1><p className="my-4">Your questions are private from other teachers. The superadmin can review your work. Verify your email and wait for approval before using the school workspace.</p><p role="alert" className="text-red-700">{error}</p><form onSubmit={submit} className="space-y-4">
    <label className="block">Full name<input required minLength={2} maxLength={120} className="block w-full border p-3 rounded-xl" value={form.displayName} onChange={e => setForm({ ...form, displayName: e.target.value })} /></label>
    {!user ? <>{['email', 'password', 'confirm'].map(key => <label key={key} className="block">{({ email: 'Email address', password: 'Password', confirm: 'Confirm password' })[key]}<input required type={key === 'email' ? 'email' : 'password'} minLength={key === 'email' ? undefined : 8} autoComplete={key === 'email' ? 'email' : 'new-password'} className="block w-full border p-3 rounded-xl" value={form[key]} onChange={e => setForm({ ...form, [key]: e.target.value })} /></label>)}</> : <p>Finish registration for {user.email}. <button type="button" className="underline" onClick={() => signOut(auth)}>Use a different account</button></p>}
    <button disabled={busy} className="bg-slate-900 text-white rounded-xl p-3">{busy ? 'Creating account…' : 'Create teacher account'}</button></form><Link to="/login" className="block mt-5 underline">Already registered? Sign in</Link></main>;
}
