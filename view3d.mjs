// The orbit view: the same recorded geometry rebuilt in Three.js with an orthographic camera, four-tone toon shading
// and drawn edges, so the drawing can turn. World (x, y, z) maps to (x, z, y): the kit's isometric projection is the
// mirror image of a real camera, and this keeps both views identical at the drawing's own azimuth and elevation.
export const VIEW3D = String.raw`
V3 = (() => {
  if (typeof THREE === "undefined") return null;
  const box = stage.querySelector(".dc-box");
  const canvas = document.createElement("canvas");
  canvas.className = "dc-3d";
  canvas.setAttribute("aria-hidden", "true");
  box.appendChild(canvas);
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true }); } catch (error) { canvas.remove(); return null; }
  renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
  const scene = new THREE.Scene();
  const W3 = (p) => new THREE.Vector3(p[0], p[2], p[1]);
  const DEG = Math.PI / 180;

  // ---- materials from the page's own tokens, so both themes work
  const css = (name) => getComputedStyle(stage).getPropertyValue(name).trim();
  const lum = (hex) => { const c = new THREE.Color(hex); return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; };
  const ramp = new THREE.DataTexture(new Uint8Array(4), 4, 1, THREE.LuminanceFormat);
  ramp.minFilter = ramp.magFilter = THREE.NearestFilter;
  const mk = () => new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: ramp, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
  const solid = mk(), solidLit = mk(), pipe = mk(), pvMat = mk();
  solid.side = solidLit.side = THREE.DoubleSide;
  const edge = new THREE.LineBasicMaterial({ color: 0x888888 });
  const edgeLit = new THREE.LineBasicMaterial({ color: 0x000000 });
  const face = new THREE.LineBasicMaterial({ color: 0xcccccc });
  const faceLit = new THREE.LineBasicMaterial({ color: 0x888888 });
  const flowMat = new THREE.LineDashedMaterial({ color: 0x000000, dashSize: 2, gapSize: 4 });
  let tokens = "";
  function paint() {
    const key = css("--anatomy-top") + css("--anatomy-lit");
    if (key === tokens) return;
    tokens = key;
    const topL = Math.max(1e-3, lum(css("--anatomy-top")));
    const levels = [0, 1, 2, 3].map((i) => Math.min(255, Math.round((lum(css("--anatomy-shade-" + i)) / topL) * 255)));
    ramp.image.data.set([levels[0], levels[1], levels[2], 255]);
    ramp.needsUpdate = true;
    solid.color.set(css("--anatomy-top"));
    solidLit.color.set(css("--anatomy-lit-top"));
    pipe.color.set(css("--anatomy-shade-1"));
    pvMat.color.set(css("--dc-pv"));
    edge.color.set(css("--anatomy-mid"));
    edgeLit.color.set(css("--anatomy-lit"));
    face.color.set(css("--anatomy-faint"));
    faceLit.color.set(css("--anatomy-lo"));
    flowMat.color.set(css("--anatomy-lit"));
    needs = true;
  }

  // ---- geometry: one merged mesh, one edge set and one line set per drawn item
  const merge = (geos) => {
    let n = 0;
    const parts = geos.map((g) => { const ng = g.index ? g.toNonIndexed() : g; n += ng.attributes.position.count; return ng; });
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
    let o = 0;
    for (const g of parts) { pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); o += g.attributes.position.count; g.dispose(); }
    const out = new THREE.BufferGeometry();
    out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    out.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
    return out;
  };
  const roundShape = (x, y, w, d, r) => {
    const s = new THREE.Shape();
    const Y = (v) => -v;
    r = Math.min(r, w / 2, d / 2);
    s.moveTo(x + r, Y(y));
    s.lineTo(x + w - r, Y(y)); s.quadraticCurveTo(x + w, Y(y), x + w, Y(y + r));
    s.lineTo(x + w, Y(y + d - r)); s.quadraticCurveTo(x + w, Y(y + d), x + w - r, Y(y + d));
    s.lineTo(x + r, Y(y + d)); s.quadraticCurveTo(x, Y(y + d), x, Y(y + d - r));
    s.lineTo(x, Y(y + r)); s.quadraticCurveTo(x, Y(y), x + r, Y(y));
    return s;
  };
  const up = new THREE.Vector3(0, 1, 0);
  function geoOf(p) {
    if (p.t === "slab") {
      const [x, y, w, d, r, z, h] = p.b;
      if (w <= 0 || d <= 0 || h <= 0) return null;
      if (r < 1 || w < 3 || d < 3) { const g = new THREE.BoxGeometry(w, h, d); g.translate(x + w / 2, z + h / 2, y + d / 2); return g; }
      const g = new THREE.ExtrudeGeometry(roundShape(x, y, w, d, r), { depth: h, bevelEnabled: false, curveSegments: 3 });
      g.rotateX(-Math.PI / 2); g.translate(0, z, 0); return g;
    }
    if (p.t === "cyl") {
      const [cx, cy, r, z, h] = p.b;
      if (h <= 0) return null;
      const g = new THREE.CylinderGeometry(r, r, h, Math.max(10, Math.min(48, Math.round(r * 3))), 1, r >= 20 && h >= 10);
      g.translate(cx, z + h / 2, cy); return g;
    }
    if (p.t === "ext") {
      const [z, h] = p.b;
      const s = new THREE.Shape(p.ring.map(([x, y]) => new THREE.Vector2(x, -y)));
      const g = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false });
      g.rotateX(-Math.PI / 2); g.translate(0, z, 0); return g;
    }
    if (p.t === "lathe") {
      const pts = [[p.prof[0][0], 0], ...p.prof, [p.prof[p.prof.length - 1][0], 0]].map(([s, r]) => new THREE.Vector2(Math.max(0.001, r), s));
      const rmax = Math.max(...p.prof.map((q) => q[1]));
      const g = new THREE.LatheGeometry(pts, Math.max(12, Math.min(40, Math.round(rmax * 3))));
      g.applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(up, W3(p.a).normalize())));
      const o = W3(p.o); g.translate(o.x, o.y, o.z); return g;
    }
    if (p.t === "tube") {
      const curve = new THREE.CatmullRomCurve3(p.pts.map(W3), false, "catmullrom", 0.2);
      return new THREE.TubeGeometry(curve, Math.max(8, p.pts.length * 2), p.r, 10, false);
    }
    return null;
  }
  const items = [];
  const layerGroups = [0, 1, 2, 3, 4].map(() => { const g = new THREE.Group(); scene.add(g); return g; });
  const bounds = {};
  const grow = (st, v) => { const b = bounds[st] || (bounds[st] = new THREE.Box3()); b.expandByPoint(v); };
  const panels = [];
  const all = new THREE.Box3();
  function addPanel(p, st) {
    const g = new THREE.Group();
    g.position.copy(W3([p.x, (p.y0 + p.y1) / 2, p.z]));
    const geo = new THREE.BoxGeometry(p.w, 0.6, p.y1 - p.y0);
    geo.translate(0, 1.1, 0);
    const mesh = new THREE.Mesh(geo, pvMat);
    mesh.userData.item = { userData: { st } };
    const e = new THREE.LineSegments(new THREE.EdgesGeometry(geo), edge);
    g.add(mesh, e);
    scene.add(g);
    panels.push({ g, mesh, e });
    const b = new THREE.Box3().setFromObject(g);
    bounds[st] = (bounds[st] || new THREE.Box3()).union(b);
  }
  function addItem(prims, st, layer) {
    const geos = [], edges = [], lines = [], flows = [];
    for (const p of prims) {
      if (p.t === "panel") { addPanel(p, st); continue; }
      if (p.t === "line" || p.t === "flow") {
        const list = p.t === "line" ? lines : flows;
        for (let i = 0; i + 1 < p.pts.length; i++) list.push(W3(p.pts[i]), W3(p.pts[i + 1]));
        continue;
      }
      const g = geoOf(p);
      if (!g) continue;
      if (p.t !== "tube") edges.push(new THREE.EdgesGeometry(g, 35));
      geos.push(g);
    }
    const group = new THREE.Group();
    group.userData = { st, layer };
    let mesh = null;
    if (geos.length) {
      const g = merge(geos.map((x) => x));
      mesh = new THREE.Mesh(g, solid);
      mesh.userData.item = group;
      group.add(mesh);
      g.computeBoundingBox(); all.union(g.boundingBox);
      if (st) bounds[st] = (bounds[st] || new THREE.Box3()).union(g.boundingBox);
    }
    let edgeLines = null, faceLines = null, flowLines = null;
    if (edges.length) {
      let n = 0; edges.forEach((e) => (n += e.attributes.position.count));
      const pos = new Float32Array(n * 3); let o = 0;
      edges.forEach((e) => { pos.set(e.attributes.position.array, o * 3); o += e.attributes.position.count; e.dispose(); });
      const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      edgeLines = new THREE.LineSegments(g, edge); group.add(edgeLines);
    }
    if (lines.length) { faceLines = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(lines), face); group.add(faceLines); }
    if (flows.length) {
      flowLines = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(flows), flowMat);
      flowLines.computeLineDistances(); flowLines.visible = false; group.add(flowLines);
      if (st) flows.forEach((v) => grow(st, v));
    }
    layerGroups[layer].add(group);
    const tube = prims.length > 0 && prims.every((p) => p.t === "tube" || p.t === "line" || p.t === "flow");
    if (mesh && tube) mesh.material = pipe;
    items.push({ group, mesh, edgeLines, faceLines, flowLines, st, layer, tube });
  }
  addItem(SCENE.ground, "", 0);
  for (const it of SCENE.items) addItem(it.p, it.st, it.layer);

  // tower fans: six blades on a hub inside each stack, turned every frame
  const rotors = FANS.map(([x, y, z]) => {
    const g = new THREE.Group();
    const blade = new THREE.BoxGeometry(17, 0.4, 3.2); blade.translate(11, 0, 0);
    const bladeEdges = new THREE.EdgesGeometry(blade);
    for (let i = 0; i < 6; i++) {
      const b = new THREE.Mesh(blade, solid); b.rotation.y = (i * Math.PI) / 3; g.add(b);
      const e = new THREE.LineSegments(bladeEdges, edge); e.rotation.y = (i * Math.PI) / 3; g.add(e);
    }
    g.position.copy(W3([x, y, z]));
    scene.add(g);
    return g;
  });

  // ---- light rides with the camera, from the upper left, as in the drawing
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -4000, 4000);
  const sun = new THREE.DirectionalLight(0xffffff, 1);
  sun.position.set(-0.75, 0.62, 0.22);
  camera.add(sun);
  scene.add(camera);
  scene.add(new THREE.AmbientLight(0xffffff, 0));

  // ---- the camera: azimuth and elevation of the drawing, framed exactly like it
  const AZ0 = P.azimuth * DEG, EL0 = (P.elevation || 30) * DEG;
  const scale = P.scale * Math.sqrt(1.6);
  const viewH = VIEW[1] / scale;
  const floorAt = (sx, sy) => {
    const qx = (sx - P.origin[0]) / scale, qy = (sy - P.origin[1]) / scale;
    const sA = Math.sin(AZ0), cA = Math.cos(AZ0), sE = Math.sin(EL0);
    return [qx * sA + (qy / sE) * cA, -qx * cA + (qy / sE) * sA, 0];
  };
  const HOME = { az: AZ0, el: EL0, target: W3(floorAt(VIEW[0] / 2, VIEW[1] / 2)), zoom: 1 };
  const orbit = { az: HOME.az, el: HOME.el, target: HOME.target.clone(), zoom: 1 };
  const aim = { az: HOME.az, el: HOME.el, target: HOME.target.clone(), zoom: 1 };
  let needs = true, idleFor = 0, interacting = false;
  function place() {
    const cE = Math.cos(orbit.el);
    const dir = new THREE.Vector3(Math.cos(orbit.az) * cE, Math.sin(orbit.el), Math.sin(orbit.az) * cE);
    camera.position.copy(orbit.target).addScaledVector(dir, 1500);
    camera.up.set(0, 1, 0);
    camera.lookAt(orbit.target);
    const w = box.clientWidth || 1, h = box.clientHeight || 1;
    const halfH = viewH / 2, halfW = (halfH * w) / h;
    camera.left = -halfW; camera.right = halfW; camera.top = halfH; camera.bottom = -halfH;
    camera.zoom = orbit.zoom;
    camera.updateProjectionMatrix();
  }
  function size() {
    const w = box.clientWidth, h = box.clientHeight;
    if (!w || !h) return;
    if (canvas.width !== Math.round(w * renderer.getPixelRatio()) || canvas.height !== Math.round(h * renderer.getPixelRatio())) renderer.setSize(w, h, false);
  }
  function frame(id) {
    const b = id === "__all" ? all : bounds[id];
    if (!b) return;
    const center = b.getCenter(new THREE.Vector3());
    aim.target.copy(center);
    // fit the box's extent along the camera's right and up axes, leaving room for the data sheet
    place();
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0), upv = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    let ex = 0, ey = 0;
    for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) {
      const d = new THREE.Vector3(x, y, z).sub(center);
      ex = Math.max(ex, Math.abs(d.dot(right))); ey = Math.max(ey, Math.abs(d.dot(upv)));
    }
    const f = freeRect();
    const w = box.clientWidth || 1, h = box.clientHeight || 1;
    const halfH = viewH / 2, halfW = (halfH * w) / h;
    const pad = id === "__all" ? 1.02 : 1.4, extra = id === "__all" ? 0 : 14;
    aim.zoom = Math.max(0.4, Math.min(4.2, Math.min((halfW * (f.x1 - f.x0)) / (ex * pad + extra), (halfH * (f.y1 - f.y0)) / (ey * pad + extra))));
    // shift the target so the part sits in the middle of the free part of the screen
    const cx = f.x0 + f.x1 - 1, cy = 1 - (f.y0 + f.y1);
    aim.target.addScaledVector(right, (-cx * halfW) / aim.zoom).addScaledVector(upv, (-cy * halfH) / aim.zoom);
    idleFor = 0;
  }
  function home() { aim.el = HOME.el; frame("__all"); }
  function reset() { aim.az = HOME.az; aim.el = HOME.el; orbit.az = HOME.az; frame("__all"); }
  function tilt(R) { const a = (-R * Math.PI) / 180; panels.forEach((p) => { p.g.rotation.z = a; }); needs = true; }
  function light(id) {
    for (const it of items) {
      const on = !!id && it.st === id;
      if (it.mesh) it.mesh.material = on ? solidLit : it.tube ? pipe : solid;
      if (it.edgeLines) it.edgeLines.material = on ? edgeLit : edge;
      if (it.faceLines) it.faceLines.material = on ? faceLit : face;
      if (it.flowLines) it.flowLines.visible = on;
    }
    for (const p of panels) p.e.material = id === "solar" ? edgeLit : edge;
    needs = true;
  }
  const ease = (a, b, dt, tau) => a + (b - a) * (1 - Math.exp(-dt / tau));
  function update(dt, calm) {
    paint();
    size();
    if (!interacting) idleFor += dt;
    if (!calm && !interacting && idleFor > 4 && !touring) { aim.az += dt * 0.12; }
    for (const key of ["az", "el", "zoom"]) {
      const next = calm ? aim[key] : ease(orbit[key], aim[key], dt, 0.35);
      if (Math.abs(next - orbit[key]) > 1e-5) needs = true;
      orbit[key] = next;
    }
    const t = calm ? aim.target.clone() : orbit.target.clone().lerp(aim.target, 1 - Math.exp(-dt / 0.35));
    if (t.distanceTo(orbit.target) > 1e-3) needs = true;
    orbit.target.copy(t);
    rotors.forEach((r, i) => { r.rotation.y = -fanAngle[i]; });
    springs.forEach((s, i) => { layerGroups[i + 1].position.y = LAYERS[i].lift * s.x; });
    flowMat.dashSize = 2; flowMat.gapSize = 4;
    place();
    renderer.render(scene, camera);
    needs = false;
  }

  // ---- input: drag orbits, shift-drag pans, ⌘/ctrl-scroll or pinch zooms, a click flies to the part
  const ray = new THREE.Raycaster();
  let down = null;
  canvas.addEventListener("pointerdown", (e) => { down = { x: e.clientX, y: e.clientY, az: aim.az, el: aim.el, t: aim.target.clone(), moved: false, pan: e.shiftKey || e.button === 2 }; interacting = true; idleFor = 0; });
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  canvas.addEventListener("pointermove", (e) => {
    if (!down) return;
    const dx = e.clientX - down.x, dy = e.clientY - down.y;
    if (!down.moved && Math.hypot(dx, dy) > 4) { down.moved = true; try { canvas.setPointerCapture(e.pointerId); } catch (error) {} takeOver(); }
    if (!down.moved) return;
    if (down.pan) {
      const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0), upv = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
      const per = viewH / (box.clientHeight || 1) / orbit.zoom;
      aim.target.copy(down.t).addScaledVector(right, -dx * per).addScaledVector(upv, dy * per);
      orbit.target.copy(aim.target);
    } else {
      aim.az = down.az + dx * 0.006;
      aim.el = Math.max(6 * DEG, Math.min(88 * DEG, down.el + dy * 0.005));
    }
    run();
  });
  const finish = (e) => {
    const was = down; down = null; interacting = false;
    if (!was || was.moved) return;
    const r = canvas.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
    const hit = ray.intersectObjects([...items.filter((it) => it.mesh && it.st).map((it) => it.mesh), ...panels.map((p) => p.mesh)], false)[0];
    if (!hit) return;
    const index = STATIONS.findIndex((s) => s.id === hit.object.userData.item.userData.st);
    if (index >= 0) { takeOver(); focus(index); stage.focus({ preventScroll: true }); }
  };
  canvas.addEventListener("pointerup", finish);
  canvas.addEventListener("pointercancel", () => { down = null; interacting = false; });
  canvas.addEventListener("dblclick", () => { takeOver(); unfocus(); reset(); });
  canvas.addEventListener("wheel", (e) => { if (!e.ctrlKey && !e.metaKey) return; e.preventDefault(); takeOver(); aim.zoom = Math.max(0.5, Math.min(12, aim.zoom * Math.exp(-e.deltaY * 0.01))); idleFor = 0; run(); }, { passive: false });
  const zoomBy = (f) => { aim.zoom = Math.max(0.5, Math.min(12, aim.zoom * f)); idleFor = 0; };
  const turn = (d) => { aim.az += d; idleFor = 0; };
  return { canvas, frame, home, reset, light, update, zoomBy, turn, tilt };
})();
`;
