// All internal dimensions are stored in centimetres. These helpers convert
// to/from the unit the user has chosen for display.

export const UNITS = {
  cm: { factor: 1, decimals: 1, label: 'cm', dxf: 5 },
  mm: { factor: 10, decimals: 0, label: 'mm', dxf: 4 },
  in: { factor: 1 / 2.54, decimals: 2, label: 'in', dxf: 1 },
  ft: { factor: 1 / 30.48, decimals: 2, label: 'ft', dxf: 2 },
};

let current = 'cm';

export function setUnit(u) { if (UNITS[u]) current = u; }
export function getUnit() { return current; }
export function unitLabel() { return UNITS[current].label; }

/** cm -> display number (unrounded) */
export function toDisplay(cm, unit = current) { return cm * UNITS[unit].factor; }
/** display number -> cm */
export function fromDisplay(v, unit = current) { return v / UNITS[unit].factor; }

/** Format a cm value in the current unit, trimming trailing zeros. */
export function fmt(cm, { withUnit = false, unit = current } = {}) {
  const u = UNITS[unit];
  let s = (cm * u.factor).toFixed(u.decimals);
  if (s.includes('.')) s = s.replace(/\.?0+$/, '');
  if (s === '-0') s = '0';
  return withUnit ? `${s} ${u.label}` : s;
}

/** Format a value for an input field (fixed decimals, no unit). */
export function fmtInput(cm, unit = current) {
  const u = UNITS[unit];
  const v = cm * u.factor;
  const r = Math.round(v * 1000) / 1000;
  return String(r);
}

/** Parse user text in the current unit (accepts "12", "12.5", "1'6\"" for ft/in) -> cm. */
export function parseInput(text, unit = current) {
  if (typeof text === 'number') return fromDisplay(text, unit);
  const s = String(text).trim().toLowerCase();
  if (!s) return NaN;
  // feet-inches notation: 5'6" or 5' 6
  const fi = s.match(/^(-?\d+(?:\.\d+)?)\s*'\s*(\d+(?:\.\d+)?)?\s*"?$/);
  if (fi) {
    const ft = parseFloat(fi[1]);
    const inch = fi[2] ? parseFloat(fi[2]) : 0;
    return ft * 30.48 + inch * 2.54;
  }
  // explicit unit suffix
  const m = s.match(/^(-?\d+(?:\.\d+)?)\s*(mm|cm|m|in|ft|")?$/);
  if (!m) return NaN;
  const v = parseFloat(m[1]);
  switch (m[2]) {
    case 'mm': return v / 10;
    case 'cm': return v;
    case 'm': return v * 100;
    case 'in': case '"': return v * 2.54;
    case 'ft': return v * 30.48;
    default: return fromDisplay(v, unit);
  }
}

/** Format "W × D × H" in the current unit. */
export function fmtDims(w, d, h) {
  return `${fmt(w)} × ${fmt(d)} × ${fmt(h)} ${unitLabel()}`;
}

/** A "nice" grid step in the current unit expressed in cm (used for major grid lines). */
export function niceStepCm(targetCm) {
  const f = UNITS[current].factor;
  const target = targetCm * f; // in display units
  const pow = Math.pow(10, Math.floor(Math.log10(target)));
  const candidates = [1, 2, 2.5, 5, 10].map((c) => c * pow);
  let best = candidates[0];
  for (const c of candidates) if (Math.abs(c - target) < Math.abs(best - target)) best = c;
  return best / f;
}
