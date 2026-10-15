import { useEffect, useState } from "react";

function calculateExpression(source) {
  const tokens = source.match(/\d*\.?\d+|[-()+*/%]/g) ?? [];
  const normalized = tokens.join("");
  if (!source.trim() || normalized !== source.replace(/\s+/g, "")) {
    throw new Error("Enter a valid calculation.");
  }

  let index = 0;
  function parseExpression() {
    let value = parseTerm();
    while (tokens[index] === "+" || tokens[index] === "-") {
      const operator = tokens[index++];
      const right = parseTerm();
      value = operator === "+" ? value + right : value - right;
    }
    return value;
  }
  function parseTerm() {
    let value = parseFactor();
    while (["*", "/", "%"].includes(tokens[index])) {
      const operator = tokens[index++];
      const right = parseFactor();
      if (operator === "/" && right === 0) throw new Error("Cannot divide by zero.");
      if (operator === "%" && right === 0) throw new Error("Cannot calculate a remainder by zero.");
      value = operator === "*" ? value * right : operator === "/" ? value / right : value % right;
    }
    return value;
  }
  function parseFactor() {
    if (tokens[index] === "+") { index++; return parseFactor(); }
    if (tokens[index] === "-") { index++; return -parseFactor(); }
    if (tokens[index] === "(") {
      index++;
      const value = parseExpression();
      if (tokens[index++] !== ")") throw new Error("Close the parentheses.");
      return value;
    }
    const token = tokens[index++];
    if (!token || !/^\d*\.?\d+$/.test(token)) throw new Error("Enter a valid calculation.");
    return Number(token);
  }

  const result = parseExpression();
  if (index !== tokens.length || !Number.isFinite(result)) {
    throw new Error("Calculation is outside the supported range.");
  }
  return Number(result.toPrecision(12)).toString();
}

const KEYS = [
  ["C", "clear"], ["(", "normal"], [")", "normal"], ["⌫", "delete"],
  ["7", "normal"], ["8", "normal"], ["9", "normal"], ["÷", "operator"],
  ["4", "normal"], ["5", "normal"], ["6", "normal"], ["×", "operator"],
  ["1", "normal"], ["2", "normal"], ["3", "normal"], ["−", "operator"],
  ["0", "normal"], [".", "normal"], ["%", "operator"], ["+", "operator"],
];

export default function ExamCalculator() {
  const [expression, setExpression] = useState("");
  const [display, setDisplay] = useState("0");
  const [error, setError] = useState("");

  useEffect(() => {
    function handleKeyDown(event) {
      if (!event.target.closest?.("[data-exam-calculator]")) return;
      if (/^[0-9().%+*/-]$/.test(event.key)) {
        event.preventDefault();
        setExpression((current) => current + event.key);
        setDisplay((current) => current === "0" ? event.key : current + event.key);
        setError("");
      } else if (event.key === "*") {
        event.preventDefault();
        setExpression((current) => current + "*");
      } else if (event.key === "Enter" || event.key === "=") {
        event.preventDefault();
        try {
          const result = calculateExpression(expression);
          setExpression(result);
          setDisplay(result);
          setError("");
        } catch (calculationError) {
          setError(calculationError.message);
        }
      } else if (event.key === "Backspace") {
        setExpression((current) => current.slice(0, -1));
        setDisplay((current) => current.length <= 1 ? "0" : current.slice(0, -1));
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [expression]);

  function press(label, kind) {
    setError("");
    if (kind === "clear") {
      setExpression("");
      setDisplay("0");
      return;
    }
    if (kind === "delete") {
      const next = expression.slice(0, -1);
      setExpression(next);
      setDisplay(next || "0");
      return;
    }
    if (label === "=") {
      try {
        const result = calculateExpression(expression);
        setExpression(result);
        setDisplay(result);
      } catch (calculationError) {
        setError(calculationError.message);
      }
      return;
    }
    const value = label === "÷" ? "/" : label === "×" ? "*" : label === "−" ? "-" : label;
    setExpression((current) => current + value);
    setDisplay((current) => current === "0" && /^[0-9.]$/.test(value) ? value : current + value);
  }

  return (
    <aside className="order-first min-w-0 w-full self-start rounded-3xl border border-slate-200 bg-white p-4 shadow-sm xl:sticky xl:top-4 xl:order-none xl:max-h-[calc(100vh-2rem)] xl:overflow-y-auto xl:p-5">
      <section data-exam-calculator role="group" aria-labelledby="exam-calculator-title" className="min-w-0">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-600">Exam tool</p>
            <h2 id="exam-calculator-title" className="mt-1 text-xl font-bold text-slate-900">Calculator</h2>
          </div>
        </div>
        <div className="mt-5 rounded-2xl bg-slate-900 p-4 text-right text-white">
          <p className="min-h-6 break-all text-sm text-slate-400">{expression || " "}</p>
          <p aria-live="polite" className="mt-1 min-h-10 break-all text-3xl font-semibold">{display}</p>
        </div>
        {error && <p role="alert" className="mt-3 text-sm text-rose-600">{error}</p>}
        <div className="mt-4 grid grid-cols-4 gap-2">
          {KEYS.map(([label, kind]) => (
            <button key={label} type="button" onClick={() => press(label, kind)} className={`min-h-12 rounded-xl font-semibold transition active:scale-95 ${kind === "operator" ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-200" : kind === "clear" || kind === "delete" ? "bg-slate-200 text-slate-800 hover:bg-slate-300" : "bg-slate-50 text-slate-800 hover:bg-slate-100"}`}>
              {label}
            </button>
          ))}
          <button type="button" onClick={() => press("=", "equals")} className="col-span-4 min-h-12 rounded-xl bg-emerald-600 font-semibold text-white hover:bg-emerald-700">Calculate =</button>
        </div>
        <p className="mt-3 text-center text-xs text-slate-500">The calculator stays in its own panel. On smaller screens, it moves below the question area so it never covers an answer.</p>
      </section>
    </aside>
  );
}
