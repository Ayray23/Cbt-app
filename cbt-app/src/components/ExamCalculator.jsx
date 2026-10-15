import { useEffect, useState } from "react";

function calculateExpression(source) {
  const tokens = source.match(/\d*\.?\d+|[-()+*/%]/g) ?? [];
  const normalized = tokens.join("");
  if (!source.trim() || normalized !== source.replace(/\s+/g, "")) throw new Error("Enter a valid calculation.");
  let index = 0;
  function parseExpression() {
    let value = parseTerm();
    while (tokens[index] === "+" || tokens[index] === "-") {
      const operator = tokens[index++]; const right = parseTerm();
      value = operator === "+" ? value + right : value - right;
    }
    return value;
  }
  function parseTerm() {
    let value = parseFactor();
    while (["*", "/", "%"].includes(tokens[index])) {
      const operator = tokens[index++]; const right = parseFactor();
      if (operator === "/" && right === 0) throw new Error("Cannot divide by zero.");
      if (operator === "%" && right === 0) throw new Error("Cannot calculate a remainder by zero.");
      value = operator === "*" ? value * right : operator === "/" ? value / right : value % right;
    }
    return value;
  }
  function parseFactor() {
    if (tokens[index] === "+") { index += 1; return parseFactor(); }
    if (tokens[index] === "-") { index += 1; return -parseFactor(); }
    if (tokens[index] === "(") {
      index += 1; const value = parseExpression();
      if (tokens[index++] !== ")") throw new Error("Close the parentheses.");
      return value;
    }
    const token = tokens[index++];
    if (!token || !/^\d*\.?\d+$/.test(token)) throw new Error("Enter a valid calculation.");
    return Number(token);
  }
  const result = parseExpression();
  if (index !== tokens.length || !Number.isFinite(result)) throw new Error("Calculation is outside the supported range.");
  return Number(result.toPrecision(12)).toString();
}

const KEYS = [
  ["C", "clear"], ["(", "normal"], [")", "normal"], ["⌫", "delete"],
  ["7", "normal"], ["8", "normal"], ["9", "normal"], ["÷", "operator"],
  ["4", "normal"], ["5", "normal"], ["6", "normal"], ["×", "operator"],
  ["1", "normal"], ["2", "normal"], ["3", "normal"], ["−", "operator"],
  ["0", "normal"], [".", "normal"], ["%", "operator"], ["+", "operator"], ["x²", "square"],
];

function normalizeInput(label) { return label === "÷" ? "/" : label === "×" ? "*" : label === "−" ? "-" : label; }

export default function ExamCalculator() {
  const [expression, setExpression] = useState("");
  const [display, setDisplay] = useState("0");
  const [error, setError] = useState("");
  const [justEvaluated, setJustEvaluated] = useState(false);

  function clearCalculator() { setExpression(""); setDisplay("0"); setError(""); setJustEvaluated(false); }
  function evaluateCurrent() { const result = calculateExpression(expression); setExpression(result); setDisplay(result); setJustEvaluated(true); setError(""); }
  function appendInput(label, kind = "normal") {
    setError(""); const value = normalizeInput(label);
    if (justEvaluated && kind === "normal" && (/^[0-9.]$/.test(value) || value === "(")) {
      setExpression(value); setDisplay(value); setJustEvaluated(false); return;
    }
    setExpression((current) => current + value);
    setDisplay((current) => current === "0" && /^[0-9.]$/.test(value) ? value : current + value);
    setJustEvaluated(false);
  }
  function press(label, kind) {
    if (kind === "clear") { clearCalculator(); return; }
    if (kind === "delete") { setError(""); const next = expression.slice(0, -1); setExpression(next); setDisplay(next || "0"); setJustEvaluated(false); return; }
    if (kind === "square") {
      try {
        const base = justEvaluated ? expression : calculateExpression(expression);
        const result = Number((Number(base) ** 2).toPrecision(12)).toString();
        setExpression(result); setDisplay(result); setJustEvaluated(true); setError("");
      } catch (calculationError) { setError(calculationError.message); }
      return;
    }
    if (label === "=") { try { evaluateCurrent(); } catch (calculationError) { setError(calculationError.message); } return; }
    appendInput(label, kind);
  }
  useEffect(() => {
    function handleKeyDown(event) {
      const calculator = event.target?.closest?.("[data-exam-calculator]"); if (!calculator) return;
      const key = event.key;
      if (/^[0-9.]$/.test(key)) { event.preventDefault(); appendInput(key); return; }
      if (["+", "-", "/", "*", "%", "(", ")"].includes(key)) { event.preventDefault(); appendInput(key, "operator"); return; }
      if (key === "s" || key === "S") { event.preventDefault(); press("x²", "square"); return; }
      if (key === "Enter" || key === "=") { event.preventDefault(); press("=", "equals"); return; }
      if (key === "Backspace") { event.preventDefault(); press("⌫", "delete"); return; }
      if (key === "Escape") { event.preventDefault(); press("C", "clear"); }
    }
    window.addEventListener("keydown", handleKeyDown); return () => window.removeEventListener("keydown", handleKeyDown);
  });

  return (
    <aside className="w-full max-w-[300px] min-w-0 self-start rounded-2xl border border-slate-200 bg-white p-3 shadow-sm lg:w-[300px] lg:max-w-[300px] lg:p-4">
      <section data-exam-calculator role="group" aria-labelledby="exam-calculator-title" className="min-w-0">
        <div className="flex items-center justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-600">Exam tool</p><h2 id="exam-calculator-title" className="mt-1 text-lg font-bold text-slate-900">Calculator</h2></div></div>
        <div className="mt-4 overflow-hidden rounded-xl bg-slate-900 p-3 text-right text-white"><p className="min-h-5 break-all text-xs text-slate-400">{expression || " "}</p><p aria-live="polite" className="mt-1 min-h-9 break-all text-2xl font-semibold">{display}</p></div>
        {error && <p role="alert" className="mt-2 text-xs font-medium text-rose-600">{error}</p>}
        <div className="mt-3 grid grid-cols-4 gap-1.5">
          {KEYS.map(([label, kind]) => <button key={label} type="button" onClick={() => press(label, kind)} aria-label={label === "x²" ? "Square" : label} className={`min-h-10 rounded-lg text-sm font-semibold transition active:scale-95 ${kind === "operator" || kind === "square" ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-200" : kind === "clear" || kind === "delete" ? "bg-slate-200 text-slate-800 hover:bg-slate-300" : "bg-slate-50 text-slate-800 hover:bg-slate-100"}`}>{label}</button>)}
          <button type="button" onClick={() => press("=", "equals")} className="col-span-4 min-h-10 rounded-lg bg-emerald-600 text-lg font-bold text-white hover:bg-emerald-700" aria-label="Equals">=</button>
        </div>
        <p className="mt-2 text-center text-[10px] leading-4 text-slate-500">Operators continue from the result. A new number after = starts fresh.</p>
      </section>
    </aside>
  );
}
