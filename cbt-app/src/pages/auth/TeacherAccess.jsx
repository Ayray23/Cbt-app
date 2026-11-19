import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { sendEmailVerification, reload } from 'firebase/auth';
import { useAuth } from '../../contexts/AuthContext';
export default function TeacherAccess() {
  const { user, profile, loading, logout } = useAuth(); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  if (loading) return <p className="p-8">Checking your account…</p>;
  if (!user) return <Navigate to="/login" replace />;
  if (profile && (!profile.approvalStatus || profile.approvalStatus === 'approved')) return <Navigate to="/" replace />;
  async function check(send) { setBusy(true); try { await reload(user); await user.getIdToken(true); if (send && !user.emailVerified) await sendEmailVerification(user); setMessage(user.emailVerified ? 'Email verified. The superadmin can now approve your account.' : send ? 'Verification email sent. Check your inbox and spam folder.' : 'Email is not verified yet. Open the verification link first.'); } catch (e) { setMessage(e.message); } finally { setBusy(false); } }
  return <main className="max-w-xl mx-auto p-8 space-y-5"><h1 className="text-3xl font-semibold">Teacher account access</h1><p>{user.email}</p><p>Status: <strong>{profile?.approvalStatus || 'Registration incomplete'}</strong></p>{profile?.approvalReason && <p>Superadmin decision: {profile.approvalReason}</p>}<p>Verify your email, then ask the superadmin to approve your account and assign your classes and subjects. School data is unavailable until approval.</p><p role="status">{message}</p><div className="flex flex-wrap gap-4"><button disabled={busy} onClick={() => check(true)} className="border p-3 rounded-xl">Send verification email</button><button disabled={busy} onClick={() => check(false)} className="border p-3 rounded-xl">I have verified my email</button></div>{!profile && <Link to="/signup" className="block underline">Finish teacher registration</Link>}<button onClick={logout} className="underline">Sign out</button></main>;
}
