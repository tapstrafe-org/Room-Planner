# Room Planner

A browser-based floor planning tool with custom objects, groups, a live 3D view and PNG / DXF (CAD) export. No build step, no backend: it is plain HTML, CSS and ES modules with a vendored copy of Three.js.

## Run it

Because the app uses ES modules it must be served over HTTP (opening `index.html` directly from disk is blocked by browsers).

```bash
npm start            # serves on http://localhost:8080 (uses npx http-server)
# or
python3 -m http.server 8080
```

Then open <http://localhost:8080>. It also works when dropped onto any static host (GitHub Pages, Netlify, S3, …).

## Features

**Plan & room**
- Set room width, length, ceiling height, wall thickness, floor and wall colours.
- Units: cm, mm, inches or feet. Fields accept `5'6"`, `120cm`, `2m`, `48in` etc.
- Grid with adjustable step, snap to grid and snap to other objects / walls (with guide lines).
- Autosave in the browser; Save / Open plans as `.json` files (or drop a `.json` onto the canvas).

**Objects**
- 80+ built-in presets (structure, living, bedroom, kitchen, office, bathroom, storage, misc). Click to add or drag onto the canvas.
- Every object has width, depth, **height**, elevation off the floor, rotation, colour, shape (rectangle, rounded, ellipse, door with swing) and a label.
- Hover any object for a tooltip with its name and W × D × H; select it to see dimension lines on the plan.
- Optional "Dims" toggle prints the dimensions on every object.

**Custom objects & groups**
- Custom tab: create a new object by name/size/height/shape/colour and save it to your library.
- Select one or more objects (or a group) and choose **Save as custom object** — multi-part groups are saved as one library item and come back as a group when placed.
- Groups (Ctrl+G) move, rotate, flip and duplicate together. Alt+click selects a single member; Ctrl+Shift+G ungroups.
- The library lives in localStorage and can be exported / imported as JSON.

**Editing**
- Move by dragging (Shift locks to an axis, Alt+drag duplicates, Ctrl ignores snapping), arrow keys nudge.
- Rotate with the rotate handle (Shift snaps to 15°), `R` / `Shift+R` for 90° steps, or type an angle.
- Resize with corner and edge handles (Shift keeps proportions).
- Flip horizontally / vertically, transpose (swap W↔D), lock, duplicate, copy/paste, delete.
- Align (left/centre/right/top/middle/bottom), distribute, centre in room, stacking order (front/back/forward/backward, or drag in the Objects list).
- Marquee selection: drag left→right selects enclosed objects, right→left selects anything touched (CAD style).
- Measure tool snaps to corners and grid.
- Unlimited undo / redo.

**3D**
- Toggle 2D / Split / 3D. The 3D view is live: walls, floor, extruded objects with their colours, elevation and height, shadows, floating labels with dimensions, hover tooltips, click to select.
- Walls facing the camera hide automatically so you can always see inside; optional ceiling; Top-down camera preset.

**Export**
- **PNG (2D plan)** — high-resolution rendering with title, dimensions and scale bar.
- **PNG (3D view)** — screenshot of the current 3D camera.
- **DXF (CAD)** — opens in AutoCAD, BricsCAD, LibreCAD, FreeCAD, QCAD, DraftSight… Objects are closed polylines on layers (`WALLS`, `FLOOR`, `OBJECTS`, `STRUCTURE`, `LABELS`, `DIMS`) with true colours; each object's height is written as entity *thickness* and its elevation as *elevation*, so the file is a 3D extrusion model when viewed in CAD. Units follow the current display unit and are declared in the header (`$INSUNITS`).
  DWG is a proprietary binary format; DXF is the open interchange format every CAD package imports and can re-save as DWG.
- **JSON** — the plan file itself.

Press `?` in the app for the full keyboard shortcut list.

## Project layout

```
index.html         app shell
css/style.css
js/main.js         bootstrap, toolbar, shortcuts, drag & drop
js/store.js        document model, undo/redo, selection, groups, persistence, custom library
js/editor2d.js     canvas plan editor (render, hit-testing, handles, snapping) + shared renderer used by PNG export
js/view3d.js       Three.js scene
js/ui.js           library / custom / objects panels, properties panel, status bar
js/export.js       PNG, DXF and JSON export
js/catalog.js      built-in presets, palette, demo plan
js/geometry.js     rotation / bounding box / hit-test helpers
js/units.js        unit conversion and formatting
vendor/three/      Three.js 0.170 (MIT) — three.module.js + OrbitControls.js
```

Plans are stored in centimetres internally regardless of the display unit.
