import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as kRaw from "./kit/iso-kit.mjs";
import * as GRaw from "./kit/lathe.mjs";

// ---------------------------------------------------------------- 3D record: every solid and face line, in world units, for the orbit view
const r1 = (v) => Math.round(v * 10) / 10;
const pt = (p) => p.map(r1);
let buf = [];
const rec = (prim) => { buf.push(prim); };
const k = {
  ...kRaw,
  slabOf: (plan, z, h, P, steps, bevel) => { rec({ t: "slab", b: [plan.x, plan.y, plan.w, plan.d, plan.r, z, h].map(r1) }); return kRaw.slabOf(plan, z, h, P, steps, bevel); },
  cylinder: (cx, cy, r, z, h, P, steps, bevel) => { rec({ t: "cyl", b: [cx, cy, r, z, h].map(r1) }); return kRaw.cylinder(cx, cy, r, z, h, P, steps, bevel); },
  extrude: (ring, z, h, P, o) => { rec({ t: "ext", ring: ring.map(pt), b: [z, h].map(r1) }); return kRaw.extrude(ring, z, h, P, o); },
};
const G = {
  ...GRaw,
  solidOf: (profile, F, P, o) => { rec({ t: "lathe", o: pt(F.o), a: F.a.map((v) => +v.toFixed(4)), prof: profile.map(([s, r]) => [r1(s), r1(r)]) }); return GRaw.solidOf(profile, F, P, o); },
  disc: (s0, s1, r, F, P, o) => { rec({ t: "lathe", o: pt(F.o), a: F.a.map((v) => +v.toFixed(4)), prof: [[r1(s0), r1(r)], [r1(s1), r1(r)]] }); return GRaw.disc(s0, s1, r, F, P, o); },
};
import { tubePieces, tubeSvg } from "./kit/tube.mjs";
import { kitScript, glScript } from "./scripts/inline-kit.mjs";
import { glCamera } from "./kit/gl.mjs";
import { SHADER } from "./shader.mjs";
import { STATIONS } from "./stations.mjs";
import { LIVE } from "./live.mjs";
import { VIEW3D } from "./view3d.mjs";
import { createPlant, SOURCES } from "./model.mjs";
import { sheetOf } from "./sheets.mjs";
import { panelSvg } from "./trackers.mjs";
import { createMicrogrid } from "./microgrid.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const theme = process.argv.includes("--dark") ? "dark" : "light";

// 10 world units = 1 m inside the buildings; the campus between them is compressed, as on any site model.
const W = 1200;
const H = 790;
const PLATE = { x: -14, y: -14, w: 868, d: 428, r: 10 };
const P = k.fitProjection([...k.boxCorners(PLATE, -18, 0), [36, 366, 104], [270, 56, 74], [540, 0, 0]], W, H, { pad: 22, azimuth: 42 });

const at = (p) => k.iso(p, P);
const S = (paths, style) => k.solidSvg(paths, style);
const L = (d, style) => k.lineSvg(d, style);
const D = (points, style) => k.dotsSvg(points, style);
const V = G.viewOf(P);
const box = (x0, y0, z0, x1, y1, z1, bevel = 0, r = 0.4, steps = 2) => k.slabOf({ x: x0, y: y0, w: x1 - x0, d: y1 - y0, r }, z0, z1 - z0, P, steps, bevel);
const quad = (points) => { rec({ t: "line", pts: [...points, points[0]].map(pt) }); return k.pathOf(points.map(at), true); };
const rectX = (X, y0, y1, z0, z1) => quad([[X, y0, z0], [X, y1, z0], [X, y1, z1], [X, y0, z1]]);
const rectY = (Y, x0, x1, z0, z1) => quad([[x0, Y, z0], [x1, Y, z0], [x1, Y, z1], [x0, Y, z1]]);
const seg = (a, b) => { rec({ t: "line", pts: [pt(a), pt(b)] }); return k.segment(a, b, P); };
const top = (a, b, z) => { rec({ t: "line", pts: [pt([a[0], a[1], z]), pt([b[0], b[1], z])] }); return k.lineOnTop(a, b, z, P); };
const P3 = (points, closed = false) => { rec({ t: "line", pts: (closed ? [...points, points[0]] : points).map(pt) }); return k.pathOf(points.map(at), closed); };
const range = (from, to, step) => { const out = []; for (let v = from; v <= to + 1e-9; v += step) out.push(+v.toFixed(4)); return out; };
// a power flow: always on, its speed, width and direction set live from the dispatch
const FLOWS = [];
const pflow = (points, route) => { FLOWS.push(`<path class="dc-pf" data-route="${route}" d="${k.pathOf(points.map(at))}"/>`); return ""; };
const flow = (points, extra = "") => { rec({ t: "flow", pts: points.map(pt) }); return `<path class="iso-line dc-flow" data-tone="lit" data-flow="" d="${k.pathOf(points.map(at))}"${extra}/>`; };

// ---------------------------------------------------------------- items and painter's order
const items = [];
function put(bb, svg, { st = "", bias = 0, name = "", layer = 0 } = {}) {
  items.push({ bb, svg, st, bias, name, layer, prims: buf });
  buf = [];
}
const bbOf = (points, r = 0) => {
  const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]), zs = points.map((p) => p[2]);
  return [Math.min(...xs) - r, Math.min(...ys) - r, Math.min(...zs) - r, Math.max(...xs) + r, Math.max(...ys) + r, Math.max(...zs) + r];
};

function painter(list) {
  const n = list.length;
  const E = 1e-6;
  const screen = list.map(({ bb: [x0, y0, z0, x1, y1, z1] }) => {
    const pts = [];
    for (const x of [x0, x1]) for (const y of [y0, y1]) for (const z of [z0, z1]) pts.push(at([x, y, z]));
    return [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];
  });
  const depth = list.map(({ bb: [x0, y0, z0, x1, y1, z1], bias }) => k.depthOf([(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], P) + bias);
  const cmp = (i, j) => {
    const [ax0, ay0, az0, ax1, ay1, az1] = list[i].bb;
    const [bx0, by0, bz0, bx1, by1, bz1] = list[j].bb;
    if (ax1 <= bx0 + E) return -1;
    if (bx1 <= ax0 + E) return 1;
    if (ay1 <= by0 + E) return -1;
    if (by1 <= ay0 + E) return 1;
    if (az1 <= bz0 + E) return -1;
    if (bz1 <= az0 + E) return 1;
    return depth[i] <= depth[j] ? -1 : 1;
  };
  const next = Array.from({ length: n }, () => []);
  const indeg = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    const a = screen[i];
    for (let j = i + 1; j < n; j++) {
      const b = screen[j];
      if (a[2] < b[0] - 0.3 || b[2] < a[0] - 0.3 || a[3] < b[1] - 0.3 || b[3] < a[1] - 0.3) continue;
      if (cmp(i, j) < 0) { next[i].push(j); indeg[j]++; } else { next[j].push(i); indeg[i]++; }
    }
  }
  const done = new Array(n).fill(false);
  const out = [];
  let cycles = 0;
  const ready = new Set(list.map((_, i) => i).filter((i) => !indeg[i]));
  while (out.length < n) {
    let pick = -1;
    for (const i of ready) if (pick < 0 || depth[i] < depth[pick]) pick = i;
    if (pick < 0) {
      cycles++;
      for (let i = 0; i < n; i++) if (!done[i] && (pick < 0 || indeg[i] < indeg[pick] || (indeg[i] === indeg[pick] && depth[i] < depth[pick]))) pick = i;
    }
    ready.delete(pick);
    done[pick] = true;
    out.push(list[pick]);
    for (const j of next[pick]) if (!done[j] && --indeg[j] === 0) ready.add(j);
  }
  return { out, cycles };
}

// ---------------------------------------------------------------- pipes
function pipe(points, r, { st = "", tone = "mid", bend = 2.6, flanges = [true, true], flowSt = "", reverse = false, maxLength = 16 } = {}) {
  const route = G.fillet(points, Math.max(3, bend * r), 7, { P, tube: r });
  rec({ t: "tube", pts: route.map(pt), r: r1(r) });
  const pieces = tubePieces(route, r, P, { maxLength });
  const total = G.pathLength(route);
  for (const piece of pieces) {
    const flowLine = flowSt ? flow(reverse ? [...piece.points].reverse() : piece.points) : "";
    put(bbOf(piece.points, r), tubeSvg(piece, { tone }) + flowLine, { st: [st, flowSt].filter(Boolean).join(" ") });
  }
  [0, 1].forEach((end) => {
    if (!flanges[end]) return;
    const p = end ? route[route.length - 1] : route[0];
    const q = end ? G.pointAlong(route, total - 0.6) : G.pointAlong(route, 0.6);
    const axis = G.unit3(G.sub3(q, p));
    const F = G.frameAlong(p, axis);
    const svg = S(G.disc(0, 1.2, r * 1.55, F, P), { tone }) + (Math.abs(G.dot3(axis, V)) > 0.12 ? D(G.dotsOf(F, G.dot3(axis, V) < 0 ? 0 : 1.2, r * 1.25, 6, P, { all: true }), { size: 0.35 }) : "");
    put(bbOf([p, G.add3(p, G.mul3(axis, 1.2))], r * 1.55), svg, { st, bias: 0.05 });
  });
  return route;
}

// ---------------------------------------------------------------- ground: plinth, road, pads
const ground = [];
const groundPrims = [];
const flushGround = () => { groundPrims.push(...buf); buf = []; };
function plinth() {
  ground.push(`<path class="iso-halo" d="${k.haloOf(PLATE, -18, 18, P)}"/>`);
  ground.push(S(k.slabOf(PLATE, -16, 16, P, 8, 1.6), { tone: "mid", inner: L(k.sideSeam(PLATE, -11, P, 8), { tone: "faint" }) }));
  ground.push(L(k.planOutline(k.insetPlan(PLATE, 5), 0, P), { tone: "faint" }));
  const screws = k.corners(PLATE, 9);
  ground.push(L(screws.map(([x, y]) => k.ring(x, y, 2.4, 0, P, 18)).join(""), { tone: "lo" }), D(screws.map(([x, y]) => at([x, y, 0])), { size: 0.5 }));
  // scale bar: 1 tick per metre, a major every 5 m, rooted on the strip's back edge
  const strip = { x: 150, y: 400, w: 204, d: 7, r: 1 };
  ground.push(S(k.slabOf(strip, 0, 0.6, P, 3), { tone: "lo", crease: "none" }));
  const ticks = k.topTicks(152, 352, 10, 5, strip.y, 0.6, [2.2, 4], P);
  ground.push(L(ticks.minor, { tone: "lo" }), L(ticks.major, { tone: "mid" }));
  // label plate with the one engraved label
  const label = { x: 26, y: 396, w: 58, d: 12, r: 1.2 };
  ground.push(S(k.slabOf(label, 0, 0.8, P, 3), { tone: "lo", crease: "none" }));
  ground.push(L(k.planOutline(k.insetPlan(label, 1.4), 0.8, P, 3), { tone: "faint" }));
  ground.push(k.faceTextSvg(k.topMatrix([label.x + 4, label.y + 7.6], 0.8, P, "x"), "DC-01", { size: 4.2, tone: "mid" }));
  ground.push(L([22, 14].map((w, i) => top([label.x + 30, label.y + 4.4 + i * 3.2], [label.x + 30 + w, label.y + 4.4 + i * 3.2], 0.8)).join(""), { tone: "lo", free: true }));
  ground.push(D([at([label.x + 3, label.y + 3, 0.8]), at([label.x + label.w - 3, label.y + label.d - 3, 0.8])], { size: 0.4 }));
  // road along the front and a driveway to the loading door
  const road = { x: 126, y: 352, w: 222, d: 38, r: 2 };
  ground.push(S(k.slabOf(road, 0, 0.3, P, 4), { tone: "lo", crease: "none", className: "dc-asphalt" }));
  ground.push(L(range(134, 330, 16).map((x) => k.planOutline({ x, y: 370.4, w: 8, d: 1.2, r: 0.6 }, 0.3, P, 2)).join(""), { tone: "mid" }));
  ground.push(S(box(258, 304, 0, 286, 352, 0.3, 0, 1, 2), { tone: "lo", crease: "none", className: "dc-asphalt" }));
  // concrete pad of the biomass plant, and the gravel of the solar field
  ground.push(S(box(14, 216, 0, 132, 390, 0.4, 0, 2, 3), { tone: "lo", crease: "none" }));
  const field = { x: 566, y: -8, w: 282, d: 420, r: 2 };
  ground.push(S(k.slabOf(field, 0, 0.6, P, 3), { tone: "lo", crease: "none", className: "dc-gravel" }));
  const gravel = [];
  for (let x = 570; x < 846; x += 6) for (let y = -4; y < 410; y += 6) if (((x * 7 + y * 13) % 17) < 5) gravel.push(at([x + ((y * 3) % 4), y + ((x * 5) % 3), 0.6]));
  ground.push(D(gravel, { size: 0.3, tone: "faint" }));
  // concrete pads of the plant yard
  ground.push(S(box(18, 18, 0, 122, 192, 0.4, 0, 2, 3), { tone: "lo", crease: "none" }));
  ground.push(S(box(396, 140, 0, 526, 240, 0.4, 0, 2, 3), { tone: "lo", crease: "none" }));
}

// ---------------------------------------------------------------- the building, cut away at sill height
const B = { x0: 146, y0: 116, x1: 394, y1: 304 };
const SILL = 12;
const FLOOR = 3;
const RAISED = 8;
const RACK_TOP = 30;

function building() {
  put([B.x0, B.y0, 0, B.x1, B.y1, FLOOR], S(box(B.x0, B.y0, 0, B.x1, B.y1, FLOOR, 0.8, 1, 3), { tone: "lo" }) + L(k.sideSeam({ x: B.x0, y: B.y0, w: B.x1 - B.x0, d: B.y1 - B.y0, r: 1 }, 1.4, P, 3), { tone: "faint" }));
  // north wall, full height: the backdrop, with its panel joints running floor to coping
  const north = box(B.x0, B.y0, FLOOR, B.x1, B.y0 + 6, 56, 0.8, 0.4, 2);
  const joints = range(170, 386, 24).map((x) => seg([x, B.y0 + 6, FLOOR], [x, B.y0 + 6, 56])).join("");
  put([B.x0, B.y0, FLOOR, B.x1, B.y0 + 6, 56], S(north, { tone: "mid", inner: L(joints, { tone: "faint" }) + L(k.sideSeam({ x: B.x0, y: B.y0, w: B.x1 - B.x0, d: 6, r: 0.4 }, 52, P, 2), { tone: "faint" }) }));
  const cut = (x0, y0, x1, y1, h = SILL) => put([x0, y0, FLOOR, x1, y1, h], S(box(x0, y0, FLOOR, x1, y1, h, 0, 0.3, 2), { tone: "mid", className: "dc-cut" }));
  cut(B.x0, B.y0 + 6, B.x0 + 6, B.y1);
  cut(B.x1 - 6, B.y0 + 6, B.x1, B.y1);
  cut(B.x0 + 6, B.y1 - 6, 256, B.y1);
  cut(286, B.y1 - 6, B.x1 - 6, B.y1);
  // loading door: a threshold plate and two jamb posts in the gap
  put([256, B.y1 - 6, FLOOR, 286, B.y1, FLOOR + 0.6], S(box(256, B.y1 - 6, FLOOR, 286, B.y1, FLOOR + 0.6), { tone: "lo", crease: "none" }));
  // partitions, cut a little lower than the outer walls
  cut(208, B.y0 + 6, 212, 278, 10);
  cut(208, 292, 212, B.y1 - 6, 10);
  cut(338, B.y0 + 6, 342, 176, 10);
  cut(338, 190, 342, 280, 10);
  cut(338, 292, 342, B.y1 - 6, 10);
  cut(342, 198, 352, 202, 10);
  cut(364, 198, B.x1 - 6, 202, 10);
}

// ---------------------------------------------------------------- data hall
const ROWS = [
  { x0: 216, x1: 228, front: true },
  { x0: 240, x1: 252, front: false },
  { x0: 264, x1: 276, front: true },
  { x0: 288, x1: 300, front: false },
  { x0: 312, x1: 324, front: true },
];
const ROW_Y = [146, 182]; // Phase 1: six racks per row; the rest of each row is reserved for Phase 2
const PHASE2_Y = 290;
const RACK_W = 6;
const LIT_RACK = 4; // the rack that answers
const LIT = { x0: 312, x1: 324, y0: ROW_Y[0] + LIT_RACK * RACK_W, y1: ROW_Y[0] + (LIT_RACK + 1) * RACK_W };

