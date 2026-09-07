import { PRESETS, CATEGORIES, PALETTE } from './catalog.js';
import { fmt, fmtInput, parseInput, unitLabel, getUnit, fromDisplay } from './units.js';
import { aabb, unionBox } from './geometry.js';

const $ = (sel, root = document) => root.querySelector(sel);
const el = (tag, attrs = {}, ...children) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'style') e.style.cssText = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'html') e.innerHTML = v;
    else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null) e.append(c.nodeType ? c : document.createTextNode(String(c)));
  return e;
};

export class UI {
  constructor(store, editor) {
    this.store = store;
    this.editor = editor;
    this.propsSig = null;
    this.libSearch = '';
    this.toastEl = el('div', { class: 'toast' });
    document.body.appendChild(this.toastEl);

    store.on('library', () => this.renderCustomList());
    store.on('selection', () => { this.syncProps(); this.renderOutline(); this.updateStatus(); });
    store.on('change', (d) => { this.syncProps(d?.kind === 'all'); this.renderOutline(); this.updateStatus(); });
    store.on('history', () => this.updateHistoryButtons());

    this.initPanelTabs();
    this.initLibrary();
    this.initCustom();
    this.initOutline();
    this.renderLibrary();
    this.renderCustomList();
    this.renderOutline();
    this.syncProps(true);
    this.updateStatus();
    this.updateHistoryButtons();
  }

