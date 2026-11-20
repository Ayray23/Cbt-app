import test from "node:test";
import assert from "node:assert/strict";
import { calculateExpression } from "../cbt-app/src/utils/examCalculator.js";

test("school calculator uses correct arithmetic order and bracket grouping", () => {
  assert.equal(calculateExpression("2 + 3 × 4"), "14");
  assert.equal(calculateExpression("(2 + 3) × 4"), "20");
  assert.equal(calculateExpression("12 ÷ 4 + 0.5"), "3.5");
  assert.equal(calculateExpression("−3 × (2 + 1)"), "-9");
  assert.equal(calculateExpression(".25 + 1.75"), "2");
  assert.equal(calculateExpression("1.2 × 0.5"), "0.6");
  assert.equal(calculateExpression("−3^2"), "-9");
});

test("percent is true percentage, not remainder; supports squares and square roots", () => {
  assert.equal(calculateExpression("50%"), "0.5");
  assert.equal(calculateExpression("200 × 10%"), "20");
  assert.equal(calculateExpression("25% × 400"), "100");
  assert.equal(calculateExpression("12^2"), "144");
  assert.equal(calculateExpression("√(81)"), "9");
  assert.equal(calculateExpression("√(9) + 2^3"), "11");
});

test("invalid calculator expressions show safe descriptive errors", () => {
  assert.throws(() => calculateExpression("5 ÷ 0"), /divide by zero/i);
  assert.throws(() => calculateExpression("√(−9)"), /negative number/);
  assert.throws(() => calculateExpression("(5+1"), /parentheses/);
  assert.throws(() => calculateExpression("5+"), /valid calculation/);
  assert.throws(() => calculateExpression("1 + evil()"), /valid calculation/);
  assert.throws(() => calculateExpression(""), /Enter a calculation/);
  assert.throws(() => calculateExpression("10%2"), /operators and parentheses/);
});