function hall() {
  // raised floor: 600 mm tiles, perforated ones in the open cold aisle by row 5
  const plan = [212, B.y0 + 6, 338, B.y1 - 6];
  const tiles = [
    ...range(218, 332, 6).map((x) => top([x, plan[1]], [x, plan[3]], RAISED)),
    ...range(128, 292, 6).map((y) => top([plan[0], y], [plan[2], y], RAISED)),
  ].join("");
  const perf = [];
  for (const y of range(146, 170, 12)) for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) perf.push(at([327 + i * 1.3, y + 1.1 + j * 1.3, RAISED]));
  put([plan[0], plan[1], FLOOR, plan[2], plan[3], RAISED], S(box(plan[0], plan[1], FLOOR, plan[2], plan[3], RAISED, 0.5, 0.3, 2), { tone: "mid" }) + L(tiles, { tone: "faint" }) + D(perf, { size: 0.28, tone: "lo" }) + flow([[331, 180, RAISED + 0.1], [331, 150, RAISED + 0.1]]) + L(ROWS.flatMap((row) => range(ROW_Y[1], PHASE2_Y - RACK_W, RACK_W).map((y) => k.planOutline({ x: row.x0 + 0.6, y: y + 0.6, w: row.x1 - row.x0 - 1.2, d: RACK_W - 1.2, r: 0.4 }, RAISED, P, 2))).join(""), { tone: "lo", className: "dc-reserved" }), { st: "crah" });

  // CRAH units against the north wall, over the hot-aisle returns
  [226, 258, 290, 322].forEach((cx, i) => {
    const [x0, x1, y0, y1, z1] = [cx - 11, cx + 11, B.y0 + 8, B.y0 + 20, 36];
    let svg = S(box(x0, y0, RAISED, x1, y1, z1, 0.6, 0.6, 2), { tone: "hi", crease: "lo" });
    svg += L(k.planOutline({ x: x0 + 2, y: y0 + 2, w: 18, d: 8, r: 0.6 }, z1, P, 2), { tone: "lo" });
    svg += L(range(x0 + 3.5, x1 - 3.5, 1.5).map((x) => k.planOutline({ x: x - 0.3, y: y0 + 3, w: 0.6, d: 6, r: 0.3 }, z1, P, 2)).join(""), { tone: "faint" });
    svg += L(rectY(y1, x0 + 1.5, cx - 0.6, RAISED + 2, z1 - 3) + rectY(y1, cx + 0.6, x1 - 1.5, RAISED + 2, z1 - 3), { tone: "lo" });
    svg += L(range(RAISED + 5, z1 - 6, 2.4).map((z) => seg([x0 + 1.5, y1, z], [cx - 0.6, y1, z])).join(""), { tone: "faint" });
    svg += `<path class="dc-screen" d="${rectY(y1, cx + 3, cx + 8, z1 - 9, z1 - 6)}"/>`;
    svg += D([at([cx + 2, y1, RAISED + 14]), at([cx + 9.5, y1, RAISED + 14])], { size: 0.4 });
    put([x0, y0, RAISED, x1, y1, z1], svg, { st: "crah" });
  });

  // rows of racks: bayed together, one slab per row with the joints between racks
  ROWS.forEach((row, index) => {
    const { x0, x1, front } = row;
    const [y0, y1] = ROW_Y;
    const ys = range(y0 + RACK_W, y1 - RACK_W, RACK_W);
    let inner = L(ys.map((y) => seg([x1, y, RAISED], [x1, y, RACK_TOP])).join(""), { tone: "lo" });
    const face = [];
    const leds = [];
    for (let r = 0; r < (y1 - y0) / RACK_W; r++) {
      const ya = y0 + r * RACK_W, yb = ya + RACK_W;
      face.push(rectX(x1, ya + 0.5, yb - 0.5, RAISED + 1, RACK_TOP - 1));
      if (front) {
        for (const z of range(RAISED + 3, RACK_TOP - 3, 1.8)) face.push(seg([x1, ya + 0.5, z], [x1, yb - 0.5, z]));
        for (const z of range(RAISED + 3.9, RACK_TOP - 3, 3.6)) leds.push(at([x1, ya + 1.2 + ((r * 7 + z) % 3) * 0.4, z]));
      }
    }
    inner += L(face.join(""), { tone: "faint" });
    const tops = [...ys.map((y) => top([x0, y], [x1, y], RACK_TOP)), ...range(y0, y1 - RACK_W, RACK_W).map((y) => k.planOutline({ x: x0 + 2, y: y + 1.6, w: 3, d: 2.8, r: 0.4 }, RACK_TOP, P, 2))].join("");
    let svg = S(box(x0, y0, RAISED, x1, y1, RACK_TOP, 0.5, 0.4, 2), { tone: "mid", inner });
    svg += L(tops, { tone: "faint" });
    svg += L(rectY(y1, x0 + 0.8, x1 - 0.8, RAISED + 1, RACK_TOP - 1), { tone: "lo" });
    if (leds.length) svg += `<g class="dc-leds">${D(leds, { size: 0.32, tone: "hi", pulse: true })}</g>`;
    put([x0, y0, RAISED, x1, y1, RACK_TOP], svg, { st: index >= 3 ? "aisle" : "", layer: 1 });
  });
  // the rack that answers: its own solid over the row, so it can light up alone
  {
    const { x0, x1, y0, y1 } = LIT;
    let svg = S(box(x0, y0, RAISED, x1, y1, RACK_TOP, 0.5, 0.3, 2), { tone: "hi", crease: "lo" });
    svg += L(rectX(x1, y0 + 0.5, y1 - 0.5, RAISED + 1, RACK_TOP - 1), { tone: "mid" });
    const units = [];
    for (const z of range(RAISED + 3, RACK_TOP - 3, 1.8)) units.push(seg([x1, y0 + 0.5, z], [x1, y1 - 0.5, z]));
    svg += L(units.join(""), { tone: "lo" });
    svg += L(k.planOutline({ x: x0 + 2, y: y0 + 1.6, w: 3, d: 2.8, r: 0.4 }, RACK_TOP, P, 2), { tone: "lo" });
    svg += `<g class="dc-leds dc-busy">${D(range(RAISED + 3.9, RACK_TOP - 3, 1.8).map((z, i) => at([x1, y0 + 1.2 + (i % 3) * 0.6, z])), { size: 0.36, tone: "hi", pulse: true })}</g>`;
    put([x0, y0, RAISED, x1, y1, RACK_TOP], svg, { st: "server", bias: 0.5, layer: 1 });
  }
  // cold-aisle containment: a lid over each pair of fronts and a door at the end
  for (const [x0, x1] of [[228, 240], [276, 288]]) {
    const joints = range(ROW_Y[0] + 12, ROW_Y[1] - 12, 12).map((y) => top([x0, y], [x1, y], RACK_TOP + 1.2)).join("");
    put([x0, ROW_Y[0], RACK_TOP, x1, ROW_Y[1], RACK_TOP + 1.2], S(box(x0, ROW_Y[0], RACK_TOP, x1, ROW_Y[1], RACK_TOP + 1.2, 0.3, 0.2, 2), { tone: "mid", inner: "" }) + L(joints, { tone: "faint" }), { layer: 2 });
    const door = S(box(x0 + 0.2, ROW_Y[1], RAISED, x1 - 0.2, ROW_Y[1] + 1.4, RACK_TOP, 0, 0.2, 2), { tone: "mid" });
    put([x0, ROW_Y[1], RAISED, x1, ROW_Y[1] + 1.4, RACK_TOP], door + L(rectY(ROW_Y[1] + 1.4, x0 + 2, x1 - 2, RAISED + 8, RACK_TOP - 3), { tone: "lo" }) + D([at([x1 - 2.2, ROW_Y[1] + 1.4, RAISED + 11])], { size: 0.45 }), { layer: 1 });
  }
  // hot air: out of the rack backs, up over the containment, back to the CRAH returns
  const heat = [
    [[306, 178, RACK_TOP], [306, 178, 44], [306, 144, 44], [322, 144, 44], [322, 132, 36]],
    [[258, 178, RACK_TOP], [258, 178, 44], [258, 134, 44], [258, 132, 36]],
  ];
  heat.forEach((points) => put(bbOf(points), flow(points), { st: "aisle" }));
}

// ---------------------------------------------------------------- overhead trays in the hall and MMR
function trays() {
  // ladder tray for power, on stands that sit on the rack tops
  const ty = [150, 156];
  for (const row of ROWS) {
    const cx = (row.x0 + row.x1) / 2;
    put([cx - 0.5, 152.5, RACK_TOP, cx + 0.5, 153.5, 33.4], S(box(cx - 0.5, 152.5, RACK_TOP, cx + 0.5, 153.5, 33.4), { tone: "mid", crease: "none" }), { layer: 3 });
    put([cx - 1.5, 149.4, 33.4, cx + 1.5, 156.6, 34], S(box(cx - 1.5, 149.4, 33.4, cx + 1.5, 156.6, 34), { tone: "mid", crease: "none" }), { layer: 3 });
  }
  for (let x = 214; x < 336; x += 24) {
    const x1 = Math.min(336, x + 24);
    let svg = S(box(x, ty[0], 34, x1, ty[0] + 0.6, 36, 0, 0.1, 1), { tone: "mid", crease: "none" });
    svg += L(range(x + 1.5, x1 - 0.5, 3).map((rx) => top([rx, ty[0] + 0.6], [rx, ty[1] - 0.6], 34.4)).join(""), { tone: "lo" });
    svg += S(box(x, ty[1] - 0.6, 34, x1, ty[1], 36, 0, 0.1, 1), { tone: "mid", crease: "none" });
    svg += pflow([[x, 153, 34.8], [x1, 153, 34.8]], "load");
    put([x, ty[0], 34, x1, ty[1], 36], svg, { st: "ups", layer: 3 });
  }
  // fibre trough: across the hall over the rows, then down the MMR to the riser
  const trough = (x0, y0, x1, y1, st) => {
    const svg = S(box(x0, y0, 36, x1, y1, 39, 0.3, 0.3, 2), { tone: "hi", crease: "lo" }) + L(k.planOutline({ x: x0 + 0.7, y: y0 + 0.7, w: x1 - x0 - 1.4, d: y1 - y0 - 1.4, r: 0.2 }, 39, P, 2), { tone: "faint" });
    put([x0, y0, 36, x1, y1, 39], svg, { st, layer: 4 });
  };
  for (let x = 214; x < 369; x += 22) trough(x, 168, Math.min(369, x + 22), 174, "leaf");
  for (let y = 174; y < 296; y += 17) trough(369, y, 375, Math.min(296, y + 17), y < 200 ? "leaf" : y < 259 ? "core" : "fiber");
  for (const row of ROWS) {
    const cx = (row.x0 + row.x1) / 2;
    put([cx - 0.5, 170.5, RACK_TOP, cx + 0.5, 171.5, 36], S(box(cx - 0.5, 170.5, RACK_TOP, cx + 0.5, 171.5, 36), { tone: "mid", crease: "none" }), { layer: 4 });
  }
  for (const y of [186, 215, 280]) put([371.5, y - 0.5, FLOOR, 372.5, y + 0.5, 36], S(box(371.5, y - 0.5, FLOOR, 372.5, y + 0.5, 36), { tone: "mid", crease: "none" }), { layer: 4 });
  // waterfall drop from the trough onto the rack that answers
  put([317, 170.7, RACK_TOP, 319, 171.3, 36], S(box(317, 170.7, RACK_TOP, 319, 171.3, 36, 0, 0.2, 1), { tone: "hi", crease: "none" }), { st: "leaf", layer: 4 });
  // the riser from the fibre entry up to the trough
  put([370, 292, FLOOR, 374, 296, 36], S(box(370, 292, FLOOR, 374, 296, 36, 0, 0.3, 2), { tone: "hi", crease: "lo" }) + L(range(8, 32, 6).map((z) => seg([374, 292, z], [374, 296, z])).join(""), { tone: "faint" }), { st: "fiber" });
  // the request's path through the building
  const path = [[372, 296, 6], [372, 294, 6], [372, 294, 37.5], [372, 214, 37.5], [372, 214, 31]];
  put(bbOf(path), flow(path), { st: "fiber", layer: 4 });
  const core = [[372, 216, 31], [372, 216, 37.5], [372, 250, 37.5], [372, 250, 32]];
  put(bbOf(core), flow(core), { st: "core", layer: 4 });
  const leaf = [[372, 250, 37.6], [372, 171, 37.6], [318, 171, 37.6], [318, 171, RACK_TOP]];
  put(bbOf(leaf), flow(leaf), { st: "leaf", layer: 4 });
}

// ---------------------------------------------------------------- electrical room
function electrical() {
  // switchgear lineup: eight sections, fronts toward the room
  const [x0, x1, y0, y1, z1] = [155, 166, 138, 234, 31];
  const secs = range(y0, y1 - 12, 12);
  let inner = L(secs.slice(1).map((y) => seg([x1, y, FLOOR], [x1, y, z1])).join(""), { tone: "lo" });
  inner += L(secs.map((y) => rectX(x1, y + 1.2, y + 10.8, FLOOR + 2, z1 - 2) + rectX(x1, y + 3, y + 9, z1 - 9, z1 - 5)).join(""), { tone: "faint" });
  let svg = S(box(x0, y0, FLOOR, x1, y1, z1, 0.6, 0.3, 2), { tone: "mid", inner });
  svg += L(secs.slice(1).map((y) => top([x0, y], [x1, y], z1)).join(""), { tone: "faint" });
  svg += D(secs.map((y) => at([x1, y + 9.4, FLOOR + 13])), { size: 0.45 });
  svg += secs.map((y) => `<path class="dc-screen dc-meter" d="${rectX(x1, y + 3.6, y + 8.4, z1 - 8.4, z1 - 5.6)}"/>`).join("");
  put([x0, y0, FLOOR, x1, y1, z1], svg, { st: "ups" });
  for (const [y, st] of [[144, "bess"], [190, "solar"], [228, "biomass"]]) put([157, y - 3, z1, 164, y + 3, z1 + 3], S(box(157, y - 3, z1, 164, y + 3, z1 + 3, 0.3, 0.3, 2), { tone: "mid" }), { st });

  // UPS modules
  const ups = [176, 188, 140, 200, 25];
  let u = L(range(152, 188, 12).map((y) => seg([ups[1], y, FLOOR], [ups[1], y, ups[4]])).join(""), { tone: "lo" });
  u += L(range(140, 188, 12).map((y) => rectX(ups[1], y + 1, y + 11, FLOOR + 1.5, ups[4] - 1.5)).join(""), { tone: "faint" });
  let usvg = S(box(ups[0], ups[2], FLOOR, ups[1], ups[3], ups[4], 0.6, 0.3, 2), { tone: "hi", crease: "lo", inner: u });
  usvg += range(140, 188, 12).map((y) => `<path class="dc-screen dc-ups" d="${rectX(ups[1], y + 3, y + 9, ups[4] - 7, ups[4] - 4)}"/>`).join("");
  usvg += D(range(140, 188, 12).map((y) => at([ups[1], y + 9.6, FLOOR + 7])), { size: 0.4 });
  usvg += L(range(140, 188, 12).map((y) => k.planOutline({ x: ups[0] + 2, y: y + 2, w: 8, d: 8, r: 0.6 }, ups[4], P, 2)).join(""), { tone: "faint" });
  put([ups[0], ups[2], FLOOR, ups[1], ups[3], ups[4]], usvg, { st: "ups" });

  // battery racks: two tiers of jars per rack, linked terminal to terminal
  for (const [rx0, rx1] of [[176, 186], [192, 202]]) {
    const [ry0, ry1] = [212, 292];
    let svg = "";
    const post = (x, y, near) => S(box(x - 0.5, y - 0.5, FLOOR, x + 0.5, y + 0.5, 26), { tone: "mid", crease: "none" });
    svg += [ry0 + 0.5, (ry0 + ry1) / 2, ry1 - 0.5].map((y) => post(rx0 + 0.5, y)).join("");
    svg += [ry0 + 0.5, (ry0 + ry1) / 2].map((y) => post(rx1 - 0.5, y)).join("");
    for (const shelf of [FLOOR + 1, 15]) {
      svg += S(box(rx0, ry0, shelf, rx1, ry1, shelf + 1, 0, 0.2, 1), { tone: "mid" });
      const zc = shelf + 1;
      const terms = [];
      const links = [];
      for (let i = 0; i < 16; i++) {
        const y = ry0 + 0.6 + i * 5;
        svg += S(box(rx0 + 1.2, y, zc, rx1 - 1.2, y + 4.2, zc + 6.5, 0.3, 0.4, 2), { tone: "hi", crease: "lo" });
        terms.push(at([rx0 + 3, y + 1.2, zc + 6.5]), at([rx0 + 3, y + 3, zc + 6.5]));
        if (i < 15) links.push(top([rx0 + 3, y + 3], [rx0 + 3, y + 6.2], zc + 6.5));
      }
      svg += L(links.join(""), { tone: "mid" }) + D(terms, { size: 0.42, tone: "mid" });
    }
    svg += post(rx1 - 0.5, ry1 - 0.5);
    put([rx0, ry0, FLOOR, rx1, ry1, 26], svg, { st: "ups" });
  }
}