  /* ---------- small helpers ---------- */
  toast(msg, ms = 2200) {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add('show');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => this.toastEl.classList.remove('show'), ms);
  }

  tooltip(container, tipEl, html, x, y) {
    if (!html) { tipEl.hidden = true; return; }
    tipEl.innerHTML = html;
    tipEl.hidden = false;
    const cw = container.clientWidth, ch = container.clientHeight;
    const tw = tipEl.offsetWidth, th = tipEl.offsetHeight;
    let left = x + 14, top = y + 16;
    if (left + tw > cw - 4) left = x - tw - 10;
    if (top + th > ch - 4) top = y - th - 10;
    tipEl.style.left = Math.max(2, left) + 'px';
    tipEl.style.top = Math.max(2, top) + 'px';
  }

  addPresetAtCenter(preset) {
    const c = this.editor.viewCenterWorld();
    const g = this.store.prefs.gridSize || 10;
    const x = Math.round(c.x / g) * g, y = Math.round(c.y / g) * g;
    this.store.addPreset(preset, x, y);
    this.toast(`Added ${preset.name}`);
  }

  /* ---------- panel tabs ---------- */
  initPanelTabs() {
    for (const b of document.querySelectorAll('.ptab')) {
      b.addEventListener('click', () => {
        document.querySelectorAll('.ptab').forEach((x) => x.classList.toggle('active', x === b));
        document.querySelectorAll('.ptab-page').forEach((p) => p.classList.toggle('active', p.dataset.page === b.dataset.ptab));
      });
    }
  }

  /* ---------- library ---------- */
  initLibrary() {
    $('#lib-search').addEventListener('input', (e) => { this.libSearch = e.target.value.trim().toLowerCase(); this.renderLibrary(); });
  }

  libItem(preset, { onDelete } = {}) {
    const sw = el('span', { class: 'sw' + (preset.shape === 'ellipse' ? ' ellipse' : ''), style: `background:${preset.color}` });
    const item = el('div', { class: 'item', draggable: 'true', title: `${preset.name}\n${fmt(preset.w)} × ${fmt(preset.d)} × ${fmt(preset.h)} ${unitLabel()}${preset.parts ? `\n${preset.parts.length} parts` : ''}\nClick to add · drag onto canvas` },
      sw,
      el('span', { class: 'nm' }, preset.name + (preset.parts ? ` (${preset.parts.length})` : '')),
      el('span', { class: 'dm' }, `${fmt(preset.w)}×${fmt(preset.d)}×${fmt(preset.h)}`),
      onDelete ? el('button', { class: 'del', title: 'Remove from library', onclick: (e) => { e.stopPropagation(); onDelete(); } }, '✕') : null,
    );
    item.addEventListener('click', () => this.addPresetAtCenter(preset));
    item.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('application/x-roomplanner-preset', JSON.stringify(preset));
      e.dataTransfer.effectAllowed = 'copy';
    });
    return item;
  }

  renderLibrary() {
    const list = $('#lib-list');
    list.innerHTML = '';
    const q = this.libSearch;
    const all = [...PRESETS, ...this.store.library];
    const cats = [...CATEGORIES, 'Custom'];
    let shown = 0;
    for (const cat of cats) {
      const items = all.filter((p) => (p.cat || 'Custom') === cat && (!q || p.name.toLowerCase().includes(q) || cat.toLowerCase().includes(q)));
      if (!items.length) continue;
      list.append(el('div', { class: 'lib-cat' }, cat));
      for (const p of items) { list.append(this.libItem(p)); shown++; }
    }
    if (!shown) list.append(el('div', { class: 'empty' }, 'No matching objects. Create one in the Custom tab.'));
  }

  /* ---------- custom ---------- */
  initCustom() {
    const form = $('#custom-form');
    const readForm = () => {
      const fd = new FormData(form);
      const w = parseInput(fd.get('w')), d = parseInput(fd.get('d')), h = parseInput(fd.get('h'));
      if (!(w > 0) || !(d > 0) || !(h >= 0)) { this.toast('Please enter valid dimensions'); return null; }
      return { name: fd.get('name').trim() || 'Custom object', w, d, h, shape: fd.get('shape'), color: fd.get('color'), z: 0 };
    };
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const p = readForm();
      if (!p) return;
      this.store.addLibraryItem(p);
      this.renderLibrary();
      this.toast(`Saved "${p.name}" to your library`);
      form.reset();
      this.updateCustomUnits();
    });
    $('#custom-add-only').addEventListener('click', () => {
      const p = readForm();
      if (p) this.addPresetAtCenter(p);
    });
    $('#custom-export').addEventListener('click', () => {
      const data = JSON.stringify({ app: 'room-planner-library', items: this.store.library }, null, 2);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
      a.download = 'room-planner-library.json';
      a.click();
    });
    $('#custom-import').addEventListener('click', () => $('#lib-file-input').click());
    $('#lib-file-input').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        const items = Array.isArray(data) ? data : data.items;
        if (!Array.isArray(items)) throw new Error('bad file');
        let n = 0;
        for (const it of items) if (it && it.name && it.w > 0 && it.d > 0) { this.store.addLibraryItem({ ...it, id: undefined }); n++; }
        this.renderLibrary();
        this.toast(`Imported ${n} custom object${n === 1 ? '' : 's'}`);
      } catch (err) { this.toast('Could not read that library file'); }
    });
    this.updateCustomUnits();
  }

  updateCustomUnits() {
    const form = $('#custom-form');
    for (const name of ['w', 'd', 'h']) form.elements[name].placeholder = unitLabel();
  }

  renderCustomList() {
    const list = $('#custom-list');
    list.innerHTML = '';
    if (!this.store.library.length) { list.append(el('div', { class: 'empty' }, 'No custom objects yet.')); return; }
    for (const p of this.store.library) {
      list.append(this.libItem(p, { onDelete: () => { if (confirm(`Remove "${p.name}" from your library?`)) { this.store.removeLibraryItem(p.id); this.renderLibrary(); } } }));
    }
  }

  /* ---------- outline ---------- */
  initOutline() { this._dragId = null; }

  renderOutline() {
    const list = $('#outline-list');
    list.innerHTML = '';
    const objs = this.store.objects.slice().reverse();
    if (!objs.length) { list.append(el('div', { class: 'empty hint' }, 'No objects in the plan yet.')); return; }
    for (const o of objs) {
      const row = el('div', { class: 'o-item' + (this.store.selection.has(o.id) ? ' sel' : ''), draggable: 'true', 'data-id': o.id },
        el('span', { class: 'sw', style: `background:${o.color}` }),
        el('span', { class: 'nm', title: o.name }, o.name),
        o.group ? el('span', { class: 'grp', title: 'Group' }, this.store.state.groups[o.group]?.name || 'Group') : null,
        o.locked ? el('span', { title: 'Locked' }, '🔒') : null,
        el('span', { class: 'dm mono', style: 'color:#6b7280;font-size:11px' }, `${fmt(o.w)}×${fmt(o.d)}`),
      );
      row.addEventListener('click', (e) => this.store.select([o.id], { toggle: e.shiftKey, expand: !e.altKey }));
      row.addEventListener('dblclick', () => this.focusName());
      row.addEventListener('dragstart', (e) => { this._dragId = o.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', o.id); });
      row.addEventListener('dragover', (e) => { if (this._dragId) { e.preventDefault(); row.classList.add('dragover'); } });
      row.addEventListener('dragleave', () => row.classList.remove('dragover'));
      row.addEventListener('drop', (e) => {
        e.preventDefault(); row.classList.remove('dragover');
        if (this._dragId && this._dragId !== o.id) this.store.moveInOrder(this._dragId, o.id); // place directly above o
        this._dragId = null;
      });
      list.append(row);
    }
  }

  /* ---------- status ---------- */
  updateStatus() {
    const sel = this.store.selectedObjects();
    let s = 'Nothing selected';
    if (sel.length === 1) s = `${sel[0].name}: ${fmt(sel[0].w)} × ${fmt(sel[0].d)} × ${fmt(sel[0].h)} ${unitLabel()}`;
    else if (sel.length > 1) { const b = unionBox(sel.map(aabb)); s = `${sel.length} objects · ${fmt(b.w)} × ${fmt(b.h)} ${unitLabel()}`; }
    $('#status-sel').textContent = s;
    const r = this.store.room;
    const areaM2 = (r.width * r.length) / 10000;
    const area = getUnit() === 'ft' || getUnit() === 'in' ? `${(areaM2 * 10.7639).toFixed(1)} ft²` : `${areaM2.toFixed(2)} m²`;
    $('#status-room').textContent = `Room ${fmt(r.width)} × ${fmt(r.length)} ${unitLabel()} · ${area} · ${this.store.objects.length} objects`;
  }

  updateHistoryButtons() {
    $('#btn-undo').disabled = !this.store.history.length;
    $('#btn-redo').disabled = !this.store.future.length;
  }

  /* ---------- properties ---------- */
  focusName() {
    const inp = $('#props input[data-field="name"]');
    if (inp) { inp.focus(); inp.select(); }
  }

  syncProps(force = false) {
    const ids = this.store.selectedIds().sort();
    const sig = ids.length ? ids.join(',') : 'room';
    const root = $('#props');
    if (force || sig !== this.propsSig || !root.childElementCount) {
      this.propsSig = sig;
      root.innerHTML = '';
      root.append(ids.length ? this.buildObjectProps() : this.buildRoomProps());
      return;
    }
    // patch values of inputs that are not being edited
    const objs = this.store.selectedObjects();
    for (const inp of root.querySelectorAll('[data-field]')) {
      if (inp === document.activeElement) continue;
      const f = inp.dataset.field;
      const v = ids.length ? this.commonValue(objs, f) : this.store.room[f];
      this.setInputValue(inp, v);
    }
    const readout = root.querySelector('.dims-readout');
    if (readout && ids.length) readout.innerHTML = this.readoutHtml(objs);
  }

  commonValue(objs, field) {
    if (!objs.length) return undefined;
    const v = objs[0][field];
    return objs.every((o) => o[field] === v) ? v : undefined;
  }

  setInputValue(inp, v) {
    const kind = inp.dataset.kind;
    if (inp.type === 'checkbox') { inp.checked = !!v; inp.indeterminate = v === undefined; return; }
    if (v === undefined) {
      if (inp.type === 'color') return; // keep the previous colour rather than an invalid empty value
      if (inp.tagName === 'SELECT') { inp.value = ''; return; }
      inp.value = ''; inp.placeholder = 'mixed'; return;
    }
    inp.placeholder = '';
    if (kind === 'len') inp.value = fmtInput(v);
    else if (kind === 'deg') inp.value = String(Math.round(v * 100) / 100);
    else inp.value = v;
  }

  /** A labelled input bound to a field of the selection or the room. */
  field(label, fieldName, kind, current, onCommit, extra = {}) {
    const isLen = kind === 'len';
    const inp = el('input', { type: kind === 'color' ? 'color' : 'text', 'data-field': fieldName, 'data-kind': kind, inputmode: isLen || kind === 'deg' ? 'decimal' : null, ...extra });
    this.setInputValue(inp, current);
    const commit = () => {
      let v;
      if (kind === 'len') { v = parseInput(inp.value); if (!isFinite(v)) { this.setInputValue(inp, current); return; } }
      else if (kind === 'deg') { v = parseFloat(inp.value); if (!isFinite(v)) { this.setInputValue(inp, current); return; } }
      else v = inp.value;
      onCommit(v);
    };
    inp.addEventListener('change', commit);
    if (kind !== 'color') inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { commit(); inp.blur(); }
      if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && (kind === 'len' || kind === 'deg')) {
        e.preventDefault();
        const cur = kind === 'len' ? parseInput(inp.value) : parseFloat(inp.value);
        if (!isFinite(cur)) return;
        const sign = e.key === 'ArrowUp' ? 1 : -1;
        const step = (e.shiftKey ? 10 : 1) * (kind === 'len' ? fromDisplay(1) : 1); // one display unit / one degree
        const next = cur + sign * step;
        inp.value = kind === 'len' ? fmtInput(next) : String(Math.round(next * 100) / 100);
        commit();
      }
    });
    const wrap = el('label', { class: isLen ? 'unit' : '', 'data-unit': isLen ? unitLabel() : null }, label, inp);
    return wrap;
  }

  buildRoomProps() {
    const st = this.store;
    const room = st.room;
    const set = (patch) => st.setRoom(patch);
    const grid = el('div', { class: 'form-grid' },
      this.field('Width', 'width', 'len', room.width, (v) => set({ width: Math.max(10, v) })),
      this.field('Length', 'length', 'len', room.length, (v) => set({ length: Math.max(10, v) })),
      this.field('Ceiling height', 'height', 'len', room.height, (v) => set({ height: Math.max(10, v) })),
      this.field('Wall thickness', 'wallThickness', 'len', room.wallThickness, (v) => set({ wallThickness: Math.max(0, v) })),
      this.field('Floor colour', 'floorColor', 'color', room.floorColor, (v) => set({ floorColor: v })),
      this.field('Wall colour', 'wallColor', 'color', room.wallColor, (v) => set({ wallColor: v })),
    );
    const gridSize = el('label', { class: 'unit', 'data-unit': unitLabel() }, 'Grid step',
      (() => {
        const i = el('input', { type: 'text', inputmode: 'decimal', value: fmtInput(st.prefs.gridSize) });
        i.addEventListener('change', () => { const v = parseInput(i.value); if (v > 0) st.setPref('gridSize', v); else i.value = fmtInput(st.prefs.gridSize); });
        return i;
      })());
    const presets = el('div', { class: 'row', style: 'margin-top:8px' },
      el('span', { class: 'hint' }, 'Quick sizes:'),
      ...[[300, 300], [400, 350], [500, 400], [600, 450], [800, 600]].map(([w, l]) => el('button', { class: 'small', onclick: () => set({ width: w, length: l }) }, `${fmt(w)}×${fmt(l)}`)),
    );
    const areaM2 = (room.width * room.length) / 10000;
    return el('div', {},
      el('div', { class: 'props-title' }, 'Room', el('span', { class: 'badge' }, 'nothing selected')),
      el('div', { class: 'dims-readout' }, `Floor area: ${areaM2.toFixed(2)} m² (${(areaM2 * 10.7639).toFixed(1)} ft²)`, el('br'), `Perimeter: ${fmt(2 * (room.width + room.length), { withUnit: true })}`),
      grid,
      el('div', { class: 'section' }, el('h3', {}, 'Grid'), el('div', { class: 'form-grid' }, gridSize)),
      presets,
      el('div', { class: 'section hint' }, 'Select an object to edit its size, height, colour and rotation. Click an item in the Library to add it to the plan.'),
    );
  }

  readoutHtml(objs) {
    if (objs.length === 1) {
      const o = objs[0];
      const area = (o.w * o.d) / 10000;
      return `W ${fmt(o.w)} × D ${fmt(o.d)} × H ${fmt(o.h)} ${unitLabel()}<br>footprint ${area.toFixed(2)} m² · top at ${fmt(o.z + o.h, { withUnit: true })}${o.rot ? ` · ${o.rot}°` : ''}`;
    }
    const b = unionBox(objs.map(aabb));
    const maxTop = Math.max(...objs.map((o) => o.z + o.h));
    return `${objs.length} objects · bounds ${fmt(b.w)} × ${fmt(b.h)} ${unitLabel()}<br>tallest point ${fmt(maxTop, { withUnit: true })}`;
  }

  buildObjectProps() {
    const st = this.store;
    const objs = st.selectedObjects();
    const ids = objs.map((o) => o.id);
    const single = objs.length === 1 ? objs[0] : null;
    const upd = (patch) => st.updateObjects(ids, patch);
    const cv = (f) => this.commonValue(objs, f);
    const groups = [...new Set(objs.map((o) => o.group).filter(Boolean))];
    const allLocked = objs.every((o) => o.locked);

    // title
    const title = el('div', { class: 'props-title' });
    if (single) {
      const nameInp = el('input', { type: 'text', 'data-field': 'name', value: single.name, style: 'font-weight:600' });
      nameInp.addEventListener('change', () => upd({ name: nameInp.value.trim() || 'Object' }));
      nameInp.addEventListener('keydown', (e) => { if (e.key === 'Enter') nameInp.blur(); });
      title.append(nameInp);
    } else {
      title.append(`${objs.length} objects`);
    }

    // group row
    let groupRow = null;
    if (groups.length === 1 && objs.every((o) => o.group === groups[0])) {
      const gname = el('input', { type: 'text', value: st.state.groups[groups[0]]?.name || 'Group', title: 'Group name' });
      gname.addEventListener('change', () => st.renameGroup(groups[0], gname.value.trim() || 'Group'));
      groupRow = el('div', { class: 'row', style: 'margin-bottom:8px' }, el('span', { class: 'hint' }, 'Group:'), el('span', { class: 'grow' }, gname));
    }

    const dims = el('div', { class: 'form-grid' },
      this.field('Width', 'w', 'len', cv('w'), (v) => upd({ w: v })),
      this.field('Depth', 'd', 'len', cv('d'), (v) => upd({ d: v })),
      this.field('Height', 'h', 'len', cv('h'), (v) => upd({ h: v })),
      this.field('Elevation', 'z', 'len', cv('z'), (v) => upd({ z: v })),
      this.field('Centre X', 'x', 'len', cv('x'), (v) => this.moveTo('x', v)),
      this.field('Centre Y', 'y', 'len', cv('y'), (v) => this.moveTo('y', v)),
      this.field('Rotation °', 'rot', 'deg', cv('rot'), (v) => upd({ rot: v })),
      (() => {
        const sel = el('select', { 'data-field': 'shape' },
          ...[['rect', 'Rectangle'], ['round', 'Rounded'], ['ellipse', 'Ellipse / round'], ['door', 'Door (swing)']].map(([v, l]) => el('option', { value: v }, l)),
          cv('shape') === undefined ? el('option', { value: '', disabled: true }, 'mixed') : null);
        sel.value = cv('shape') ?? '';
        sel.addEventListener('change', () => upd({ shape: sel.value }));
        return el('label', {}, 'Shape', sel);
      })(),
    );

    // colour
    const colorInp = el('input', { type: 'color', 'data-field': 'color', value: cv('color') || objs[0].color });
    colorInp.addEventListener('input', () => upd({ color: colorInp.value }));
    const swatches = el('div', { class: 'swatches' }, ...PALETTE.map((c) => el('button', { class: c === cv('color') ? 'cur' : '', style: `background:${c}`, title: c, onclick: () => upd({ color: c }) })));
    const colorGrid = el('div', { class: 'form-grid' }, el('label', { class: 'span2' }, 'Colour', colorInp), swatches);

    // toggles
    const lbl = el('input', { type: 'checkbox', 'data-field': 'showLabel' }); this.setInputValue(lbl, cv('showLabel'));
    lbl.addEventListener('change', () => upd({ showLabel: lbl.checked }));
    const lock = el('input', { type: 'checkbox', 'data-field': 'locked' }); this.setInputValue(lock, cv('locked'));
    lock.addEventListener('change', () => upd({ locked: lock.checked }));
    const toggles = el('div', { class: 'row', style: 'margin-top:6px' },
      el('label', { class: 'chk' }, lbl, ' Show label'),
      el('label', { class: 'chk' }, lock, ' Locked'),
    );

    // actions
    const b = (label, title, fn, cls = '') => el('button', { title, class: cls, onclick: fn }, label);
    const actions = el('div', { class: 'btn-grid' },
      b('⟲ 90°', 'Rotate 90° counter-clockwise (Shift+R)', () => st.rotateObjects(ids, -90)),
      b('⟳ 90°', 'Rotate 90° clockwise (R)', () => st.rotateObjects(ids, 90)),
      b('Flip ↔', 'Mirror horizontally (X)', () => st.flipObjects(ids, 'x')),
      b('Flip ↕', 'Mirror vertically (Y)', () => st.flipObjects(ids, 'y')),
      b('Transpose W↔D', 'Swap width and depth (T)', () => st.transposeObjects(ids)),
      b('Duplicate', 'Duplicate (Ctrl+D)', () => st.duplicateObjects(ids)),
      objs.length > 1 && !(groups.length === 1 && objs.every((o) => o.group === groups[0]))
        ? b('Group', 'Group selection (Ctrl+G)', () => { st.groupSelected(); this.toast('Grouped — the objects now move together'); }, 'primary')
        : b('Ungroup', 'Ungroup (Ctrl+Shift+G)', () => st.ungroupSelected(), groups.length ? '' : 'ghost'),
      b(allLocked ? 'Unlock' : 'Lock', 'Lock / unlock (Ctrl+L)', () => upd({ locked: !allLocked })),
      b('To front', 'Bring to front', () => st.reorder(ids, 'front')),
      b('To back', 'Send to back', () => st.reorder(ids, 'back')),
      b('Forward', 'Bring forward (PgUp)', () => st.reorder(ids, 'forward')),
      b('Backward', 'Send backward (PgDn)', () => st.reorder(ids, 'backward')),
      b('Centre in room ↔', 'Centre horizontally in the room', () => st.align(ids, 'room-center-x')),
      b('Centre in room ↕', 'Centre vertically in the room', () => st.align(ids, 'room-center-y')),
      el('button', { class: 'span2', title: 'Save this object (or group of objects) to your custom library', onclick: () => this.saveAsCustom(objs) }, '★ Save as custom object'),
      el('button', { class: 'span2 danger', title: 'Delete (Del)', onclick: () => st.deleteObjects(ids) }, 'Delete'),
    );

    let align = null;
    if (objs.length > 1) {
      align = el('div', { class: 'section' }, el('h3', {}, 'Align & distribute'),
        el('div', { class: 'btn-grid', style: 'grid-template-columns:repeat(3,1fr)' },
          b('⇤ Left', 'Align left edges', () => st.align(ids, 'left')),
          b('↔ Centre', 'Align horizontal centres', () => st.align(ids, 'center-x')),
          b('Right ⇥', 'Align right edges', () => st.align(ids, 'right')),
          b('⤒ Top', 'Align top edges', () => st.align(ids, 'top')),
          b('↕ Middle', 'Align vertical centres', () => st.align(ids, 'center-y')),
          b('Bottom ⤓', 'Align bottom edges', () => st.align(ids, 'bottom')),
          b('Dist. ↔', 'Distribute horizontally', () => st.distribute(ids, 'x')),
          b('Dist. ↕', 'Distribute vertically', () => st.distribute(ids, 'y')),
        ));
    }

    return el('div', {},
      title,
      groupRow,
      el('div', { class: 'dims-readout', html: this.readoutHtml(objs) }),
      dims,
      el('div', { class: 'section' }, el('h3', {}, 'Colour'), colorGrid, toggles),
      el('div', { class: 'section' }, el('h3', {}, 'Actions'), actions),
      align,
    );
  }

  /** Move the selection so its common centre coordinate becomes v (keeps relative layout for groups). */
  moveTo(axis, v) {
    const objs = this.store.selectedObjects();
    if (!objs.length) return;
    const cur = this.commonValue(objs, axis);
    if (cur !== undefined) { this.store.updateObjects(objs.map((o) => o.id), { [axis]: v }); return; }
    const b = unionBox(objs.map(aabb));
    const delta = v - (axis === 'x' ? b.cx : b.cy);
    this.store.nudge(objs.map((o) => o.id), axis === 'x' ? delta : 0, axis === 'y' ? delta : 0);
  }

  saveAsCustom(objs) {
    const suggested = objs.length === 1 ? objs[0].name : (this.store.state.groups[objs[0].group]?.name || 'Custom group');
    const name = prompt('Name for the custom object:', suggested);
    if (name == null) return;
    const preset = this.store.presetFromObjects(objs, name.trim() || suggested);
    this.store.addLibraryItem(preset);
    this.renderLibrary();
    this.toast(`Saved "${preset.name}" to your custom library`);
  }

  /** Re-render everything that shows units. */
  unitsChanged() {
    this.renderLibrary();
    this.renderCustomList();
    this.renderOutline();
    this.updateCustomUnits();
    this.syncProps(true);
    this.updateStatus();
  }
}
