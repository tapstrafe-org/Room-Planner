import { Store } from './store.js';
import { Editor2D } from './editor2d.js';
import { View3D } from './view3d.js';
import { UI } from './ui.js';
import { setUnit, fmt } from './units.js';
import { exportJSON, exportPlanPNG, exportDXF, downloadDataUrl, safeName } from './export.js';

const $ = (s) => document.querySelector(s);

/* ---------- bootstrap ---------- */
const store = new Store();
store.loadFromStorage();
setUnit(store.prefs.units);

const view2dEl = $('#view2d'), view3dEl = $('#view3d');
const tip2d = $('#tooltip'), tip3d = $('#tooltip3d');

let ui; // assigned after editor exists (editor hooks reference it lazily)
const editor = new Editor2D($('#canvas2d'), store, {
  coords: (x, y) => { $('#status-coords').textContent = `x: ${fmt(x)}  y: ${fmt(y)}`; },
  hint: (t) => { $('#canvas-hint').textContent = t || ''; },
  tooltip: (html, x, y) => ui?.tooltip(view2dEl, tip2d, html, x, y),
  zoomChanged: (z) => { $('#zoom-label').textContent = `${Math.round(z * 100)}%`; },
  editName: () => ui?.focusName(),
});
ui = new UI(store, editor);

let view3d = null;
function ensure3D() {
  if (view3d) return view3d;
  try {
    view3d = new View3D($('#three-container'), store, {
      tooltip: (html, x, y) => ui.tooltip(view3dEl, tip3d, html, x, y),
    });
    $('#opt3d-walls-auto').addEventListener('change', (e) => view3d.setOption('autoHideWalls', e.target.checked));
    $('#opt3d-labels').addEventListener('change', (e) => view3d.setOption('labels', e.target.checked));
    $('#opt3d-ceiling').addEventListener('change', (e) => view3d.setOption('ceiling', e.target.checked));
    $('#btn3d-reset').addEventListener('click', () => view3d.resetCamera());
    $('#btn3d-top').addEventListener('click', () => view3d.topView());
  } catch (err) {
    console.error(err);
    ui.toast('3D view could not start (WebGL unavailable?)', 4000);
  }
  return view3d;
}

/* ---------- plan name ---------- */
const nameInput = $('#plan-name');
nameInput.value = store.state.name;
nameInput.addEventListener('change', () => store.setName(nameInput.value.trim() || 'Untitled plan'));
nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') nameInput.blur(); });
store.on('change', (d) => { if (d?.kind === 'all') nameInput.value = store.state.name; });

/* ---------- view switching ---------- */
function setView(v) {
  $('#viewport').dataset.view = v;
  for (const b of document.querySelectorAll('#view-switch button')) b.classList.toggle('active', b.dataset.view === v);
  store.setPref('view', v);
  const prev = setView.current;
  setView.current = v;
  if (v !== '2d') ensure3D();
  requestAnimationFrame(() => {
    view3d?.resize();
    editor.resize();
    if (prev && prev !== v) editor.zoomFit(); // canvas width changed — keep the whole plan in view
  });
}
for (const b of document.querySelectorAll('#view-switch button')) b.addEventListener('click', () => setView(b.dataset.view));
setView(store.prefs.view || '2d');

/* ---------- toolbar ---------- */
for (const b of document.querySelectorAll('#tools .tool')) b.addEventListener('click', () => editor.setTool(b.dataset.tool));
editor.hooks.toolChanged = (t) => {
  for (const b of document.querySelectorAll('#tools .tool')) b.classList.toggle('active', b.dataset.tool === t);
  $('#canvas-hint').textContent = t === 'measure' ? 'Drag to measure. Endpoints snap to corners and the grid. Esc clears.' : t === 'pan' ? 'Drag to pan. Scroll to zoom.' : '';
};

$('#btn-undo').addEventListener('click', () => store.undo());
$('#btn-redo').addEventListener('click', () => store.redo());
$('#btn-zoom-in').addEventListener('click', () => editor.zoomBy(1.25));
$('#btn-zoom-out').addEventListener('click', () => editor.zoomBy(0.8));
$('#btn-zoom-fit').addEventListener('click', () => editor.zoomFit());
$('#btn-help').addEventListener('click', () => $('#help-dialog').showModal());