// ---------------------------------------------------------------- NOC with its video wall
function noc() {
  const Y = B.y0 + 6;
  put([346, Y, 14, 384, Y + 1.6, 46], S(box(346, Y, 14, 384, Y + 1.6, 46, 0.3, 0.3, 2), { tone: "mid" }));
  const plane = k.sideMatrix([0, Y + 1.6], 0, P, "left");
  const pane = (x0, z0, x1, z1) => `M${x0} ${-z1}H${x1}V${-z0}H${x0}Z`;
  const panes = [];
  for (const [i, x] of [347.4, 359.2, 371].entries()) for (const z of [30.6, 15.6]) panes.push(pane(x, z, x + 11.2, z + 14.2));
  const wall = [
    `<g transform="${plane}">`,
    `<path class="dc-wall" d="${panes.join("")}"/>`,
    `<text class="dc-wtxt" x="348.6" y="-41.6" font-size="1.4">PUE</text>`,
    `<text class="dc-wbig" data-noc="pue" x="348.6" y="-35" font-size="3.4">1.27</text>`,
    `<path class="dc-spark" data-noc="spark" d="M348.6 -32L357.4 -32"/>`,
    `<text class="dc-wtxt" x="360.4" y="-41.6" font-size="1.4">IT LOAD</text>`,
    `<text class="dc-wbig" data-noc="it" x="360.4" y="-35" font-size="3.4">2.4</text>`,
    `<text class="dc-wtxt" x="360.4" y="-32" font-size="1.4">MW</text>`,
    `<text class="dc-wtxt" x="372.2" y="-41.6" font-size="1.4">SOURCE</text>`,
    `<text class="dc-wmid" data-noc="src" x="372.2" y="-36.4" font-size="1.9">UTILITY</text>`,
    `<path class="dc-wbar" d="M372.2 -33.2H380.6"/><path class="dc-wfill" data-noc="bat" d="M372.2 -33.2H380.6"/>`,
    `<text class="dc-wtxt" x="348.6" y="-26.6" font-size="1.4">REQUEST</text>`,
    ...[0, 1, 2, 3, 4].map((i) => `<circle class="dc-hop" data-hop="${i}" cx="${349.6 + i * 2.2}" cy="-22" r="0.7"/>`),
    `<path class="dc-wline" d="M350.3 -22H357.7"/>`,
    `<text class="dc-wtxt" data-noc="hop" x="348.6" y="-18.4" font-size="1.5">—</text>`,
    `<text class="dc-wtxt" x="360.4" y="-26.6" font-size="1.4">CHW °C</text>`,
    `<text class="dc-wmid" data-noc="chw" x="360.4" y="-21.4" font-size="1.9">14 / 20</text>`,
    `<text class="dc-wtxt" x="372.2" y="-26.6" font-size="1.4">TOWERS</text>`,
    `<text class="dc-wmid" data-noc="fan" x="372.2" y="-21.4" font-size="1.9">72%</text>`,
    `<path class="iso-line" data-tone="lo" d="${panes.join("")}"/>`,
    `</g>`,
  ].join("");
  put([346, Y + 1.6, 14, 384, Y + 1.7, 46], wall, { st: "core" });
  // two rows of operator desks with monitors and chairs
  for (const dy of [148, 170]) {
    let svg = S(box(350, dy, FLOOR, 382, dy + 7, 10.4, 0.4, 0.6, 2), { tone: "mid" });
    for (const mx of [352, 362.5, 373]) {
      svg += S(box(mx, dy + 1, 10.4, mx + 7, dy + 1.6, 15.6, 0, 0.2, 1), { tone: "mid" });
      svg += `<path class="dc-screen" d="${rectY(dy + 1.6, mx + 0.6, mx + 6.4, 11, 15)}"/>`;
    }
    svg += L(top([352, dy + 5.4], [358, dy + 5.4], 10.4), { tone: "lo", free: true });
    put([350, dy, FLOOR, 382, dy + 7, 15.6], svg);
    for (const cx of [356, 366.5, 377]) {
      const cy = dy + 11.5;
      put([cx - 2.4, cy - 2.4, FLOOR, cx + 2.4, cy + 2.4, 13], S(k.cylinder(cx, cy, 0.5, FLOOR, 4, P, 12), { tone: "mid", crease: "none" }) + S(k.cylinder(cx, cy, 2.4, FLOOR + 4, 1.2, P, 24), { tone: "mid" }) + S(box(cx - 2, cy + 1.6, FLOOR + 5.2, cx + 2, cy + 2.4, 13, 0, 0.3, 2), { tone: "mid" }));
    }
  }
}

// ---------------------------------------------------------------- meet-me room
function mmr() {
  const rackRow = (x0, x1, y0, count, z1, st, kind) => {
    const y1 = y0 + count * RACK_W;
    const ys = range(y0, y1 - RACK_W, RACK_W);
    let inner = L(ys.slice(1).map((y) => seg([x1, y, FLOOR], [x1, y, z1])).join(""), { tone: "lo" });
    const face = [];
    for (const y of ys) {
      face.push(rectX(x1, y + 0.5, y + RACK_W - 0.5, FLOOR + 1, z1 - 1));
      const step = kind === "odf" ? 1.1 : kind === "router" ? 0 : 2.4;
      if (step) for (const z of range(FLOOR + 3, z1 - 3, step)) face.push(seg([x1, y + 0.5, z], [x1, y + RACK_W - 0.5, z]));
    }
    if (kind === "router") {
      for (const y of ys) for (const yy of range(y + 1.3, y + RACK_W - 1.3, 0.9)) face.push(seg([x1, yy, FLOOR + 1], [x1, yy, z1 - 7]));
      for (const y of ys) face.push(seg([x1, y + 0.5, z1 - 7], [x1, y + RACK_W - 0.5, z1 - 7]));
    }
    inner += L(face.join(""), { tone: "faint" });
    let svg = S(box(x0, y0, FLOOR, x1, y1, z1, 0.5, 0.3, 2), { tone: "hi", crease: "lo", inner });
    svg += L(ys.slice(1).map((y) => top([x0, y], [x1, y], z1)).join(""), { tone: "faint" });
    if (kind !== "router") svg += D(ys.flatMap((y) => range(FLOOR + 4, z1 - 4, 4.8).map((z, i) => at([x1, y + 1 + (i % 2) * 3.6, z]))), { size: 0.3, tone: "hi", pulse: true });
    put([x0, y0, FLOOR, x1, y1, z1], svg, { st });
  };
  rackRow(366, 378, 206, 2, 30, "mmr", "odf");
  rackRow(366, 378, 220, 3, 32, "core", "router");
  rackRow(366, 378, 244, 6, 30, "core", "switch");
  rackRow(346, 356, 210, 10, 28, "mmr", "carrier");
  // the cage round the carriers: posts, rails, mesh
  const cage = { x0: 344, x1: 360, y0: 206, y1: 274 };
  const posts = [];
  for (const y of range(cage.y0, cage.y1, 17)) posts.push([cage.x1, y]);
  for (const x of [cage.x0]) posts.push([x, cage.y1]);
  const cageBack = [];
  for (const y of range(cage.y0, cage.y1, 17)) cageBack.push([cage.x0, y]);
  for (const [x, y] of cageBack) put([x - 0.4, y - 0.4, FLOOR, x + 0.4, y + 0.4, 26], S(box(x - 0.4, y - 0.4, FLOOR, x + 0.4, y + 0.4, 26), { tone: "mid", crease: "none" }));
  let mesh = "";
  for (const y of range(cage.y0 + 1, cage.y1 - 1, 1.4)) mesh += seg([cage.x1, y, FLOOR + 0.6], [cage.x1, y, 25.4]);
  for (const x of range(cage.x0 + 1, cage.x1 - 1, 1.4)) mesh += seg([x, cage.y1, FLOOR + 0.6], [x, cage.y1, 25.4]);
  const rails = P3([[cage.x1, cage.y0, 25.4], [cage.x1, cage.y1, 25.4], [cage.x0, cage.y1, 25.4]]) + P3([[cage.x1, cage.y0, FLOOR + 0.6], [cage.x1, cage.y1, FLOOR + 0.6], [cage.x0, cage.y1, FLOOR + 0.6]]);
  let svg = L(mesh, { tone: "faint" }) + L(rails, { tone: "mid" });
  svg += [...posts, [cage.x1, cage.y1]].map(([x, y]) => S(box(x - 0.4, y - 0.4, FLOOR, x + 0.4, y + 0.4, 26), { tone: "mid", crease: "none" })).join("");
  put([cage.x1 - 0.4, cage.y0, FLOOR, cage.x1 + 0.4, cage.y1 + 0.4, 26], svg, { st: "mmr" });
  // cross-connect tray over the aisle from the carrier cage to the ODF
  put([351, 211, 32, 369, 214, 33.4], S(box(351, 211, 32, 369, 214, 33.4, 0, 0.2, 1), { tone: "hi", crease: "lo" }), { st: "mmr" });
  put([350.5, 211.5, 28, 351.5, 213.5, 32], S(box(350.5, 211.5, 28, 351.5, 213.5, 32), { tone: "mid", crease: "none" }));
  const xc = [[351, 212.5, 34], [367, 212.5, 34], [367, 212.5, 31]];
  put(bbOf(xc), flow(xc), { st: "mmr" });
}

// ---------------------------------------------------------------- fibre from the street
function fiber() {
  put([356, 330, 0, 386, 352, 5], S(box(356, 330, 0, 386, 352, 5, 0.6, 0.6, 2), { tone: "mid" }) + S(k.cylinder(371, 341, 6, 5, 0.8, P, 40), { tone: "hi", crease: "lo" }) + L(k.ring(371, 341, 4.2, 5.8, P, 32), { tone: "lo" }) + D(Array.from({ length: 8 }, (_, i) => at([371 + 5 * Math.cos((i / 8) * 6.283), 341 + 5 * Math.sin((i / 8) * 6.283), 5.8])), { size: 0.35 }), { st: "fiber" });
  for (const x of [366, 376]) {
    pipe([[x, PLATE.y + PLATE.d, 1.8], [x, 352, 1.8]], 1.4, { st: "fiber", flowSt: "fiber", flanges: [false, true], tone: "hi" });
    pipe([[x, 330, 2.6], [x, 318, 2.6], [x, 312, 7], [x, B.y1, 7]], 1.4, { st: "fiber", flowSt: "fiber", flanges: [true, true], tone: "hi" });
  }
}

// ---------------------------------------------------------------- substation
const PHASES = [350, 363, 376];
function substation() {
  // the line comes in on a lattice tower in the corner
  const [tx, ty] = [36, 366];
  const legs = (z) => { const h = 7 - (z / 100) * 4.6; return [[tx - h, ty - h, z], [tx + h, ty - h, z], [tx + h, ty + h, z], [tx - h, ty + h, z]]; };
  let svg = "";
  for (const [x, y] of [[tx - 7, ty - 7], [tx + 7, ty - 7], [tx + 7, ty + 7], [tx - 7, ty + 7]]) svg += S(box(x - 1.6, y - 1.6, 1, x + 1.6, y + 1.6, 3, 0, 0.3, 2), { tone: "lo" });
  const levels = [3, 18, 34, 50, 64, 76, 86, 96, 100];
  const lines = [];
  for (let i = 0; i < 4; i++) lines.push(seg(legs(3)[i], legs(100)[i]));
  for (const z of levels) lines.push(P3(legs(z), true));
  for (let l = 0; l + 1 < levels.length; l++) {
    const a = legs(levels[l]), b = legs(levels[l + 1]);
    for (const [i, j] of [[1, 2], [2, 3]]) lines.push(seg(a[i], b[j]), seg(a[j], b[i]));
  }
  // cross-arms carry the three phases toward the gantry; the earth wire peak on top
  const arm = (z, half) => seg([tx, ty - half, z], [tx, ty + half, z]);
  lines.push(arm(76, 16), seg([tx, ty - (7 - 0.86 * 4.6), 86], [tx, ty + 12, 86]), seg([tx, ty, 100], [tx, ty, 104]));
  svg += L(lines.join(""), { tone: "mid" });
  const ends = [[tx, ty - 16, 76], [tx, ty + 16, 76], [tx, ty + 12, 86]];
  svg += L(ends.map(([x, y, z]) => seg([x, y, z], [x, y, z - 5])).join(""), { tone: "hi" });
  svg += D([at([tx, ty, 104])], { size: 0.7, tone: "mid" });
  svg += D(ends.flatMap(([x, y, z]) => [0, 1, 2, 3].map((i) => at([x, y, z - 1.2 - i * 1.2]))), { size: 0.7, tone: "hi" });
  put([tx - 9, ty - 18, 0, tx + 9, ty + 18, 104], svg, { st: "grid" });

  // gantry with strain insulators
  const gx = 76;
  let g = "";
  for (const y of [338, 388]) g += S(box(gx - 1.4, y - 1.4, 1, gx + 1.4, y + 1.4, 54, 0.3, 0.3, 2), { tone: "mid" });
  g += S(box(gx - 1.6, 336, 54, gx + 1.6, 390, 57, 0.3, 0.3, 2), { tone: "mid" });
  g += L(PHASES.map((y) => seg([gx, y, 54], [gx, y, 48])).join(""), { tone: "hi" }) + D(PHASES.flatMap((y) => [0, 1, 2, 3].map((i) => at([gx, y, 53 - i * 1.3]))), { size: 0.7, tone: "hi" });
  put([gx - 1.6, 336, 0, gx + 1.6, 390, 57], g, { st: "grid" });
  // the conductors sag between tower and gantry
  const sag = (a, b) => Array.from({ length: 13 }, (_, i) => { const t = i / 12; return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t - 6 * Math.sin(Math.PI * t)]; });
  const tower = [[tx, ty - 16, 71], [tx, ty + 16, 71], [tx, ty + 12, 81]];
  [0, 1, 2].forEach((i) => {
    const pts = sag(tower[[0, 2, 1][i]], [gx, PHASES[i], 48]);
    put(bbOf(pts), `<path class="iso-line dc-wire" data-tone="hi" d="${P3(pts)}"/>` + flow(pts), { st: "grid" });
  });
  // breakers on stands, then the bus to the transformer bushings
  PHASES.forEach((y, i) => {
    let b = S(k.cylinder(92, y, 1.1, 1, 18, P, 16), { tone: "mid", crease: "none" });
    b += S(k.cylinder(92, y, 2.6, 19, 9, P, 28, 0.4), { tone: "hi", crease: "lo" });
    b += L([21, 23, 25].map((z) => k.sideArc(92, y, 2.6, z, P, 16)).join(""), { tone: "faint" });
    b += D([at([92, y, 28])], { size: 0.6, tone: "hi" });
    put([89, y - 2.6, 0, 95, y + 2.6, 28], b, { st: "grid" });
    const down = [[gx, y, 48], [84, y, 40], [92, y, 28]];
    put(bbOf(down), L(P3(down), { tone: "hi" }) + flow(down), { st: "grid" });
    const bus = [[92, y, 28], [100, y, 34], [110, [346, 356, 366][i], 49]];
    put(bbOf(bus), L(P3(bus), { tone: "hi" }) + flow(bus), { st: "grid" });
  });
  transformer(336, "grid", true);
  transformer(266, "grid", false);
  // MV switch house
  let h = S(box(18, 220, 1, 62, 256, 22, 0.6, 0.6, 2), { tone: "mid" });
  h += S(box(16.5, 218.5, 22, 63.5, 257.5, 24, 0.4, 0.6, 2), { tone: "mid" });
  h += L(rectY(256, 24, 34, 1.5, 17) + rectX(62, 228, 250, 12, 18), { tone: "lo" });
  h += L(range(13.2, 17, 1.2).map((z) => seg([62, 228, z], [62, 250, z])).join(""), { tone: "faint" });
  h += D([at([32.6, 256, 9])], { size: 0.45 });
  put([16.5, 218.5, 1, 63.5, 257.5, 24], h, { st: "grid" });
  fence();
}

