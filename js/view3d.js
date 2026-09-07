import * as THREE from 'three';
import { OrbitControls } from 'three/addons/OrbitControls.js';
import { DEG, shade } from './geometry.js';
import { fmtDims, fmt } from './units.js';

const unitBox = new THREE.BoxGeometry(1, 1, 1);
const unitBoxEdges = new THREE.EdgesGeometry(unitBox);
const unitCyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 40);

export class View3D {
  constructor(container, store, hooks = {}) {
    this.container = container;
    this.store = store;
    this.hooks = hooks;
    this.options = { autoHideWalls: true, labels: true, ceiling: false };
    this.dirty = true;
    this.disposables = [];
    this.meshes = []; // pickable object meshes
    this.labelSprites = [];

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);
    this.renderer = renderer;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xdfe5ee);
    this.camera = new THREE.PerspectiveCamera(50, 1, 1, 200000);
    this.controls = new OrbitControls(this.camera, renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.01;
    this.controls.addEventListener('change', () => { this.dirty = true; });

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x8a94a6, 1.1);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 1.8);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0005;
    this.scene.add(this.sun, this.sun.target);

    this.staticGroup = new THREE.Group();
    this.objectGroup = new THREE.Group();
    this.scene.add(this.staticGroup, this.objectGroup);

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.hoverId = null;

    renderer.domElement.addEventListener('pointermove', (e) => this.onPointerMove(e));
    renderer.domElement.addEventListener('pointerdown', (e) => { this._down = { x: e.clientX, y: e.clientY, t: Date.now() }; });
    renderer.domElement.addEventListener('pointerup', (e) => this.onPointerUp(e));
    renderer.domElement.addEventListener('pointerleave', () => { this.hoverId = null; this.hooks.tooltip?.(null); });

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);

    store.on('change', (d) => { this.rebuild(d?.kind); });
    store.on('selection', () => this.updateSelection());
    store.on('prefs', () => this.rebuild('all'));

    this.rebuild('all');
    this.resetCamera();
    this.resize();
    this.animate();
  }

  setOption(key, value) {
    this.options[key] = value;
    if (key === 'labels' || key === 'ceiling') this.rebuild('all');
    this.dirty = true;
  }

  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = w + 'px';
    this.renderer.domElement.style.height = h + 'px';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.dirty = true;
  }

  isVisible() { return this.container.clientWidth > 0 && this.container.clientHeight > 0 && this.container.offsetParent !== null; }

  roomExtent() {
    const r = this.store.room;
    return Math.max(r.width, r.length, r.height);
  }

  resetCamera() {
    const r = this.store.room;
    const D = this.roomExtent();
    this.controls.target.set(r.width / 2, r.height * 0.3, r.length / 2);
    this.camera.position.set(r.width / 2 + D * 0.55, D * 0.85, r.length / 2 + D * 1.05);
    this.controls.update();
    this.dirty = true;
  }

  topView() {
    const r = this.store.room;
    const D = this.roomExtent();
    this.controls.target.set(r.width / 2, 0, r.length / 2);
    this.camera.position.set(r.width / 2, D * 1.7, r.length / 2 + 0.5);
    this.controls.update();
    this.dirty = true;
  }

  /* ---------- scene building ---------- */
  disposeAll() {
    for (const d of this.disposables) d.dispose?.();
    this.disposables = [];
    this.staticGroup.clear();
    this.objectGroup.clear();
    this.meshes = [];
    this.labelSprites = [];
    this.walls = [];
    this.ceiling = null;
  }

  material(color, opts = {}) {
    const m = new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 0.85, metalness: 0.0, ...opts });
    this.disposables.push(m);
    return m;
  }

  rebuild() {
    this.disposeAll();
    const room = this.store.room;
    const { width: W, length: L, height: H, wallThickness: T } = room;

    // ground
    const D = this.roomExtent();
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(W + D * 6, L + D * 6), this.material(0xc9ced8, { roughness: 1 }));
    this.disposables.push(ground.geometry);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(W / 2, -0.5, L / 2);
    ground.receiveShadow = true;
    this.staticGroup.add(ground);

    // floor
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, L), this.material(room.floorColor, { roughness: 0.9 }));
    this.disposables.push(floor.geometry);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(W / 2, 0, L / 2);
    floor.receiveShadow = true;
    floor.userData.isFloor = true;
    this.staticGroup.add(floor);

    // walls: [center, size, outward normal]
    const wallDefs = [
      [[W / 2, H / 2, -T / 2], [W + 2 * T, H, T], [0, 0, -1]],
      [[W / 2, H / 2, L + T / 2], [W + 2 * T, H, T], [0, 0, 1]],
      [[-T / 2, H / 2, L / 2], [T, H, L], [-1, 0, 0]],
      [[W + T / 2, H / 2, L / 2], [T, H, L], [1, 0, 0]],
    ];
    const wallMat = this.material(room.wallColor, { roughness: 0.95 });
    for (const [c, s, n] of wallDefs) {
      const m = new THREE.Mesh(unitBox, wallMat);
      m.scale.set(...s);
      m.position.set(...c);
      m.castShadow = true; m.receiveShadow = true;
      m.userData.normal = new THREE.Vector3(...n);
      m.userData.center = new THREE.Vector3(...c);
      const edges = new THREE.LineSegments(unitBoxEdges, new THREE.LineBasicMaterial({ color: 0x4b5563 }));
      this.disposables.push(edges.material);
      m.add(edges);
      this.staticGroup.add(m);
      this.walls.push(m);
    }

    if (this.options.ceiling) {
      const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W, L), this.material(0xf5f5f4, { side: THREE.DoubleSide }));
      this.disposables.push(ceil.geometry);
      ceil.rotation.x = Math.PI / 2;
      ceil.position.set(W / 2, H, L / 2);
      this.staticGroup.add(ceil);
      this.ceiling = ceil;
    }

    // sun placement
    this.sun.position.set(W * 0.9, H * 2.2 + D * 0.4, L * 0.2);
    this.sun.target.position.set(W / 2, 0, L / 2);
    const cam = this.sun.shadow.camera;
    const ext = D * 1.2;
    cam.left = -ext; cam.right = ext; cam.top = ext; cam.bottom = -ext; cam.near = 1; cam.far = D * 6;
    cam.updateProjectionMatrix();

    // objects
    for (const o of this.store.objects) this.buildObject(o);
    this.updateSelection();
    this.dirty = true;
  }

  buildObject(o) {
    const g = new THREE.Group();
    g.position.set(o.x, o.z, o.y);
    g.rotation.y = -o.rot * DEG;
    const h = Math.max(o.h, 0.5);
    const mat = this.material(o.color, { transparent: o.h <= 2, opacity: o.h <= 2 ? 0.95 : 1 });
    let mesh;
    if (o.shape === 'ellipse') {
      mesh = new THREE.Mesh(unitCyl, mat);
      mesh.scale.set(o.w, h, o.d);
    } else if (o.shape === 'round') {
      const r = Math.min(o.w, o.d) * 0.18;
      const shape = new THREE.Shape();
      const x = -o.w / 2, y = -o.d / 2, w = o.w, d = o.d;
      shape.moveTo(x + r, y);
      shape.lineTo(x + w - r, y); shape.quadraticCurveTo(x + w, y, x + w, y + r);
      shape.lineTo(x + w, y + d - r); shape.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
      shape.lineTo(x + r, y + d); shape.quadraticCurveTo(x, y + d, x, y + d - r);
      shape.lineTo(x, y + r); shape.quadraticCurveTo(x, y, x + r, y);
      const geo = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false, curveSegments: 8 });
      this.disposables.push(geo);
      mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.x = -Math.PI / 2; // extrude along +y
      mesh.position.y = -h / 2; // compensate: we offset the whole mesh below
    } else {
      mesh = new THREE.Mesh(unitBox, mat);
      mesh.scale.set(o.w, h, o.d);
      const edges = new THREE.LineSegments(unitBoxEdges, new THREE.LineBasicMaterial({ color: new THREE.Color(shade(o.color, -90)), transparent: true, opacity: 0.6 }));
      this.disposables.push(edges.material);
      mesh.add(edges);
    }
    mesh.position.y += h / 2;
    mesh.castShadow = o.h > 2;
    mesh.receiveShadow = true;
    mesh.userData.id = o.id;
    g.add(mesh);
    this.meshes.push(mesh);

    if (o.shape === 'door') {
      // swing arc on the floor
      const ring = new THREE.Mesh(new THREE.RingGeometry(o.w - 1.5, o.w, 32, 1, o.mirror ? Math.PI / 2 : 0, Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(shade(o.color, -40)), side: THREE.DoubleSide }));
      this.disposables.push(ring.geometry, ring.material);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(o.mirror ? o.w / 2 : -o.w / 2, 0.4 - o.z, -o.d / 2);
      g.add(ring);
    }

    if (this.options.labels && o.showLabel !== false) {
      const sprite = this.makeLabel(o);
      sprite.position.set(0, h + 14, 0);
      g.add(sprite);
      this.labelSprites.push(sprite);
    }
    this.objectGroup.add(g);
  }

  makeLabel(o) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const name = o.name, dims = fmtDims(o.w, o.d, o.h);
    ctx.font = 'bold 28px sans-serif';
    const w1 = ctx.measureText(name).width;
    ctx.font = '22px sans-serif';
    const w2 = ctx.measureText(dims).width;
    const W = Math.ceil(Math.max(w1, w2) + 28), H = 72;
    canvas.width = W; canvas.height = H;
    ctx.fillStyle = 'rgba(17,24,39,0.82)';
    ctx.beginPath(); ctx.roundRect ? ctx.roundRect(0, 0, W, H, 12) : ctx.rect(0, 0, W, H); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = 'bold 28px sans-serif'; ctx.fillText(name, W / 2, 24);
    ctx.font = '22px sans-serif'; ctx.fillStyle = '#cbd5e1'; ctx.fillText(dims, W / 2, 52);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
    this.disposables.push(tex, mat);
    const sprite = new THREE.Sprite(mat);
    const scale = 0.28; // world cm per canvas px
    sprite.scale.set(W * scale, H * scale, 1);
    sprite.renderOrder = 10;
    return sprite;
  }

  updateSelection() {
    const sel = this.store.selection;
    for (const m of this.meshes) {
      const on = sel.has(m.userData.id);
      m.material.emissive.set(on ? 0x1d4ed8 : 0x000000);
      m.material.emissiveIntensity = on ? 0.45 : 0;
    }
    this.dirty = true;
  }

  /* ---------- interaction ---------- */
  pick(e) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.meshes, false);
    return hits.length ? hits[0].object.userData.id : null;
  }

  onPointerMove(e) {
    if (e.buttons) { this.hooks.tooltip?.(null); return; }
    const id = this.pick(e);
    if (id !== this.hoverId) {
      this.hoverId = id;
      this.renderer.domElement.style.cursor = id ? 'pointer' : '';
    }
    const o = id ? this.store.getObj(id) : null;
    if (o) {
      const rect = this.renderer.domElement.getBoundingClientRect();
      const extra = o.z ? ` · elev. ${fmt(o.z, { withUnit: true })}` : '';
      this.hooks.tooltip?.(`<b>${esc(o.name)}</b><span class="mono">${fmtDims(o.w, o.d, o.h)}${extra}</span>`, e.clientX - rect.left, e.clientY - rect.top);
    } else this.hooks.tooltip?.(null);
  }

  onPointerUp(e) {
    const d = this._down;
    this._down = null;
    if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4 || Date.now() - d.t > 500) return;
    const id = this.pick(e);
    if (id) this.store.select([id], { toggle: e.shiftKey, expand: !e.altKey });
    else if (!e.shiftKey) this.store.clearSelection();
  }

  /* ---------- render loop ---------- */
  animate() {
    requestAnimationFrame(() => this.animate());
    if (!this.isVisible()) return;
    const changed = this.controls.update();
    if (!changed && !this.dirty) return;
    this.dirty = false;
    this.updateWallVisibility();
    this.renderer.render(this.scene, this.camera);
  }

  updateWallVisibility() {
    const cam = this.camera.position;
    const tmp = new THREE.Vector3();
    for (const w of this.walls) {
      if (!this.options.autoHideWalls) { w.visible = true; continue; }
      tmp.copy(cam).sub(w.userData.center);
      w.visible = tmp.dot(w.userData.normal) < 0;
    }
    if (this.ceiling) this.ceiling.visible = cam.y < this.store.room.height;
  }

  screenshot() {
    this.updateWallVisibility();
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL('image/png');
  }
}

function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