// preferences
const prefCheck = (id, key) => {
  const cb = $(id);
  cb.checked = !!store.prefs[key];
  cb.addEventListener('change', () => store.setPref(key, cb.checked));
  return cb;
};
const snapGridCb = prefCheck('#opt-snap-grid', 'snapGrid');
prefCheck('#opt-snap-obj', 'snapObjects');
prefCheck('#opt-labels', 'showLabels');
prefCheck('#opt-dims', 'showDims');

const unitSel = $('#opt-units');
unitSel.value = store.prefs.units;
unitSel.addEventListener('change', () => {
  setUnit(unitSel.value);
  store.setPref('units', unitSel.value);
  ui.unitsChanged();
  view3d?.rebuild('all');
  editor.invalidate();
});

// file operations
$('#btn-new').addEventListener('click', () => {
  if (!confirm('Start a new, empty plan? (The current plan is kept in your browser history via Undo; use Save to keep a file.)')) return;
  store.newPlan();
  editor.zoomFit();
  ui.toast('New plan created — set the room size in the panel on the right');
});
$('#btn-save').addEventListener('click', () => exportJSON(store));
$('#btn-open').addEventListener('click', () => $('#file-input').click());
$('#file-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (file) await openPlanFile(file);
});

async function openPlanFile(file) {
  try {
    const data = JSON.parse(await file.text());
    if (!data || !Array.isArray(data.objects)) throw new Error('not a plan');
    store.loadPlan(data);
    editor.zoomFit();
    ui.toast(`Opened "${store.state.name}"`);
  } catch (err) {
    ui.toast('That file is not a Room Planner plan (.json)', 3500);
  }
}

// export menu
const dd = $('#btn-export').parentElement;
$('#btn-export').addEventListener('click', (e) => { e.stopPropagation(); dd.classList.toggle('open'); });
document.addEventListener('click', () => dd.classList.remove('open'));
$('#exp-png').addEventListener('click', () => { exportPlanPNG(store, { labels: store.prefs.showLabels, dims: store.prefs.showDims }); ui.toast('PNG exported'); });
$('#exp-png3d').addEventListener('click', () => {
  const v3 = ensure3D();
  if (!v3) return;
  if ($('#viewport').dataset.view === '2d') { setView('split'); ui.toast('Switched to Split view — export the 3D image again once it has rendered', 3500); return; }
  downloadDataUrl(v3.screenshot(), `${safeName(store.state.name)}-3d.png`);
  ui.toast('3D PNG exported');
});
$('#exp-dxf').addEventListener('click', () => { exportDXF(store); ui.toast('DXF exported — open it in AutoCAD, LibreCAD, FreeCAD, etc.', 3500); });
$('#exp-json').addEventListener('click', () => exportJSON(store));

/* ---------- drag & drop onto the canvas ---------- */
const canvas = $('#canvas2d');
canvas.addEventListener('dragover', (e) => {
  if (e.dataTransfer.types.includes('application/x-roomplanner-preset') || e.dataTransfer.types.includes('Files')) {
    e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; canvas.classList.add('dragover');
  }
});
canvas.addEventListener('dragleave', () => canvas.classList.remove('dragover'));
canvas.addEventListener('drop', async (e) => {
  e.preventDefault();
  canvas.classList.remove('dragover');
  const file = e.dataTransfer.files?.[0];
  if (file && file.name.endsWith('.json')) { await openPlanFile(file); return; }
  const raw = e.dataTransfer.getData('application/x-roomplanner-preset');
  if (!raw) return;
  try {
    const preset = JSON.parse(raw);
    const r = canvas.getBoundingClientRect();
    const w = editor.screenToWorld(e.clientX - r.left, e.clientY - r.top);
    const g = store.prefs.snapGrid ? store.prefs.gridSize || 10 : 1;
    store.addPreset(preset, Math.round(w.x / g) * g, Math.round(w.y / g) * g);
  } catch (_) { /* ignore */ }
});