function transformer(y0, st, live) {
  const [x0, x1, y1, z1] = [98, 124, y0 + 44, 31];
  let svg = S(box(x0 - 3, y0 - 3, 1, x1 + 9, y1 + 9, 2.6, 0, 0.6, 2), { tone: "lo" });
  svg += S(box(x0, y0, 2.6, x1, y1, z1, 0.8, 1.2, 3), { tone: "hi", crease: "lo", inner: L(k.sideSeam({ x: x0, y: y0, w: x1 - x0, d: y1 - y0, r: 1.2 }, z1 - 4, P, 3), { tone: "faint" }) });
  // conservator on two stools
  for (const y of [y0 + 8, y0 + 24]) svg += S(box(102, y - 1, z1, 104, y + 1, z1 + 3.4), { tone: "mid", crease: "none" });
  const F = G.frameAlong([103, y0 + 4, z1 + 7.4], [0, 1, 0]);
  svg += S(G.solidOf([[0, 3.6], [24, 3.6]], F, P), { tone: "mid" }) + L(G.arcOf(F, 12, 3.6, P), { tone: "faint" });
  // HV bushings with their sheds
  for (const y of [y0 + 10, y0 + 20, y0 + 30]) {
    svg += S(k.cylinder(110, y, 2.2, z1, 2, P, 24), { tone: "mid" });
    svg += S(k.cylinder(110, y, 1.3, z1 + 2, 16, P, 20), { tone: "hi", crease: "none" });
    svg += L(range(z1 + 3.4, z1 + 16.6, 1.6).map((z) => k.sideArc(110, y, 1.6, z, P, 12)).join(""), { tone: "lo" });
    svg += D([at([110, y, z1 + 18])], { size: 0.6, tone: "hi" });
  }
  for (const y of [y0 + 12, y0 + 22, y0 + 32]) svg += S(k.cylinder(120, y, 1.2, z1, 5, P, 16), { tone: "mid" });
  // radiators along the near side
  const fins = range(x0 + 2, x1 - 2, 2.4);
  svg += S(box(x0 + 1, y1, 6, x1 - 1, y1 + 1.2, 26, 0, 0.2, 1), { tone: "mid" });
  for (const x of fins) svg += S(box(x - 0.35, y1 + 1.2, 5, x + 0.35, y1 + 8, 27, 0, 0.1, 1), { tone: "mid", crease: "none" });
  put([x0 - 3, y0 - 3, 0, x1 + 9, y1 + 9, z1 + 18], svg, { st });
  // riser for the low-voltage cables, up to the tray
  put([126, y0 + 34, 0, 130, y0 + 38, 40], S(box(126, y0 + 34, 1, 130, y0 + 38, 40, 0, 0.3, 2), { tone: "mid" }) + L(range(6, 36, 5).map((z) => seg([130, y0 + 34, z], [130, y0 + 38, z])).join(""), { tone: "faint" }), { st });
  put([124, y0 + 35, 26, 126, y0 + 37, 29], S(box(124, y0 + 35, 26, 126, y0 + 37, 29), { tone: "mid" }), { st });
}

function fence() {
  const [x0, x1, y0, y1] = [12, 134, 214, 392];
  const side = (a, b, st = "") => {
    const n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 12));
    const posts = Array.from({ length: n + 1 }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n]);
    let svg = "";
    for (const z of [13.6, 7.2, 1.6]) svg += L(P3([[a[0], a[1], z], [b[0], b[1], z]]), { tone: "lo" });
    svg += posts.map(([x, y]) => S(box(x - 0.4, y - 0.4, 1, x + 0.4, y + 0.4, 14), { tone: "mid", crease: "none" })).join("");
    put([Math.min(a[0], b[0]) - 0.4, Math.min(a[1], b[1]) - 0.4, 1, Math.max(a[0], b[0]) + 0.4, Math.max(a[1], b[1]) + 0.4, 14], svg);
  };
  side([x0, y0], [x1, y0]);
  side([x0, y0], [x0, y1]);
  side([x0, y1], [x1, y1]);
  side([x1, y0], [x1, y1]);
}

// ---------------------------------------------------------------- tray from the transformers and the gensets
function ladder(points, st) {
  // a ladder tray on posts: two rails, rungs, and a post at each corner and every 30 units
  for (let i = 0; i + 1 < points.length; i++) {
    const [a, b] = [points[i], points[i + 1]];
    const along = Math.abs(b[0] - a[0]) > Math.abs(b[1] - a[1]) ? "x" : "y";
    const len = Math.abs(along === "x" ? b[0] - a[0] : b[1] - a[1]);
    const n = Math.ceil(len / 20);
    for (let s = 0; s < n; s++) {
      const t0 = s / n, t1 = (s + 1) / n;
      const p0 = [a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0];
      const p1 = [a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1];
      const z = a[2];
      let svg, bb;
      if (along === "x") {
        const [xa, xb] = [Math.min(p0[0], p1[0]), Math.max(p0[0], p1[0])];
        const y = a[1];
        svg = S(box(xa, y - 3, z, xb, y - 2.4, z + 2), { tone: "mid", crease: "none" });
        svg += L(range(xa + 1, xb - 0.5, 2.5).map((x) => top([x, y - 2.4], [x, y + 2.4], z + 0.4)).join(""), { tone: "lo" });
        svg += S(box(xa, y + 2.4, z, xb, y + 3, z + 2), { tone: "mid", crease: "none" });
        bb = [xa, y - 3, z, xb, y + 3, z + 2];
        svg += flow([[p0[0], y, z + 0.6], [p1[0], y, z + 0.6]]) + pflow([[p0[0], y, z + 0.7], [p1[0], y, z + 0.7]], st);
      } else {
        const [ya, yb] = [Math.min(p0[1], p1[1]), Math.max(p0[1], p1[1])];
        const x = a[0];
        svg = S(box(x - 3, ya, z, x - 2.4, yb, z + 2), { tone: "mid", crease: "none" });
        svg += L(range(ya + 1, yb - 0.5, 2.5).map((y) => top([x - 2.4, y], [x + 2.4, y], z + 0.4)).join(""), { tone: "lo" });
        svg += S(box(x + 2.4, ya, z, x + 3, yb, z + 2), { tone: "mid", crease: "none" });
        bb = [x - 3, ya, z, x + 3, yb, z + 2];
        svg += flow([[x, p0[1], z + 0.6], [x, p1[1], z + 0.6]]) + pflow([[x, p0[1], z + 0.7], [x, p1[1], z + 0.7]], st);
      }
      put(bb, svg, { st });
    }
  }
  for (const p of points) {
    if (p[3] === "nopost") continue;
    put([p[0] - 0.6, p[1] - 0.6, 0, p[0] + 0.6, p[1] + 0.6, p[2]], S(box(p[0] - 0.6, p[1] - 0.6, 0, p[0] + 0.6, p[1] + 0.6, p[2]), { tone: "mid", crease: "none" }) + S(box(p[0] - 3.2, p[1] - 3.2, p[2] - 0.6, p[0] + 3.2, p[1] + 3.2, p[2]), { tone: "mid", crease: "none" }));
  }
}

// ---------------------------------------------------------------- generators and fuel
const GENS = [24, 72, 120];
function generators() {
  GENS.forEach((y0, i) => {
    const [x0, x1, y1] = [22, 118, y0 + 28];
    let svg = S(box(x0 - 2, y0 - 2, 0.4, x1 + 2, y1 + 2, 6, 0.4, 0.6, 2), { tone: "lo" });
    let inner = L(range(42, 102, 20).map((x) => seg([x, y1, 6], [x, y1, 34])).join(""), { tone: "faint" });
    inner += L([26, 46, 66].map((x) => rectY(y1, x + 2, x + 14, 8, 30)).join(""), { tone: "lo" });
    inner += L(range(86, 116, 2).map((x) => rectY(y1, x, x + 0.8, 14, 28)).join(""), { tone: "faint" });
    inner += L(rectX(x1, y0 + 3, y1 - 3, 9, 31) + range(11, 29, 2).map((z) => rectX(x1, y0 + 4.5, y1 - 4.5, z, z + 0.7)).join(""), { tone: "lo" });
    svg += S(box(x0, y0, 6, x1, y1, 34, 0.8, 0.8, 2), { tone: "hi", crease: "lo", inner });
    svg += D([30, 50, 70].map((x) => at([x + 11.5, y1, 20])), { size: 0.45 });
    svg += D([[x0 + 2, y0 + 2], [x1 - 2, y0 + 2], [x0 + 2, y1 - 2], [x1 - 2, y1 - 2]].map(([x, y]) => at([x, y, 34])), { size: 0.5 });
    // air intake hood and the silencer on its saddles with the stack
    svg += S(box(98, y0 + 4, 34, 114, y1 - 4, 38, 0.4, 0.4, 2), { tone: "mid" }) + L(range(100, 112, 1.6).map((x) => k.planOutline({ x: x - 0.25, y: y0 + 6, w: 0.5, d: 16, r: 0.25 }, 38, P, 2)).join(""), { tone: "faint" });
    for (const x of [44, 72]) svg += S(box(x - 2, y0 + 10, 34, x + 2, y0 + 18, 36.6), { tone: "mid" });
    const yc = y0 + 14;
    const F = G.frameAlong([38, yc, 40.6], [1, 0, 0]);
    svg += S(G.solidOf([[0, 3.2], [1.2, 4], [38, 4], [39.2, 3.2]], F, P), { tone: "mid" }) + L(G.arcOf(F, 19, 4, P), { tone: "faint" });
    svg += S(k.cylinder(46, yc, 1.8, 44.1, 12, P, 20), { tone: "mid" }) + S(k.cylinder(46, yc, 2.6, 56.1, 0.6, P, 24), { tone: "mid" });
    svg += `<g class="dc-smoke">${[0, 1, 2].map((j) => `<circle class="dc-puff" cx="${at([46, yc, 58])[0].toFixed(1)}" cy="${at([46, yc, 58])[1].toFixed(1)}" r="3" style="--d:${j * 0.9}s"/>`).join("")}</g>`;
    // cable chute from the alternator end into the collector tray
    svg += S(box(x1, y0 + 12, 30, 124, y0 + 16, 33), { tone: "mid", crease: "none" });
    put([x0 - 2, y0 - 2, 0, 124, y1 + 2, 58], svg, { st: "gen", name: `gen${i}` });
  });
  // fuel tank in its bund
  const yc = 178;
  const wall = (x0, y0, x1, y1) => put([x0, y0, 0.4, x1, y1, 4.6], S(box(x0, y0, 0.4, x1, y1, 4.6, 0.3, 0.2, 2), { tone: "lo" }));
  wall(20, 162, 116, 164);
  wall(20, 164, 22, 192);
  let t = "";
  for (const x of [36, 68, 100]) t += S(box(x - 2, yc - 5, 0.4, x + 2, yc + 5, 2.4), { tone: "mid" });
  const F = G.frameAlong([28, yc, 9.6], [1, 0, 0]);
  t += S(G.solidOf([[0, 4], [0.8, 6.4, 1], [2.4, 7.2, 1], [80, 7.2], [81.6, 6.4, 1], [82.4, 4]], F, P), { tone: "hi", crease: "lo" });
  t += L([20, 40, 60].map((s) => G.arcOf(F, s, 7.2, P)).join(""), { tone: "faint" });
  t += S(k.cylinder(60, yc, 1.4, 16.8, 3, P, 16), { tone: "mid" }) + S(k.cylinder(90, yc, 0.6, 16.8, 9, P, 12), { tone: "mid", crease: "none" });
  put([28, yc - 7.2, 0.4, 110.4, yc + 7.2, 25.8], t, { st: "gen" });
  wall(114, 164, 116, 192);
  wall(22, 190, 114, 192);
}

// ---------------------------------------------------------------- cooling towers on the north side
const TOWER = { y0: 18, y1: 94, base: 14, deck: 60 };
const CELLS = [[164, 232], [236, 304]];
function towers() {
  put([162, 16, 0, 306, 96, TOWER.base], S(box(162, 16, 0, 306, 96, TOWER.base, 0.8, 0.8, 2), { tone: "mid", inner: L(k.sideSeam({ x: 162, y: 16, w: 144, d: 80, r: 0.8 }, 10, P, 2), { tone: "faint" }) }) + L(range(186, 290, 24).map((x) => seg([x, 96, 0], [x, 96, 10])).join(""), { tone: "faint" }), { st: "tower" });
  CELLS.forEach(([x0, x1], i) => {
    const cx = (x0 + x1) / 2, cy = (TOWER.y0 + TOWER.y1) / 2;
    let inner = "";
    if (i === CELLS.length - 1) inner += L(range(17, 33, 2.6).map((z) => rectX(x1, TOWER.y0 + 3, TOWER.y1 - 3, z, z + 1.2)).join(""), { tone: "lo" });
    inner += L(range(18, 34, 2.6).map((z) => rectY(TOWER.y1, x0 + 3, x1 - 3, z, z + 1.2)).join(""), { tone: "faint" });
    let svg = S(box(x0, TOWER.y0, TOWER.base, x1, TOWER.y1, TOWER.deck, 0.8, 0.6, 2), { tone: "mid", inner });
    // handrail: far sides before the fan stack, near sides after
    const rail = (pts) => L(P3(pts.map(([x, y]) => [x, y, TOWER.deck + 7])) + P3(pts.map(([x, y]) => [x, y, TOWER.deck + 3.6])), { tone: "lo" });
    const post = (x, y) => S(box(x - 0.35, y - 0.35, TOWER.deck, x + 0.35, y + 0.35, TOWER.deck + 7), { tone: "mid", crease: "none" });
    const [rx0, rx1, ry0, ry1] = [x0 + 1, x1 - 1, TOWER.y0 + 1, TOWER.y1 - 1];
    const far = [...range(rx0, rx1, (rx1 - rx0) / 5).map((x) => [x, ry0]), ...range(ry0, ry1, (ry1 - ry0) / 6).map((y) => [rx0, y])];
    const near = [...range(rx0, rx1, (rx1 - rx0) / 5).map((x) => [x, ry1]), ...range(ry0, ry1, (ry1 - ry0) / 6).map((y) => [rx1, y])];
    svg += far.map(([x, y]) => post(x, y)).join("") + rail([[rx0, ry1], [rx0, ry0], [rx1, ry0]]);
    // fan stack, its opening, the turning blades seen through it
    svg += S(k.cylinder(cx, cy, 24, TOWER.deck, 2, P, 72), { tone: "mid" });
    svg += S(k.cylinder(cx, cy, 22, TOWER.deck + 2, 12, P, 72, 0.6), { tone: "mid", inner: L(k.sideArc(cx, cy, 22, TOWER.deck + 8, P, 36), { tone: "faint" }) });
    const opening = k.onTop(k.circleRing(cx, cy, 20.6, 72), TOWER.deck + 14, P, true);
    svg += `<clipPath id="fan-${i}"><path d="${opening}"/></clipPath><path class="dc-void" d="${opening}"/>`;
    svg += `<g clip-path="url(#fan-${i})"><path class="dc-blade" data-fan="${i}" d="${blades(cx, cy, TOWER.deck + 9, 0)}"/>${D([at([cx, cy, TOWER.deck + 9])], { size: 1.1, tone: "hi" })}</g>`;
    svg += L(opening, { tone: "lo" });
    svg += near.map(([x, y]) => post(x, y)).join("") + rail([[rx0, ry1], [rx1, ry1], [rx1, ry0]]);
    svg += `<g class="dc-plume">${[0, 1, 2].map((j) => { const [px, py] = at([cx, cy, TOWER.deck + 18]); return `<ellipse class="dc-steam" cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" rx="14" ry="7" style="--d:${(j * 1.3 + i * 0.4).toFixed(2)}s"/>`; }).join("")}</g>`;
    put([x0, TOWER.y0, TOWER.base, x1, TOWER.y1, TOWER.deck + 14], svg, { st: "tower" });
  });
  // caged ladder up the east end
  let l = "";
  for (const y of [74, 80]) l += S(box(307.2, y, 0, 308.2, y + 0.8, TOWER.deck + 7), { tone: "mid", crease: "none" });
  for (const z of [20, 44]) l += S(box(304, 73.6, z, 307.2, 81.2, z + 0.8), { tone: "mid", crease: "none" });
  l += L(range(2, TOWER.deck + 5, 2.4).map((z) => seg([307.7, 74.8, z], [307.7, 80, z])).join(""), { tone: "lo" });
  put([304, 73.6, 0, 308.2, 81.2, TOWER.deck + 7], l, { st: "tower" });
}
function blades(cx, cy, z, angle) {
  const out = [];
  for (let b = 0; b < 6; b++) {
    const a = angle + (b * Math.PI) / 3;
    const pts = [[2.4, a - 0.22], [19.6, a - 0.09], [20, a + 0.05], [2.4, a + 0.22]].map(([r, t]) => [cx + r * Math.cos(t), cy + r * Math.sin(t)]);
    out.push(k.onTop(pts, z, P, true));
  }
  return out.join("");
}

