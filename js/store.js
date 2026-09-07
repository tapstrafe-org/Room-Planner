import { aabb, unionBox, rotatePoint, normDeg } from './geometry.js';
import { demoPlan } from './catalog.js';

const PLAN_KEY = 'roomplanner.plan.v1';
const LIB_KEY = 'roomplanner.library.v1';
const PREFS_KEY = 'roomplanner.prefs.v1';
const HISTORY_LIMIT = 150;

let idCounter = 0;
export function uid(prefix = 'o') {
  idCounter++;
  return `${prefix}${Date.now().toString(36)}${idCounter.toString(36)}`;
}

export function defaultRoom() {
  return { width: 500, length: 400, height: 260, wallThickness: 15, floorColor: '#e7dcc8', wallColor: '#d1d5db' };
}

export function normalizeObject(o) {
  return {
    id: o.id || uid(),
    name: o.name || 'Object',
    x: +o.x || 0, y: +o.y || 0,
    w: Math.max(0.1, +o.w || 10), d: Math.max(0.1, +o.d || 10), h: Math.max(0, +o.h || 0),
    z: +o.z || 0,
    rot: normDeg(+o.rot || 0),
    color: o.color || '#a78bfa',
    shape: ['rect', 'round', 'ellipse', 'door'].includes(o.shape) ? o.shape : 'rect',
    locked: !!o.locked,
    group: o.group || null,
    showLabel: o.showLabel !== false,
    mirror: !!o.mirror,
  };
}

export function normalizePlan(p) {
  const plan = {
    version: 1,
    name: p?.name || 'Untitled plan',
    room: { ...defaultRoom(), ...(p?.room || {}) },
    objects: Array.isArray(p?.objects) ? p.objects.map(normalizeObject) : [],
    groups: p?.groups && typeof p.groups === 'object' ? { ...p.groups } : {},
  };
  // make sure every referenced group exists
  for (const o of plan.objects) if (o.group && !plan.groups[o.group]) plan.groups[o.group] = { name: 'Group' };
  return plan;
}

export class Store extends EventTarget {
  constructor() {
    super();
    this.state = normalizePlan(demoPlan());
    this.selection = new Set();
    this.history = [];
    this.future = [];
    this.clipboard = null;
    this.library = [];
    this.prefs = { units: 'cm', snapGrid: true, snapObjects: true, showLabels: true, showDims: false, gridSize: 10, view: '2d' };
    this._saveTimer = null;
    this._dragSnapshot = null;
  }

  /* ---------- events ---------- */
  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  on(type, fn) { this.addEventListener(type, (e) => fn(e.detail)); }

  changed(kind = 'objects') {
    this.emit('change', { kind });
    this.scheduleSave();
  }

  /* ---------- persistence ---------- */
  loadFromStorage() {
    try {
      const raw = localStorage.getItem(PLAN_KEY);
      if (raw) this.state = normalizePlan(JSON.parse(raw));
    } catch (e) { console.warn('Could not load saved plan', e); }
    try {
      const lib = localStorage.getItem(LIB_KEY);
      if (lib) this.library = JSON.parse(lib);
    } catch (e) { console.warn('Could not load library', e); }
    try {
      const prefs = localStorage.getItem(PREFS_KEY);
      if (prefs) this.prefs = { ...this.prefs, ...JSON.parse(prefs) };
    } catch (e) { /* ignore */ }
  }

