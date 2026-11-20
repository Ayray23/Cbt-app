// Restricted arithmetic parser for the exam calculator: no eval, Function,
// remote services, or arbitrary JavaScript. Percent is a percentage (10% = 0.1),
// not a programming-language remainder.
export function calculateExpression(expression) {
  const normalized = String(expression || "")
    .replaceAll("×", "*").replaceAll("÷", "/")
    .replaceAll("−", "-").replaceAll("√", "sqrt")
    .replace(/\s+/g, "");
  if (!normalized) throw new Error("Enter a calculation.");
  if (normalized.length > 160) throw new Error("Calculation is too long.");
  const tokens = normalized.match(/\d+(?:\.\d*)?|\.\d+|sqrt|[+\-*/^()%]/g) || [];
  if (tokens.join("") !== normalized) throw new Error("Enter a valid calculation.");
  let at = 0;
  function requireFinite(n) {
    if (!Number.isFinite(n)) throw new Error("This result is outside the supported range.");
    return n;
  }
  function atomic() {
    const token = tokens[at++];
    if (token === "(") {
      const n = expressionValue();
      if (tokens[at++] !== ")") throw new Error("Close the parentheses.");
      return n;
    }
    if (token === "sqrt") {
      if (tokens[at++] !== "(") throw new Error("Use √ with parentheses.");
      const n = expressionValue();
      if (tokens[at++] !== ")") throw new Error("Close the square-root parentheses.");
      if (n < 0) throw new Error("Cannot find the square root of a negative number.");
      return Math.sqrt(n);
    }
    if (!token || !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(token))
      throw new Error("Enter a valid calculation.");
    return Number(token);
  }
  function postfix() {
    let n = atomic();
    while (tokens[at] === "%") { at++; n /= 100; }
    return n;
  }
  function power() {
    const n = postfix();
    if (tokens[at] === "^") {
      at++;
      return requireFinite(n ** signed());
    }
    return n;
  }
  function signed() {
    if (tokens[at] === "+") { at++; return signed(); }
    if (tokens[at] === "-") { at++; return -signed(); }
    return power();
  }
  function term() {
    let n = signed();
    while (tokens[at] === "*" || tokens[at] === "/") {
      const op = tokens[at++];
      const rhs = signed();
      if (op === "/" && rhs === 0) throw new Error("Cannot divide by zero.");
      n = requireFinite(op === "*" ? n * rhs : n / rhs);
    }
    return n;
  }
  function expressionValue() {
    let n = term();
    while (tokens[at] === "+" || tokens[at] === "-") {
      const op = tokens[at++];
      const rhs = term();
      n = requireFinite(op === "+" ? n + rhs : n - rhs);
    }
    return n;
  }
  const result = expressionValue();
  if (at !== tokens.length) throw new Error("Check the operators and parentheses.");
  return Number(requireFinite(result).toPrecision(12)).toString();
}