// ---------------------------------------------------------------- chillers, their pipes, the rack to the towers
const CHILLERS = [148, 196];
function chillers() {
  CHILLERS.forEach((y0, i) => {
    const ye = y0 + 10, yc = y0 + 24, za = 15;
    put([422, y0, 0.4, 520, y0 + 34, 3], S(box(422, y0, 0.4, 520, y0 + 34, 3, 0.4, 0.4, 2), { tone: "lo" }), { st: "chiller" });
    for (const y of [ye, yc]) {
      let s = "";
      for (const x of [442, 496]) s += S(box(x - 3, y - 5, 3, x + 3, y + 5, 8.2, 0.3, 0.3, 2), { tone: "mid" });
      const F = G.frameAlong([426, y, za], [1, 0, 0]);
      s += S(G.disc(0, 5.6, 8.2, F, P), { tone: "mid" });
      s += S(G.solidOf([[5.6, 7], [80, 7]], F, P), { tone: y === ye ? "hi" : "mid", crease: "lo" });
      s += L([18, 42.8, 68].map((sv) => G.arcOf(F, sv, 7, P)).join(""), { tone: "faint" });
      s += S(G.disc(80, 85.6, 8.2, F, P), { tone: "mid" }) + D(G.dotsOf(F, 85.6, 6.8, 12, P, { all: true }), { size: 0.35 });
      put([426, y - 8.2, 3, 511.6, y + 8.2, za + 8.2], s, { st: y === ye ? "chiller chw" : "chiller" });
    }
    // compressor on its bracket across the shells, discharge line into the condenser
    let c = S(box(452, y0 + 8, 22, 486, y0 + 26, 24.4, 0.3, 0.4, 2), { tone: "mid" });
    const Fc = G.frameAlong([454, y0 + 17, 30], [1, 0, 0]);
    c += S(G.solidOf([[0, 4], [1, 5.6, 1], [2, 5.6], [17, 5.6], [17, 4.8], [29, 4.8], [30, 3.6, 1]], Fc, P), { tone: "hi", crease: "lo" });
    c += L(G.ribsOf(Fc, 3, 15, 5.6, 28, P, { seams: true, least: 0.25 }), { tone: "faint" });
    put([452, y0 + 8, 22, 486, y0 + 26, 35.6], c, { st: "chiller" });
    pipe([[478, y0 + 17, 34.6], [478, y0 + 17, 39], [478, yc, 39], [478, yc, 22]], 1.3, { st: "chiller", flanges: [false, false], tone: "mid" });
    // control panel on the east end
    let p = S(box(514.4, y0 + 3, 3, 520, y0 + 31, 30, 0.4, 0.4, 2), { tone: "mid", inner: L(rectX(520, y0 + 5, y0 + 29, 5, 28), { tone: "lo" }) });
    p += `<path class="dc-screen" d="${rectX(520, y0 + 18, y0 + 26, 20, 25)}"/>` + D([at([520, y0 + 8, 16]), at([520, y0 + 8, 19])], { size: 0.45 });
    put([514.4, y0 + 3, 3, 520, y0 + 31, 30], p, { st: "chiller" });
    // chilled water: two lines into the east wall, under the floor to the CRAHs
    pipe([[426, ye - 3.5, za], [404 - i * 2, ye - 3.5, za], [404 - i * 2, ye - 3.5, 6.2], [B.x1, ye - 3.5, 6.2]], 1.8, { st: "chw", flowSt: "chw", reverse: false, tone: "hi" });
    pipe([[B.x1, ye + 3.5, 9.6], [398 - i * 2, ye + 3.5, 9.6], [398 - i * 2, ye + 3.5, za], [426, ye + 3.5, za]], 1.8, { st: "chw", flowSt: "chw", tone: "hi" });
    // condenser water up to the rack and north to the towers
    const lanes = i === 0 ? [418, 412] : [406, 400];
    const turns = i === 0 ? [[40, "hot"], [48, "cold"]] : [[60, "hot"], [68, "cold"]];
    [yc - 3.5, yc + 3.5].forEach((y, j) => {
      const x = lanes[j];
      const [ty, kind] = turns[j];
      const zEnd = kind === "hot" ? 50 : 7;
      const xEnd = kind === "hot" ? 304 : 306;
      const route = [[426, y, za], [x, y, za], [x, y, 34], [x, ty, 34], [318, ty, 34], [318, ty, zEnd], [xEnd, ty, zEnd]];
      pipe(kind === "hot" ? route : [...route].reverse(), 2.3, { st: "tower", flowSt: "chiller", tone: "mid", maxLength: 14 });
    });
  });
  // pipe rack: T-posts carrying the four condenser lines
  for (const y of [86, 124, 186]) {
    put([408.4, y - 0.6, 0, 409.6, y + 0.6, 30.2], S(box(408.4, y - 0.6, 0.4, 409.6, y + 0.6, 30.2), { tone: "mid", crease: "none" }) + S(box(396, y - 1, 30.2, 422, y + 1, 31.7, 0, 0.2, 1), { tone: "mid", crease: "none" }) + S(box(406.8, y - 2, 0.4, 411.2, y + 2, 1.6), { tone: "lo", crease: "none" }));
  }
}

// ---------------------------------------------------------------- staff car park with a gate booth (cars at true size: 4.5 m)
function parking() {
  ground.push(S(box(400, 262, 0, 540, 400, 0.3, 0, 2, 3), { tone: "lo", crease: "none", className: "dc-asphalt" }));
  const stalls = [];
  for (const y of range(268, 372, 26)) for (const x0 of [404, 488]) stalls.push(k.planOutline({ x: x0, y: y - 0.5, w: 48, d: 1, r: 0.5 }, 0.3, P, 2));
  ground.push(L(stalls.join(""), { tone: "mid" }));
  ground.push(L(range(274, 366, 14).map((y) => k.planOutline({ x: 469.4, y, w: 1.2, d: 6, r: 0.6 }, 0.3, P, 2)).join(""), { tone: "mid" }));
  flushGround();
  const car = (x0, y0, faceEast) => {
    const x1 = x0 + 44, y1 = y0 + 18;
    let svg = "";
    for (const wx of [x0 + 8, x1 - 8]) for (const wy of [y0 + 1.2, y1 - 1.2]) svg += S(k.cylinder(wx, wy, 3.2, 0.3, 2, P, 18), { tone: "lo", crease: "none" });
    svg += S(box(x0, y0 + 1, 2.6, x1, y1 - 1, 9.6, 0.5, 3, 5), { tone: "mid", inner: L(k.sideSeam({ x: x0, y: y0 + 1, w: 44, d: 16, r: 3 }, 6.4, P, 5), { tone: "faint" }) });
    const [c0, c1] = faceEast ? [x0 + 9, x0 + 31] : [x1 - 31, x1 - 9];
    svg += S(box(c0, y0 + 2.6, 9.6, c1, y1 - 2.6, 15.4, 0.4, 2.4, 5), { tone: "mid" });
    svg += `<path class="dc-screen" d="${rectY(y1 - 2.6, c0 + 2, (c0 + c1) / 2 - 0.6, 10.4, 14.4) + rectY(y1 - 2.6, (c0 + c1) / 2 + 0.6, c1 - 2, 10.4, 14.4)}"/>`;
    svg += `<path class="dc-screen" d="${faceEast ? rectX(c1, y0 + 4, y1 - 4, 10.4, 14.4) : ""}"/>`;
    put([x0, y0, 0.3, x1, y1, 15.4], svg);
  };
  car(406, 270, true);
  car(406, 322, true);
  car(490, 270, false);
  car(490, 348, false);
  // gate booth and barrier at the entrance
  let b = S(box(520, 380, 0.3, 536, 396, 22, 0.4, 0.8, 2), { tone: "mid", inner: L(rectX(536, 383, 393, 9, 18), { tone: "lo" }) });
  b += `<path class="dc-screen" d="${rectX(536, 384, 392, 10, 17)}"/>`;
  b += S(box(518, 378, 22, 538, 398, 24, 0.3, 0.8, 2), { tone: "mid" });
  put([518, 378, 0.3, 538, 398, 24], b);
  put([514, 391, 0.3, 518, 395, 9], S(box(514, 391, 0.3, 518, 395, 9, 0.3, 0.4, 2), { tone: "mid" }));
  put([470, 392.4, 7.4, 514, 393.6, 8.6], S(box(470, 392.4, 7.4, 514, 393.6, 8.6, 0, 0.5, 2), { tone: "hi", crease: "none" }));
}

// ---------------------------------------------------------------- exploded hall: the layers lift straight up, the top one first
const LAYERS = [
  { name: "racks", lift: 34 },
  { name: "containment", lift: 66 },
  { name: "power tray", lift: 96 },
  { name: "fibre trough", lift: 124 },
];
const SPRING = { stagger: 0.07, stiffness: 64, damping: 14.2 };

// ---------------------------------------------------------------- battery yard: four LFP containers and their power conversion skids
const BESS_BOXES = [26, 64, 102, 140];
function bessYard() {
  BESS_BOXES.forEach((y0, i) => {
    const [x0, x1, y1, z1] = [26, 112, y0 + 26, 27];
    let svg = S(box(x0 - 2, y0 - 1, 0.4, x1 + 2, y1 + 1, 2.4, 0.3, 0.4, 2), { tone: "lo" });
    let inner = L(range(x0 + 3, x1 - 3, 3).map((x) => seg([x, y1, 2.4], [x, y1, z1])).join(""), { tone: "faint" });
    inner += L([34, 58, 82].map((x) => rectY(y1, x, x + 14, 4, 24)).join(""), { tone: "lo" });
    inner += L(rectX(x1, y0 + 4, y1 - 4, 6, 24), { tone: "lo" });
    svg += S(box(x0, y0, 2.4, x1, y1, z1, 0.6, 0.6, 2), { tone: "hi", crease: "lo", inner });
    svg += L(range(x0 + 6, x1 - 6, 12).map((x) => top([x, y0], [x, y1], z1)).join(""), { tone: "faint" });
    // state-of-charge gauge on the door side: the fill is redrawn live
    svg += L(rectY(y1, 100, 106, 5, 23), { tone: "mid" });
    svg += `<path class="dc-soc" data-soc="${i}" d="${rectY(y1, 100.6, 105.4, 5.6, 5.6 + 16.8 * 0.8)}"/>`;
    // HVAC unit on the east end
    svg += S(box(x1, y0 + 5, 8, x1 + 4, y1 - 5, 24, 0.3, 0.4, 2), { tone: "mid", inner: L(range(10, 22, 2).map((z) => rectX(x1 + 4, y0 + 7, y1 - 7, z, z + 0.8)).join(""), { tone: "faint" }) });
    svg += S(box(x1 - 8, y0 + 11, z1, x1, y0 + 14, 30, 0, 0.3, 2), { tone: "mid", crease: "none" }) + S(box(x1 + 1.5, y0 + 11, 30, x1 + 7, y0 + 14, 33, 0, 0.3, 2), { tone: "mid", crease: "none" });
    svg += S(box(x1 - 8, y0 + 11, 30, x1 + 1.5, y0 + 14, 33, 0, 0.3, 2), { tone: "mid", crease: "none" });
    put([x0 - 2, y0 - 1, 0.4, x1 + 7, y1 + 1, 33], svg, { st: "bess" });
    put([x1 + 5.5, y0 + 11, 33, x1 + 7, y0 + 14, 38], S(box(x1 + 5.5, y0 + 11, 33, x1 + 7, y0 + 14, 38), { tone: "mid", crease: "none" }), { st: "bess" });
  });
  // power conversion: two 1.25 MW inverter-transformer skids
  for (const x0 of [30, 72]) {
    let svg = S(box(x0, 170, 0.4, x0 + 30, 190, 20, 0.5, 0.6, 2), { tone: "mid", inner: L(range(x0 + 3, x0 + 27, 2).map((x) => rectY(190, x, x + 0.8, 4, 16)).join(""), { tone: "faint" }) });
    svg += S(box(x0 + 4, 173, 20, x0 + 26, 187, 22, 0.3, 0.4, 2), { tone: "mid" });
    put([x0, 170, 0.4, x0 + 30, 190, 22], svg, { st: "bess" });
  }
}

// ---------------------------------------------------------------- biomass CHP: husk shed, gasifier, gas cleaning, engine
const CHP_STACK = [92, 263, 48.6];
function chp() {
  // husk shed: open on two sides so the heaps show
  const shed = { x0: 18, x1: 80, y0: 300, y1: 388, z: 30 };
  put([shed.x0, shed.y0, 0.4, shed.x0 + 2, shed.y1, shed.z], S(box(shed.x0, shed.y0, 0.4, shed.x0 + 2, shed.y1, shed.z, 0.3, 0.2, 2), { tone: "mid" }), { st: "biomass" });
  put([shed.x0, shed.y0, 0.4, shed.x1, shed.y0 + 2, shed.z], S(box(shed.x0 + 2, shed.y0, 0.4, shed.x1, shed.y0 + 2, shed.z, 0.3, 0.2, 2), { tone: "mid" }), { st: "biomass" });
  [[42, 330, 17], [50, 364, 15]].forEach(([cx, cy, r]) => {
    const F = G.frameAlong([cx, cy, 0.4], [0, 0, 1]);
    put([cx - r, cy - r, 0.4, cx + r, cy + r, 0.4 + r * 0.8], `<g class="dc-husk">${S(G.solidOf([[0, r], [r * 0.15, r * 0.86, 1], [r * 0.45, r * 0.6, 1], [r * 0.7, r * 0.3, 1], [r * 0.8, 0.01]], F, P), { tone: "mid", crease: "none" })}</g>`, { st: "biomass" });
  });
  let posts = "";
  for (const [x, y] of [[78.6, 301.4], [78.6, 344], [78.6, 386.6], [48, 386.6], [19.4, 386.6]]) posts += S(k.cylinder(x, y, 0.8, 0.4, shed.z - 0.4, P, 12), { tone: "mid", crease: "none" });
  put([18, 300, 0.4, 80, 388, shed.z], posts, { st: "biomass", bias: 0.4 });
  put([16, 298, shed.z, 82, 390, shed.z + 2], S(box(16, 298, shed.z, 82, 390, shed.z + 2, 0.4, 0.4, 2), { tone: "mid", inner: L(range(310, 382, 12).map((y) => seg([82, y, shed.z], [82, y, shed.z + 2])).join(""), { tone: "faint" }) }) + L(range(310, 380, 12).map((y) => top([16, y], [82, y], shed.z + 2)).join(""), { tone: "faint" }), { st: "biomass" });
  // gasifier: a downdraft reactor on a skid with a hopper on top
  let g = S(box(42, 224, 0.4, 70, 252, 4, 0.4, 0.6, 2), { tone: "lo" });
  const F = G.frameAlong([56, 238, 4], [0, 0, 1]);
  g += S(G.solidOf([[0, 8], [28, 8], [30, 7.6, 1], [33, 5.6, 1], [36, 3]], F, P), { tone: "hi", crease: "lo" }) + L([8, 16, 24].map((sv) => G.arcOf(F, sv, 8, P)).join(""), { tone: "faint" });
  g += S(box(52, 234, 40, 60, 242, 48, 0.3, 0.4, 2), { tone: "mid" });
  g += `<g class="dc-glow"><path d="${rectX(64, 236, 240, 8, 12)}"/></g>`;
  put([42, 224, 0.4, 70, 252, 48], g, { st: "biomass" });
  // gas cleaning: cyclone and filter vessels on a skid
  let c = S(box(44, 262, 0.4, 74, 280, 14, 0.5, 0.6, 2), { tone: "mid", inner: L(rectY(280, 48, 70, 3, 11), { tone: "lo" }) });
  for (const x of [51, 59, 67]) c += S(k.cylinder(x, 271, 3.2, 14, 12, P, 24), { tone: "mid" }) + L(k.sideArc(x, 271, 3.2, 20, P, 12), { tone: "faint" });
  put([44, 262, 0.4, 74, 280, 26], c, { st: "biomass" });
  // the engine-generator in its enclosure, and its stack
  let e = S(box(82, 248, 0.4, 126, 278, 3, 0.4, 0.6, 2), { tone: "lo" });
  let inner = L([86, 100].map((x) => rectY(278, x, x + 11, 5, 22)).join(""), { tone: "lo" }) + L(range(114, 123, 1.8).map((x) => rectY(278, x, x + 0.8, 8, 20)).join(""), { tone: "faint" });
  inner += L(rectX(124, 252, 274, 6, 22) + range(8, 21, 2).map((z) => rectX(124, 253.5, 272.5, z, z + 0.7)).join(""), { tone: "lo" });
  e += S(box(84, 250, 3, 124, 276, 26, 0.6, 0.6, 2), { tone: "hi", crease: "lo", inner });
  e += S(k.cylinder(CHP_STACK[0], CHP_STACK[1], 1.8, 26, 22, P, 20), { tone: "mid" }) + S(k.cylinder(CHP_STACK[0], CHP_STACK[1], 2.6, 48, 0.6, P, 24), { tone: "mid" });
  e += `<g class="dc-smoke">${[0, 1, 2].map((j) => `<circle class="dc-puff" cx="${at([CHP_STACK[0], CHP_STACK[1], 50])[0].toFixed(1)}" cy="${at([CHP_STACK[0], CHP_STACK[1], 50])[1].toFixed(1)}" r="3" style="--d:${j * 0.9}s"/>`).join("")}</g>`;
  e += S(box(124, 260, 20, 128, 264, 38), { tone: "mid", crease: "none" });
  put([82, 248, 0.4, 128, 278, 49], e, { st: "biomass" });
  // husk conveyor up to the hopper, gas line to the cleaning skid and on to the engine
  pipe([[72, 318, 4], [66, 292, 22], [57, 250, 44], [56, 242.4, 45]], 1.5, { st: "biomass", tone: "mid", flanges: [false, true] });
  pipe([[64.1, 238, 24], [74, 238, 24], [74, 266, 24], [74, 266, 14.2]], 1.4, { st: "biomass", tone: "mid", flanges: [false, true] });
  pipe([[74.2, 271, 10], [84, 271, 10]], 1.4, { st: "biomass", tone: "mid", flanges: [true, true] });
}