/* ---------- keyboard shortcuts ---------- */
function inEditable(e) {
  const t = e.target;
  return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (inEditable(e)) { e.target.blur(); return; }
    if ($('#help-dialog').open) { $('#help-dialog').close(); return; }
    if (!editor.cancelDrag()) store.clearSelection();
    return;
  }
  if (inEditable(e)) return;
  const mod = e.ctrlKey || e.metaKey;
  const ids = store.selectedIds();
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;

  if (e.code === 'Space' && !e.repeat) { editor.spaceDown = true; canvas.style.cursor = 'grab'; e.preventDefault(); return; }

  if (mod) {
    switch (key) {
      case 'z': e.preventDefault(); if (e.shiftKey) store.redo(); else store.undo(); return;
      case 'y': e.preventDefault(); store.redo(); return;
      case 'a': e.preventDefault(); store.selectAll(); return;
      case 'd': e.preventDefault(); if (ids.length) store.duplicateObjects(ids); return;
      case 'c': e.preventDefault(); if (store.copy()) ui.toast(`Copied ${ids.length} object${ids.length === 1 ? '' : 's'}`); return;
      case 'x': e.preventDefault(); if (store.copy()) store.deleteObjects(ids); return;
      case 'v': e.preventDefault(); store.paste(editor.hover ? null : editor.screenToWorld(editor.lastMouse.x, editor.lastMouse.y)); return;
      case 'g': e.preventDefault(); if (e.shiftKey) store.ungroupSelected(); else if (store.groupSelected()) ui.toast('Grouped'); return;
      case 'l': e.preventDefault(); if (ids.length) { const all = store.selectedObjects().every((o) => o.locked); store.updateObjects(ids, { locked: !all }); } return;
      case 's': e.preventDefault(); exportJSON(store); return;
      case 'o': e.preventDefault(); $('#file-input').click(); return;
      case 'e': e.preventDefault(); exportPlanPNG(store, { labels: store.prefs.showLabels, dims: store.prefs.showDims }); return;
      case '0': e.preventDefault(); editor.zoomFit(); return;
      case '=': case '+': e.preventDefault(); editor.zoomBy(1.25); return;
      case '-': e.preventDefault(); editor.zoomBy(0.8); return;
    }
    return;
  }

  switch (key) {
    case 'Delete': case 'Backspace': e.preventDefault(); store.deleteObjects(ids); return;
    case 'ArrowLeft': case 'ArrowRight': case 'ArrowUp': case 'ArrowDown': {
      if (!ids.length) return;
      e.preventDefault();
      const step = (store.prefs.gridSize || 10) * (e.shiftKey ? 10 : 1);
      const dx = key === 'ArrowLeft' ? -step : key === 'ArrowRight' ? step : 0;
      const dy = key === 'ArrowUp' ? -step : key === 'ArrowDown' ? step : 0;
      store.nudge(ids, dx, dy);
      return;
    }
    case 'PageUp': e.preventDefault(); store.reorder(ids, e.shiftKey ? 'front' : 'forward'); return;
    case 'PageDown': e.preventDefault(); store.reorder(ids, e.shiftKey ? 'back' : 'backward'); return;
    case 'r': if (ids.length) store.rotateObjects(ids, e.shiftKey ? -90 : 90); return;
    case 'x': if (ids.length) store.flipObjects(ids, 'x'); return;
    case 'y': if (ids.length) store.flipObjects(ids, 'y'); return;
    case 't': if (ids.length) store.transposeObjects(ids); return;
    case 'v': editor.setTool('select'); return;
    case 'h': editor.setTool('pan'); return;
    case 'm': editor.setTool('measure'); return;
    case 'f': editor.zoomFit(); return;
    case 'g': snapGridCb.checked = !snapGridCb.checked; store.setPref('snapGrid', snapGridCb.checked); ui.toast(`Grid snap ${snapGridCb.checked ? 'on' : 'off'}`); return;
    case '1': setView('2d'); return;
    case '2': setView('split'); return;
    case '3': setView('3d'); return;
    case '+': case '=': editor.zoomBy(1.25); return;
    case '-': editor.zoomBy(0.8); return;
    case '?': $('#help-dialog').showModal(); return;
  }
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') { editor.spaceDown = false; canvas.style.cursor = ''; }
});
window.addEventListener('blur', () => { editor.spaceDown = false; });
window.addEventListener('beforeunload', () => store.saveNow());

// expose for debugging / tests
window.roomPlanner = { store, editor, ui, get view3d() { return view3d; } };
