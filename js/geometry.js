// Geometry helpers. Plan coordinates: x to the right, y downwards, units cm.
// Object rotation is in degrees, clockwise on screen.

export const DEG = Math.PI / 180;

export function rotatePoint(px, py, cx, cy, deg) {
  const a = deg * DEG, c = Math.cos(a), s = Math.sin(a);
  const dx = px - cx, dy = py - cy;
  return { x: cx + dx * c - dy * s, y: cy + dx * s + dy * c };
}

/** World -> object-local coordinates (origin at centre, unrotated). */
export function toLocal(obj, px, py) {
  const p = rotatePoint(px, py, obj.x, obj.y, -obj.rot);
  return { x: p.x - obj.x, y: p.y - obj.y };
}

/** Corners of an object's rotated footprint in world space (TL, TR, BR, BL). */
export function corners(obj) {
  const hw = obj.w / 2, hd = obj.d / 2;
  return [
    rotatePoint(obj.x - hw, obj.y - hd, obj.x, obj.y, obj.rot),
    rotatePoint(obj.x + hw, obj.y - hd, obj.x, obj.y, obj.rot),
    rotatePoint(obj.x + hw, obj.y + hd, obj.x, obj.y, obj.rot),
    rotatePoint(obj.x - hw, obj.y + hd, obj.x, obj.y, obj.rot),
  ];
}

/** Axis-aligned bounding box of an object. */
export function aabb(obj) {
  const cs = corners(obj);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of cs) {
    if (c.x < minX) minX = c.x; if (c.x > maxX) maxX = c.x;
    if (c.y < minY) minY = c.y; if (c.y > maxY) maxY = c.y;
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
}

export function unionBox(boxes) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const b of boxes) {
    if (b.minX < minX) minX = b.minX; if (b.maxX > maxX) maxX = b.maxX;
    if (b.minY < minY) minY = b.minY; if (b.maxY > maxY) maxY = b.maxY;
  }
  if (minX === Infinity) return null;
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
}

/** Point-in-object test respecting rotation and shape. `pad` grows the shape (world cm). */
export function hitTest(obj, px, py, pad = 0) {
  const l = toLocal(obj, px, py);
  const hw = obj.w / 2 + pad, hd = obj.d / 2 + pad;
  if (Math.abs(l.x) > hw || Math.abs(l.y) > hd) return false;
  if (obj.shape === 'ellipse') {
    const nx = l.x / hw, ny = l.y / hd;
    return nx * nx + ny * ny <= 1;
  }
  return true;
}

export function boxesIntersect(a, b) {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

export function boxContains(outer, inner) {
  return inner.minX >= outer.minX && inner.maxX <= outer.maxX && inner.minY >= outer.minY && inner.maxY <= outer.maxY;
}

export function normDeg(d) {
  d = d % 360;
  if (d < 0) d += 360;
  return Math.round(d * 100) / 100;
}

export function snap(v, step) {
  if (!step) return v;
  return Math.round(v / step) * step;
}

export function dist(ax, ay, bx, by) { return Math.hypot(bx - ax, by - ay); }

export function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

/** Points approximating an ellipse footprint (world coordinates). */
export function ellipsePoints(obj, n = 48) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const lx = Math.cos(t) * obj.w / 2, ly = Math.sin(t) * obj.d / 2;
    pts.push(rotatePoint(obj.x + lx, obj.y + ly, obj.x, obj.y, obj.rot));
  }
  return pts;
}

/* ---------- colours ---------- */

export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const v = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255 };
}

export function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map((c) => clamp(Math.round(c), 0, 255).toString(16).padStart(2, '0')).join('');
}

export function shade(hex, amt) {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHex(r + amt, g + amt, b + amt);
}

export function withAlpha(hex, a) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

export function isDark(hex) {
  const { r, g, b } = hexToRgb(hex);
  return (r * 299 + g * 587 + b * 114) / 1000 < 128;
}