// ---------------------------------------------------------------- solar field: 77 single-axis tracker tables in 11 rows, axis north–south
const TABLES = [];
for (let i = 0; i < 11; i++) for (let j = 0; j < 7; j++) TABLES.push({ x: 580 + 26 * i, y0: -2 + 58 * j, y1: 50 + 58 * j, z: 11, w: 13 });
function solarField() {
  TABLES.forEach((T, n) => {
    let base = "";
    for (const y of [T.y0 + 4, (T.y0 + T.y1) / 2, T.y1 - 4]) base += S(box(T.x - 0.5, y - 0.5, 0.6, T.x + 0.5, y + 0.5, T.z - 0.9), { tone: "mid", crease: "none" });
    const yc = (T.y0 + T.y1) / 2;
    base += S(box(T.x + 0.5, yc - 1.5, T.z - 4, T.x + 2.6, yc + 1.5, T.z - 1), { tone: "mid", crease: "none" });
    const F = G.frameAlong([T.x, T.y0 + 1, T.z], [0, 1, 0]);
    const tube = S(G.solidOf([[0, 0.9], [T.y1 - T.y0 - 2, 0.9]], F, P), { tone: "mid", crease: "none" });
    rec({ t: "panel", x: T.x, y0: T.y0, y1: T.y1, z: T.z, w: T.w, i: n });
    const { svg, facing } = panelSvg(T, 0, P, k.iso, k.pathOf);
    const tubeG = `<g data-tube>${tube}</g>`, panelG = `<g data-panel="${n}">${svg}</g>`;
    put([T.x - T.w / 2 - 0.5, T.y0, 0.6, T.x + T.w / 2 + 0.5, T.y1, T.z + 7], base + (facing ? tubeG + panelG : panelG + tubeG), { st: "solar" });
  });
  // string inverters at the field edge and the collector cable along it
  for (const y0 of [236, 262]) {
    let svg = S(box(546, y0, 0.6, 562, y0 + 20, 22, 0.5, 0.6, 2), { tone: "mid", inner: L(range(y0 + 3, y0 + 17, 2).map((y) => rectX(562, y, y + 0.8, 5, 18)).join(""), { tone: "faint" }) });
    svg += S(box(549, y0 + 3, 22, 559, y0 + 17, 24, 0.3, 0.4, 2), { tone: "mid" });
    put([546, y0, 0.6, 562, y0 + 20, 24], svg, { st: "solar" });
  }
  pipe([[564, -2, 1.4], [564, 236, 1.4]], 1, { st: "solar", tone: "mid", flanges: [false, true], maxLength: 30 });
  put([552, 282, 22, 556, 286, 38], S(box(552, 282, 22, 556, 286, 38), { tone: "mid", crease: "none" }), { st: "solar" });
  for (let y = -2; y < 236; y += 34) put([563, y, 1.4, 565, Math.min(236, y + 34), 2.6], pflow([[564, y, 2.5], [564, Math.min(236, y + 34), 2.5]], "solar"), { st: "solar", bias: 0.1 });
}

// ---------------------------------------------------------------- assemble
plinth();
flushGround();
building();
hall();
trays();
electrical();
noc();
mmr();
fiber();
bessYard();
chp();
solarField();
towers();
chillers();
parking();
// power: transformers to the utility section, gensets to the generator section
ladder([[128, 262, 40, "nopost"], [128, 228, 40], [161, 228, 40, "nopost"]], "biomass");
ladder([[125, 40, 38, "nopost"], [125, 88, 38], [125, 136, 38], [125, 144, 38], [161, 144, 38, "nopost"]], "bess");
ladder([[554, 284, 40, "nopost"], [554, 316, 40], [460, 316, 40], [360, 316, 40], [250, 316, 40], [170, 316, 40], [170, 190, 40], [161, 190, 40, "nopost"]], "solar");
for (const [y, zt, st] of [[228, 40, "biomass"], [144, 38, "bess"], [190, 40, "solar"]]) put([159.5, y - 1.5, 34, 162.5, y + 1.5, zt], S(box(159.5, y - 1.5, 34, 162.5, y + 1.5, zt), { tone: "mid", crease: "none" }), { st });

const { out: ordered, cycles } = painter(items);
const THREE_TAG = `<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>`;
const SCENE = {
  ground: groundPrims,
  items: items.filter((it) => it.prims.length).map((it) => ({ st: it.st.split(" ")[0] || "", layer: it.layer || 0, p: it.prims })),
};
console.log("3D scene", SCENE.items.length, "items", SCENE.items.reduce((n, it) => n + it.p.length, 0) + SCENE.ground.length, "prims", (JSON.stringify(SCENE).length / 1024).toFixed(0) + " KB");
const DATA_JS = () => `const LAYERS = ${JSON.stringify(LAYERS.map((l) => ({ ...l, step: k.axisVector(P, [0, 0, l.lift]) })))};\nconst SPRING = ${JSON.stringify(SPRING)};\nconst GL = ${JSON.stringify({ W, H, camera: glCamera(P), towers: [...CELLS.flatMap(([x0, x1]) => [(x0 + x1) / 2, (TOWER.y0 + TOWER.y1) / 2, TOWER.deck + 14]), -9999, -9999, 0], stacks: [...CHP_STACK, -9999, -9999, 0, -9999, -9999, 0] })};\nconst SHADER = ${JSON.stringify(SHADER)};\nconst SCENE = ${JSON.stringify(SCENE)};\n`;
const SITE_BOX = (() => {
  const pts = [...k.boxCorners(PLATE, -18, 0), ...items.flatMap(({ bb: [x0, y0, z0, x1, y1, z1] }) => [[x0, y0, z1], [x1, y1, z1], [x0, y1, z1], [x1, y0, z1]])].map(at);
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)].map((v) => +v.toFixed(1));
})();
const FOCUS = Object.fromEntries(STATIONS.map((st) => {
  const pts = [];
  for (const it of items) {
    if (!(" " + it.st + " ").includes(" " + st.id + " ")) continue;
    const [x0, y0, z0, x1, y1, z1] = it.bb;
    for (const x of [x0, x1]) for (const y of [y0, y1]) for (const z of [z0, z1]) pts.push(at([x, y, z]));
  }
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return [st.id, [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)].map((v) => +v.toFixed(1))];
}));
const SCRIPT = () =>
  kitScript() + glScript() +
  `const P = ${JSON.stringify(P)};\nconst STATIONS = ${JSON.stringify(STATIONS)};\nconst FANS = ${JSON.stringify(CELLS.map(([x0, x1]) => [(x0 + x1) / 2, (TOWER.y0 + TOWER.y1) / 2, TOWER.deck + 9]))};\nconst FOCUS = ${JSON.stringify(FOCUS)};\nconst SITE_BOX = ${JSON.stringify(SITE_BOX)};\nconst VIEW = [${W}, ${H}];\nconst blades = ${blades.toString().replace(/k\.onTop/g, "onTop")};\nconst createPlant = ${createPlant.toString()};\nconst sheetOf = ${sheetOf.toString()};\nconst createMicrogrid = ${createMicrogrid.toString()};\nconst panelSvg = ${panelSvg.toString()};\nconst TABLES = ${JSON.stringify(TABLES)};\nconst BESS_BOXES = ${JSON.stringify(BESS_BOXES)};\n` +
  DATA_JS() + LIVE + VIEW3D + "\nif (!V3) viewButton.disabled = true;\n";
const body = [
  ...ground,
  ...ordered.map((it) => `<g class="it"${it.st ? ` data-st="${it.st}"` : ""}${it.layer ? ` data-layer="${it.layer}"` : ""}>${it.svg}</g>`),
];

const OLD_CSS = `
.iso-page{width:min(1240px,100% - 32px)}
.dc-svg .it{transition:opacity .4s var(--anatomy-ease)}
.dc-svg[data-focus] .it:not([data-on]) .iso-edge[data-tone="hi"]{stroke:var(--anatomy-mid)}
.dc-svg[data-focus] .it:not([data-on]) .iso-edge[data-tone="mid"]{stroke:var(--anatomy-lo)}
.dc-svg .it[data-on] .iso-solid>.iso-edge{stroke:var(--anatomy-lit);stroke-width:1.15px}
.dc-svg .it[data-on] .tb-edge,.dc-svg .it[data-on] .tb>path:last-child{stroke-width:1.15px}
.dc-svg .it[data-on] .iso-solid>.iso-top{fill:var(--anatomy-lit-top)}
.dc-svg .it[data-on] .iso-solid>.iso-shade{fill:var(--anatomy-lit-shade)}
.dc-svg .it[data-on] .iso-solid>.iso-fill{fill:var(--anatomy-face)}
.dc-svg .it[data-on] .iso-line[data-tone="faint"]{stroke:var(--anatomy-lo)}
.dc-svg .it[data-on] .tb-shine{fill:var(--anatomy-lit-top)}
.dc-svg .it[data-on] .tb-body{fill:var(--anatomy-face)}
.dc-svg .it[data-on] .tb .iso-line,.dc-svg .it[data-on] .tb path[class*="edge"]{stroke:var(--anatomy-lit)}
.dc-flow{display:none;stroke-width:1.4px}
.dc-svg .it[data-on] .dc-flow{display:inline}
.dc-cut>.iso-top{fill:var(--dc-cut)}
.dc-asphalt>.iso-top{fill:var(--dc-asphalt)}
.dc-gravel>.iso-top{fill:var(--dc-gravel)}
.dc-screen{fill:var(--dc-glass);stroke:var(--anatomy-lo);stroke-width:var(--anatomy-weight)}
.dc-ups{transition:fill .4s}
.dc-svg[data-source="battery"] .dc-ups{fill:var(--anatomy-red)}
.dc-svg[data-source="gen"] .dc-ups{fill:var(--dc-amber)}
.dc-void{fill:var(--dc-void)}
.dc-blade{fill:var(--anatomy-shade-1);stroke:var(--anatomy-mid);stroke-width:var(--anatomy-weight);stroke-linejoin:round}
.dc-wall{fill:var(--dc-glass)}
.dc-wtxt{fill:var(--dc-ink);font-family:var(--anatomy-mono);opacity:.7}
.dc-wbig,.dc-wmid{fill:var(--dc-ink);font-family:var(--anatomy-mono);font-weight:600}
.dc-spark{fill:none;stroke:var(--dc-ink);stroke-width:.6px;vector-effect:non-scaling-stroke}
.dc-wbar{stroke:var(--anatomy-lo);stroke-width:1.6px;vector-effect:non-scaling-stroke}
.dc-wfill{stroke:var(--dc-ink);stroke-width:1.6px;vector-effect:non-scaling-stroke}
.dc-wline{stroke:var(--anatomy-lo);stroke-width:.5px;vector-effect:non-scaling-stroke}
.dc-hop{fill:var(--anatomy-lo)}
.dc-hop[data-lit]{fill:var(--dc-ink)}
.dc-svg[data-source="battery"] [data-noc="src"]{fill:var(--anatomy-red)}
.dc-svg[data-source="gen"] [data-noc="src"]{fill:var(--dc-amber)}
.dc-svg[data-grid="off"] .dc-wire{stroke-dasharray:1 3}
.dc-smoke,.dc-plume{opacity:0;transition:opacity 1.2s var(--anatomy-ease)}
.dc-svg[data-gens="run"] .dc-smoke{opacity:1}
.dc-svg[data-towers="run"] .dc-plume{opacity:1}
.dc-puff{fill:var(--dc-smoke);filter:blur(2px);animation:dc-rise 2.7s linear infinite;animation-delay:var(--d);transform-box:fill-box;transform-origin:center}
.dc-steam{fill:var(--dc-steam);filter:blur(5px);animation:dc-steam 3.9s linear infinite;animation-delay:var(--d);transform-box:fill-box;transform-origin:center}
@keyframes dc-rise{0%{transform:translate(0,0) scale(.4);opacity:0}15%{opacity:.8}100%{transform:translate(10px,-34px) scale(2.4);opacity:0}}
@keyframes dc-steam{0%{transform:translate(0,4px) scale(.5);opacity:0}20%{opacity:.7}100%{transform:translate(8px,-46px) scale(1.7);opacity:0}}
.dc-busy circle{animation-duration:420ms!important}
.dc-stops{display:flex;flex-wrap:wrap;gap:6px;margin:14px 0 4px}
.dc-stop{all:unset;cursor:pointer;display:inline-flex;gap:7px;align-items:baseline;padding:5px 9px;border-radius:6px;box-shadow:0 0 0 1px var(--anatomy-lo);color:var(--anatomy-text);font:12px/1.2 ui-sans-serif,system-ui,sans-serif}
.dc-stop:hover{box-shadow:0 0 0 1px var(--anatomy-mid)}
.dc-stop[aria-pressed="true"]{box-shadow:0 0 0 1px var(--anatomy-strong);color:var(--anatomy-strong)}
.dc-stop:focus-visible{outline:1px solid var(--anatomy-muted);outline-offset:3px}
.dc-num{font-family:var(--anatomy-mono);color:var(--anatomy-muted);font-size:11px}
.dc-what{min-height:3.2em;color:var(--anatomy-text);font-size:14px;line-height:1.55;margin:6px 0 0}
.dc-what b{color:var(--anatomy-strong);font-weight:600}
.dc-bar{display:flex;gap:10px;flex-wrap:wrap;margin-top:8px}
.dc-btn{all:unset;cursor:pointer;padding:6px 11px;border-radius:6px;box-shadow:0 0 0 1px var(--anatomy-mid);color:var(--anatomy-strong);font:12px/1.2 ui-sans-serif,system-ui,sans-serif}
.dc-btn:focus-visible{outline:1px solid var(--anatomy-muted);outline-offset:3px}
.dc-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.iso-stage{touch-action:pan-y}
.iso-stage:focus{outline:none}
.iso-stage:focus-visible{outline:1px solid var(--anatomy-muted);outline-offset:6px}
.iso{--dc-sun:#e39b12;--dc-batt:#24996a;--dc-bio:#9a6332;--dc-out:#d83a3a;--dc-shed:#e8862a;--dc-pv:#2c4a6e;--dc-pv-line:#5f7fa6;--dc-pv-lit:#3d6596;--dc-nightc:#28365e;--dc-husk:#d9b77a;--dc-husk-d:#b8925a;--dc-cold:#3e7bd6;--dc-hot:#d9483b;--dc-cut:#d6d6d2;--dc-asphalt:#ececea;--dc-gravel:#f1f1ee;--dc-glass:#e9ecef;--dc-ink:#1f2a33;--dc-void:#c9c9c5;--dc-amber:#d9822b;--dc-smoke:#7d7d78;--dc-steam:#c4ccd2}
.iso[data-theme="dark"]{--dc-sun:#ffbf47;--dc-batt:#4cc38a;--dc-bio:#c58c55;--dc-out:#ff6b6b;--dc-shed:#ffa45c;--dc-pv:#24405f;--dc-pv-line:#4d6d93;--dc-pv-lit:#3a6aa2;--dc-nightc:#3a4a78;--dc-husk:#8a7046;--dc-husk-d:#6c5636;--dc-cold:#5d93e6;--dc-hot:#ef6a5c;--dc-cut:#161616;--dc-asphalt:#161616;--dc-gravel:#171717;--dc-glass:#0e1418;--dc-ink:#cfe3ef;--dc-void:#080808;--dc-amber:#f0a050;--dc-smoke:#3a3a3a;--dc-steam:#5a6268}
.iso-plate{position:relative}
.dc-sheet{gap:12px}
.dc-sheet .dc-sh-head{display:flex;justify-content:space-between;align-items:flex-start;gap:8px}
.dc-sh-head h2{font-size:18px}
.dc-math{all:unset;cursor:pointer;width:26px;height:26px;display:grid;place-items:center;border-radius:50%;box-shadow:0 0 0 1px var(--anatomy-lo);font:italic 600 14px Georgia,serif;color:var(--anatomy-muted)}
.dc-math[aria-pressed="true"]{box-shadow:0 0 0 1px var(--anatomy-strong);color:var(--anatomy-strong)}
.dc-math:focus-visible{outline:1px solid var(--anatomy-muted);outline-offset:2px}
.dc-dims{width:150px;height:auto;justify-self:center;overflow:visible}
.dc-d-top{fill:var(--anatomy-top);stroke:var(--anatomy-mid);stroke-width:.8}
.dc-d-left{fill:var(--anatomy-shade-1);stroke:var(--anatomy-mid);stroke-width:.8}
.dc-d-right{fill:var(--anatomy-shade-2);stroke:var(--anatomy-mid);stroke-width:.8}
.dc-dims text{font:9.5px var(--anatomy-mono);fill:var(--anatomy-muted)}
.dc-inst{width:100%;height:auto;display:block;overflow:visible}
.dc-inst text{font:9px var(--anatomy-mono);fill:var(--anatomy-muted)}
.dc-inst .on{fill:var(--anatomy-strong)}
.dc-i-grid{stroke:var(--anatomy-faint);stroke-width:.6}
.dc-i-bar{fill:var(--anatomy-lo)}
.dc-i-bar.on{fill:var(--anatomy-strong)}
.dc-i-tick{stroke:var(--anatomy-paper);stroke-width:1.2}
.dc-i-tick.on{stroke:var(--anatomy-strong);stroke-width:1.4}
.dc-i-big{font:600 13px var(--anatomy-mono)!important;fill:var(--anatomy-strong)!important}
.dc-i-seg{fill:var(--anatomy-shade-2);stroke:none}
.dc-i-seg.s0{fill:var(--anatomy-mid)}
.dc-i-seg.s1{fill:var(--anatomy-lo)}
.dc-i-seg.s3{fill:var(--anatomy-faint)}
.dc-i-seg.on{fill:var(--anatomy-strong)}
.dc-tiles{display:grid;grid-template-columns:1fr 1fr;gap:10px 14px}
.dc-tile{display:grid;gap:3px;min-width:0}
.dc-tile .dc-k{font:10px/1.2 var(--anatomy-mono);text-transform:uppercase;letter-spacing:.08em;color:var(--anatomy-muted)}
.dc-tile .dc-v{font:600 16px/1.15 var(--anatomy-mono);color:var(--anatomy-strong);text-align:left;font-variant-numeric:tabular-nums;white-space:nowrap}
.dc-meter{height:3px;border-radius:2px;background:var(--anatomy-faint);overflow:hidden}
.dc-meter i{display:block;height:100%;background:var(--anatomy-hi);transition:width .3s var(--anatomy-ease)}
.dc-tile .dc-eq{display:none;font:10px/1.35 var(--anatomy-mono);color:var(--anatomy-muted)}
.dc-sheet[data-show-math] .dc-tile .dc-eq{display:block}
.dc-sh-nav{align-items:center}
.dc-sh-nav .dc-sh-time{flex:1;text-align:center;font:10.5px var(--anatomy-mono);color:var(--anatomy-muted)}
.dc-sh-nav .dc-btn:nth-child(2){flex:none}
.dc-stops{display:flex;flex-wrap:wrap;gap:10px 22px;margin:16px 0 6px}
.dc-group{display:flex;flex-wrap:wrap;align-items:center;gap:6px}
.dc-group-name{font:10px var(--anatomy-mono);text-transform:uppercase;letter-spacing:.12em;color:var(--anatomy-muted);margin-right:2px}
.dc-group[data-group="request"] .dc-num{color:var(--anatomy-blue)}
.dc-group[data-group="heat"] .dc-num{color:var(--anatomy-red)}
.dc-group[data-group="power"] .dc-num{color:var(--dc-amber)}
.dc-what{min-height:0;font-size:14px;margin:8px 0 0}
.dc-more{margin-top:18px;color:var(--anatomy-muted);font-size:13px;line-height:1.6}
.dc-more summary{cursor:pointer;font:11px var(--anatomy-mono);text-transform:uppercase;letter-spacing:.1em}
.dc-more p{max-width:68ch}

.iso-plate[data-zoomed] .dc-svg{cursor:grab}
.iso-plate[data-zoomed] .dc-svg:active{cursor:grabbing}
.dc-svg .it[data-st]{cursor:pointer}
.dc-sheet{position:absolute;top:44px;right:20px;bottom:44px;width:min(340px,40%);overflow:auto;display:grid;gap:14px;align-content:start;padding:16px 16px 14px;background:color-mix(in srgb,var(--anatomy-card) 94%,transparent);box-shadow:0 0 0 1px var(--anatomy-lo),0 12px 30px -18px #0004;backdrop-filter:blur(6px);color:var(--anatomy-text);font:13px/1.45 ui-sans-serif,system-ui,sans-serif;z-index:2}
.dc-sheet[hidden]{display:none}
.dc-sh-head{display:grid;gap:2px}
.dc-sh-num{font:11px/1 var(--anatomy-mono);color:var(--anatomy-muted);letter-spacing:.06em}
.dc-sh-head h2{margin:2px 0 0;font:600 17px/1.2 ui-sans-serif,system-ui,sans-serif;color:var(--anatomy-strong);text-wrap:balance}
.dc-sh-size{margin:0;font:11.5px/1.4 var(--anatomy-mono);color:var(--anatomy-muted)}
.dc-rows{display:grid;gap:0}
.dc-row{display:grid;grid-template-columns:1fr auto;column-gap:10px;padding:7px 0;border-top:1px solid var(--anatomy-faint)}
.dc-k{color:var(--anatomy-text);min-width:0}
.dc-v{font:600 13px/1.3 var(--anatomy-mono);color:var(--anatomy-strong);font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap}
.dc-eq{grid-column:1/-1;font:11px/1.4 var(--anatomy-mono);color:var(--anatomy-muted);margin-top:2px}
.dc-sh-scope{margin:0;display:grid;gap:6px}
.dc-sh-scope figcaption{font:11px/1 var(--anatomy-mono);color:var(--anatomy-muted);text-transform:uppercase;letter-spacing:.08em}
.dc-scope{width:100%;height:auto;display:block;overflow:visible}
.dc-scope text{font:9.5px var(--anatomy-mono);fill:var(--anatomy-muted)}
.dc-scope-grid{stroke:var(--anatomy-faint);stroke-width:1;fill:none}
.dc-scope-area{fill:var(--anatomy-shade-1);stroke:none}
.dc-scope-line{fill:none;stroke:var(--anatomy-hi);stroke-width:1.4;stroke-linejoin:round}
.dc-scope-dot{fill:var(--anatomy-strong)}
.dc-sh-time{margin:0;font:11px/1.4 var(--anatomy-mono);color:var(--anatomy-muted)}
.dc-sh-nav{display:flex;gap:6px}
.dc-sh-nav .dc-btn:nth-child(2){flex:1;text-align:center}
.dc-sources{margin:10px 0 0;padding-left:18px;color:var(--anatomy-muted);font-size:12px;line-height:1.55;display:grid;gap:2px}
@media (max-width:900px){.dc-sheet{position:static;width:auto;margin:14px 0 0;backdrop-filter:none}}
.dc-box{position:relative}
.dc-3d{position:absolute;inset:0;width:100%;height:100%;display:none;touch-action:none;cursor:grab}
.dc-3d:active{cursor:grabbing}
.iso-stage[data-mode="3d"] .dc-3d{display:block}
.iso-stage[data-mode="3d"] .dc-svg{visibility:hidden}
.iso-stage[data-mode="3d"] .dc-gl{display:none}
.dc-btn-strong{box-shadow:0 0 0 1px var(--anatomy-strong)}
.dc-svg{overflow:hidden!important}
.dc-gl{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}
.dc-svg[data-apart] .dc-flow{display:none!important}
.iso-stage[data-gl] .dc-smoke,.iso-stage[data-gl] .dc-plume{display:none}
@media (prefers-reduced-motion:reduce){.dc-puff,.dc-steam{animation:none;opacity:.5}}
`;
const svg = k.figureSvg({
  width: W,
  height: H,
  className: "dc-svg",
  label:
    "A cutaway site model of an off-grid data center. A field of 77 single-axis solar tracker tables turns to follow the sun; four battery containers store the midday surplus; a biomass plant gasifies rice husk for a 750 kW engine at night. In the cutaway building a request arrives on fibre, passes the meet-me room, routers and switches and reaches a GPU rack; the heat goes to air handlers, chilled water, chillers and two cooling towers.",
  body,
});

