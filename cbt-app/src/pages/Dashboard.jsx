import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "/firebase";

function MetricCard({ label, value, helper }) {
  return (
    <div className="rounded-2xl bg-white p-6 shadow-sm">
      <p className="text-sm font-medium uppercase tracking-[0.25em] text-slate-400">{label}</p>
      <p className="mt-4 text-4xl font-semibold text-slate-900">{value}</p>
      <p className="mt-2 text-sm text-slate-500">{helper}</p>
    </div>
  );
}

function formatPercent(value) {
  if (!Number.isFinite(value)) {
    return "0%";
  }

  return `${value.toFixed(1)}%`;
}

function getStudentLabel(session) {
  return session.studentName ?? session.studentEmail ?? session.studentUid ?? "Unknown student";
}

export default function Dashboard() {
  const [users, setUsers] = useState([]);
  const [exams, setExams] = useState([]);
  const [questions, setQuestions] = useState([]);
  const [sessions, setSessions] = useState([]);

  useEffect(() => {
    const unsubscribeUsers = onSnapshot(collection(db, "users"), (snapshot) => {
      setUsers(snapshot.docs.map((docItem) => ({ id: docItem.id, ...docItem.data() })));
    });

    const unsubscribeExams = onSnapshot(collection(db, "exams"), (snapshot) => {
      setExams(snapshot.docs.map((docItem) => ({ id: docItem.id, ...docItem.data() })));
    });

    const unsubscribeQuestions = onSnapshot(collection(db, "questions"), (snapshot) => {
      setQuestions(snapshot.docs.map((docItem) => ({ id: docItem.id, ...docItem.data() })));
    });

    const unsubscribeSessions = onSnapshot(collection(db, "examSessions"), (snapshot) => {
      setSessions(snapshot.docs.map((docItem) => ({ id: docItem.id, ...docItem.data() })));
    });

    return () => {
      unsubscribeUsers();
      unsubscribeExams();
      unsubscribeQuestions();
      unsubscribeSessions();
    };
  }, []);

  const submittedSessions = useMemo(
    () => sessions.filter((session) => session.status === "submitted"),
    [sessions]
  );

  const examTotalsById = useMemo(
    () =>
      questions.reduce((acc, question) => {
        const examId = question.examId;
        acc[examId] = (acc[examId] || 0) + Number(question.marks || 1);
        return acc;
      }, {}),
    [questions]
  );

  const examTitleById = useMemo(
    () =>
      exams.reduce((acc, exam) => {
        acc[exam.id] = exam.title || exam.id;
        return acc;
      }, {}),
    [exams]
  );

  const analytics = useMemo(() => {
    const studentCount = users.filter((user) => user.role === "student").length;
    const publishedCount = exams.filter((exam) => exam.status === "published").length;
    const totalSubmissions = submittedSessions.length;

    let passCount = 0;
    let totalPercent = 0;

    const subjects = {};
    const studentStats = {};

    submittedSessions.forEach((session) => {
      const examId = session.examId;
      const maxMarks = Number(examTotalsById[examId] || 0);
      const score = Number(session.finalScore ?? session.totalAutoScore ?? 0);
      const percent = maxMarks > 0 ? (score / maxMarks) * 100 : 0;
      const examTitle = examTitleById[examId] || session.examTitle || examId;

      totalPercent += percent;
      if (percent >= 50) {
        passCount += 1;
      }

      if (!subjects[examId]) {
        subjects[examId] = {
          examId,
          title: examTitle,
          totalPercent: 0,
          attempts: 0,
        };
      }

      subjects[examId].totalPercent += percent;
      subjects[examId].attempts += 1;

      const studentKey = session.studentUid || session.studentEmail || session.id;
      if (!studentStats[studentKey]) {
        studentStats[studentKey] = {
          studentKey,
          name: getStudentLabel(session),
          email: session.studentEmail ?? "-",
          totalPercent: 0,
          attempts: 0,
          totalScore: 0,
        };
      }

      studentStats[studentKey].totalPercent += percent;
      studentStats[studentKey].attempts += 1;
      studentStats[studentKey].totalScore += score;
    });

    const subjectAverages = Object.values(subjects)
      .map((subject) => ({
        ...subject,
        averagePercent: subject.attempts ? subject.totalPercent / subject.attempts : 0,
      }))
      .sort((first, second) => second.averagePercent - first.averagePercent);

    const rankedStudents = Object.values(studentStats)
      .map((student) => ({
        ...student,
        averagePercent: student.attempts ? student.totalPercent / student.attempts : 0,
      }))
      .sort((first, second) => {
        if (second.averagePercent !== first.averagePercent) {
          return second.averagePercent - first.averagePercent;
        }

        return second.totalScore - first.totalScore;
      });

    return {
      studentCount,
      examCount: exams.length,
      publishedCount,
      totalSubmissions,
      overallAveragePercent: totalSubmissions ? totalPercent / totalSubmissions : 0,
      passRate: totalSubmissions ? (passCount / totalSubmissions) * 100 : 0,
      bestSubject: subjectAverages[0] ?? null,
      worstSubject: subjectAverages.at(-1) ?? null,
      topStudents: rankedStudents.slice(0, 10),
    };
  }, [examTitleById, examTotalsById, exams, submittedSessions, users]);

  return (
    <div className="space-y-6">
      <section className="rounded-2xl bg-white p-6 shadow-sm">
        <h2 className="text-2xl font-semibold text-slate-900">Operations and analytics hub</h2>
        <p className="mt-2 max-w-3xl text-sm text-slate-500">
          Track exam activity, submission volume, pass rate, subject strength, and top performers
          from one admin dashboard.
        </p>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Students" value={analytics.studentCount} helper="Candidates with a student role" />
        <MetricCard label="Exams" value={analytics.examCount} helper="Draft and published papers" />
        <MetricCard label="Published" value={analytics.publishedCount} helper="Ready for live candidates" />
        <MetricCard label="Submissions" value={analytics.totalSubmissions} helper="Stored submitted sessions" />
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Overall Performance"
          value={formatPercent(analytics.overallAveragePercent)}
          helper="Average score percentage across submitted exams"
        />
        <MetricCard
          label="Pass Rate"
          value={formatPercent(analytics.passRate)}
          helper="Percentage of submissions scoring 50% or higher"
        />
        <MetricCard
          label="Best Subject"
          value={analytics.bestSubject?.title ?? "-"}
          helper={
            analytics.bestSubject
              ? `Average ${formatPercent(analytics.bestSubject.averagePercent)}`
              : "No submitted results yet"
          }
        />
        <MetricCard
          label="Worst Subject"
          value={analytics.worstSubject?.title ?? "-"}
          helper={
            analytics.worstSubject
              ? `Average ${formatPercent(analytics.worstSubject.averagePercent)}`
              : "No submitted results yet"
          }
        />
      </section>

      <section className="rounded-2xl bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-xl font-semibold text-slate-900">Top 10 students</h3>
            <p className="mt-2 text-sm text-slate-500">
              Ranked by average score percentage across submitted papers.
            </p>
          </div>
          <div className="rounded-2xl bg-slate-100 px-4 py-3 text-sm text-slate-600">
            Based on {analytics.totalSubmissions} submitted session(s)
          </div>
        </div>

        {analytics.topStudents.length > 0 ? (
          <div className="mt-6 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-4 py-3">Rank</th>
                  <th className="px-4 py-3">Student</th>
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">Papers</th>
                  <th className="px-4 py-3">Average</th>
                </tr>
              </thead>
              <tbody>
                {analytics.topStudents.map((student, index) => (
                  <tr key={student.studentKey} className="border-t border-slate-200">
                    <td className="px-4 py-4 font-semibold text-slate-700">{index + 1}</td>
                    <td className="px-4 py-4 text-slate-700">{student.name}</td>
                    <td className="px-4 py-4 text-slate-500">{student.email}</td>
                    <td className="px-4 py-4 text-slate-500">{student.attempts}</td>
                    <td className="px-4 py-4 text-slate-500">{formatPercent(student.averagePercent)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="mt-6 rounded-2xl border border-dashed border-slate-300 p-6 text-sm text-slate-500">
            Top performers will appear here after students submit exams.
          </div>
        )}
      </section>
    </div>
  );
}
