import { rotatePoint, toLocal, corners, aabb, unionBox, hitTest, boxesIntersect, boxContains, normDeg, snap, dist, shade, withAlpha, isDark, DEG } from './geometry.js';
import { fmt, fmtDims, unitLabel, niceStepCm } from './units.js';

const HANDLE_PX = 8;
const ROT_HANDLE_OFFSET = 28; // px above the top edge
const SNAP_PX = 7;
const SEL_COLOR = '#2563eb';
const HOVER_COLOR = '#60a5fa';
const GUIDE_COLOR = '#d946ef';

// Corner handles (sx, sy) then edge handles.
const HANDLES = [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, -1], [1, 0], [0, 1], [-1, 0]];

export class Editor2D {
  constructor(canvas, store, hooks = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.store = store;
    this.hooks = hooks;
    this.view = { zoom: 1, panX: 40, panY: 40 };
    this.tool = 'select';
    this.hover = null;
    this.drag = null;
    this.measure = null;
    this.guides = [];
    this.marquee = null;
    this.spaceDown = false;
    this.lastMouse = { x: 0, y: 0 };
    this.needsRender = true;
    this._raf = null;

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement);
    this.resize();

    canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    canvas.addEventListener('pointermove', (e) => this.onPointerMove(e));
    canvas.addEventListener('pointerup', (e) => this.onPointerUp(e));
    canvas.addEventListener('pointercancel', (e) => this.onPointerUp(e));
    canvas.addEventListener('pointerleave', () => { if (!this.drag) { this.setHover(null); this.invalidate(); } });
    canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    canvas.addEventListener('dblclick', (e) => this.onDblClick(e));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    store.on('change', () => this.invalidate());
    store.on('selection', () => this.invalidate());
    store.on('prefs', () => this.invalidate());
  }

  /* ---------- view transforms ---------- */
  worldToScreen(x, y) { return { x: x * this.view.zoom + this.view.panX, y: y * this.view.zoom + this.view.panY }; }
  screenToWorld(sx, sy) { return { x: (sx - this.view.panX) / this.view.zoom, y: (sy - this.view.panY) / this.view.zoom }; }
  get width() { return this.canvas.clientWidth; }
  get height() { return this.canvas.clientHeight; }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.parentElement.clientWidth, h = this.canvas.parentElement.clientHeight;
    if (!w || !h) return;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.dpr = dpr;
    if (!this._fitted) { this._fitted = true; this.zoomFit(); }
    this.invalidate();
  }

  zoomFit() {
    const room = this.store.room;
    const boxes = [{ minX: -room.wallThickness, minY: -room.wallThickness, maxX: room.width + room.wallThickness, maxY: room.length + room.wallThickness }];
    for (const o of this.store.objects) boxes.push(aabb(o));
    const b = unionBox(boxes);
    const margin = 60;
    const zx = (this.width - margin * 2) / Math.max(1, b.maxX - b.minX);
    const zy = (this.height - margin * 2) / Math.max(1, b.maxY - b.minY);
    this.view.zoom = Math.max(0.05, Math.min(zx, zy));
    this.view.panX = (this.width - (b.minX + b.maxX) * this.view.zoom) / 2;
    this.view.panY = (this.height - (b.minY + b.maxY) * this.view.zoom) / 2;
    this.hooks.zoomChanged?.(this.view.zoom);
    this.invalidate();
  }

  zoomBy(factor, sx = this.width / 2, sy = this.height / 2) {
    const before = this.screenToWorld(sx, sy);
    this.view.zoom = Math.max(0.05, Math.min(40, this.view.zoom * factor));
    const after = this.worldToScreen(before.x, before.y);
    this.view.panX += sx - after.x;
    this.view.panY += sy - after.y;
    this.hooks.zoomChanged?.(this.view.zoom);
    this.invalidate();
  }

  viewCenterWorld() { return this.screenToWorld(this.width / 2, this.height / 2); }

  setTool(t) {
    this.tool = t;
    this.measure = null;
    this.canvas.style.cursor = '';
    this.canvas.classList.toggle('tool-pan', t === 'pan');
    this.canvas.classList.toggle('tool-measure', t === 'measure');
    this.hooks.toolChanged?.(t);
    this.invalidate();
  }

  /* ---------- helpers ---------- */
  gridStep() { return this.store.prefs.gridSize || 10; }
  snapThreshold() { return SNAP_PX / this.view.zoom; }

  objectAt(wx, wy) {
    const objs = this.store.objects;
    const pad = 2 / this.view.zoom;
    for (let i = objs.length - 1; i >= 0; i--) if (hitTest(objs[i], wx, wy, pad)) return objs[i];
    return null;
  }

  /** Handle positions (world) for the current selection. Returns {handles:[{x,y,sx,sy,i}], rot:{x,y}, obj|box} */
  selectionHandles() {
    const sel = this.store.selectedObjects().filter((o) => !o.locked);
    if (!sel.length) return null;
    const off = ROT_HANDLE_OFFSET / this.view.zoom;
    if (sel.length === 1) {
      const o = sel[0];
      const hw = o.w / 2, hd = o.d / 2;
      const handles = HANDLES.map(([sx, sy], i) => ({ ...rotatePoint(o.x + sx * hw, o.y + sy * hd, o.x, o.y, o.rot), sx, sy, i }));
      const rot = rotatePoint(o.x, o.y - hd - off, o.x, o.y, o.rot);
      return { single: o, handles, rot, pivot: { x: o.x, y: o.y } };
    }
    const box = unionBox(sel.map(aabb));
    return { box, handles: [], rot: { x: box.cx, y: box.minY - off }, pivot: { x: box.cx, y: box.cy } };
  }

  handleAt(sx, sy) {
    const hs = this.selectionHandles();
    if (!hs) return null;
    const r = HANDLE_PX;
    const rp = this.worldToScreen(hs.rot.x, hs.rot.y);
    if (dist(sx, sy, rp.x, rp.y) <= r + 2) return { type: 'rotate', hs };
    for (const h of hs.handles) {
      const p = this.worldToScreen(h.x, h.y);
      if (Math.abs(p.x - sx) <= r && Math.abs(p.y - sy) <= r) return { type: 'resize', handle: h, hs };
    }
    return null;
  }

  setHover(id) {
    if (this.hover !== id) { this.hover = id; this.invalidate(); }
  }

  showTooltip(obj, sx, sy) {
    if (!obj) { this.hooks.tooltip?.(null); return; }
    const parts = [`<b>${escapeHtml(obj.name)}</b>`, `<span class="mono">${fmtDims(obj.w, obj.d, obj.h)}</span>`];
    const extra = [];
    if (obj.z) extra.push(`elev. ${fmt(obj.z, { withUnit: true })}`);
    if (obj.rot) extra.push(`rot ${obj.rot}°`);
    if (obj.locked) extra.push('locked');
    if (obj.group) extra.push(`group: ${escapeHtml(this.store.state.groups[obj.group]?.name || 'Group')}`);
    if (extra.length) parts.push(`<span class="mono">${extra.join(' · ')}</span>`);
    this.hooks.tooltip?.(parts.join(''), sx, sy);
  }

  /* ---------- pointer events ---------- */
  eventPos(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  onPointerDown(e) {
    const s = this.eventPos(e);
    const w = this.screenToWorld(s.x, s.y);
    this.canvas.setPointerCapture(e.pointerId);
    this.canvas.focus?.();
    const isPan = e.button === 1 || this.tool === 'pan' || this.spaceDown;

    if (isPan) {
      this.drag = { type: 'pan', startS: s, panX: this.view.panX, panY: this.view.panY };
      this.canvas.classList.add('panning');
      return;
    }
    if (e.button === 2) return;

    if (this.tool === 'measure') {
      const p = this.snapMeasurePoint(w);
      this.measure = { a: p, b: p };
      this.drag = { type: 'measure' };
      this.invalidate();
      return;
    }

    // select tool
    const handle = this.handleAt(s.x, s.y);
    if (handle) {
      const sel = this.store.selectedObjects().filter((o) => !o.locked);
      const originals = sel.map((o) => ({ ...o }));
      this.store.beginDrag();
      if (handle.type === 'rotate') {
        const pivot = handle.hs.pivot;
        const startAngle = Math.atan2(w.y - pivot.y, w.x - pivot.x) / DEG;
        this.drag = { type: 'rotate', pivot, startAngle, originals, single: handle.hs.single ? { ...handle.hs.single } : null, angle: 0 };
      } else {
        this.drag = { type: 'resize', handle: handle.handle, original: { ...handle.hs.single } };
      }
      return;
    }

    const hit = this.objectAt(w.x, w.y);
    if (hit) {
      const selected = this.store.selection.has(hit.id);
      let duplicate = false;
      if (e.shiftKey) {
        this.store.select([hit.id], { toggle: true, expand: !e.altKey });
        if (!this.store.selection.has(hit.id)) return; // deselected -> no drag
      } else if (!selected) {
        this.store.select([hit.id], { expand: !e.altKey }); // Alt+click picks a single group member
      } else if (e.altKey) {
        duplicate = true; // Alt+drag on a selected object duplicates the selection
      }
      if (hit.locked) { this.drag = { type: 'noop' }; return; }

      let ids = this.store.selectedIds();
      if (duplicate) ids = this.store.duplicateObjects(ids, 0);
      this.store.beginDrag();
      const moving = this.store.objects.filter((o) => ids.includes(o.id) && !o.locked);
      this.drag = {
        type: 'move', startW: w, moved: false,
        originals: moving.map((o) => ({ id: o.id, x: o.x, y: o.y })),
        box: unionBox(moving.map(aabb)),
        ids: moving.map((o) => o.id),
      };
      return;
    }

    // empty space: marquee
    if (!e.shiftKey) this.store.clearSelection();
    this.drag = { type: 'marquee', startW: w, add: e.shiftKey };
    this.marquee = { a: w, b: w };
  }

  onPointerMove(e) {
    const s = this.eventPos(e);
    const w = this.screenToWorld(s.x, s.y);
    this.lastMouse = s;
    this.hooks.coords?.(w.x, w.y);
    const d = this.drag;

    if (!d) {
      this.updateIdleCursor(s, w);
      return;
    }

    switch (d.type) {
      case 'pan':
        this.view.panX = d.panX + (s.x - d.startS.x);
        this.view.panY = d.panY + (s.y - d.startS.y);
        this.invalidate();
        break;
      case 'measure':
        this.measure.b = this.snapMeasurePoint(w);
        this.invalidate();
        break;
      case 'marquee':
        this.marquee.b = w;
        this.invalidate();
        break;
      case 'move': this.doMove(w, e); break;
      case 'rotate': this.doRotate(w, e); break;
      case 'resize': this.doResize(w, e); break;
    }
  }

  onPointerUp(e) {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    this.canvas.classList.remove('panning');
    this.guides = [];
    try { this.canvas.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ }

    if (d.type === 'marquee') {
      const m = this.marquee;
      this.marquee = null;
      const minX = Math.min(m.a.x, m.b.x), maxX = Math.max(m.a.x, m.b.x);
      const minY = Math.min(m.a.y, m.b.y), maxY = Math.max(m.a.y, m.b.y);
      const box = { minX, minY, maxX, maxY };
      if ((maxX - minX) * this.view.zoom > 3 || (maxY - minY) * this.view.zoom > 3) {
        const crossing = m.b.x < m.a.x; // right-to-left = crossing selection (CAD style)
        const ids = this.store.objects.filter((o) => {
          const b = aabb(o);
          return crossing ? boxesIntersect(box, b) : boxContains(box, b);
        }).map((o) => o.id);
        this.store.select(ids, { add: d.add });
      }
      this.invalidate();
      return;
    }
    if (d.type === 'move' || d.type === 'rotate' || d.type === 'resize') {
      this.store.commitDrag();
      this.hooks.hint?.('');
    }
    if (d.type === 'measure' && this.measure) {
      const L = dist(this.measure.a.x, this.measure.a.y, this.measure.b.x, this.measure.b.y);
      if (L * this.view.zoom < 2) this.measure = null;
      this.invalidate();
    }
  }

  cancelDrag() {
    const d = this.drag;
    if (!d) { if (this.measure) { this.measure = null; this.invalidate(); return true; } return false; }
    this.drag = null;
    this.marquee = null;
    this.guides = [];
    this.canvas.classList.remove('panning');
    if (d.type === 'move' || d.type === 'rotate' || d.type === 'resize') this.store.cancelDrag();
    if (d.type === 'measure') this.measure = null;
    this.invalidate();
    return true;
  }

  onDblClick(e) {
    const s = this.eventPos(e);
    const w = this.screenToWorld(s.x, s.y);
    const hit = this.objectAt(w.x, w.y);
    if (hit) this.hooks.editName?.(hit.id);
  }

  onWheel(e) {
    e.preventDefault();
    const s = this.eventPos(e);
    if (e.shiftKey && !e.ctrlKey) {
      this.view.panX -= e.deltaY;
      this.invalidate();
      return;
    }
    const factor = Math.pow(1.0015, -e.deltaY);
    this.zoomBy(factor, s.x, s.y);
  }

  updateIdleCursor(s, w) {
    const c = this.canvas;
    if (this.tool !== 'select') { c.style.cursor = ''; this.setHover(null); this.hooks.tooltip?.(null); return; }
    const handle = this.handleAt(s.x, s.y);
    if (handle) {
      if (handle.type === 'rotate') c.style.cursor = 'alias';
      else {
        const o = handle.hs.single;
        const p = this.worldToScreen(handle.handle.x, handle.handle.y);
        const cp = this.worldToScreen(o.x, o.y);
        let a = Math.atan2(p.y - cp.y, p.x - cp.x) / DEG;
        // handles on edges point along the edge normal
        if (handle.handle.sx === 0 || handle.handle.sy === 0) {
          a = o.rot + (handle.handle.sx === 0 ? 90 : 0);
        }
        a = ((a % 180) + 180) % 180;
        c.style.cursor = a < 22.5 || a >= 157.5 ? 'ew-resize' : a < 67.5 ? 'nwse-resize' : a < 112.5 ? 'ns-resize' : 'nesw-resize';
      }
      this.setHover(null);
      this.hooks.tooltip?.(null);
      return;
    }
    const hit = this.objectAt(w.x, w.y);
    if (hit) {
      c.style.cursor = hit.locked ? 'not-allowed' : 'move';
      this.setHover(hit.id);
      this.showTooltip(hit, s.x, s.y);
    } else {
      c.style.cursor = 'default';
      this.setHover(null);
      this.hooks.tooltip?.(null);
    }
  }

  /* ---------- drag operations ---------- */
  doMove(w, e) {
    const d = this.drag;
    let dx = w.x - d.startW.x, dy = w.y - d.startW.y;
    if (!d.moved && Math.hypot(dx, dy) * this.view.zoom < 3) return;
    d.moved = true;
    if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; } // axis lock

    const prefs = this.store.prefs;
    this.guides = [];
    if (!e.ctrlKey && !e.metaKey) {
      const box = d.box;
      const moved = { minX: box.minX + dx, maxX: box.maxX + dx, minY: box.minY + dy, maxY: box.maxY + dy, cx: box.cx + dx, cy: box.cy + dy };
      const th = this.snapThreshold();
      let bestX = null, bestY = null;
      if (prefs.snapObjects) {
        const room = this.store.room;
        const xs = [0, room.width, room.width / 2], ys = [0, room.length, room.length / 2];
        for (const o of this.store.objects) {
          if (d.ids.includes(o.id)) continue;
          const b = aabb(o);
          xs.push(b.minX, b.maxX, b.cx); ys.push(b.minY, b.maxY, b.cy);
        }
        for (const mx of [moved.minX, moved.maxX, moved.cx]) for (const x of xs) {
          const off = x - mx;
          if (Math.abs(off) <= th && (!bestX || Math.abs(off) < Math.abs(bestX.off))) bestX = { off, at: x };
        }
        for (const my of [moved.minY, moved.maxY, moved.cy]) for (const y of ys) {
          const off = y - my;
          if (Math.abs(off) <= th && (!bestY || Math.abs(off) < Math.abs(bestY.off))) bestY = { off, at: y };
        }
      }
      if (prefs.snapGrid) {
        const g = this.gridStep();
        if (!bestX) { const sx = snap(moved.minX, g); dx += sx - moved.minX; }
        if (!bestY) { const sy = snap(moved.minY, g); dy += sy - moved.minY; }
      }
      if (bestX) { dx += bestX.off; this.guides.push({ axis: 'x', at: bestX.at }); }
      if (bestY) { dy += bestY.off; this.guides.push({ axis: 'y', at: bestY.at }); }
    }
    for (const org of d.originals) {
      const o = this.store.getObj(org.id);
      if (o) { o.x = org.x + dx; o.y = org.y + dy; }
    }
    this.hooks.hint?.(`Δx ${fmt(dx, { withUnit: true })}  Δy ${fmt(dy, { withUnit: true })}`);
    this.store.changed();
  }

  doRotate(w, e) {
    const d = this.drag;
    const ang = Math.atan2(w.y - d.pivot.y, w.x - d.pivot.x) / DEG;
    let delta = ang - d.startAngle;
    if (d.single) {
      let target = d.single.rot + delta;
      if (e.shiftKey || this.store.prefs.snapGrid) target = Math.round(target / (e.shiftKey ? 15 : 1)) * (e.shiftKey ? 15 : 1);
      delta = target - d.single.rot;
    } else if (e.shiftKey) {
      delta = Math.round(delta / 15) * 15;
    } else {
      delta = Math.round(delta);
    }
    d.angle = delta;
    for (const org of d.originals) {
      const o = this.store.getObj(org.id);
      if (!o) continue;
      if (d.originals.length > 1) {
        const p = rotatePoint(org.x, org.y, d.pivot.x, d.pivot.y, delta);
        o.x = p.x; o.y = p.y;
      }
      o.rot = normDeg(org.rot + delta);
    }
    this.hooks.hint?.(d.single ? `Rotation ${normDeg(d.single.rot + delta)}°` : `Rotate ${Math.round(delta)}°`);
    this.store.changed();
  }

  doResize(w, e) {
    const d = this.drag;
    const o0 = d.original;
    const obj = this.store.getObj(o0.id);
    if (!obj) return;
    const { sx, sy } = d.handle;
    const l = toLocal(o0, w.x, w.y); // local coords relative to original centre
    const lx = l.x, ly = l.y;
    const oppX = -sx * o0.w / 2, oppY = -sy * o0.d / 2;
    const g = this.store.prefs.snapGrid && !e.ctrlKey ? this.gridStep() : 0;
    const min = 1;
    let newW = o0.w, newD = o0.d;
    if (sx !== 0) newW = Math.max(min, sx * (lx - oppX));
    if (sy !== 0) newD = Math.max(min, sy * (ly - oppY));
    if (g) { if (sx !== 0) newW = Math.max(min, snap(newW, g)); if (sy !== 0) newD = Math.max(min, snap(newD, g)); }
    if (e.shiftKey && sx !== 0 && sy !== 0) {
      const ratio = o0.w / o0.d;
      if (newW / o0.w > newD / o0.d) newD = newW / ratio; else newW = newD * ratio;
    }
    const lcx = sx !== 0 ? oppX + sx * newW / 2 : 0;
    const lcy = sy !== 0 ? oppY + sy * newD / 2 : 0;
    const c = rotatePoint(o0.x + lcx, o0.y + lcy, o0.x, o0.y, o0.rot);
    obj.w = newW; obj.d = newD; obj.x = c.x; obj.y = c.y;
    this.hooks.hint?.(`${fmt(newW)} × ${fmt(newD)} ${unitLabel()}`);
    this.store.changed();
  }

  snapMeasurePoint(w) {
    const th = this.snapThreshold() * 1.5;
    let best = null, bd = th;
    const room = this.store.room;
    const pts = [{ x: 0, y: 0 }, { x: room.width, y: 0 }, { x: 0, y: room.length }, { x: room.width, y: room.length }];
    for (const o of this.store.objects) pts.push(...corners(o), { x: o.x, y: o.y });
    for (const p of pts) { const dd = dist(p.x, p.y, w.x, w.y); if (dd < bd) { bd = dd; best = p; } }
    if (best) return { x: best.x, y: best.y, snapped: true };
    if (this.store.prefs.snapGrid) { const g = this.gridStep(); return { x: snap(w.x, g), y: snap(w.y, g) }; }
    return { x: w.x, y: w.y };
  }

  /* ---------- rendering ---------- */
  invalidate() {
    this.needsRender = true;
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => { this._raf = null; if (this.needsRender) { this.needsRender = false; this.render(); } });
  }

  render() {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    renderPlan(ctx, this.store, this.view, {
      width: this.width, height: this.height,
      selection: this.store.selection, hover: this.hover,
      showLabels: this.store.prefs.showLabels, showDims: this.store.prefs.showDims,
      gridSize: this.gridStep(), showGrid: true,
    });
    this.renderOverlays(ctx);
  }

  renderOverlays(ctx) {
    // snap guides
    for (const g of this.guides) {
      ctx.save();
      ctx.strokeStyle = GUIDE_COLOR; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
      ctx.beginPath();
      if (g.axis === 'x') { const x = this.worldToScreen(g.at, 0).x; ctx.moveTo(x, 0); ctx.lineTo(x, this.height); }
      else { const y = this.worldToScreen(0, g.at).y; ctx.moveTo(0, y); ctx.lineTo(this.width, y); }
      ctx.stroke();
      ctx.restore();
    }
    // handles
    const hs = this.tool === 'select' ? this.selectionHandles() : null;
    if (hs) {
      ctx.save();
      const top = hs.single ? rotatePoint(hs.single.x, hs.single.y - hs.single.d / 2, hs.single.x, hs.single.y, hs.single.rot) : { x: hs.box.cx, y: hs.box.minY };
      const anchor = this.worldToScreen(top.x, top.y);
      const rp = this.worldToScreen(hs.rot.x, hs.rot.y);
      ctx.strokeStyle = SEL_COLOR; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(anchor.x, anchor.y); ctx.lineTo(rp.x, rp.y); ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(rp.x, rp.y, HANDLE_PX / 2 + 1, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.arc(rp.x, rp.y, 2, 0, Math.PI * 2); ctx.fillStyle = SEL_COLOR; ctx.fill();
      for (const h of hs.handles) {
        const p = this.worldToScreen(h.x, h.y);
        const r = (h.sx === 0 || h.sy === 0) ? HANDLE_PX / 2 - 1 : HANDLE_PX / 2;
        ctx.fillStyle = '#fff';
        ctx.fillRect(p.x - r, p.y - r, r * 2, r * 2);
        ctx.strokeRect(p.x - r, p.y - r, r * 2, r * 2);
      }
      ctx.restore();
      if (this.drag?.type === 'rotate') {
        const p = this.worldToScreen(hs.pivot.x, hs.pivot.y);
        ctx.save();
        ctx.font = '12px sans-serif'; ctx.fillStyle = SEL_COLOR; ctx.textAlign = 'center';
        ctx.fillText(this.drag.single ? `${normDeg(this.drag.single.rot + this.drag.angle)}°` : `${Math.round(this.drag.angle)}°`, p.x, p.y - 8);
        ctx.restore();
      }
    }
    // marquee
    if (this.marquee) {
      const a = this.worldToScreen(this.marquee.a.x, this.marquee.a.y), b = this.worldToScreen(this.marquee.b.x, this.marquee.b.y);
      ctx.save();
      ctx.fillStyle = withAlpha(SEL_COLOR, 0.08); ctx.strokeStyle = SEL_COLOR; ctx.lineWidth = 1;
      if (this.marquee.b.x < this.marquee.a.x) ctx.setLineDash([5, 4]);
      ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
      ctx.strokeRect(Math.round(a.x) + 0.5, Math.round(a.y) + 0.5, Math.round(b.x - a.x), Math.round(b.y - a.y));
      ctx.restore();
    }
    // measure
    if (this.measure) {
      const m = this.measure;
      const a = this.worldToScreen(m.a.x, m.a.y), b = this.worldToScreen(m.b.x, m.b.y);
      const L = dist(m.a.x, m.a.y, m.b.x, m.b.y);
      ctx.save();
      ctx.strokeStyle = '#dc2626'; ctx.fillStyle = '#dc2626'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      for (const p of [a, b]) { ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2); ctx.fill(); }
      const label = `${fmt(L, { withUnit: true })}  (Δx ${fmt(Math.abs(m.b.x - m.a.x))}, Δy ${fmt(Math.abs(m.b.y - m.a.y))})`;
      drawLabelBox(ctx, label, (a.x + b.x) / 2, (a.y + b.y) / 2 - 14, '#dc2626');
      ctx.restore();
    }
    // scale bar
    drawScaleBar(ctx, this.view.zoom, this.width - 20, this.height - 16);
  }
}