const stopButton = (s, i) => `<button class="dc-stop" type="button" data-stop="${s.id}" aria-pressed="false"><span class="dc-num">${String(i + 1).padStart(2, "0")}</span><span class="dc-name">${s.name}</span></button>`;
const stationButtons = [["Request", 0, 5], ["Heat", 5, 10], ["Power", 10, 14]].map(([name, a, b]) => `<div class="dc-group" data-group="${name.toLowerCase()}"><span class="dc-group-name">${name}</span>${STATIONS.slice(a, b).map((s, i) => stopButton(s, a + i)).join("")}</div>`).join("");
const MONTH_TICKS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"].map((m) => `<span>${m}</span>`).join("");
const APP = `<div class="dc-app">
<div class="iso-stage" tabindex="0" role="group" aria-label="Off-grid data center site model. Click a part to fly to it; arrows step through the parts; up and down change the IT load; space pauses the day; V turns it in 3D; Y shows the year; A lifts the hall apart.">
<div class="dc-box">${svg}<svg class="iso-svg dc-flows" viewBox="0 0 ${W} ${H}" aria-hidden="true">${FLOWS.join("")}</svg><canvas class="dc-gl" aria-hidden="true"></canvas></div>
<div class="dc-night" aria-hidden="true"></div>
<span class="dc-sr" role="status" aria-live="polite" data-status></span>
</div>
<header class="dc-top">
<div class="dc-time dc-glass"><button class="dc-icon" type="button" data-act="play" aria-pressed="true" aria-label="Pause">❚❚</button><span class="dc-clock"><b data-clock>06:30</b><span data-date>15 Apr</span></span><select data-speed aria-label="Simulation speed"><option value="60">1 min / s</option><option value="600">10 min / s</option><option value="3600">1 h / s</option></select></div>
<div class="dc-controls">
<div class="dc-seg dc-glass" role="group" aria-label="Today's weather"><button type="button" data-weather="sunny">Sunny</button><button type="button" data-weather="cloudy">Cloudy</button><button type="button" data-weather="overcast">Overcast</button></div>
<div class="dc-seg dc-glass" role="group" aria-label="Plant in service"><button type="button" data-act="bio" aria-pressed="true">Biomass</button><button type="button" data-act="bess" aria-pressed="true">Battery</button></div>
<button class="dc-chip dc-glass dc-chip-warn" type="button" data-act="solaronly" aria-pressed="false">Solar + battery only</button>
<button class="dc-chip dc-glass" type="button" data-act="year" aria-pressed="false">The year</button>
<button class="dc-chip dc-glass dc-chip-strong" type="button" data-act="view" aria-pressed="false">3D</button>
<button class="dc-chip dc-glass dc-theme" type="button" data-act="theme" aria-label="Switch to dark theme"><span class="dc-sun-i" aria-hidden="true">☀</span><span class="dc-moon-i" aria-hidden="true">☾</span></button>
</div>
</header>
<nav class="dc-rail dc-glass" aria-label="Parts of the site">${stationButtons}<div class="dc-rail-acts"><button class="dc-mini" type="button" data-act="tour" aria-pressed="false">Tour</button><button class="dc-mini" type="button" data-act="apart" aria-pressed="false">Lift hall</button></div></nav>
<aside class="dc-sheet dc-glass" data-sheet hidden aria-label="Data sheet"></aside>
<section class="dc-hud" aria-label="Power right now and today">
<div class="dc-kpis">
<div class="dc-k-state"><span class="dc-dot"></span><b data-kpi="state">…</b></div>
<div class="dc-kpi" data-kind="load"><span>Load</span><b data-kpi="load">0</b><i>kW</i></div>
<div class="dc-kpi" data-kind="sun"><span>Sun</span><b data-kpi="solar">0</b><i>kW</i></div>
<div class="dc-kpi" data-kind="batt"><span>Battery <em data-kpi="soc">0%</em></span><b data-kpi="bess">0</b><i>kW</i><s><u data-kpi="socbar"></u></s></div>
<div class="dc-kpi" data-kind="bio"><span>Husk</span><b data-kpi="bio">0</b><i>kW</i></div>
<div class="dc-kpi dc-kpi-up"><span>Uptime</span><b data-kpi="uptime">…</b><i data-kpi="uptime-note"></i></div>
</div>
<div class="dc-dayw">
<div class="dc-legend"><span data-c="sun">sun</span><span data-c="bio">husk</span><span data-c="batt">battery</span><span data-c="chg">charging</span><span data-c="curt">spilled</span><span data-c="out">missing</span><span data-c="load">load</span><span class="dc-what" data-what></span></div>
<svg class="dc-day" data-day viewBox="0 0 1000 150" role="img" aria-label="Today, quarter hour by quarter hour: what powered the load, what charged the battery, and the battery's charge. Click to jump ahead."></svg>
</div>
<span class="dc-readout" data-readout></span>
</section>
<div class="dc-year dc-glass" data-year hidden role="dialog" aria-label="A year of operation">
<header><div><span class="dc-eyebrow">8,760 hours · a seeded weather year</span><h2>A year, hour by hour</h2></div><button type="button" class="dc-btn" data-close aria-label="Close">×</button></header>
<div class="dc-year-grid">
<figure><figcaption><b>As designed</b> sun + battery + husk</figcaption><canvas data-map="design"></canvas><div class="dc-months">${MONTH_TICKS}</div><div class="dc-year-kpi"><b data-y="design-up">…</b><span data-y="design-out"></span><span data-y="design-mix"></span></div></figure>
<figure><figcaption><b>Solar + battery only</b> no husk</figcaption><canvas data-map="solar"></canvas><div class="dc-months">${MONTH_TICKS}</div><div class="dc-year-kpi"><b data-y="solar-up">…</b><span data-y="solar-out"></span><span data-y="solar-mix"></span></div></figure>
</div>
<div class="dc-legend dc-legend-year"><span data-c="sun">sun</span><span data-c="batt">battery</span><span data-c="bio">husk</span><span data-c="shed">shedding</span><span data-c="out">dark</span><span class="dc-axis-note">columns are days · rows are hours, midnight at the top</span></div>
<p class="dc-year-size">To hold 99.9 % on sun and battery alone: <span data-y="sizing">working it out…</span></p>
<details class="dc-more"><summary>How the numbers are made</summary><ul class="dc-sources">${SOURCES.map((x) => `<li>${x}</li>`).join("")}</ul></details>
</div>
</div>`;

