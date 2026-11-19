import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '/firebase';
export function useSchool() {
  const [school, setSchool] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => onSnapshot(doc(db, 'school', 'settings'), s => setSchool(s.exists() ? s.data() : null), e => setError(e.message)), []);
  return { school, error };
}
