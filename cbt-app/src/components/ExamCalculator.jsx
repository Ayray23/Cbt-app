import { useState } from "react";
import { calculateExpression } from "../utils/examCalculator";
import { toast } from "../utils/toast";

const KEYS = [
  ["AC", "clear"], ["(", "normal"], [")", "normal"], ["⌫", "delete"],
  ["√", "function"], ["x²", "function"], ["%", "operator"], ["÷", "operator"],
  ["7", "number"], ["8", "number"], ["9", "number"], ["×", "operator"],
  ["4", "number"], ["5", "number"], ["6", "number"], ["−", "operator"],
  ["1", "number"], ["2", "number"], ["3", "number"], ["+", "operator"],
  ["0", "number-wide"], [".", "number"], ["=", "equals"],
];

const isNewNumber = (key) => /^[0-9.]$/.test(key) || key === "(";

export default function ExamCalculator() {
  const [expression, setExpression] = useState("");
  const [justEvaluated, setJustEvaluated] = useState(false);

  function press(key) {
    if (key === "AC") {
      setExpression("");
      setJustEvaluated(false);
      return;
    }
    if (key === "⌫") {
      setExpression((before) =>
        before.endsWith("√(") ? before.slice(0, -2) : before.slice(0, -1),
      );
      setJustEvaluated(false);
      return;
    }
    if (key === "=" || key === "x²" || (key === "√" && expression)) {
      try {
        const target = key === "x²" ? `(${expression})^2`
          : key === "√" ? `√(${expression})`
          : expression;
        const answer = calculateExpression(target);
        setExpression(answer);
        setJustEvaluated(true);
      } catch (err) {
        toast.error(err.message);
      }
      return;
    }
    if (key === "√") {
      setExpression("√(");
      setJustEvaluated(false);
      return;
    }
    if (key === "." && /(?:^|[^\d.])\d*\.\d*$/.test(expression) && !justEvaluated) {
      return;
    }
    if (justEvaluated && isNewNumber(key)) {
      setExpression(key === "." ? "0." : key);
    } else {
      setExpression((before) => {
        if (key === "." && (!before || /[+×÷−(]$/.test(before))) return before + "0.";
        if (key === "0" && before === "0") return before;
        if (/^[1-9]$/.test(key) && before === "0") return key;
        return before + key;
      });
    }
    setJustEvaluated(false);
  }

  function keyboard(event) {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (!event.target.closest?.("[data-exam-calculator]")) return;
    const keys = {
      "*": "×", "/": "÷", "-": "−", "Enter": "=", "Backspace": "⌫", "Escape": "AC",
    };
    const key = keys[event.key] || event.key;
    if (/^[0-9.]$/.test(key) || ["+", "−", "×", "÷", "%", "(", ")", "=", "⌫", "AC"].includes(key)) {
      event.preventDefault();
      press(key);
    }
  }

  return (
    <section
      data-exam-calculator
      onKeyDown={keyboard}
      aria-labelledby="exam-calculator-title"
      className="w-full min-w-0 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm"
    >
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
          Exam tool
        </p>
        <h3 id="exam-calculator-title" className="mt-1 font-bold text-slate-900">
          Calculator
        </h3>
      </div>
      <div className="mt-3 min-w-0 rounded-xl bg-slate-950 px-3 py-4 text-right text-white">
        <p className="text-[10px] uppercase tracking-wider text-slate-400">Calculation / Result</p>
        <output
          aria-label="Calculator display"
          aria-live="polite"
          className="mt-2 block min-h-9 break-all font-mono text-2xl font-semibold"
        >
          {expression || "0"}
        </output>
      </div>
      <div className="mt-3 grid grid-cols-4 gap-1.5">
        {KEYS.map(([label, kind]) => (
          <button
            key={label}
            type="button"
            onClick={() => press(label)}
            aria-label={{
              "AC": "Clear calculator", "⌫": "Backspace", "x²": "Square",
              "√": "Square root", "=": "Equals",
            }[label] || label}
            className={`min-h-11 min-w-0 rounded-lg px-1 text-sm font-semibold transition active:scale-95
              ${kind === "equals" ? "bg-emerald-700 text-white hover:bg-emerald-800"
                : kind === "operator" || kind === "function" ? "bg-emerald-100 text-emerald-900 hover:bg-emerald-200"
                : kind === "clear" || kind === "delete" ? "bg-slate-200 text-slate-900 hover:bg-slate-300"
                : "bg-slate-50 text-slate-900 hover:bg-slate-100"}
              ${kind === "number-wide" ? "col-span-2" : ""}`}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="mt-3 text-xs leading-5 text-slate-600">
        % means percentage (10% = 0.1). √ finds a square root.
        x² squares the current calculation. AC clears everything.
      </p>
    </section>
  );
}