const css = `<style>
${OLD_CSS}
html,body{height:100%}
body{overflow:hidden}
.iso-page{margin:0!important;width:auto!important}
.dc-app{position:fixed;inset:0;overflow:hidden;background:var(--anatomy-page);color:var(--anatomy-text);font:14px/1.45 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
.dc-app .iso-stage{position:absolute;inset:0;outline:none}
.dc-app .dc-box{position:absolute;inset:0}
.dc-app .dc-svg,.dc-app .dc-flows{width:100%!important;height:100%!important;overflow:hidden!important}
.dc-app .dc-flows{position:absolute;inset:0;pointer-events:none}
.iso-stage[data-mode="3d"] .dc-flows{display:none}
.dc-svg .iso-dots circle[data-pulse]{animation:none}
.dc-svg .dc-busy circle[data-pulse]{animation:iso-pulse 420ms steps(1,end) infinite}
.dc-glass{background:color-mix(in srgb,var(--anatomy-card) 88%,transparent);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);box-shadow:0 0 0 1px var(--anatomy-faint),0 8px 24px -16px #0003}
.dc-night{position:absolute;inset:0;pointer-events:none;background:var(--dc-nightc);mix-blend-mode:multiply;opacity:0}
.dc-top{position:absolute;top:0;left:0;right:0;display:flex;align-items:center;gap:10px 18px;flex-wrap:wrap;padding:12px max(16px,env(safe-area-inset-right,0px)) 8px max(16px,env(safe-area-inset-left,0px));pointer-events:none;z-index:3}
.dc-top>*{pointer-events:auto}
.dc-brand{display:grid;gap:2px}
.dc-brand h1{margin:0;font:650 18px/1.1 ui-sans-serif,system-ui,sans-serif;color:var(--anatomy-strong);letter-spacing:-.01em}
.dc-eyebrow{font:10.5px/1.2 var(--anatomy-mono);letter-spacing:.12em;text-transform:uppercase;color:var(--anatomy-muted)}
.dc-time{display:flex;align-items:center;gap:8px;padding:5px 8px 5px 5px;border-radius:999px}
.dc-icon{all:unset;cursor:pointer;width:28px;height:28px;display:grid;place-items:center;border-radius:50%;background:var(--anatomy-strong);color:var(--anatomy-card);font-size:10px}
.dc-clock{display:flex;align-items:baseline;gap:6px;font-variant-numeric:tabular-nums}
.dc-clock b{font:600 17px var(--anatomy-mono);color:var(--anatomy-strong)}
.dc-clock span{font:11px var(--anatomy-mono);color:var(--anatomy-muted)}
.dc-time select{font:11px var(--anatomy-mono);background:transparent;color:var(--anatomy-text);border:0;cursor:pointer}
.dc-controls{margin-left:auto;display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end}
.dc-seg{display:inline-flex;border-radius:999px;overflow:hidden;padding:2px;gap:2px}
.dc-seg button,.dc-chip{all:unset;cursor:pointer;padding:6px 12px;border-radius:999px;font:12px/1.1 ui-sans-serif,system-ui,sans-serif;color:var(--anatomy-text);white-space:nowrap}
.dc-seg button[aria-pressed="true"]{background:var(--anatomy-strong);color:var(--anatomy-card)}
.dc-seg button[data-act][aria-pressed="false"]{color:var(--dc-out);text-decoration:line-through}
.dc-seg button:disabled{opacity:.35;cursor:default}
.dc-chip[aria-pressed="true"]{background:var(--anatomy-strong);color:var(--anatomy-card)}
.dc-chip-warn[aria-pressed="true"]{background:var(--dc-out);color:#fff}
.dc-theme{width:16px;text-align:center;padding:6px 10px}
.dc-theme .dc-moon-i{display:none}
.dc-app[data-dark] .dc-theme .dc-sun-i{display:none}
.dc-app[data-dark] .dc-theme .dc-moon-i{display:inline}
.dc-seg button:focus-visible,.dc-chip:focus-visible,.dc-icon:focus-visible,.dc-stop:focus-visible,.dc-mini:focus-visible{outline:2px solid var(--anatomy-muted);outline-offset:2px}
.dc-rail{position:absolute;left:max(14px,env(safe-area-inset-left,0px));top:50%;transform:translateY(-58%);display:flex;flex-direction:column;gap:10px;z-index:2;width:164px;padding:10px 6px 10px 8px;border-radius:12px}
.dc-rail .dc-group{display:flex;flex-direction:column;align-items:stretch;gap:0}
.dc-rail .dc-group-name{margin:0 0 3px 2px}
.dc-stop{all:unset;cursor:pointer;display:flex;gap:8px;align-items:baseline;padding:3px 8px;border-radius:6px;font:12px/1.3 ui-sans-serif,system-ui,sans-serif;color:var(--anatomy-text)}
.dc-stop:hover{background:color-mix(in srgb,var(--anatomy-card) 80%,transparent)}
.dc-stop[aria-pressed="true"]{background:var(--anatomy-strong);color:var(--anatomy-card)}
.dc-stop[aria-pressed="true"] .dc-num{color:inherit!important}
.dc-rail-acts{display:flex;gap:6px;margin-top:4px}
.dc-mini{all:unset;cursor:pointer;padding:4px 9px;border-radius:999px;font:11px/1.2 var(--anatomy-mono);color:var(--anatomy-muted);box-shadow:0 0 0 1px var(--anatomy-lo)}
.dc-mini[aria-pressed="true"]{color:var(--anatomy-card);background:var(--anatomy-strong);box-shadow:none}
.dc-group[data-group="power"] .dc-num{color:var(--dc-sun)}
.dc-app .dc-sheet{position:absolute;top:70px;right:max(16px,env(safe-area-inset-right,0px));bottom:206px;width:min(340px,38vw);z-index:3;border-radius:14px}
.dc-hud{position:absolute;left:0;right:0;bottom:0;z-index:2;display:grid;grid-template-columns:minmax(300px,380px) 1fr;gap:6px 22px;align-items:end;padding:10px max(16px,env(safe-area-inset-right,0px)) max(10px,env(safe-area-inset-bottom,0px)) max(16px,env(safe-area-inset-left,0px));background:linear-gradient(to top,var(--anatomy-page) 62%,color-mix(in srgb,var(--anatomy-page) 0%,transparent))}
.dc-kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:8px 14px;padding-bottom:6px}
.dc-k-state{grid-column:1/-1;display:flex;align-items:center;gap:8px;font-size:13px;color:var(--anatomy-strong)}
.dc-dot{width:9px;height:9px;border-radius:50%;background:var(--dc-batt);box-shadow:0 0 0 3px color-mix(in srgb,var(--dc-batt) 25%,transparent)}
.dc-app[data-served="shed"] .dc-dot{background:var(--dc-shed);box-shadow:0 0 0 3px color-mix(in srgb,var(--dc-shed) 25%,transparent)}
.dc-app[data-served="no"] .dc-dot{background:var(--dc-out);box-shadow:0 0 0 3px color-mix(in srgb,var(--dc-out) 30%,transparent);animation:dc-blink 1s steps(2) infinite}
@keyframes dc-blink{50%{opacity:.3}}
.dc-kpi{display:grid;grid-template-columns:auto 1fr;align-items:baseline;column-gap:4px;position:relative;padding-left:9px;min-width:0}
.dc-kpi::before{content:"";position:absolute;left:0;top:3px;bottom:3px;width:3px;border-radius:2px;background:var(--anatomy-lo)}
.dc-kpi[data-kind="sun"]::before{background:var(--dc-sun)}
.dc-kpi[data-kind="batt"]::before{background:var(--dc-batt)}
.dc-kpi[data-kind="bio"]::before{background:var(--dc-bio)}
.dc-kpi[data-kind="load"]::before{background:var(--anatomy-hi)}
.dc-kpi span{grid-column:1/-1;font:10px/1.2 var(--anatomy-mono);text-transform:uppercase;letter-spacing:.1em;color:var(--anatomy-muted)}
.dc-kpi span em{font-style:normal;color:var(--anatomy-text);letter-spacing:0}
.dc-kpi b{font:600 20px/1.1 var(--anatomy-mono);color:var(--anatomy-strong);font-variant-numeric:tabular-nums}
.dc-kpi i{font:11px var(--anatomy-mono);font-style:normal;color:var(--anatomy-muted)}
.dc-kpi s{grid-column:1/-1;display:block;height:3px;border-radius:2px;background:var(--anatomy-faint);overflow:hidden;margin-top:3px;text-decoration:none}
.dc-kpi s u{display:block;height:100%;background:var(--dc-batt)}
.dc-kpi-up b{color:var(--dc-batt)}
.dc-app[data-solar-only] .dc-kpi-up b{color:var(--dc-out)}
.dc-kpi-up i{grid-column:1/-1;font-size:9.5px}
.dc-dayw{display:grid;gap:2px;min-width:0}
.dc-legend{display:flex;flex-wrap:wrap;gap:4px 12px;align-items:center;font:10.5px var(--anatomy-mono);color:var(--anatomy-muted)}
.dc-legend span[data-c]::before{content:"";display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:5px;vertical-align:-1px;background:var(--c)}
.dc-legend [data-c="sun"]{--c:var(--dc-sun)}
.dc-legend [data-c="bio"]{--c:var(--dc-bio)}
.dc-legend [data-c="batt"]{--c:var(--dc-batt)}
.dc-legend [data-c="chg"]{--c:color-mix(in srgb,var(--dc-sun) 40%,transparent)}
.dc-legend [data-c="curt"]{--c:color-mix(in srgb,var(--dc-sun) 14%,transparent)}
.dc-legend [data-c="out"]{--c:var(--dc-out)}
.dc-legend [data-c="shed"]{--c:var(--dc-shed)}
.dc-legend [data-c="load"]{--c:var(--anatomy-strong)}
.dc-legend [data-c="load"]::before{height:2px;vertical-align:3px}
.dc-legend .dc-what{margin:0 0 0 auto;font:12.5px/1.35 ui-sans-serif,system-ui,sans-serif;color:var(--anatomy-text);min-height:0;max-width:62ch;text-align:right}
.dc-day{width:100%;height:auto;max-height:150px;display:block;cursor:pointer;overflow:visible}
.dc-day text{font:10px var(--anatomy-mono);fill:var(--anatomy-muted)}
.dc-d-grid{stroke:var(--anatomy-faint);stroke-width:.8}
.dc-c-sun{fill:var(--dc-sun)}
.dc-c-bio{fill:var(--dc-bio)}
.dc-c-batt{fill:var(--dc-batt)}
.dc-c-out{fill:var(--dc-out)}
.dc-c-chg{fill:color-mix(in srgb,var(--dc-sun) 40%,transparent)}
.dc-c-curt{fill:color-mix(in srgb,var(--dc-sun) 14%,transparent)}
.dc-proj{opacity:.35}
.dc-d-load{fill:none;stroke:var(--anatomy-strong);stroke-width:1.4;stroke-linejoin:round}
.dc-d-soc{fill:none;stroke:var(--dc-batt);stroke-width:1.6;stroke-dasharray:5 3}
.dc-d-res{stroke:var(--dc-batt);stroke-width:.8;stroke-dasharray:1 3;opacity:.7}
.dc-d-now{stroke:var(--anatomy-strong);stroke-width:1.2}
.dc-d-nowdot{fill:var(--anatomy-strong)}
.dc-d-lab{fill:var(--dc-batt)!important}
.dc-readout{position:absolute;right:max(16px,env(safe-area-inset-right,0px));bottom:2px;font:10px var(--anatomy-mono);color:var(--anatomy-muted);opacity:.0}
.dc-year{position:absolute;z-index:5;left:50%;top:50%;transform:translate(-50%,-50%);width:min(920px,calc(100vw - 32px));max-height:calc(100vh - 40px);overflow:auto;border-radius:16px;padding:18px 20px;display:grid;gap:14px}
.dc-year[hidden]{display:none}
.dc-year header{display:flex;justify-content:space-between;align-items:flex-start}
.dc-year h2{margin:2px 0 0;font:650 20px/1.2 ui-sans-serif,system-ui,sans-serif;color:var(--anatomy-strong)}
.dc-year-grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}
.dc-year figure{margin:0;display:grid;gap:6px;min-width:0}
.dc-year figcaption{font-size:13px;color:var(--anatomy-muted)}
.dc-year figcaption b{color:var(--anatomy-strong);margin-right:6px}
.dc-year canvas{width:100%;height:120px;image-rendering:pixelated;border-radius:6px;display:block}
.dc-months{display:flex;justify-content:space-between;font:9.5px var(--anatomy-mono);color:var(--anatomy-muted);padding:0 2px}
.dc-year-kpi{display:flex;flex-wrap:wrap;gap:2px 12px;align-items:baseline}
.dc-year-kpi b{font:650 26px/1 var(--anatomy-mono);color:var(--dc-batt);font-variant-numeric:tabular-nums}
.dc-year figure:nth-child(2) .dc-year-kpi b{color:var(--dc-out)}
.dc-year-kpi span{font:11.5px var(--anatomy-mono);color:var(--anatomy-muted)}
.dc-legend-year .dc-axis-note{margin-left:auto}
.dc-year-size{margin:0;font-size:14px;color:var(--anatomy-text)}
.dc-year-size b{color:var(--anatomy-strong)}
.dc-pf{fill:none;stroke-linecap:round;stroke-dasharray:2.5 6;animation:dc-pf 1s linear infinite;transition:opacity .6s}
.dc-pf[data-route="solar"]{stroke:var(--dc-sun);stroke-width:var(--solar-w,1px);opacity:var(--solar-o,0);animation-duration:var(--solar-dur,1s)}
.dc-pf[data-route="bess"]{stroke:var(--dc-batt);stroke-width:var(--bess-w,1px);opacity:var(--bess-o,0);animation-duration:var(--bess-dur,1s)}
.dc-pf[data-route="biomass"]{stroke:var(--dc-bio);stroke-width:var(--biomass-w,1px);opacity:var(--biomass-o,0);animation-duration:var(--biomass-dur,1s)}
.dc-pf[data-route="load"]{stroke:var(--anatomy-hi);stroke-width:var(--load-w,1px);opacity:var(--load-o,0);animation-duration:var(--load-dur,1s)}
.dc-flows[data-bess-dir="charge"] .dc-pf[data-route="bess"]{animation-direction:reverse}
@keyframes dc-pf{to{stroke-dashoffset:-17}}
.dc-pv{fill:var(--dc-pv)}
.dc-pv-line{stroke:var(--dc-pv-line)!important;stroke-width:.45px}
.dc-svg .it[data-on] .dc-pv{fill:var(--dc-pv-lit)}
.dc-soc{fill:var(--dc-batt)}
.dc-glow path{fill:#ff7a1a;opacity:calc(var(--chp,0) * .9)}
.dc-husk .iso-shade,.dc-husk .iso-top{fill:var(--dc-husk)!important;stroke:var(--dc-husk)!important}
.dc-husk .iso-shade[data-shade="0"]{fill:var(--dc-husk-d)!important;stroke:var(--dc-husk-d)!important}
.dc-reserved{stroke-dasharray:1.2 1.8}
.dc-sun circle{fill:var(--dc-sun)}
.dc-sun path{stroke:var(--dc-sun);stroke-width:1.6px;stroke-linecap:round}
.dc-sun-path{fill:none;stroke:var(--dc-sun);stroke-width:1px;stroke-dasharray:1 5;opacity:.45}
.dc-s-solar{fill:var(--dc-sun)}
.dc-s-bio{fill:var(--dc-bio)}
.dc-s-dis{fill:var(--dc-batt)}
.dc-s-unserved{fill:var(--dc-out)}
.dc-i-sun{fill:var(--dc-sun)}
.dc-i-ray{stroke:var(--dc-sun);stroke-width:1;stroke-dasharray:2 3}
.dc-i-panel{stroke:var(--dc-pv);stroke-width:4;stroke-linecap:round}
.dc-i-post{stroke:var(--anatomy-mid);stroke-width:2}
.dc-i-ground{stroke:var(--anatomy-lo);stroke-width:1}
.dc-b-case{fill:none;stroke:var(--anatomy-mid);stroke-width:1.2}
.dc-b-cap{fill:var(--anatomy-mid)}
.dc-b-fill{fill:var(--dc-batt)}
.dc-b-res{stroke:var(--anatomy-strong);stroke-width:1.2;stroke-dasharray:2 2}
.dc-app[data-sheet-open] .dc-legend .dc-what{display:none}
.dc-app .iso-stage::after{content:"";position:absolute;inset:0;pointer-events:none;box-shadow:inset 0 0 140px color-mix(in srgb,var(--dc-out) 55%,transparent);opacity:0;transition:opacity .6s}
.dc-app[data-served="no"] .iso-stage::after{opacity:1}
.dc-app[data-served="no"] .dc-svg .dc-leds,.dc-app[data-served="no"] .dc-svg .dc-screen{opacity:.15}
@media (max-width:900px){
  .dc-rail{display:none}
  .dc-hud{grid-template-columns:1fr}
  .dc-kpis{grid-template-columns:repeat(5,minmax(0,1fr));gap:6px 10px}
  .dc-k-state{grid-column:1/-1}
  .dc-kpi-up{display:none}
  .dc-kpi b{font-size:16px}
  .dc-legend .dc-what{display:none}
  .dc-app .dc-sheet{position:absolute;left:8px;right:8px;width:auto;top:auto;bottom:178px;max-height:46vh}
  .dc-controls{margin-left:0}
  .dc-year-grid{grid-template-columns:1fr}
}
@media (max-width:560px){.dc-brand h1{font-size:15px}.dc-seg button,.dc-chip{padding:5px 9px;font-size:11px}.dc-time select{display:none}}
</style>`;
const html = k.pageHtml({
  title: "Off-Grid Data Center",
  theme,
  width: 1240,
  body: THREE_TAG + css + APP,
  script:
    SCRIPT(),
});
const name = theme === "dark" ? "datacenter-dark.html" : "datacenter.html";
writeFileSync(join(HERE, name), html);
console.log(`wrote ${name} · ${items.length} items · ${cycles} order cycles broken · ${(html.length / 1024).toFixed(0)} KB`);

// ---------------------------------------------------------------- artifact variant: the viewer supplies the skeleton and the theme
if (theme === "light") {
  const block = (sel) => { const at = k.ISO_CSS.indexOf(sel + "{"); return k.ISO_CSS.slice(at + sel.length + 1, k.ISO_CSS.indexOf("}", at)); };
  const darkVars = block(".iso");
  const lightVars = block('.iso[data-theme="light"]');
  const dcLight = css.match(/\.iso\{(--dc-[^}]*)\}/)[1];
  const dcDark = css.match(/\.iso\[data-theme="dark"\]\{(--dc-[^}]*)\}/)[1];
  const themeCss = `<style>
:root{--page:#f2f2ef}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--page:#0b0b0b;color-scheme:dark}}
:root[data-theme="dark"]{--page:#0b0b0b;color-scheme:dark}
body{background:var(--page);padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px))}
.iso.dc-root{${lightVars};${dcLight};color:var(--anatomy-text);font:14px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]) .iso.dc-root{${darkVars};${dcDark}}}
:root[data-theme="dark"] .iso.dc-root{${darkVars};${dcDark}}
.dc-root .iso-page{width:min(1240px,100%);margin:40px auto 72px}
</style>`;
  const page = [
    `<title>Off-Grid Data Center</title>`,
    `<meta name="claude:viewport-fit-sides" content="cover">`,
    `<style>${k.ISO_CSS}</style>`,
    themeCss,
    THREE_TAG,
    `<div class="iso dc-root">${css + APP}</div>`,
    `<script type="module">${SCRIPT().replace(/<\/(script)/gi, "<\\/$1")}</script>`,
  ].join("\n");
  writeFileSync(join(HERE, "datacenter-artifact.html"), page);
  console.log("wrote datacenter-artifact.html");
}

// ---------------------------------------------------------------- static site: one auto-themed page plus fixed light and dark pages
if (theme === "light") {
  const { mkdirSync, readFileSync, copyFileSync } = await import("node:fs");
  const site = join(HERE, "docs");
  mkdirSync(site, { recursive: true });
  const content = readFileSync(join(HERE, "datacenter-artifact.html"), "utf8");
  const head = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><meta name="description" content="An interactive cutaway of a data center: follow one request, its heat and its power from fibre to fan."><style>*{box-sizing:border-box}:root{color-scheme:light}body{margin:0}</style>`;
  writeFileSync(join(site, "index.html"), head + content.replace(/<\/style>\n<div class="iso dc-root">/, "</style></head><body>\n<div class=\"iso dc-root\">") + "</body></html>");
  copyFileSync(join(HERE, "datacenter.html"), join(site, "light.html"));
  writeFileSync(join(site, ".nojekyll"), "");
  console.log("wrote docs/index.html");
}