  scheduleSave() {
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this.saveNow(), 400);
  }

  saveNow() {
    try {
      localStorage.setItem(PLAN_KEY, JSON.stringify(this.state));
      localStorage.setItem(PREFS_KEY, JSON.stringify(this.prefs));
    } catch (e) { /* storage full or disabled */ }
  }

  setPref(key, value) {
    this.prefs[key] = value;
    this.emit('prefs', { key, value });
    this.scheduleSave();
  }

  /* ---------- history ---------- */
  serialize() { return JSON.stringify(this.state); }

  pushHistory() {
    this.history.push(this.serialize());
    if (this.history.length > HISTORY_LIMIT) this.history.shift();
    this.future = [];
    this.emit('history');
  }

  /** Call before an interactive drag; commitDrag() records one history step if anything changed. */
  beginDrag() { this._dragSnapshot = this.serialize(); }
  cancelDrag() {
    if (this._dragSnapshot) { this.state = normalizePlan(JSON.parse(this._dragSnapshot)); this._dragSnapshot = null; this.changed(); }
  }
  commitDrag() {
    if (!this._dragSnapshot) return;
    const now = this.serialize();
    if (now !== this._dragSnapshot) {
      this.history.push(this._dragSnapshot);
      if (this.history.length > HISTORY_LIMIT) this.history.shift();
      this.future = [];
      this.emit('history');
    }
    this._dragSnapshot = null;
    this.changed();
  }

  undo() {
    if (!this.history.length) return false;
    this.future.push(this.serialize());
    this.state = normalizePlan(JSON.parse(this.history.pop()));
    this.pruneSelection();
    this.emit('history');
    this.changed('all');
    return true;
  }

  redo() {
    if (!this.future.length) return false;
    this.history.push(this.serialize());
    this.state = normalizePlan(JSON.parse(this.future.pop()));
    this.pruneSelection();
    this.emit('history');
    this.changed('all');
    return true;
  }

  /** Run a mutation with a history step. */
  mutate(fn, kind = 'objects') {
    this.pushHistory();
    fn(this.state);
    this.changed(kind);
  }

  /* ---------- plan-level ---------- */
  newPlan(room) {
    this.pushHistory();
    this.state = normalizePlan({ name: 'Untitled plan', room: room || defaultRoom(), objects: [], groups: {} });
    this.selection.clear();
    this.emit('selection');
    this.changed('all');
  }

  loadPlan(obj) {
    this.pushHistory();
    this.state = normalizePlan(obj);
    this.selection.clear();
    this.emit('selection');
    this.changed('all');
  }

  setRoom(patch) {
    this.mutate((s) => { Object.assign(s.room, patch); }, 'room');
  }

  setName(name) { this.state.name = name; this.changed('meta'); }

  /* ---------- lookup ---------- */
  get objects() { return this.state.objects; }
  get room() { return this.state.room; }
  getObj(id) { return this.state.objects.find((o) => o.id === id); }
  selectedObjects() { return this.state.objects.filter((o) => this.selection.has(o.id)); }
  selectedIds() { return [...this.selection]; }

  /** Members of the same groups as the given ids (group selection semantics). */
  expandGroups(ids) {
    const out = new Set(ids);
    const groups = new Set();
    for (const id of ids) { const o = this.getObj(id); if (o?.group) groups.add(o.group); }
    for (const o of this.state.objects) if (o.group && groups.has(o.group)) out.add(o.id);
    return [...out];
  }

  groupMembers(gid) { return this.state.objects.filter((o) => o.group === gid); }

  selectionBox() {
    const objs = this.selectedObjects();
    if (!objs.length) return null;
    return unionBox(objs.map(aabb));
  }

  /* ---------- selection ---------- */
  select(ids, { add = false, toggle = false, expand = true } = {}) {
    let list = Array.isArray(ids) ? ids : ids ? [ids] : [];
    if (expand) list = this.expandGroups(list);
    if (toggle) {
      for (const id of list) this.selection.has(id) ? this.selection.delete(id) : this.selection.add(id);
    } else {
      if (!add) this.selection.clear();
      for (const id of list) this.selection.add(id);
    }
    this.emit('selection');
  }

  clearSelection() { if (this.selection.size) { this.selection.clear(); this.emit('selection'); } }
  selectAll() { this.selection = new Set(this.state.objects.filter((o) => !o.locked).map((o) => o.id)); this.emit('selection'); }
  pruneSelection() {
    const ids = new Set(this.state.objects.map((o) => o.id));
    for (const id of [...this.selection]) if (!ids.has(id)) this.selection.delete(id);
    this.emit('selection');
  }

  /* ---------- object CRUD ---------- */
  /** Add a preset (single or multi-part) centred at x,y. Returns the new ids. */
  addPreset(preset, x, y, { select = true } = {}) {
    const ids = [];
    this.pushHistory();
    if (preset.parts && preset.parts.length) {
      const gid = preset.parts.length > 1 ? uid('g') : null;
      if (gid) this.state.groups[gid] = { name: preset.name };
      for (const p of preset.parts) {
        const o = normalizeObject({ ...p, id: undefined, x: x + p.dx, y: y + p.dy, group: gid, name: p.name || preset.name });
        this.state.objects.push(o);
        ids.push(o.id);
      }
    } else {
      const o = normalizeObject({ ...preset, id: undefined, x, y, group: null });
      this.state.objects.push(o);
      ids.push(o.id);
    }
    if (select) this.select(ids, { expand: false });
    this.changed();
    return ids;
  }

  updateObjects(ids, patch, { history = true } = {}) {
    const apply = (s) => {
      for (const o of s.objects) if (ids.includes(o.id)) {
        Object.assign(o, patch);
        if ('rot' in patch) o.rot = normDeg(o.rot);
        if ('w' in patch) o.w = Math.max(0.1, o.w);
        if ('d' in patch) o.d = Math.max(0.1, o.d);
        if ('h' in patch) o.h = Math.max(0, o.h);
      }
    };
    if (history) this.mutate(apply); else { apply(this.state); this.changed(); }
  }

  deleteObjects(ids) {
    if (!ids.length) return;
    this.mutate((s) => {
      s.objects = s.objects.filter((o) => !ids.includes(o.id));
      this.cleanGroups(s);
    });
    this.pruneSelection();
  }

  cleanGroups(s) {
    const used = new Set(s.objects.map((o) => o.group).filter(Boolean));
    for (const gid of Object.keys(s.groups)) if (!used.has(gid)) delete s.groups[gid];
    // groups with a single member are dissolved
    const counts = {};
    for (const o of s.objects) if (o.group) counts[o.group] = (counts[o.group] || 0) + 1;
    for (const o of s.objects) if (o.group && counts[o.group] < 2) { delete s.groups[o.group]; o.group = null; }
  }

  duplicateObjects(ids, offset = 20) {
    const objs = this.state.objects.filter((o) => ids.includes(o.id));
    if (!objs.length) return [];
    const newIds = this.cloneInto(objs, offset, offset);
    this.select(newIds, { expand: false });
    return newIds;
  }

  /** Clone objects keeping group structure (new group ids). */
  cloneInto(objs, dx, dy) {
    const groupMap = {};
    const newIds = [];
    this.pushHistory();
    for (const o of objs) {
      let g = null;
      if (o.group) {
        if (!groupMap[o.group]) { groupMap[o.group] = uid('g'); this.state.groups[groupMap[o.group]] = { ...(this.state.groups[o.group] || { name: 'Group' }) }; }
        g = groupMap[o.group];
      }
      const c = normalizeObject({ ...o, id: undefined, x: o.x + dx, y: o.y + dy, group: g });
      this.state.objects.push(c);
      newIds.push(c.id);
    }
    this.cleanGroups(this.state);
    this.changed();
    return newIds;
  }

  copy() {
    const objs = this.selectedObjects();
    if (!objs.length) return false;
    this.clipboard = JSON.parse(JSON.stringify(objs));
    return true;
  }

  paste(at) {
    if (!this.clipboard?.length) return [];
    let dx = 20, dy = 20;
    if (at) {
      const box = unionBox(this.clipboard.map(aabb));
      dx = at.x - box.cx; dy = at.y - box.cy;
    }
    const ids = this.cloneInto(this.clipboard, dx, dy);
    this.select(ids, { expand: false });
    return ids;
  }

  /* ---------- groups ---------- */
  groupSelected(name) {
    const ids = this.selectedIds();
    if (ids.length < 2) return null;
    const gid = uid('g');
    this.mutate((s) => {
      s.groups[gid] = { name: name || 'Group' };
      for (const o of s.objects) if (ids.includes(o.id)) o.group = gid;
      this.cleanGroups(s);
    });
    return gid;
  }

  ungroupSelected() {
    const ids = this.selectedIds();
    this.mutate((s) => {
      for (const o of s.objects) if (ids.includes(o.id)) o.group = null;
      this.cleanGroups(s);
    });
  }

  renameGroup(gid, name) { this.mutate((s) => { if (s.groups[gid]) s.groups[gid].name = name; }, 'meta'); }

  /* ---------- transforms ---------- */
  /** Rotate objects by deg around the centre of their combined bounding box. */
  rotateObjects(ids, deg, { history = true } = {}) {
    const objs = this.state.objects.filter((o) => ids.includes(o.id) && !o.locked);
    if (!objs.length) return;
    const box = unionBox(objs.map(aabb));
    const apply = () => {
      for (const o of objs) {
        if (objs.length > 1) {
          const p = rotatePoint(o.x, o.y, box.cx, box.cy, deg);
          o.x = p.x; o.y = p.y;
        }
        o.rot = normDeg(o.rot + deg);
      }
    };
    if (history) this.mutate(apply); else { apply(); this.changed(); }
  }

  /** Mirror objects across the vertical (axis='x') or horizontal (axis='y') centre line of the selection. */
  flipObjects(ids, axis) {
    const objs = this.state.objects.filter((o) => ids.includes(o.id) && !o.locked);
    if (!objs.length) return;
    const box = unionBox(objs.map(aabb));
    this.mutate(() => {
      for (const o of objs) {
        if (axis === 'x') { o.x = 2 * box.cx - o.x; o.rot = normDeg(-o.rot); }
        else { o.y = 2 * box.cy - o.y; o.rot = normDeg(180 - o.rot); }
        o.mirror = !o.mirror;
      }
    });
  }

  /** Swap width and depth (transpose footprint). */
  transposeObjects(ids) {
    this.mutate((s) => {
      for (const o of s.objects) if (ids.includes(o.id) && !o.locked) { const t = o.w; o.w = o.d; o.d = t; }
    });
  }

  nudge(ids, dx, dy) {
    const objs = this.state.objects.filter((o) => ids.includes(o.id) && !o.locked);
    if (!objs.length) return;
    this.mutate(() => { for (const o of objs) { o.x += dx; o.y += dy; } });
  }

  align(ids, mode) {
    const objs = this.state.objects.filter((o) => ids.includes(o.id) && !o.locked);
    if (objs.length < 2 && !['room-center-x', 'room-center-y'].includes(mode)) return;
    const boxes = objs.map((o) => ({ o, b: aabb(o) }));
    const box = unionBox(boxes.map((x) => x.b));
    const room = this.state.room;
    this.mutate(() => {
      for (const { o, b } of boxes) {
        switch (mode) {
          case 'left': o.x += box.minX - b.minX; break;
          case 'right': o.x += box.maxX - b.maxX; break;
          case 'top': o.y += box.minY - b.minY; break;
          case 'bottom': o.y += box.maxY - b.maxY; break;
          case 'center-x': o.x += box.cx - b.cx; break;
          case 'center-y': o.y += box.cy - b.cy; break;
          case 'room-center-x': o.x += room.width / 2 - box.cx; break;
          case 'room-center-y': o.y += room.length / 2 - box.cy; break;
        }
      }
    });
  }

  distribute(ids, axis) {
    const objs = this.state.objects.filter((o) => ids.includes(o.id) && !o.locked);
    if (objs.length < 3) return;
    const items = objs.map((o) => ({ o, b: aabb(o) })).sort((a, b) => (axis === 'x' ? a.b.cx - b.b.cx : a.b.cy - b.b.cy));
    const first = items[0].b, last = items[items.length - 1].b;
    const total = axis === 'x' ? last.maxX - first.minX : last.maxY - first.minY;
    const sizes = items.reduce((s, it) => s + (axis === 'x' ? it.b.w : it.b.h), 0);
    const gap = (total - sizes) / (items.length - 1);
    this.mutate(() => {
      let cursor = axis === 'x' ? first.minX : first.minY;
      for (const { o, b } of items) {
        if (axis === 'x') { o.x += cursor - b.minX; cursor += b.w + gap; }
        else { o.y += cursor - b.minY; cursor += b.h + gap; }
      }
    });
  }

  /* ---------- z-order ---------- */
  reorder(ids, mode) {
    this.mutate((s) => {
      const sel = s.objects.filter((o) => ids.includes(o.id));
      const rest = s.objects.filter((o) => !ids.includes(o.id));
      if (mode === 'front') s.objects = [...rest, ...sel];
      else if (mode === 'back') s.objects = [...sel, ...rest];
      else if (mode === 'forward' || mode === 'backward') {
        const arr = s.objects.slice();
        const idxs = arr.map((o, i) => (ids.includes(o.id) ? i : -1)).filter((i) => i >= 0);
        if (mode === 'forward') {
          for (let k = idxs.length - 1; k >= 0; k--) {
            const i = idxs[k];
            if (i + 1 < arr.length && !ids.includes(arr[i + 1].id)) [arr[i], arr[i + 1]] = [arr[i + 1], arr[i]];
          }
        } else {
          for (const i of idxs) {
            if (i - 1 >= 0 && !ids.includes(arr[i - 1].id)) [arr[i], arr[i - 1]] = [arr[i - 1], arr[i]];
          }
        }
        s.objects = arr;
      }
    });
  }

  /** Move `id` so that it sits directly above `afterId` in stacking order (null = send to back). */
  moveInOrder(id, afterId) {
    this.mutate((s) => {
      const from = s.objects.findIndex((o) => o.id === id);
      if (from < 0) return;
      const [item] = s.objects.splice(from, 1);
      const idx = afterId ? s.objects.findIndex((o) => o.id === afterId) : -1;
      s.objects.splice(idx + 1, 0, item);
    });
  }

  /* ---------- custom library ---------- */
  saveLibrary() {
    try { localStorage.setItem(LIB_KEY, JSON.stringify(this.library)); } catch (e) { /* ignore */ }
    this.emit('library');
  }

  addLibraryItem(item) {
    const entry = { ...item, id: uid('c'), cat: 'Custom' };
    this.library.push(entry);
    this.saveLibrary();
    return entry;
  }

  removeLibraryItem(id) {
    this.library = this.library.filter((i) => i.id !== id);
    this.saveLibrary();
  }

  /** Build a library preset from the current selection (single object or multi-part). */
  presetFromObjects(objs, name) {
    if (!objs.length) return null;
    const box = unionBox(objs.map(aabb));
    const h = Math.max(...objs.map((o) => o.z + o.h));
    if (objs.length === 1) {
      const o = objs[0];
      return { name: name || o.name, w: o.w, d: o.d, h: o.h, z: o.z, color: o.color, shape: o.shape };
    }
    return {
      name: name || 'Custom group', w: box.w, d: box.h, h, color: objs[0].color, shape: 'rect',
      parts: objs.map((o) => ({ name: o.name, dx: o.x - box.cx, dy: o.y - box.cy, w: o.w, d: o.d, h: o.h, z: o.z, rot: o.rot, color: o.color, shape: o.shape, mirror: o.mirror })),
    };
  }
}
