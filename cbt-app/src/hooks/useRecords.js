import { useEffect, useMemo, useState } from "react";
import {
  collection,
  documentId,
  limit,
  onSnapshot,
  orderBy,
  query,
  startAfter,
  where,
} from "firebase/firestore";
import { db } from "/firebase";
const EMPTY = { rows: [], more: false, error: "", last: null };
// Cursor pagination bounds each subscription and preserves per-role query constraints.
export function useRecords(name, filters = [], size = 50) {
  const key = JSON.stringify([name, filters, size]);
  const [navigation, setNavigation] = useState({
    key: "",
    cursors: [null],
    index: 0,
  });
  const [snapshot, setSnapshot] = useState({
    key: "",
    rows: [],
    last: null,
    more: false,
    error: "",
  });
  const page = navigation.key === key ? navigation.index : 0;
  const cursor = navigation.key === key ? navigation.cursors[page] : null;
  const constraints = useMemo(
    () =>
      JSON.parse(key)[1].map(([field, op, value]) => where(field, op, value)),
    [key],
  );
  useEffect(
    () =>
      onSnapshot(
        query(
          collection(db, name),
          ...constraints,
          orderBy(documentId()),
          ...(cursor ? [startAfter(cursor)] : []),
          limit(size + 1),
        ),
        (s) =>
          setSnapshot({
            key,
            rows: s.docs.slice(0, size).map((d) => ({ id: d.id, ...d.data() })),
            last: s.docs[size - 1],
            more: s.docs.length > size,
            error: "",
          }),
        (e) =>
          setSnapshot({
            key,
            rows: [],
            last: null,
            more: false,
            error: e.message,
          }),
      ),
    [key, name, constraints, cursor, size],
  );
  const state = snapshot.key === key ? snapshot : EMPTY;
  return {
    ...state,
    page,
    next: () => {
      if (state.more)
        setNavigation((n) => ({
          key,
          cursors: [
            ...(n.key === key ? n.cursors.slice(0, page + 1) : [null]),
            state.last,
          ],
          index: page + 1,
        }));
    },
    previous: () =>
      setNavigation((n) => ({ ...n, index: Math.max(0, page - 1) })),
  };
}
