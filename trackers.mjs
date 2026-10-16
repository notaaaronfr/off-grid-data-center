// One tracker table's module surface at rotation R (degrees, + faces east), drawn as a solid box in the kit's camera.
// Self-contained (it is given iso and pathOf) so the page can redraw the field as the sun moves.
export function panelSvg(T, R, P, iso, pathOf) {
  const D = Math.PI / 180;
  const a = (P.azimuth ?? 45) * D, e = (P.elevation ?? 30) * D;
  const V = [Math.cos(a) * Math.cos(e), Math.sin(a) * Math.cos(e), Math.sin(e)];
  const L = [-Math.sin(a), Math.cos(a), 1.2];
  const ll = Math.hypot(...L);
  const n = [Math.sin(R * D), 0, Math.cos(R * D)];
  const d = [Math.cos(R * D), 0, -Math.sin(R * D)];
  const c = [T.x + n[0] * 1.1, 0, T.z + n[2] * 1.1];
  const P3 = (y, s, b) => [c[0] + d[0] * s + n[0] * b, y, c[2] + d[2] * s + n[2] * b];
  const hw = T.w / 2, ht = 0.3;
  const corner = {};
  for (const y of [T.y0, T.y1]) for (const s of [-hw, hw]) for (const b of [-ht, ht]) corner[y + ":" + s + ":" + b] = P3(y, s, b);
  const C = (y, s, b) => corner[y + ":" + s + ":" + b];
  const faces = [
    { n, pts: [C(T.y0, -hw, ht), C(T.y0, hw, ht), C(T.y1, hw, ht), C(T.y1, -hw, ht)], kind: "glass" },
    { n: n.map((v) => -v), pts: [C(T.y0, -hw, -ht), C(T.y1, -hw, -ht), C(T.y1, hw, -ht), C(T.y0, hw, -ht)], kind: "back" },
    { n: d, pts: [C(T.y0, hw, -ht), C(T.y1, hw, -ht), C(T.y1, hw, ht), C(T.y0, hw, ht)], kind: "edge" },
    { n: d.map((v) => -v), pts: [C(T.y0, -hw, -ht), C(T.y0, -hw, ht), C(T.y1, -hw, ht), C(T.y1, -hw, -ht)], kind: "edge" },
    { n: [0, 1, 0], pts: [C(T.y1, -hw, -ht), C(T.y1, -hw, ht), C(T.y1, hw, ht), C(T.y1, hw, -ht)], kind: "edge" },
    { n: [0, -1, 0], pts: [C(T.y0, -hw, -ht), C(T.y0, hw, -ht), C(T.y0, hw, ht), C(T.y0, -hw, ht)], kind: "edge" },
  ];
  const dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
  const all = Object.values(corner).map((p) => iso(p, P));
  // hull of the projected box
  const pts = [...all].sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const cross = (o, p, q) => (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0]);
  const lower = [], upper = [];
  for (const p of pts) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
  const hull = pathOf([...lower.slice(0, -1), ...upper.slice(0, -1)], true);
  let body = "";
  let lines = "";
  for (const f of faces) {
    if (dot(f.n, V) <= 1e-6) continue;
    const dpath = pathOf(f.pts.map((p) => iso(p, P)), true);
    if (f.kind === "glass") body += `<path class="dc-pv" d="${dpath}"/>`;
    else if (f.kind === "back") body += `<path class="iso-shade" data-shade="0" d="${dpath}"/>`;
    else { const lit = (dot(f.n, L) / ll + 1) / 2; body += `<path class="iso-shade" data-shade="${Math.min(3, Math.max(0, Math.floor(lit * 4)))}" d="${dpath}"/>`; }
    if (f.kind === "glass") {
      // module joints: one seam down the middle of the two-in-portrait table, and one every module along it
      const seg = (p, q) => pathOf([iso(p, P), iso(q, P)]);
      lines += seg(P3(T.y0, 0, ht), P3(T.y1, 0, ht));
      const count = Math.round((T.y1 - T.y0) / 2.6);
      for (let i = 1; i < count; i++) { const y = T.y0 + ((T.y1 - T.y0) * i) / count; lines += seg(P3(y, -hw, ht), P3(y, hw, ht)); }
    }
  }
  const facing = dot(n, V) > 0;
  return { svg: `<g class="iso-solid dc-panel"><path class="iso-fill" d="${hull}"/>${body}${lines ? `<path class="iso-line dc-pv-line" d="${lines}"/>` : ""}<path class="iso-line iso-edge" data-tone="mid" d="${hull}"/></g>`, facing };
}
