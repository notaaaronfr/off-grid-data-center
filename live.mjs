// The page's live code. It runs after the kit and gl layer, and after P, STATIONS, FANS, FOCUS, VIEW, blades,
// createPlant, createMicrogrid, sheetOf, panelSvg, TABLES, BESS_BOXES, LAYERS, SPRING, GL and SHADER are declared.
export const LIVE = String.raw`
const sim = createPlant();
const { C } = sim;
const { LOAD } = C;
const MG = createMicrogrid();
const app = document.querySelector(".dc-app");
const stage = document.querySelector(".iso-stage");
const box = stage.querySelector(".dc-box");
const svg = stage.querySelector(".dc-svg");
const flowSvg = stage.querySelector(".dc-flows");
const readout = document.querySelector("[data-readout]");
const status = document.querySelector("[data-status]");
const what = document.querySelector("[data-what]");
const stops = [...document.querySelectorAll("[data-stop]")];
const sheetEl = document.querySelector("[data-sheet]");
const topBar = document.querySelector(".dc-top");
const hud = document.querySelector(".dc-hud");
const rail = document.querySelector(".dc-rail");
const dayEl = document.querySelector("[data-day]");
const yearEl = document.querySelector("[data-year]");
const nightEl = document.querySelector(".dc-night");
const still = matchMedia("(prefers-reduced-motion: reduce)");
const fanEls = FANS.map((_, i) => svg.querySelector('[data-fan="' + i + '"]'));
const noc = (name) => svg.querySelector('[data-noc="' + name + '"]');
const hops = [...svg.querySelectorAll("[data-hop]")];
const groups = STATIONS.map((s) => [...svg.querySelectorAll('.it[data-st~="' + s.id + '"]')]);
const tourButton = document.querySelector('[data-act="tour"]');
const kpi = (name) => document.querySelector('[data-kpi="' + name + '"]');

let current = -1, focused = false;
let V3 = null, mode = "2d";
let load = LOAD.start, shown = LOAD.start;
let touring = false, tourClock = 0;
let fanAngle = FANS.map((_, i) => i * 0.7), fanSpeed = 0.6;
let frame = 0, last = 0, visible = false, sampleClock = 0, clock = 0, pueAt = 0;
const HIST = 150;
const history = {};
const keep = (key, v) => { (history[key] = history[key] || []).push(v); if (history[key].length > HIST) history[key].shift(); };
const pueHist = [];
const f0 = (v) => Math.round(v).toLocaleString("en-US"), f1 = (v) => v.toFixed(1), f2 = (v) => v.toFixed(2);
const clockText = (min) => String(Math.floor(min / 60) % 24).padStart(2, "0") + ":" + String(Math.floor(min % 60)).padStart(2, "0");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dateText = (doy) => { const d = new Date(Date.UTC(2026, 0, doy)); return d.getUTCDate() + " " + MONTHS[d.getUTCMonth()]; };

// ------------------------------------------------------------ the sun, the weather and the dispatch, in simulated time
const WEATHER = { sunny: 1.15, cloudy: 0.5, overcast: 0.25 };
const cfg = { weather: "sunny", bioOk: true, bessOk: true, solarOnly: false, playing: !still.matches, speed: 600 };
let doy = 105, simMin = 0;
let st = MG.newState(12500);
let m = sim.step(0, { load, source: "utility", accel: 0 });
const loadKw = () => m.total * 1000 + MG.BESS.hvacKw;
let flow = { solar: 0, bio: 0, dis: 0, chg: 0, curt: 0, unserved: 0, shed: 0, outage: 0, soc: st.soc, load: loadKw() };
let pvNow = MG.pv(doy, 0, WEATHER[cfg.weather]);
const SLOTS = 96;
let dayLog = new Array(SLOTS).fill(null), slotAcc = null, plan = [];
let yearDesigned = null, yearSolarOnly = null, sizing = null;
const inputs = (hours) => ({ hours, load: loadKw(), solar: MG.pv(doy, hours, WEATHER[cfg.weather]).ac, bioOk: cfg.bioOk, bessOk: cfg.bessOk, useBio: !cfg.solarOnly });
function replan() {
  const copy = { ...st };
  const from = Math.floor(simMin / 15);
  plan = new Array(SLOTS).fill(null);
  for (let k = from; k < SLOTS; k++) plan[k] = { ...MG.step(copy, 0.25, inputs(k / 4 + 0.125)) };
}
function newDay() {
  doy = (doy % 365) + 1;
  dayLog = new Array(SLOTS).fill(null);
  slotAcc = null;
}
function advance(dtSim) {
  // one-minute steps keep the engine ramp and the battery smooth at any speed
  let left = dtSim;
  while (left > 1e-6) {
    const h = Math.min(left, 60);
    left -= h;
    simMin += h / 60;
    if (simMin >= 1440) { simMin -= 1440; newDay(); replan(); }
    const hours = simMin / 60;
    pvNow = MG.pv(doy, hours, WEATHER[cfg.weather], true);
    flow = MG.step(st, h / 3600, { ...inputs(hours), solar: pvNow.ac });
    const k = Math.min(SLOTS - 1, Math.floor(simMin / 15));
    if (!slotAcc || slotAcc.k !== k) {
      if (slotAcc && slotAcc.n) dayLog[slotAcc.k] = Object.fromEntries(Object.entries(slotAcc.sum).map(([key, v]) => [key, v / slotAcc.n]));
      slotAcc = { k, n: 0, sum: {} };
      replan();
    }
    for (const key of ["solar", "bio", "dis", "chg", "curt", "unserved", "soc", "load"]) slotAcc.sum[key] = (slotAcc.sum[key] || 0) + flow[key];
    slotAcc.n++;
  }
}
function runYears() {
  const design = Math.round(loadKw());
  yearDesigned = MG.year({ map: true, it: design, pue: 1 });
  yearSolarOnly = MG.year({ map: true, useBio: false, it: design, pue: 1 });
}

// ------------------------------------------------------------ the story: one sentence per stop
function lines() {
  const kw = f1(m.rackKw);
  const g = flow;
  return {
    fiber: ["01 fibre · 85 km to the cable landing", "<b>The request arrives as light.</b> It comes from the submarine cable landing station, about 85 km away, in two ducts that never share a trench."],
    mmr: ["02 meet-me room", "<b>The carrier hands it over.</b> A jumper across the aisle joins the carrier's rack to the building's fibre frame: the border of the data center."],
    core: ["03 router + spine · " + f0(m.queueNs) + " ns queue", "<b>Routing.</b> The edge router and one of the spine switches pick the path to the right row in a few microseconds."],
    leaf: ["04 leaf switch", "<b>Down the fibre trough.</b> It runs along the trough over the rows and drops into the rack's top-of-rack switch."],
    server: ["05 GPU rack · " + kw + " kW", "<b>The work.</b> 200 GPUs in 13 racks do the computing; this one draws " + kw + " kW and answers in about 46 ms."],
    aisle: ["06 hot aisle · 36 °C", "<b>Every watt becomes heat.</b> Cold air at 24 °C goes in the front of the racks and leaves the back at 36 °C."],
    crah: ["07 air handlers", "<b>Air to water.</b> The heat crosses a coil into 14 °C water and the cooled air drops back under the floor."],
    chw: ["08 chilled water · " + f1(m.chwFlow) + " L/s", "<b>The heat goes into water.</b> " + f1(m.chwFlow) + " litres a second carry it out of the building in a DN150 loop."],
    chiller: ["09 chillers · COP " + f2(m.cop), "<b>Pumping heat uphill.</b> The compressors lift it to " + f1(m.tCond) + " °C so the towers can throw it away; COP " + f2(m.cop) + " right now."],
    tower: ["10 towers · wet bulb " + f1(m.wb) + " °C", "<b>Out into the sky.</b> The towers evaporate " + f2(m.evaporation) + " m³ of water an hour; they can never beat the " + f1(m.wb) + " °C wet bulb."],
    solar: ["11 solar · " + f0(g.solar) + " kW", "<b>The sun runs the site by day.</b> 77 tables turn from east to west to face it; at full sun they make 2.85 MW, three times what the site uses."],
    bess: ["12 battery · " + f0((g.soc / MG.BESS.kwh) * 100) + "% · " + (g.chg > 1 ? "charging " + f0(g.chg) : g.dis > 1 ? "giving " + f0(g.dis) : "resting") + " kW", "<b>The battery carries the evening.</b> It fills from the midday surplus and runs the site after sunset; 2 MWh is always kept back for emergencies."],
    biomass: ["13 biomass · " + f0(g.bio) + " kW", "<b>Rice husk carries the night.</b> A gasifier turns husk into gas for a 750 kW engine; it runs from about 21:00 until the sun is up, and on cloudy days."],
    ups: ["14 UPS · " + f1(m.upsEff * 100) + "%", "<b>Clean, unbroken power.</b> Every source lands on one switchboard; the UPS turns it into power a server never sees flicker."],
  };
}

// ------------------------------------------------------------ the exploded hall
const layerEls = LAYERS.map((_, i) => [...svg.querySelectorAll('.it[data-layer="' + (i + 1) + '"]')]);
const springs = LAYERS.map(() => ({ x: 0, v: 0, target: 0, pending: null }));
const apartButton = document.querySelector('[data-act="apart"]');
let apart = false;
function setApart(next) {
  if (next === apart) return;
  apart = next;
  const order = next ? [3, 2, 1, 0] : [0, 1, 2, 3];
  let n = 0;
  for (const i of order) {
    const s = springs[i], value = next ? 1 : 0;
    if ((s.pending ? s.pending.value : s.target) === value) continue;
    s.pending = { value, at: clock + n * SPRING.stagger };
    n++;
  }
  if (apartButton) apartButton.setAttribute("aria-pressed", String(next));
  status.textContent = next ? "Lifting the hall apart." : "Closing the hall up.";
  if (next) svg.setAttribute("data-apart", "");
}
function stepSprings(dt, calm) {
  let moving = false;
  springs.forEach((s, i) => {
    if (s.pending && clock >= s.pending.at) { s.target = s.pending.value; s.pending = null; }
    if (calm) { s.x = s.target; s.v = 0; }
    else for (let k = 0; k < 4; k++) { s.v += (SPRING.stiffness * (s.target - s.x) - SPRING.damping * s.v) * dt / 4; s.x += s.v * dt / 4; }
    if (Math.abs(s.target - s.x) < 5e-4 && Math.abs(s.v) < 5e-4) { s.x = s.target; s.v = 0; }
    if (s.pending || s.x !== s.target) moving = true;
    const [sx, sy] = LAYERS[i].step;
    const t = s.x ? "translate(" + (sx * s.x).toFixed(2) + " " + (sy * s.x).toFixed(2) + ")" : null;
    if (layerEls[i].t !== t) { layerEls[i].t = t; layerEls[i].forEach((el) => (t ? el.setAttribute("transform", t) : el.removeAttribute("transform"))); }
  });
  if (!apart && !moving && svg.hasAttribute("data-apart")) svg.removeAttribute("data-apart");
  return moving;
}
const apartLine = () => {
  const moving = springs.some((s) => s.pending || s.x !== s.target);
  if (!apart && !moving && springs.every((s) => s.x === 0)) return null;
  return moving ? (apart ? "lifting the hall apart" : "closing the hall up") : "hall apart · 4 layers";
};

// ------------------------------------------------------------ the camera: a viewBox that fills the screen, flies, pans and zooms
const cam = { x: 0, y: 0, w: VIEW[0], vx: 0, vy: 0, vw: 0 };
const goal = { x: 0, y: 0, w: VIEW[0] };
const aspect = () => (box.clientHeight || 1) / (box.clientWidth || 1);
function freeRect() {
  const W = box.clientWidth || 1, H = box.clientHeight || 1;
  const top = (topBar.offsetHeight + 10) / H;
  const bottom = 1 - (hud.offsetHeight + 14) / H;
  const left = rail && getComputedStyle(rail).display !== "none" ? (rail.offsetWidth + 24) / W : 0.02;
  const sheetOn = focused && !sheetEl.hidden && getComputedStyle(sheetEl).position === "absolute";
  const wide = sheetOn && sheetEl.offsetWidth > W * 0.7;
  const right = sheetOn && !wide ? 1 - (sheetEl.offsetWidth + 28) / W : 0.98;
  const floor = wide ? Math.min(bottom, (sheetEl.offsetTop - 8) / H) : bottom;
  return { x0: left, x1: Math.max(left + 0.25, right), y0: top, y1: Math.max(top + 0.2, floor) };
}
function fitBox(bx, by, bw, bh, pad = 1.15, minW = 150) {
  const f = freeRect(), a = aspect();
  goal.w = Math.min(VIEW[0] * 4, Math.max(minW, (bw * pad) / (f.x1 - f.x0), (bh * pad) / ((f.y1 - f.y0) * a)));
  goal.x = bx + bw / 2 - ((f.x0 + f.x1) / 2) * goal.w;
  goal.y = by + bh / 2 - ((f.y0 + f.y1) / 2) * goal.w * a;
}
function frameOn(id) {
  if (mode === "3d" && V3) { V3.frame(id); return; }
  const [bx, by, bw, bh] = FOCUS[id];
  fitBox(bx, by, bw, bh, 1.3, 170);
}
function overview() { fitBox(SITE_BOX[0], SITE_BOX[1], SITE_BOX[2], SITE_BOX[3], 1.04, 0); if (mode === "3d" && V3) V3.home(); }
function stepCamera(dt, calm) {
  let moving = false;
  for (const [key, vel] of [["x", "vx"], ["y", "vy"], ["w", "vw"]]) {
    if (calm) { cam[key] = goal[key]; cam[vel] = 0; continue; }
    const w = 1 / 0.38;
    for (let k = 0; k < 4; k++) { cam[vel] += (w * w * (goal[key] - cam[key]) - 2 * w * cam[vel]) * dt / 4; cam[key] += cam[vel] * dt / 4; }
    if (Math.abs(goal[key] - cam[key]) < 0.02 && Math.abs(cam[vel]) < 0.02) { cam[key] = goal[key]; cam[vel] = 0; } else moving = true;
  }
  const vb = cam.x.toFixed(2) + " " + cam.y.toFixed(2) + " " + cam.w.toFixed(2) + " " + (cam.w * aspect()).toFixed(2);
  if (svg.getAttribute("viewBox") !== vb) { svg.setAttribute("viewBox", vb); flowSvg.setAttribute("viewBox", vb); }
  app.toggleAttribute("data-zoomed", cam.w < VIEW[0] * 0.9);
  return moving;
}
const toView = (clientX, clientY) => { const r = svg.getBoundingClientRect(); return [cam.x + ((clientX - r.left) / r.width) * cam.w, cam.y + ((clientY - r.top) / r.height) * cam.w * aspect()]; };
function zoomAt(clientX, clientY, factor) {
  const [px, py] = toView(clientX, clientY);
  const w = Math.min(VIEW[0] * 4, Math.max(90, goal.w * factor));
  const r = svg.getBoundingClientRect();
  const fx = (clientX - r.left) / r.width, fy = (clientY - r.top) / r.height;
  goal.w = w; goal.x = px - fx * w; goal.y = py - fy * w * aspect();
}

// ------------------------------------------------------------ the sun in the sky, night, trackers, power flows
const NS = "http://www.w3.org/2000/svg";
const sky = document.createElementNS(NS, "g");
sky.setAttribute("class", "dc-sky");
sky.innerHTML = '<path class="dc-sun-path" d=""/><g class="dc-sun"><circle r="7"/><path d=""/></g>';
svg.insertBefore(sky, svg.firstChild);
const sunPath = sky.querySelector(".dc-sun-path"), sunG = sky.querySelector(".dc-sun"), sunRays = sunG.querySelector("path");
{ let d = ""; for (let i = 0; i < 8; i++) { const a = (i * Math.PI) / 4; d += "M" + (Math.cos(a) * 10).toFixed(1) + " " + (Math.sin(a) * 10).toFixed(1) + "L" + (Math.cos(a) * 14).toFixed(1) + " " + (Math.sin(a) * 14).toFixed(1); } sunRays.setAttribute("d", d); }
const SKY_ANCHOR = [700, 200, 0], SKY_R = 430;
const skyPoint = (s) => iso([SKY_ANCHOR[0] + s.east * SKY_R, SKY_ANCHOR[1] - s.north * SKY_R, SKY_ANCHOR[2] + s.up * SKY_R], P);
let sunPathDoy = -1;
function drawSky() {
  if (sunPathDoy !== doy) {
    sunPathDoy = doy;
    const pts = [];
    for (let h = 5; h <= 19; h += 0.2) { const s = MG.sun(doy, h); if (s.up > 0) pts.push(skyPoint(s)); }
    sunPath.setAttribute("d", pts.length ? "M" + pts.map((p) => p[0].toFixed(1) + " " + p[1].toFixed(1)).join("L") : "");
  }
  const s = MG.sun(doy, simMin / 60);
  const [x, y] = skyPoint(s);
  sunG.setAttribute("transform", "translate(" + x.toFixed(1) + " " + y.toFixed(1) + ")");
  sunG.style.opacity = String(Math.max(0, Math.min(1, (s.elev + 3) / 6)) * (cfg.weather === "overcast" ? 0.35 : cfg.weather === "cloudy" ? 0.65 : 1));
  const night = 1 - Math.max(0, Math.min(1, (s.elev + 6) / 14));
  nightEl.style.opacity = (night * 0.42).toFixed(3);
}
const tableEls = TABLES.map((_, i) => { const p = svg.querySelector('[data-panel="' + i + '"]'); return { p, t: p ? p.parentNode.querySelector("[data-tube]") : null }; });
let trackerR = 999, trackerClock = 0;
function drawTrackers(R) {
  if (Math.abs(R - trackerR) < 1) return;
  trackerR = R;
  TABLES.forEach((T, i) => {
    const el = tableEls[i];
    if (!el.p) return;
    const { svg: s, facing } = panelSvg(T, R, P, iso, pathOf);
    el.p.innerHTML = s;
    const parent = el.p.parentNode;
    if (facing && el.p.previousSibling !== el.t) parent.insertBefore(el.t, el.p);
    if (!facing && el.t.previousSibling !== el.p) parent.insertBefore(el.p, el.t);
  });
  if (V3) V3.tilt(R);
}
const socEls = [...svg.querySelectorAll("[data-soc]")];
const routeCache = {};
let chpCss = "";
function drawPower() {
  const route = (name, kw, full) => {
    const share = Math.round(Math.min(1, Math.abs(kw) / full) * 10) / 10;
    const key = (kw > 3 ? 1 : 0) + ":" + share;
    if (routeCache[name] === key) return;
    routeCache[name] = key;
    flowSvg.style.setProperty("--" + name + "-o", kw > 3 ? "1" : "0");
    flowSvg.style.setProperty("--" + name + "-w", (0.9 + 2.6 * share).toFixed(1) + "px");
    flowSvg.style.setProperty("--" + name + "-dur", (2.4 - 1.9 * share).toFixed(1) + "s");
  };
  route("solar", flow.solar, 2850);
  route("bess", flow.chg > 1 ? flow.chg : flow.dis, 2500);
  route("biomass", flow.bio, 750);
  route("load", flow.load - flow.unserved, 1200);
  setAttr(flowSvg, "data-bess-dir", flow.chg > 1 ? "charge" : "discharge");
  setAttr(svg, "data-gens", flow.bio > 5 ? "run" : "stop");
  const chp = (Math.round((flow.bio / 750) * 10) / 10).toFixed(1);
  if (chp !== chpCss) { chpCss = chp; svg.style.setProperty("--chp", chp); }
  setAttr(svg, "data-outage", flow.outage > 1 ? "on" : flow.shed > 1 ? "shed" : "off");
  const share = flow.soc / MG.BESS.kwh;
  socEls.forEach((el, i) => {
    const y = BESS_BOXES[i] + 26;
    const zt = 5.6 + 16.8 * Math.max(0.02, Math.round(share * 50) / 50);
    setAttr(el, "d", pathOf([[100.6, y, 5.6], [105.4, y, 5.6], [105.4, y, zt], [100.6, y, zt]].map((p) => iso(p, P)), true));
  });
}

// ------------------------------------------------------------ the 24-hour strip: what powered the load, slot by slot
function drawDay() {
  const Wd = 1000, x0 = 34, x1 = Wd - 8, yb = 128, yt = 14, kwMax = 3000;
  const X = (k) => x0 + (k / SLOTS) * (x1 - x0);
  const Y = (kw) => yb - (kw / kwMax) * (yb - yt);
  const nowK = Math.min(SLOTS - 1, Math.floor(simMin / 15));
  const series = [["solar", "dc-c-sun"], ["bio", "dc-c-bio"], ["dis", "dc-c-batt"], ["unserved", "dc-c-out"]];
  let out = "";
  for (let h = 0; h <= 24; h += 3) out += '<path class="dc-d-grid" d="M' + X(h * 4).toFixed(1) + " " + yt + "V" + yb + '"/>';
  for (const kw of [1000, 2000, 3000]) out += '<path class="dc-d-grid" d="M' + x0 + " " + Y(kw).toFixed(1) + "H" + x1 + '"/><text class="dc-d-ax" x="' + (x0 - 4) + '" y="' + (Y(kw) + 3).toFixed(1) + '" text-anchor="end">' + kw / 1000 + " MW</text>";
  const rects = {};
  const socPts = [], loadPts = [];
  for (let k = 0; k < SLOTS; k++) {
    const s = k < nowK ? dayLog[k] : k === nowK ? flow : plan[k];
    if (!s) continue;
    const proj = k > nowK ? " p" : "";
    const xa = X(k), w = X(k + 1) - xa + 0.3;
    let base = 0;
    const toSolar = Math.min(s.solar, s.load);
    const toLoad = { solar: toSolar, bio: Math.min(s.bio, Math.max(0, s.load - toSolar)), dis: s.dis, unserved: s.unserved };
    for (const [key, cls] of series) {
      const v = toLoad[key];
      if (v > 0.5) { (rects[cls + proj] = rects[cls + proj] || []).push("M" + xa.toFixed(1) + " " + Y(base + v).toFixed(1) + "h" + w.toFixed(1) + "V" + Y(base).toFixed(1) + "h" + (-w).toFixed(1) + "Z"); base += v; }
    }
    let top = s.load;
    for (const [v, cls] of [[s.chg, "dc-c-chg"], [s.curt, "dc-c-curt"]]) if (v > 0.5) { (rects[cls + proj] = rects[cls + proj] || []).push("M" + xa.toFixed(1) + " " + Y(top + v).toFixed(1) + "h" + w.toFixed(1) + "V" + Y(top).toFixed(1) + "h" + (-w).toFixed(1) + "Z"); top += v; }
    loadPts.push([xa + w / 2, Y(s.load)]);
    socPts.push([xa + w / 2, yb - (s.soc / MG.BESS.kwh) * (yb - yt)]);
  }
  for (const [cls, list] of Object.entries(rects)) out += '<path class="' + cls.replace(" p", " dc-proj") + '" d="' + list.join("") + '"/>';
  const line = (pts) => pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join("");
  if (loadPts.length) out += '<path class="dc-d-load" d="' + line(loadPts) + '"/>';
  if (socPts.length) out += '<path class="dc-d-soc" d="' + line(socPts) + '"/>';
  const reserve = yb - (MG.BESS.reserve / MG.BESS.kwh) * (yb - yt);
  out += '<path class="dc-d-res" d="M' + x0 + " " + reserve.toFixed(1) + "H" + x1 + '"/>';
  const xn = X(simMin / 15);
  out += '<path class="dc-d-now" d="M' + xn.toFixed(1) + " " + (yt - 6) + "V" + yb + '"/><circle class="dc-d-nowdot" cx="' + xn.toFixed(1) + '" cy="' + (yt - 6) + '" r="3"/>';
  for (let h = 0; h <= 24; h += 6) out += '<text class="dc-d-ax" x="' + X(h * 4).toFixed(1) + '" y="' + (yb + 14) + '" text-anchor="middle">' + String(h).padStart(2, "0") + ":00</text>";
  if (socPts.length) out += '<text class="dc-d-lab" x="' + (socPts[socPts.length - 1][0] - 2).toFixed(1) + '" y="' + Math.max(yt + 8, socPts[socPts.length - 1][1] - 4).toFixed(1) + '" text-anchor="end">battery</text>';
  dayEl.innerHTML = out;
}
dayEl.addEventListener("click", (event) => {
  const r = dayEl.getBoundingClientRect();
  const x = ((event.clientX - r.left) / r.width) * 1000;
  const target = Math.max(0, Math.min(1439, ((x - 34) / (1000 - 42)) * 1440));
  if (target > simMin) advance((target - simMin) * 60);
  run();
});

// ------------------------------------------------------------ the heads-up numbers
function drawKpis() {
  const pct = flow.soc / MG.BESS.kwh;
  setText(kpi("load"), f0(flow.load));
  setText(kpi("solar"), f0(flow.solar));
  setText(kpi("bess"), (flow.chg > 1 ? "+" : flow.dis > 1 ? "−" : "") + f0(flow.chg > 1 ? flow.chg : flow.dis));
  setText(kpi("soc"), f0(pct * 100) + "%");
  setAttr(kpi("socbar"), "style", "width:" + (pct * 100).toFixed(1) + "%");
  setText(kpi("bio"), f0(flow.bio));
  const y = cfg.solarOnly ? yearSolarOnly : yearDesigned;
  setText(kpi("uptime"), y ? (y.uptime * 100).toFixed(y.uptime > 0.99 ? 2 : 1) + "%" : "…");
  setText(kpi("uptime-note"), cfg.solarOnly ? "a year on sun + battery" : "a year on sun + battery + husk");
  const served = flow.unserved < 1;
  setText(kpi("state"), served ? (flow.solar >= flow.load - 1 ? "The sun carries the load" : flow.bio > 5 && flow.dis > 1 ? "Husk + battery carry the load" : flow.bio > 5 ? "Husk carries the load" : flow.dis > 1 ? "The battery carries the load" : "Covered") : flow.outage > 1 ? "Dark: not enough energy" : "Shedding non-critical load");
  app.setAttribute("data-served", flow.outage > 1 ? "no" : flow.shed > 1 ? "shed" : "yes");
  setText(document.querySelector("[data-clock]"), clockText(simMin));
  setText(document.querySelector("[data-date]"), dateText(doy));
}

// ------------------------------------------------------------ the year: every hour of a seeded weather year, two ways
function drawYear() {
  if (!yearDesigned) runYears();
  const cs = getComputedStyle(app);
  const colors = ["--dc-batt", "--dc-sun", "--dc-batt", "--dc-bio", "--dc-out", "--dc-shed"].map((n) => cs.getPropertyValue(n).trim());
  const probe = document.createElement("canvas").getContext("2d");
  const rgb = colors.map((c) => { probe.clearRect(0, 0, 1, 1); probe.fillStyle = c || "#888"; probe.fillRect(0, 0, 1, 1); return probe.getImageData(0, 0, 1, 1).data; });
  const draw = (canvas, y) => {
    canvas.width = 365; canvas.height = 24;
    const ctx = canvas.getContext("2d");
    const img = ctx.createImageData(365, 24);
    for (let d = 0; d < 365; d++) for (let h = 0; h < 24; h++) { const v = y.cells[d * 24 + h] || 2; const p = (h * 365 + d) * 4; img.data[p] = rgb[v][0]; img.data[p + 1] = rgb[v][1]; img.data[p + 2] = rgb[v][2]; img.data[p + 3] = 255; }
    ctx.putImageData(img, 0, 0);
  };
  draw(yearEl.querySelector('[data-map="design"]'), yearDesigned);
  draw(yearEl.querySelector('[data-map="solar"]'), yearSolarOnly);
  const fill = (key, y) => {
    setText(yearEl.querySelector('[data-y="' + key + '-up"]'), (y.uptime * 100).toFixed(2) + "%");
    setText(yearEl.querySelector('[data-y="' + key + '-out"]'), f0(y.outageH) + " h dark a year");
    setText(yearEl.querySelector('[data-y="' + key + '-mix"]'), f1(y.solarGwh) + " GWh sun · " + f1(y.bioGwh) + " GWh husk · " + f1(y.curtGwh) + " GWh spilled");
  };
  fill("design", yearDesigned);
  fill("solar", yearSolarOnly);
  if (!sizing) setTimeout(() => {
    sizing = MG.solarOnlySizing(0.999) || { none: true };
    const el = yearEl.querySelector('[data-y="sizing"]');
    if (!sizing.none) el.innerHTML = "<b>" + (sizing.kwp / 1000).toFixed(1) + " MWp</b> of trackers and <b>" + (sizing.kwh / 1000).toFixed(0) + " MWh</b> of battery: " + ((sizing.kwp / 1000) * 1.8).toFixed(1) + " ha of panels for a 7.3 ha site.";
    else el.textContent = "Not reachable below 10 MWp and 60 MWh in this weather year.";
  }, 30);
}

// ------------------------------------------------------------ the data sheet
function scopeSvg(values, unit, scale) {
  if (!values || values.length < 2) return "";
  const vs = values.map((v) => v * scale);
  let lo = Math.min(...vs), hi = Math.max(...vs);
  if (hi - lo < 1e-3 * Math.max(1, Math.abs(hi))) { const c = (hi + lo) / 2, span = Math.max(0.5, Math.abs(c) * 0.02); lo = c - span; hi = c + span; }
  const pad = (hi - lo) * 0.15; const floor = Math.min(...vs) >= 0 ? 0 : -Infinity; lo = Math.max(floor, lo - pad); hi = unit === "%" ? Math.min(100, hi + pad) : hi + pad;
  const Wd = 280, Hd = 60, x0 = Wd - ((vs.length - 1) / (HIST - 1)) * Wd;
  const pts = vs.map((v, i) => [x0 + (i / (HIST - 1)) * Wd, 4 + (Hd - 8) * (1 - (v - lo) / (hi - lo))]);
  const d = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join("");
  const area = d + "L" + pts[pts.length - 1][0].toFixed(1) + " " + Hd + "L" + pts[0][0].toFixed(1) + " " + Hd + "Z";
  const end = pts[pts.length - 1];
  const fmt = (v) => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2));
  return '<svg class="dc-scope" viewBox="0 0 ' + Wd + " " + (Hd + 14) + '" aria-hidden="true"><path class="dc-scope-grid" d="M0 ' + Hd / 2 + "H" + Wd + "M0 " + Hd + "H" + Wd + '"/><path class="dc-scope-area" d="' + area + '"/><path class="dc-scope-line" d="' + d + '"/><circle class="dc-scope-dot" cx="' + end[0].toFixed(1) + '" cy="' + end[1].toFixed(1) + '" r="2.6"/><text x="0" y="10">' + fmt(hi) + " " + unit + '</text><text x="0" y="' + (Hd - 3) + '">' + fmt(lo) + '</text><text x="' + Wd + '" y="' + (Hd + 12) + '" text-anchor="end">now</text></svg>';
}
let sheetHtml = "", showMath = false;
const esc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;");
function dimsSvg([w, d, h]) {
  const big = Math.max(w, d, h);
  const len = (v) => 6 + 58 * Math.pow(v / big, 0.8);
  const a = len(w), b = len(d), c = len(h);
  const cx = Math.cos(Math.PI / 6), sy = 0.5, O = [70, 30 + c];
  const P2 = (x, y, z) => [O[0] + (x - y) * cx, O[1] + (x + y) * sy - z];
  const pts = (list) => list.map((p) => P2(...p).map((v) => v.toFixed(1)).join(",")).join(" ");
  const [wx, wy] = P2(a / 2, b + 3, 0), [dx, dy] = P2(a + 3, b / 2, 0), [hx, hy] = P2(a, b, c / 2);
  const mm = (v) => (v >= 10 ? v.toFixed(0) : v.toFixed(1)) + " m";
  return '<svg class="dc-dims" viewBox="0 0 150 ' + (60 + c + (a + b) * 0.5).toFixed(0) + '" aria-label="' + w + " by " + d + " by " + h + ' metres"><polygon class="dc-d-right" points="' + pts([[a, 0, 0], [a, b, 0], [a, b, c], [a, 0, c]]) + '"/><polygon class="dc-d-left" points="' + pts([[0, b, 0], [a, b, 0], [a, b, c], [0, b, c]]) + '"/><polygon class="dc-d-top" points="' + pts([[0, 0, c], [a, 0, c], [a, b, c], [0, b, c]]) + '"/><text x="' + (wx - 4).toFixed(1) + '" y="' + (wy + 9).toFixed(1) + '" text-anchor="end">' + mm(w) + '</text><text x="' + (dx + 4).toFixed(1) + '" y="' + (dy + 9).toFixed(1) + '">' + mm(d) + '</text><text x="' + (hx + 5).toFixed(1) + '" y="' + (hy + 3).toFixed(1) + '">' + mm(h) + "</text></svg>";
}
function netSvg(id) {
  const qus = m.queueNs / 1000;
  const hops = [["fiber", "fibre", 85 * 4.895], ["mmr", "x-connect", 0.15], ["core", "core", 4.5 + 0.66 + 2 * qus], ["leaf", "leaf", 0.63 + qus], ["server", "GPUs", 46000]];
  const Wd = 300, x0 = 62, x1 = Wd - 44, lo = -2, hi = 5;
  const X = (us) => x0 + ((Math.log10(Math.max(us, 0.01)) - lo) / (hi - lo)) * (x1 - x0);
  const fmt = (us) => (us >= 1000 ? (us / 1000).toFixed(0) + " ms" : us >= 10 ? us.toFixed(0) + " µs" : us >= 1 ? us.toFixed(1) + " µs" : (us * 1000).toFixed(0) + " ns");
  let out = '<svg class="dc-inst" viewBox="0 0 ' + Wd + ' 92" aria-label="Time spent at each hop">';
  for (let e = lo; e <= hi; e++) out += '<path class="dc-i-grid" d="M' + X(10 ** e).toFixed(1) + ' 2V76"/>';
  hops.forEach(([key, label, us], i) => {
    const y = 6 + i * 14, on = key === id;
    out += '<text class="dc-i-lab' + (on ? " on" : "") + '" x="' + (x0 - 6) + '" y="' + (y + 7) + '" text-anchor="end">' + label + '</text><rect class="dc-i-bar' + (on ? " on" : "") + '" x="' + x0 + '" y="' + y + '" width="' + Math.max(1.5, X(us) - x0).toFixed(1) + '" height="8" rx="1"/><text class="dc-i-val' + (on ? " on" : "") + '" x="' + (X(us) + 4).toFixed(1) + '" y="' + (y + 7) + '">' + fmt(us) + "</text>";
  });
  [["10 ns", -2], ["1 µs", 0], ["1 ms", 3], ["100 ms", 5]].forEach(([t, e]) => (out += '<text class="dc-i-axis" x="' + X(10 ** e).toFixed(1) + '" y="88" text-anchor="middle">' + t + "</text>"));
  return out + "</svg>";
}
function heatSvg(marks) {
  const Wd = 300, x0 = 8, x1 = Wd - 8, lo = 10, hi = 40;
  const X = (t) => x0 + ((t - lo) / (hi - lo)) * (x1 - x0);
  const pts = [["wb", "wet bulb", m.wb], ["chws", "chilled", 14], ["chwr", "chilled ret.", 20], ["cold", "cold aisle", 24], ["hot", "hot aisle", 36], ["evap", "evaporator", m.tEvap], ["cond", "condenser", m.tCond], ["cws", "tower out", m.cwSupply], ["cwr", "tower in", m.cwReturn]];
  let out = '<svg class="dc-inst" viewBox="0 0 ' + Wd + ' 74" aria-label="Temperatures along the cooling chain"><defs><linearGradient id="dc-temp" x1="0" x2="1"><stop offset="0" stop-color="var(--dc-cold)"/><stop offset="1" stop-color="var(--dc-hot)"/></linearGradient></defs><rect x="' + x0 + '" y="32" width="' + (x1 - x0) + '" height="6" rx="3" fill="url(#dc-temp)"/>';
  let up = true;
  for (const [key, label, t] of pts) {
    const on = marks.includes(key), x = X(t).toFixed(1);
    out += '<path class="dc-i-tick' + (on ? " on" : "") + '" d="M' + x + (on ? (up ? " 22V38" : " 32V48") : " 30V40") + '"/>';
    if (on) { out += '<text class="dc-i-val on" x="' + x + '" y="' + (up ? 18 : 60) + '" text-anchor="middle">' + label + " " + t.toFixed(0) + "°</text>"; up = !up; }
  }
  [10, 20, 30, 40].forEach((t) => (out += '<text class="dc-i-axis" x="' + X(t).toFixed(1) + '" y="72" text-anchor="middle">' + t + "°C</text>"));
  return out + "</svg>";
}
function supplySvg(marks) {
  const toSolar = Math.min(flow.solar, flow.load);
  const parts = [["solar", "sun", toSolar], ["bio", "husk", Math.min(flow.bio, Math.max(0, flow.load - toSolar))], ["dis", "battery", flow.dis], ["unserved", "missing", flow.unserved]];
  const Wd = 300, full = Math.max(flow.load, 1);
  let x = 0, out = '<svg class="dc-inst" viewBox="0 0 ' + Wd + ' 62" aria-label="What supplies the load right now"><text class="dc-i-big" x="0" y="16">' + f0(flow.load) + ' kW</text><text class="dc-i-axis" x="' + Wd + '" y="16" text-anchor="end">PUE ' + f2(m.pue) + "</text>";
  parts.forEach(([key, label, v]) => {
    const w = (v / full) * Wd;
    if (w < 0.5) return;
    out += '<rect class="dc-s-' + key + (marks.includes(key) ? " on" : "") + '" x="' + x.toFixed(1) + '" y="24" width="' + Math.max(0.8, w - 0.8).toFixed(1) + '" height="14"/>';
    if (w > 46) out += '<text class="dc-i-val' + (marks.includes(key) ? " on" : "") + '" x="' + (x + 2).toFixed(1) + '" y="52">' + label + " " + f0(v) + "</text>";
    x += w;
  });
  return out + "</svg>";
}
function sunSvg() {
  const Wd = 300, Hd = 100, cx = 150, base = 82, R = 70;
  const s = MG.sun(doy, simMin / 60);
  let out = '<svg class="dc-inst" viewBox="0 0 ' + Wd + " " + Hd + '" aria-label="Sun and tracker"><path class="dc-i-grid" d="M' + (cx - R) + " " + base + "A" + R + " " + R + " 0 0 1 " + (cx + R) + " " + base + '"/><path class="dc-i-ground" d="M' + (cx - R - 14) + " " + base + "H" + (cx + R + 14) + '"/>';
  out += '<text class="dc-i-axis" x="' + (cx - R - 6) + '" y="' + (base + 12) + '" text-anchor="middle">E</text><text class="dc-i-axis" x="' + (cx + R + 6) + '" y="' + (base + 12) + '" text-anchor="middle">W</text>';
  if (s.up > 0) {
    const ang = Math.atan2(s.up, s.east);
    const sx = cx + Math.cos(ang) * R * -1 * -1, sy = base - Math.sin(ang) * R;
    const px = cx - Math.cos(ang) * R;
    out += '<circle class="dc-i-sun" cx="' + px.toFixed(1) + '" cy="' + sy.toFixed(1) + '" r="6"/><path class="dc-i-ray" d="M' + px.toFixed(1) + " " + sy.toFixed(1) + "L" + cx + " " + (base - 14) + '"/>';
  }
  const r = (pvNow.R * Math.PI) / 180;
  const hw = 22;
  out += '<path class="dc-i-post" d="M' + cx + " " + base + "V" + (base - 14) + '"/><path class="dc-i-panel" d="M' + (cx - Math.cos(r) * hw).toFixed(1) + " " + (base - 14 - Math.sin(r) * hw).toFixed(1) + "L" + (cx + Math.cos(r) * hw).toFixed(1) + " " + (base - 14 + Math.sin(r) * hw).toFixed(1) + '"/>';
  out += '<text class="dc-i-val on" x="' + cx + '" y="' + (base + 12) + '" text-anchor="middle">' + (s.up > 0 ? "sun " + f0(s.elev) + "° up · tables " + f0(Math.abs(pvNow.R)) + "° " + (pvNow.R >= 0 ? "east" : "west") : "night · tables flat") + "</text>";
  return out + "</svg>";
}
function batterySvg() {
  const Wd = 300, Hd = 64, x0 = 4, x1 = 270, share = flow.soc / MG.BESS.kwh, res = MG.BESS.reserve / MG.BESS.kwh;
  const X = (v) => x0 + v * (x1 - x0);
  let out = '<svg class="dc-inst" viewBox="0 0 ' + Wd + " " + Hd + '" aria-label="Battery charge"><rect class="dc-b-case" x="' + x0 + '" y="10" width="' + (x1 - x0) + '" height="34" rx="4"/><rect class="dc-b-cap" x="' + (x1 + 2) + '" y="20" width="6" height="14" rx="1.5"/>';
  out += '<rect class="dc-b-fill" x="' + (x0 + 2) + '" y="12" width="' + Math.max(0, X(share) - x0 - 4).toFixed(1) + '" height="30" rx="3"/><path class="dc-b-res" d="M' + X(res).toFixed(1) + ' 8V46"/>';
  out += '<text class="dc-i-big" x="' + (x0 + 8) + '" y="32">' + f1(flow.soc / 1000) + " MWh</text>";
  out += '<text class="dc-i-axis" x="' + X(res).toFixed(1) + '" y="58" text-anchor="middle">reserve</text><text class="dc-i-val on" x="' + x1 + '" y="58" text-anchor="end">' + (flow.chg > 1 ? "charging " + f0(flow.chg) + " kW" : flow.dis > 1 ? "giving " + f0(flow.dis) + " kW" : "resting") + "</text>";
  return out + "</svg>";
}
function fuelSvg() {
  const Wd = 300, burnKg = (flow.bio * 3600) / (MG.BIO.eff * MG.BIO.lhv * 1000);
  let out = '<svg class="dc-inst" viewBox="0 0 ' + Wd + ' 60" aria-label="Biomass engine and fuel">';
  out += '<text class="dc-i-big" x="0" y="16">' + f0(flow.bio) + ' kW</text><text class="dc-i-axis" x="' + Wd + '" y="16" text-anchor="end">' + f0(burnKg) + " kg husk / h</text>";
  out += '<rect class="dc-b-case" x="0" y="24" width="' + Wd + '" height="10" rx="3"/><rect class="dc-s-bio" x="0" y="24" width="' + ((flow.bio / MG.BIO.kw) * Wd).toFixed(1) + '" height="10" rx="3"/>';
  out += '<text class="dc-i-axis" x="0" y="52">60 days of husk on site · 500 t</text>';
  return out + "</svg>";
}
function renderSheet(force = false) {
  if (!focused || current < 0) return;
  const id = STATIONS[current].id;
  const g = { flow, pv: pvNow, sun: MG.sun(doy, simMin / 60), mg: MG, year: cfg.solarOnly ? yearSolarOnly : yearDesigned };
  const sh = sheetOf(id, m, C, g);
  const [key, label, unit, scale] = sh.scope;
  const inst = sh.kind === "net" ? netSvg(id) : sh.kind === "heat" ? heatSvg(sh.mark || []) : sh.kind === "sun" ? sunSvg() : sh.kind === "battery" ? batterySvg() : sh.kind === "fuel" ? fuelSvg() : supplySvg(sh.mark || []);
  const tiles = sh.rows.map(([k, v, eq, n, lo, hi]) => {
    const share = n === undefined ? 0 : Math.max(0, Math.min(1, (n - lo) / (hi - lo)));
    return '<div class="dc-tile" title="' + esc(eq) + '"><span class="dc-k">' + k + '</span><span class="dc-v">' + v + '</span><span class="dc-meter"><i style="width:' + (share * 100).toFixed(1) + '%"></i></span><span class="dc-eq">' + eq + "</span></div>";
  }).join("");
  const html = '<header class="dc-sh-head"><div><span class="dc-sh-num">' + String(current + 1).padStart(2, "0") + '</span><h2>' + STATIONS[current].name + '</h2><p class="dc-sh-size">' + sh.what + '</p></div><button type="button" class="dc-math" data-math aria-pressed="' + showMath + '" title="Show the equations">ƒ</button></header>' + dimsSvg(sh.dims) + inst + '<div class="dc-tiles">' + tiles + '</div><figure class="dc-sh-scope"><figcaption>' + label + '</figcaption>' + scopeSvg(history[key], unit, scale) + '</figure><nav class="dc-sh-nav"><button type="button" class="dc-btn" data-nav="-1" aria-label="Previous component">←</button><span class="dc-sh-time"></span><button type="button" class="dc-btn" data-nav="0" aria-label="Back to the whole site">×</button><button type="button" class="dc-btn" data-nav="1" aria-label="Next component">→</button></nav>';
  if (html !== sheetHtml || force) { sheetEl.innerHTML = html; sheetHtml = html; }
  sheetEl.toggleAttribute("data-show-math", showMath);
}

// ------------------------------------------------------------ selecting, focusing, writing
function select(index, announce = true) {
  index = (index + STATIONS.length) % STATIONS.length;
  if (index !== current) {
    if (current >= 0) groups[current].forEach((el) => el.removeAttribute("data-on"));
    current = index;
    groups[current].forEach((el) => el.setAttribute("data-on", ""));
    if (V3) V3.light(STATIONS[current].id);
    svg.setAttribute("data-focus", "");
    stops.forEach((b, i) => b.setAttribute("aria-pressed", String(i === current)));
    hops.forEach((h, i) => h.toggleAttribute("data-lit", i <= Math.min(current, 4)));
    if (announce) status.textContent = STATIONS[current].name;
  }
  if (focused) frameOn(STATIONS[current].id);
  write(true);
  renderSheet(true);
  run();
}
function focus(index) {
  focused = true;
  sheetEl.hidden = false;
  app.setAttribute("data-sheet-open", "");
  select(index);
}
function unfocus() {
  focused = false;
  sheetEl.hidden = true;
  app.removeAttribute("data-sheet-open");
  if (current >= 0) groups[current].forEach((el) => el.removeAttribute("data-on"));
  if (V3) V3.light("");
  svg.removeAttribute("data-focus");
  stops.forEach((b) => b.setAttribute("aria-pressed", "false"));
  current = -1;
  overview();
  write(true);
  run();
}
let lastText = "", lastWhat = "";
const cache = new Map();
const setText = (el, v) => { if (el && cache.get(el) !== v) { cache.set(el, v); el.textContent = v; } };
const setAttr = (el, name, v) => { if (!el) return; const map = cache.get(el) || {}; if (map[name] !== v) { map[name] = v; cache.set(el, map); el.setAttribute(name, v); } };
function write(force = false) {
  let text, body;
  if (current >= 0) [text, body] = lines()[STATIONS[current].id];
  else { text = (flow.unserved < 1 ? "load covered" : "short " + f0(flow.unserved) + " kW") + " · PUE " + f2(m.pue); body = "<b>An off-grid data center.</b> The sun runs it by day and fills the battery, the battery carries the evening, and rice husk carries the night."; }
  const ap = apartLine();
  if (ap) { text = ap; body = "<b>The hall, layer by layer.</b> Racks, containment, the power tray and the fibre trough lift apart; press A to put them back."; }
  if (text !== lastText) { readout.textContent = text; lastText = text; }
  if (body !== lastWhat || force) { what.innerHTML = body; lastWhat = body; }
  setText(noc("pue"), f2(m.pue));
  setText(noc("it"), f2(m.it));
  setText(noc("chw"), "14 / 20");
  setText(noc("fan"), f0((flow.soc / MG.BESS.kwh) * 100) + "%");
  setText(noc("src"), flow.solar >= flow.load - 1 ? "SOLAR" : flow.bio > 5 ? "BIOMASS" : flow.dis > 1 ? "BATTERY" : "—");
  setAttr(noc("bat"), "d", "M372.2 -33.2H" + (372.2 + 8.4 * (flow.soc / MG.BESS.kwh)).toFixed(2));
  setText(noc("hop"), current >= 0 && current <= 4 ? ["85 km fibre", "cross-connect", "router + spine", "leaf switch", "GPUs"][current] : "answered");
  setAttr(svg, "data-towers", "run");
}
function drawSpark() {
  if (pueHist.length < 2) return;
  const lo = Math.min(...pueHist) - 0.01, hi = Math.max(...pueHist) + 0.01;
  setAttr(noc("spark"), "d", pueHist.map((v, i) => (i ? "L" : "M") + (348.6 + (8.8 * i) / 39).toFixed(2) + " " + (-30.6 - ((v - lo) / (hi - lo)) * 3.4).toFixed(2)).join(""));
}

// ------------------------------------------------------------ steam and exhaust in WebGL; the CSS puffs stay as the fallback
const glCanvas = stage.querySelector(".dc-gl");
let fx = null;
try { fx = glLayer({ canvas: glCanvas, fragment: SHADER, view: [GL.W, GL.H], camera: GL.camera, uniforms: ["uLight", "uSteam", "uRise", "uSmoke", "uPuff"], fixed: { uTower: GL.towers, uStack: GL.stacks } }); } catch (error) { fx = null; }
if (fx) stage.setAttribute("data-gl", "");
const steam = { x: 0, v: 0 }, plumeRise = { x: 40, v: 0 }, chpSmoke = { x: 0, v: 0 };
let light = 1, themeClock = 0, chpStart = -99, chpWas = false;
const readLight = () => (getComputedStyle(stage).getPropertyValue("--anatomy-lit").trim().toLowerCase() === "#000000" ? 1 : 0);
light = readLight();

// ------------------------------------------------------------ the loop
const TOUR_HOLD = 6.5;
let dayClock = 0;
function tick(now) {
  const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
  last = now;
  const calm = still.matches;
  clock += dt;
  shown = calm ? load : shown + (load - shown) * (1 - Math.exp(-dt / 0.35));
  if (Math.abs(load - shown) < 0.0005) shown = load;
  if (cfg.playing) advance(dt * cfg.speed);
  sim.s.day = simMin;
  m = sim.step(cfg.playing ? dt * Math.min(cfg.speed, 60) : 0, { load: shown, source: "utility", accel: 0 });
  const want = m.fanShare * 5.2;
  fanSpeed = calm ? want : fanSpeed + (want - fanSpeed) * (1 - Math.exp(-dt / 1.2));
  if (!calm) fanAngle = fanAngle.map((a) => a + fanSpeed * dt);
  fanEls.forEach((el, i) => el.setAttribute("d", blades(FANS[i][0], FANS[i][1], FANS[i][2], fanAngle[i])));
  trackerClock += dt;
  if (trackerClock > 0.25) { trackerClock = 0; drawTrackers(pvNow.up > 0 ? pvNow.R : 0); }
  drawSky();
  drawPower();
  if (touring) {
    tourClock += dt;
    if (tourClock > TOUR_HOLD) { tourClock = 0; focus(current + 1); }
  }
  stepSprings(dt, calm);
  stepCamera(dt, calm);
  sampleClock += dt;
  if (sampleClock > 0.2) {
    sampleClock = 0;
    const snap = { ...m, solar: flow.solar, soc: (flow.soc / MG.BESS.kwh) * 100, bio: flow.bio, load: flow.load };
    for (const key of ["util", "queueNs", "tj", "rackKw", "fans", "chwPump", "cop", "cwSupply", "solar", "soc", "bio", "load"]) keep(key, snap[key]);
    renderSheet();
    drawKpis();
    if (clock - pueAt > 0.5) { pueAt = clock; pueHist.push(m.pue); if (pueHist.length > 40) pueHist.shift(); drawSpark(); }
  }
  dayClock += dt;
  if (dayClock > 0.25) { dayClock = 0; drawDay(); }
  if (mode === "3d" && V3) V3.update(dt, calm);
  if (fx && mode === "2d") {
    themeClock += dt;
    if (themeClock > 0.5) { themeClock = 0; light = readLight(); }
    settle(steam, 0.3 + 0.7 * m.fanShare, dt, 1.4, calm);
    settle(plumeRise, 26 + 30 * m.fanShare, dt, 1.8, calm);
    const on = flow.bio > 5;
    if (on && !chpWas) chpStart = clock;
    chpWas = on;
    settle(chpSmoke, on ? 0.25 + 0.5 * (flow.bio / 750) : 0, dt, 1.4, calm);
    fx.draw({ uLight: light, uSteam: steam.x, uRise: plumeRise.x, uSmoke: [chpSmoke.x, 0, 0], uPuff: [calm ? 0 : burst(clock - chpStart, 0.15, 1.2) * 0.8, 0, 0], uView: [cam.w, cam.w * aspect()], uOrigin: [GL.camera.origin[0] - cam.x, GL.camera.origin[1] - cam.y] }, calm ? 0.8 : clock);
  }
  write();
  frame = visible ? requestAnimationFrame(tick) : 0;
}
function run() { if (!frame && visible) { last = 0; frame = requestAnimationFrame(tick); } }
function takeOver() { touring = false; if (tourButton) tourButton.setAttribute("aria-pressed", "false"); }
new IntersectionObserver((entries) => { visible = entries[entries.length - 1].isIntersecting; if (visible) run(); }, { rootMargin: "120px 0px" }).observe(stage);

// ------------------------------------------------------------ input: click flies, drag pans, scroll zooms
const stationOf = (target) => {
  const it = target.closest && target.closest(".it[data-st]");
  if (!it) return -1;
  return STATIONS.findIndex((s) => s.id === it.getAttribute("data-st").split(" ")[0]);
};
let drag = null;
svg.addEventListener("pointermove", (event) => {
  if (!drag) return;
  const r = svg.getBoundingClientRect();
  const dx = ((event.clientX - drag.x) / r.width) * cam.w, dy = ((event.clientY - drag.y) / r.height) * cam.w * aspect();
  if (!drag.moved && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 4) { drag.moved = true; try { svg.setPointerCapture(event.pointerId); } catch (error) {} takeOver(); }
  if (drag.moved) { goal.x = drag.gx - dx; goal.y = drag.gy - dy; cam.x = goal.x; cam.y = goal.y; cam.vx = cam.vy = 0; run(); }
});
svg.addEventListener("pointerdown", (event) => { if (event.button === 0) drag = { x: event.clientX, y: event.clientY, gx: goal.x, gy: goal.y, moved: false }; });
svg.addEventListener("pointerup", (event) => {
  const moved = drag && drag.moved;
  drag = null;
  if (moved) return;
  const index = stationOf(event.target);
  if (index >= 0) { takeOver(); focus(index); stage.focus({ preventScroll: true }); }
});
svg.addEventListener("pointercancel", () => { drag = null; });
svg.addEventListener("dblclick", (event) => { event.preventDefault(); takeOver(); unfocus(); });
stage.addEventListener("wheel", (event) => {
  if (mode !== "2d") return;
  event.preventDefault();
  takeOver();
  zoomAt(event.clientX, event.clientY, Math.exp(event.deltaY * (event.ctrlKey ? 0.01 : 0.0025)));
  run();
}, { passive: false });
addEventListener("keydown", (event) => {
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.target.closest && event.target.closest("select, input")) return;
  const key = event.key;
  let handled = true;
  if (key === "ArrowRight") { takeOver(); focus(current + 1); }
  else if (key === "ArrowLeft") { takeOver(); focus(current - 1); }
  else if (key === "Escape") { takeOver(); if (!yearEl.hidden) toggleYear(); else unfocus(); }
  else if (key === "ArrowUp") { load = Math.min(LOAD.max, +(load + LOAD.step).toFixed(3)); status.textContent = "IT load " + f0(load * 1000) + " kW"; replan(); }
  else if (key === "ArrowDown") { load = Math.max(LOAD.min, +(load - LOAD.step).toFixed(3)); status.textContent = "IT load " + f0(load * 1000) + " kW"; replan(); }
  else if (key === " ") { cfg.playing = !cfg.playing; syncControls(); }
  else if (mode === "3d" && V3 && (key === "+" || key === "=")) { V3.zoomBy(1.25); }
  else if (mode === "3d" && V3 && key === "-") { V3.zoomBy(0.8); }
  else if (key === "+" || key === "=") { const r = svg.getBoundingClientRect(); zoomAt(r.left + r.width / 2, r.top + r.height / 2, 0.8); }
  else if (key === "-") { const r = svg.getBoundingClientRect(); zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1.25); }
  else if (key === "v" || key === "V") { setMode(mode === "3d" ? "2d" : "3d"); }
  else if (key === "a" || key === "A") { setApart(!apart); }
  else if (key === "y" || key === "Y") { toggleYear(); }
  else if (key === "t" || key === "T") { applyTheme(isDark() ? "light" : "dark"); }
  else handled = false;
  if (handled) { event.preventDefault(); run(); }
});
sheetEl.addEventListener("click", (event) => {
  if (event.target.closest("[data-math]")) { showMath = !showMath; renderSheet(true); return; }
  const b = event.target.closest("[data-nav]");
  if (!b) return;
  takeOver();
  const n = Number(b.dataset.nav);
  if (n === 0) unfocus(); else focus(current + n);
});
stops.forEach((b, i) => b.addEventListener("click", () => { takeOver(); focus(i); }));

// ------------------------------------------------------------ the controls in the top bar
const act = (name) => document.querySelector('[data-act="' + name + '"]');
function syncControls() {
  act("play").setAttribute("aria-pressed", String(cfg.playing));
  act("play").setAttribute("aria-label", cfg.playing ? "Pause" : "Play");
  act("play").textContent = cfg.playing ? "❚❚" : "▶";
  document.querySelectorAll("[data-weather]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.weather === cfg.weather)));
  act("bio").setAttribute("aria-pressed", String(cfg.bioOk && !cfg.solarOnly));
  act("bio").disabled = cfg.solarOnly;
  act("bess").setAttribute("aria-pressed", String(cfg.bessOk));
  act("solaronly").setAttribute("aria-pressed", String(cfg.solarOnly));
  document.querySelector("[data-speed]").value = String(cfg.speed);
  app.toggleAttribute("data-solar-only", cfg.solarOnly);
}
act("play").addEventListener("click", () => { cfg.playing = !cfg.playing; syncControls(); run(); });
document.querySelector("[data-speed]").addEventListener("change", (e) => { cfg.speed = Number(e.target.value); run(); });
document.querySelectorAll("[data-weather]").forEach((b) => b.addEventListener("click", () => { cfg.weather = b.dataset.weather; trackerR = 999; replan(); syncControls(); status.textContent = "Weather: " + b.textContent; run(); }));
act("bio").addEventListener("click", () => { cfg.bioOk = !cfg.bioOk; replan(); syncControls(); status.textContent = cfg.bioOk ? "Biomass back in service." : "Biomass plant offline."; run(); });
act("bess").addEventListener("click", () => { cfg.bessOk = !cfg.bessOk; replan(); syncControls(); status.textContent = cfg.bessOk ? "Battery back in service." : "Battery offline."; run(); });
act("solaronly").addEventListener("click", () => { cfg.solarOnly = !cfg.solarOnly; replan(); syncControls(); status.textContent = cfg.solarOnly ? "Solar and battery only: no biomass." : "Solar, battery and biomass."; run(); });
if (apartButton) apartButton.addEventListener("click", () => { setApart(!apart); run(); });
if (tourButton) tourButton.addEventListener("click", () => {
  if (touring) { takeOver(); unfocus(); return; }
  touring = true; tourClock = 0; tourButton.setAttribute("aria-pressed", "true"); focus(current < 0 ? 0 : current); run();
});
function toggleYear() {
  yearEl.hidden = !yearEl.hidden;
  act("year").setAttribute("aria-pressed", String(!yearEl.hidden));
  if (!yearEl.hidden) setTimeout(drawYear, 10);
}
act("year").addEventListener("click", toggleYear);
yearEl.addEventListener("click", (event) => { if (event.target.closest("[data-close]")) toggleYear(); });
const viewButton = act("view");
function setMode(next) {
  if (next === "3d" && !V3) return;
  mode = next;
  stage.setAttribute("data-mode", mode);
  viewButton.setAttribute("aria-pressed", String(mode === "3d"));
  if (mode === "3d") { if (focused && current >= 0) V3.frame(STATIONS[current].id); else V3.home(); }
  else if (focused && current >= 0) frameOn(STATIONS[current].id); else overview();
  status.textContent = mode === "3d" ? "3D view. Drag to turn it." : "Drawing view.";
  run();
}
viewButton.addEventListener("click", () => setMode(mode === "3d" ? "2d" : "3d"));
addEventListener("resize", () => { if (focused && current >= 0) frameOn(STATIONS[current].id); else overview(); run(); });

// ------------------------------------------------------------ light / dark: the root attribute on the published page, the body on the fixed pages
const themeHost = document.querySelector(".dc-root") ? document.documentElement : document.body;
const isDark = () => getComputedStyle(stage).getPropertyValue("--anatomy-lit").trim().toLowerCase() !== "#000000";
function applyTheme(next, save = true) {
  themeHost.setAttribute("data-theme", next);
  document.documentElement.style.colorScheme = next;
  if (save) { try { localStorage.setItem("dc-theme", next); } catch (error) {} }
  syncTheme();
  light = readLight();
  if (!yearEl.hidden) drawYear();
  run();
}
function syncTheme() {
  const dark = isDark();
  app.toggleAttribute("data-dark", dark);
  act("theme").setAttribute("aria-label", dark ? "Switch to light theme" : "Switch to dark theme");
}
try { const saved = localStorage.getItem("dc-theme"); if (saved === "light" || saved === "dark") applyTheme(saved, false); } catch (error) {}
act("theme").addEventListener("click", () => applyTheme(isDark() ? "light" : "dark"));
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", syncTheme);
syncTheme();

// ------------------------------------------------------------ start: a sunny April morning, with the battery as the night left it
syncControls();
advance(6.5 * 3600);
replan();
overview();
cam.x = goal.x; cam.y = goal.y; cam.w = goal.w;
setTimeout(() => { runYears(); drawKpis(); }, 50);
write(true);
pueHist.push(m.pue);
`;