/* =====================================================================
 * Shared plan renderer — used by the editor and by PNG export.
 * ===================================================================*/
export function renderPlan(ctx, store, view, opts) {
  const { width, height } = opts;
  const z = view.zoom;
  const W2S = (x, y) => ({ x: x * z + view.panX, y: y * z + view.panY });
  const room = store.room;
  const selection = opts.selection || new Set();
  const ts = opts.textScale || 1; // enlarges text/line weights for high-resolution export

  ctx.save();
  ctx.fillStyle = opts.background || '#e9ebef';
  ctx.fillRect(0, 0, width, height);

  // floor
  const r0 = W2S(0, 0), r1 = W2S(room.width, room.length);
  ctx.fillStyle = room.floorColor || '#e7dcc8';
  ctx.fillRect(r0.x, r0.y, r1.x - r0.x, r1.y - r0.y);

  // grid
  if (opts.showGrid !== false) {
    const minor = opts.gridSize || 10;
    const major = niceStepCm(90 / z);
    const wl = (0 - view.panX) / z, wt = (0 - view.panY) / z, wr = (width - view.panX) / z, wb = (height - view.panY) / z;
    ctx.lineWidth = 1;
    if (minor * z >= 6) {
      ctx.strokeStyle = 'rgba(0,0,0,0.05)';
      ctx.beginPath();
      for (let x = Math.floor(wl / minor) * minor; x <= wr; x += minor) { const p = W2S(x, 0).x; ctx.moveTo(Math.round(p) + 0.5, 0); ctx.lineTo(Math.round(p) + 0.5, height); }
      for (let y = Math.floor(wt / minor) * minor; y <= wb; y += minor) { const p = W2S(0, y).y; ctx.moveTo(0, Math.round(p) + 0.5); ctx.lineTo(width, Math.round(p) + 0.5); }
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.11)';
    ctx.beginPath();
    for (let x = Math.floor(wl / major) * major; x <= wr; x += major) { const p = W2S(x, 0).x; ctx.moveTo(Math.round(p) + 0.5, 0); ctx.lineTo(Math.round(p) + 0.5, height); }
    for (let y = Math.floor(wt / major) * major; y <= wb; y += major) { const p = W2S(0, y).y; ctx.moveTo(0, Math.round(p) + 0.5); ctx.lineTo(width, Math.round(p) + 0.5); }
    ctx.stroke();
  }

  // walls (drawn outside the room rectangle)
  const t = room.wallThickness * z;
  ctx.fillStyle = room.wallColor || '#d1d5db';
  ctx.fillRect(r0.x - t, r0.y - t, (r1.x - r0.x) + 2 * t, t); // top
  ctx.fillRect(r0.x - t, r1.y, (r1.x - r0.x) + 2 * t, t); // bottom
  ctx.fillRect(r0.x - t, r0.y, t, r1.y - r0.y); // left
  ctx.fillRect(r1.x, r0.y, t, r1.y - r0.y); // right
  ctx.strokeStyle = '#374151'; ctx.lineWidth = Math.max(1, Math.min(2, z * 0.5));
  ctx.strokeRect(r0.x, r0.y, r1.x - r0.x, r1.y - r0.y);
  ctx.strokeRect(r0.x - t, r0.y - t, (r1.x - r0.x) + 2 * t, (r1.y - r0.y) + 2 * t);

  // room dimensions
  ctx.fillStyle = '#374151'; ctx.font = `${12 * ts}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  ctx.fillText(`${fmt(room.width, { withUnit: true })}`, (r0.x + r1.x) / 2, r0.y - t - 6 * ts);
  ctx.save();
  ctx.translate(r0.x - t - 6 * ts, (r0.y + r1.y) / 2); ctx.rotate(-Math.PI / 2);
  ctx.fillText(`${fmt(room.length, { withUnit: true })}`, 0, 0);
  ctx.restore();
  if (opts.showDims) {
    ctx.textBaseline = 'top'; ctx.fillStyle = '#6b7280'; ctx.font = `${11 * ts}px sans-serif`;
    ctx.fillText(`ceiling ${fmt(room.height, { withUnit: true })}`, (r0.x + r1.x) / 2, r1.y + t + 4);
  }

  // objects
  for (const o of store.objects) drawObject(ctx, o, z, W2S, opts, ts);

  // hover / selection outlines
  for (const o of store.objects) {
    const sel = selection.has(o.id);
    const hov = opts.hover === o.id && !sel;
    if (!sel && !hov) continue;
    const c = W2S(o.x, o.y);
    ctx.save();
    ctx.translate(c.x, c.y); ctx.rotate(o.rot * DEG);
    ctx.strokeStyle = sel ? SEL_COLOR : HOVER_COLOR; ctx.lineWidth = sel ? 2 : 1.5;
    if (o.locked) ctx.setLineDash([4, 3]);
    shapePath(ctx, o, z, 1.5);
    ctx.stroke();
    ctx.restore();
  }

  // dimension lines for selected objects
  if (selection.size) {
    const sel = store.objects.filter((o) => selection.has(o.id));
    if (sel.length === 1) drawObjectDims(ctx, sel[0], z, W2S);
    else {
      const box = unionBox(sel.map(aabb));
      const a = W2S(box.minX, box.minY), b = W2S(box.maxX, box.maxY);
      ctx.save();
      ctx.strokeStyle = SEL_COLOR; ctx.setLineDash([5, 4]); ctx.lineWidth = 1;
      ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
      ctx.restore();
      drawDimLine(ctx, a.x, b.y, b.x, b.y, 16, fmt(box.w, { withUnit: true }));
      drawDimLine(ctx, b.x, b.y, b.x, a.y, 16, fmt(box.h, { withUnit: true }));
    }
  }
  ctx.restore();
}

function shapePath(ctx, o, z, grow = 0) {
  const w = o.w * z + grow * 2, d = o.d * z + grow * 2;
  ctx.beginPath();
  if (o.shape === 'ellipse') ctx.ellipse(0, 0, w / 2, d / 2, 0, 0, Math.PI * 2);
  else if (o.shape === 'round') { const r = Math.min(w, d) * 0.18; roundRect(ctx, -w / 2, -d / 2, w, d, r); }
  else ctx.rect(-w / 2, -d / 2, w, d);
}

function roundRect(ctx, x, y, w, h, r) {
  if (ctx.roundRect) { ctx.roundRect(x, y, w, h, r); return; }
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

function drawObject(ctx, o, z, W2S, opts, ts = 1) {
  const c = W2S(o.x, o.y);
  const w = o.w * z, d = o.d * z;
  ctx.save();
  ctx.translate(c.x, c.y);
  ctx.rotate(o.rot * DEG);
  const stroke = shade(o.color, -70);

  if (o.shape === 'door') {
    // swing arc: hinge at left end (or right when mirrored), swinging towards -y
    const hx = o.mirror ? w / 2 : -w / 2;
    const dir = o.mirror ? -1 : 1;
    ctx.beginPath();
    ctx.moveTo(hx, -d / 2);
    ctx.arc(hx, -d / 2, w, o.mirror ? Math.PI : -Math.PI / 2, o.mirror ? Math.PI * 1.5 : 0, false);
    ctx.closePath();
    ctx.fillStyle = withAlpha(o.color, 0.12); ctx.fill();
    ctx.strokeStyle = withAlpha(stroke, 0.7); ctx.lineWidth = 1; ctx.setLineDash([3, 3]); ctx.stroke();
    ctx.setLineDash([]);
    // open leaf
    ctx.beginPath(); ctx.moveTo(hx, -d / 2); ctx.lineTo(hx, -d / 2 - w); ctx.strokeStyle = stroke; ctx.lineWidth = Math.max(1.5, d * 0.6); ctx.stroke();
    void dir;
  }

  shapePath(ctx, o, z);
  ctx.fillStyle = withAlpha(o.color, o.h <= 2 ? 0.55 : 0.88);
  ctx.fill();
  ctx.strokeStyle = stroke; ctx.lineWidth = 1.25 * ts;
  ctx.stroke();
  // little "front" marker for rectangular furniture so orientation is visible
  if (o.shape !== 'door' && o.shape !== 'ellipse' && w > 22 && d > 14 && o.h > 2) {
    ctx.strokeStyle = withAlpha(stroke, 0.35); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(-w / 2 + 3, d / 2 - 4); ctx.lineTo(w / 2 - 3, d / 2 - 4); ctx.stroke();
  }

  // label
  if (opts.showLabels && o.showLabel !== false) {
    const fontPx = Math.max(9 * ts, Math.min(15 * ts, Math.min(w, d) * 0.28));
    ctx.font = `${fontPx}px ${'-apple-system, Segoe UI, Roboto, sans-serif'}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const dark = isDark(o.color);
    const upsideDown = o.rot > 90 && o.rot < 270;
    if (upsideDown) ctx.rotate(Math.PI);
    const lines = [o.name];
    if (opts.showDims) lines.push(`${fmt(o.w)}×${fmt(o.d)}×${fmt(o.h)}`);
    const lineH = fontPx * 1.15;
    const total = lineH * lines.length;
    const fits = d >= fontPx + 2 && w >= 20;
    if (fits) {
      ctx.fillStyle = dark ? 'rgba(255,255,255,0.92)' : 'rgba(17,24,39,0.85)';
      lines.forEach((ln, i) => {
        let txt = ln;
        const maxW = w - 6;
        if (ctx.measureText(txt).width > maxW) {
          while (txt.length > 1 && ctx.measureText(txt + '…').width > maxW) txt = txt.slice(0, -1);
          txt += '…';
        }
        if (i > 0) ctx.font = `${Math.max(8, fontPx * 0.8)}px sans-serif`;
        ctx.fillText(txt, 0, -total / 2 + lineH * i + lineH / 2);
      });
    }
    if (upsideDown) ctx.rotate(Math.PI);
  }
  if (o.locked && w > 16 && d > 16) {
    ctx.font = '10px sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(17,24,39,0.7)';
    ctx.fillText('🔒', w / 2 - 2, -d / 2 + 2);
  }
  ctx.restore();
}

