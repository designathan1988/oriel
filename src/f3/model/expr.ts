// Arithmetic in typed values (like Blender, Fusion and SketchUp's measurements box): "3*2.5", "10/3",
// "(4+2)*1.5", "250cm + 1m", "-2". Numbers may carry a unit (mm, cm, m: the result is in metres); a
// comma is a decimal point. A small recursive-descent parser: no eval, nothing but numbers and + − × ÷.

/**
 * The value of an expression, or null when it is not one. `vars`: names a formula may use (a family's
 * other parameters: "=width/2", "=height - 0.3").
 */
export function evalExpr(src: string, vars?: Record<string, number>): number | null {
  const s = src.toLowerCase().replace(/,/g, '.').replace(/×/g, '*').replace(/÷/g, '/');
  let i = 0;
  const ws = () => {
    while (s[i] === ' ') i++;
  };
  const num = (): number | null => {
    ws();
    const m = /^(\d*\.?\d+(?:e[+-]?\d+)?)\s*(mm|cm|m(?![a-z]))?/.exec(s.slice(i));
    if (!m) return null;
    i += m[0].length;
    const v = parseFloat(m[1]!);
    return m[2] === 'mm' ? v / 1000 : m[2] === 'cm' ? v / 100 : v;
  };
  const factor = (): number | null => {
    ws();
    if (s[i] === '-') {
      i++;
      const v = factor();
      return v === null ? null : -v;
    }
    if (s[i] === '+') {
      i++;
      return factor();
    }
    if (s[i] === '(') {
      i++;
      const v = sum();
      ws();
      if (v === null || s[i] !== ')') return null;
      i++;
      return v;
    }
    if (vars) {
      const m = /^[a-z_][a-z0-9_]*/.exec(s.slice(i));
      if (m) {
        // Names are matched without case (the text was lowered).
        const key = Object.keys(vars).find((k) => k.toLowerCase() === m[0]);
        if (key === undefined) return null;
        i += m[0].length;
        return vars[key]!;
      }
    }
    return num();
  };
  const term = (): number | null => {
    let v = factor();
    for (;;) {
      ws();
      const op = s[i];
      if (v === null || (op !== '*' && op !== '/')) return v;
      i++;
      const r = factor();
      if (r === null || (op === '/' && r === 0)) return null;
      v = op === '*' ? v * r : v / r;
    }
  };
  const sum = (): number | null => {
    let v = term();
    for (;;) {
      ws();
      const op = s[i];
      if (v === null || (op !== '+' && op !== '-')) return v;
      i++;
      const r = term();
      if (r === null) return null;
      v = op === '+' ? v + r : v - r;
    }
  };
  const v = sum();
  ws();
  return v !== null && i === s.length && Number.isFinite(v) ? v : null;
}
