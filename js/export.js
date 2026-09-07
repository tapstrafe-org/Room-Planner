import { renderPlan, drawScaleBar } from './editor2d.js';
import { aabb, unionBox, corners, ellipsePoints, hexToRgb, normDeg } from './geometry.js';
import { UNITS, getUnit, fmt, unitLabel } from './units.js';

/* ---------- download helpers ---------- */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function downloadDataUrl(dataUrl, filename) {
  const a = document.createElement('a');
  a.href = dataUrl; a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function safeName(name) {
  return (name || 'plan').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'plan';
}

/* ---------- JSON ---------- */
export function exportJSON(store) {
  const data = JSON.stringify({ ...store.state, exportedAt: new Date().toISOString(), app: 'room-planner' }, null, 2);
  downloadBlob(new Blob([data], { type: 'application/json' }), `${safeName(store.state.name)}.json`);
}

/* ---------- PNG (2D plan) ---------- */
export function exportPlanPNG(store, opts = {}) {
  const room = store.room;
  const t = room.wallThickness;
  const boxes = [{ minX: -t, minY: -t, maxX: room.width + t, maxY: room.length + t }];
  for (const o of store.objects) boxes.push(aabb(o));
  const b = unionBox(boxes);
  const margin = 90, header = 70;
  const maxPx = opts.maxPx || 2600;
  const zoom = Math.max(1, Math.min((maxPx - margin * 2) / b.w, (maxPx - margin * 2 - header) / b.h));
  const width = Math.ceil(b.w * zoom + margin * 2);
  const height = Math.ceil(b.h * zoom + margin * 2 + header);
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  const view = { zoom, panX: margin - b.minX * zoom, panY: margin + header - b.minY * zoom };
  renderPlan(ctx, store, view, {
    width, height, background: '#ffffff', showGrid: opts.grid !== false,
    showLabels: opts.labels !== false, showDims: !!opts.dims, gridSize: store.prefs.gridSize,
    selection: new Set(), hover: null, textScale: Math.max(1, Math.min(4, zoom / 1.3)),
  });
  // header
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.fillRect(0, 0, width, header - 6);
  ctx.fillStyle = '#111827'; ctx.font = 'bold 26px sans-serif'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  ctx.fillText(store.state.name || 'Floor plan', 24, 28);
  ctx.font = '15px sans-serif'; ctx.fillStyle = '#4b5563';
  const objCount = store.objects.length;
  ctx.fillText(`Room ${fmt(room.width)} × ${fmt(room.length)} ${unitLabel()} · ceiling ${fmt(room.height, { withUnit: true })} · ${objCount} object${objCount === 1 ? '' : 's'} · ${new Date().toLocaleDateString()}`, 24, 52);
  ctx.restore();
  drawScaleBar(ctx, zoom, width - 30, height - 24);
  downloadDataUrl(canvas.toDataURL('image/png'), `${safeName(store.state.name)}-plan.png`);
}

/* ---------- DXF ---------- */

const ACI = [
  [1, 255, 0, 0], [2, 255, 255, 0], [3, 0, 255, 0], [4, 0, 255, 255], [5, 0, 0, 255], [6, 255, 0, 255],
  [7, 255, 255, 255], [8, 128, 128, 128], [9, 192, 192, 192], [30, 255, 127, 0], [40, 255, 191, 0],
  [94, 0, 127, 63], [140, 0, 63, 255], [170, 63, 0, 255], [200, 191, 0, 255], [250, 51, 51, 51], [253, 153, 153, 153],
  [34, 191, 127, 63], [22, 127, 63, 0], [42, 191, 159, 63],
];

function nearestAci(hex) {
  const { r, g, b } = hexToRgb(hex);
  let best = 7, bd = Infinity;
  for (const [i, cr, cg, cb] of ACI) {
    const d = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

function trueColor(hex) { const { r, g, b } = hexToRgb(hex); return (r << 16) | (g << 8) | b; }

/**
 * Build an ASCII DXF (R12/AC1009 compatible with true-colour hints) of the plan.
 * The plan's y axis points down; DXF y points up, so y is flipped. Object heights are
 * written as entity thickness (group 39) and elevation as group 38, which lets CAD
 * packages display the plan as an extruded 3D model.
 */
export function buildDXF(store, unit = getUnit()) {
  const f = UNITS[unit].factor;
  const room = store.room;
  const L = room.length;
  const out = [];
  const n = (v) => String(Math.round(v * 1e4) / 1e4);
  const P = (x, y) => ({ x: x * f, y: (L - y) * f }); // plan -> DXF, in export units
  const push = (...pairs) => { for (let i = 0; i < pairs.length; i += 2) out.push(String(pairs[i]), String(pairs[i + 1])); };

  const layers = [
    ['WALLS', 8], ['FLOOR', 9], ['OBJECTS', 7], ['STRUCTURE', 8], ['LABELS', 7], ['DIMS', 253],
  ];

  // HEADER
  const extMinP = P(-room.wallThickness, L + room.wallThickness), extMaxP = P(room.width + room.wallThickness, -room.wallThickness);
  push(0, 'SECTION', 2, 'HEADER');
  push(9, '$ACADVER', 1, 'AC1009');
  push(9, '$INSUNITS', 70, UNITS[unit].dxf);
  push(9, '$EXTMIN', 10, n(extMinP.x), 20, n(extMinP.y), 30, 0);
  push(9, '$EXTMAX', 10, n(extMaxP.x), 20, n(extMaxP.y), 30, n(room.height * f));
  push(0, 'ENDSEC');

  // TABLES
  push(0, 'SECTION', 2, 'TABLES');
  push(0, 'TABLE', 2, 'LTYPE', 70, 1);
  push(0, 'LTYPE', 2, 'CONTINUOUS', 70, 0, 3, 'Solid line', 72, 65, 73, 0, 40, 0);
  push(0, 'ENDTAB');
  push(0, 'TABLE', 2, 'LAYER', 70, layers.length);
  for (const [name, color] of layers) push(0, 'LAYER', 2, name, 70, 0, 62, color, 6, 'CONTINUOUS');
  push(0, 'ENDTAB');
  push(0, 'TABLE', 2, 'STYLE', 70, 1);
  push(0, 'STYLE', 2, 'STANDARD', 70, 0, 40, 0, 41, 1, 50, 0, 71, 0, 42, 2.5, 3, 'txt', 4, '');
  push(0, 'ENDTAB');
  push(0, 'ENDSEC');

  // ENTITIES
  push(0, 'SECTION', 2, 'ENTITIES');
  out.push('999', `Room Planner export: ${store.state.name} — units ${unit}; object heights stored as thickness (39), elevation as (38)`);

  const polyline = (pts, layer, { color, thickness = 0, elevation = 0, trueColour } = {}) => {
    push(0, 'POLYLINE', 8, layer);
    if (color != null) push(62, color);
    if (trueColour != null) push(420, trueColour);
    push(66, 1, 70, 1, 38, n(elevation * f), 39, n(thickness * f), 10, 0, 20, 0, 30, n(elevation * f));
    for (const p of pts) {
      const q = P(p.x, p.y);
      push(0, 'VERTEX', 8, layer, 10, n(q.x), 20, n(q.y), 30, n(elevation * f));
    }
    push(0, 'SEQEND', 8, layer);
  };
  const text = (str, x, y, height, layer, { rot = 0, color } = {}) => {
    const q = P(x, y);
    push(0, 'TEXT', 8, layer);
    if (color != null) push(62, color);
    push(10, n(q.x), 20, n(q.y), 30, 0, 40, n(height * f), 1, str.replace(/[\r\n]/g, ' '), 50, n(rot), 72, 1, 73, 2, 11, n(q.x), 21, n(q.y), 31, 0);
  };
  const circle = (x, y, r, layer, opts = {}) => {
    const q = P(x, y);
    push(0, 'CIRCLE', 8, layer);
    if (opts.color != null) push(62, opts.color);
    if (opts.trueColour != null) push(420, opts.trueColour);
    push(38, n((opts.elevation || 0) * f), 39, n((opts.thickness || 0) * f), 10, n(q.x), 20, n(q.y), 30, n((opts.elevation || 0) * f), 40, n(r * f));
  };

  // floor outline
  polyline([{ x: 0, y: 0 }, { x: room.width, y: 0 }, { x: room.width, y: L }, { x: 0, y: L }], 'FLOOR');
  // walls as four slabs
  const T = room.wallThickness, W = room.width;
  const slabs = [
    [{ x: -T, y: -T }, { x: W + T, y: -T }, { x: W + T, y: 0 }, { x: -T, y: 0 }],
    [{ x: -T, y: L }, { x: W + T, y: L }, { x: W + T, y: L + T }, { x: -T, y: L + T }],
    [{ x: -T, y: 0 }, { x: 0, y: 0 }, { x: 0, y: L }, { x: -T, y: L }],
    [{ x: W, y: 0 }, { x: W + T, y: 0 }, { x: W + T, y: L }, { x: W, y: L }],
  ];
  for (const s of slabs) polyline(s, 'WALLS', { thickness: room.height });

  // objects
  for (const o of store.objects) {
    const layer = ['Wall segment', 'Half wall', 'Column', 'Round column'].includes(o.name) || o.shape === 'door' ? 'STRUCTURE' : 'OBJECTS';
    const opts = { color: nearestAci(o.color), trueColour: trueColor(o.color), thickness: o.h, elevation: o.z };
    if (o.shape === 'ellipse' && Math.abs(o.w - o.d) < 1e-6) circle(o.x, o.y, o.w / 2, layer, opts);
    else if (o.shape === 'ellipse') polyline(ellipsePoints(o, 48), layer, opts);
    else polyline(corners(o), layer, opts);
    if (o.shape === 'door') {
      // swing arc
      const hinge = o.mirror ? { lx: o.w / 2, ly: -o.d / 2 } : { lx: -o.w / 2, ly: -o.d / 2 };
      const pts = [];
      const a0 = o.mirror ? 180 : -90, a1 = o.mirror ? 270 : 0;
      for (let i = 0; i <= 12; i++) {
        const a = (a0 + (a1 - a0) * i / 12) * Math.PI / 180;
        const lx = hinge.lx + Math.cos(a) * o.w, ly = hinge.ly + Math.sin(a) * o.w;
        const rad = o.rot * Math.PI / 180;
        pts.push({ x: o.x + lx * Math.cos(rad) - ly * Math.sin(rad), y: o.y + lx * Math.sin(rad) + ly * Math.cos(rad) });
      }
      // open polyline (flag 0)
      push(0, 'POLYLINE', 8, 'STRUCTURE', 66, 1, 70, 0, 10, 0, 20, 0, 30, 0);
      for (const p of pts) { const q = P(p.x, p.y); push(0, 'VERTEX', 8, 'STRUCTURE', 10, n(q.x), 20, n(q.y), 30, 0); }
      push(0, 'SEQEND', 8, 'STRUCTURE');
    }
    // labels + dimensions
    let rot = normDeg(-o.rot);
    if (o.rot > 90 && o.rot < 270) rot = normDeg(rot + 180);
    const th = Math.max(4, Math.min(o.w, o.d) * 0.22);
    const dimTh = th * 0.7;
    const rad = o.rot * Math.PI / 180;
    const offset = (dy) => ({ x: o.x - dy * Math.sin(rad), y: o.y + dy * Math.cos(rad) });
    const flip = o.rot > 90 && o.rot < 270 ? -1 : 1;
    const lp = offset(-dimTh * 0.7 * flip), dp = offset(th * 0.8 * flip);
    text(o.name, lp.x, lp.y, th, 'LABELS', { rot });
    text(`${fmt(o.w)} x ${fmt(o.d)} x ${fmt(o.h)} ${unit}${o.z ? ` @${fmt(o.z)}` : ''}`, dp.x, dp.y, dimTh, 'DIMS', { rot });
  }
  // room labels
  text(`${store.state.name}  ${fmt(room.width)} x ${fmt(room.length)} ${unit}, ceiling ${fmt(room.height)} ${unit}`, room.width / 2, -T - 20, 12, 'LABELS');

  push(0, 'ENDSEC', 0, 'EOF');
  return out.join('\r\n') + '\r\n';
}

export function exportDXF(store) {
  const dxf = buildDXF(store);
  downloadBlob(new Blob([dxf], { type: 'application/dxf' }), `${safeName(store.state.name)}.dxf`);
}