function drawObjectDims(ctx, o, z, W2S) {
  const cs = corners(o).map((p) => W2S(p.x, p.y)); // TL TR BR BL (rotated)
  // width along the bottom edge (BL->BR), depth along the right edge (TR->BR)
  drawDimLine(ctx, cs[3].x, cs[3].y, cs[2].x, cs[2].y, 14, fmt(o.w, { withUnit: true }));
  drawDimLine(ctx, cs[2].x, cs[2].y, cs[1].x, cs[1].y, 14, fmt(o.d, { withUnit: true }));
}

/** Dimension line offset to the right-hand side of the direction a->b (screen px). */
function drawDimLine(ctx, ax, ay, bx, by, offset, label) {
  const dx = bx - ax, dy = by - ay;
  const L = Math.hypot(dx, dy);
  if (L < 1) return;
  const nx = -dy / L, ny = dx / L; // normal (rotate -90°)
  const ox = nx * -offset, oy = ny * -offset;
  // choose the side pointing away from the shape: we want "outside", use +offset on right side of a->b
  const p1 = { x: ax - ox, y: ay - oy }, p2 = { x: bx - ox, y: by - oy };
  ctx.save();
  ctx.strokeStyle = SEL_COLOR; ctx.fillStyle = SEL_COLOR; ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(ax, ay); ctx.lineTo(p1.x - ox * 0.3, p1.y - oy * 0.3);
  ctx.moveTo(bx, by); ctx.lineTo(p2.x - ox * 0.3, p2.y - oy * 0.3);
  ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y);
  ctx.stroke();
  // ticks
  const tx = (dx / L) * 4, ty = (dy / L) * 4;
  ctx.beginPath();
  ctx.moveTo(p1.x - tx + ox * 0.25, p1.y - ty + oy * 0.25); ctx.lineTo(p1.x + tx - ox * 0.25, p1.y + ty - oy * 0.25);
  ctx.moveTo(p2.x - tx + ox * 0.25, p2.y - ty + oy * 0.25); ctx.lineTo(p2.x + tx - ox * 0.25, p2.y + ty - oy * 0.25);
  ctx.stroke();
  // label
  let ang = Math.atan2(dy, dx);
  if (ang > Math.PI / 2 || ang < -Math.PI / 2) ang += Math.PI;
  ctx.translate((p1.x + p2.x) / 2, (p1.y + p2.y) / 2);
  ctx.rotate(ang);
  ctx.font = '11px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const tw = ctx.measureText(label).width + 6;
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.fillRect(-tw / 2, -8, tw, 16);
  ctx.fillStyle = SEL_COLOR;
  ctx.fillText(label, 0, 0);
  ctx.restore();
}

function drawLabelBox(ctx, text, x, y, color) {
  ctx.save();
  ctx.font = '12px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const w = ctx.measureText(text).width + 10;
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.strokeStyle = color; ctx.lineWidth = 1;
  ctx.beginPath(); roundRect(ctx, x - w / 2, y - 10, w, 20, 4); ctx.fill(); ctx.stroke();
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.restore();
}

export function drawScaleBar(ctx, zoom, rightX, bottomY) {
  const target = 110 / zoom; // cm
  const step = niceStepCm(target);
  const px = step * zoom;
  ctx.save();
  ctx.strokeStyle = '#374151'; ctx.fillStyle = '#374151'; ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(rightX - px, bottomY); ctx.lineTo(rightX, bottomY);
  ctx.moveTo(rightX - px, bottomY - 5); ctx.lineTo(rightX - px, bottomY + 1);
  ctx.moveTo(rightX, bottomY - 5); ctx.lineTo(rightX, bottomY + 1);
  ctx.stroke();
  ctx.font = '11px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  ctx.fillText(fmt(step, { withUnit: true }), rightX - px / 2, bottomY - 4);
  ctx.restore();
}

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
