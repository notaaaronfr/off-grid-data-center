// The data sheet for each component: real dimensions in metres, live values from the plant and microgrid
// simulations and the equation behind each one. sheetOf() is self-contained so the build can inline it.
// rows: [label, value, equation, number, min, max]; the number and its range drive the tile's meter.

export function sheetOf(id, m, C, g) {
  const f0 = (v) => Math.round(v).toLocaleString("en-US");
  const f1 = (v) => v.toFixed(1), f2 = (v) => v.toFixed(2), f3 = (v) => v.toFixed(3);
  const kw = (mw) => f0(mw * 1000) + " kW";
  const { flow, pv, mg } = g;
  const KM = 85, usPerKm = 4.895, prop = KM * usPerKm;
  const loss = KM * 0.25 + 4 * 0.3 + 18 * 0.05;
  const qus = m.queueNs / 1000;
  const core = 4.5 + 0.6 + 0.06 + 2 * qus;
  const leaf = 0.6 + 0.03 + qus;
  const soc = flow.soc / mg.BESS.kwh;
  const autonomy = flow.load > 1 ? Math.max(0, flow.soc - mg.BESS.reserve) / flow.load : 0;
  const burnKg = (flow.bio * 3600) / (mg.BIO.eff * mg.BIO.lhv * 1000);
  const T = {
    fiber: {
      kind: "net", dims: [3.0, 2.2, 0.5], what: "Street vault · two diverse ducts",
      rows: [
        ["Route", KM + " km", "to the submarine cable landing station", KM, 0, 120],
        ["Fibre loss", f1(loss) + " dB", "0.25 dB/km at 1,550 nm + 4 connectors + 18 splices", loss, 0, 30],
        ["Light time", f0(prop) + " µs", "t = L·n_g / c, n_g 1.468", prop, 0, 600],
        ["Link load", f0(m.util * 100) + " %", "live traffic on the 100G uplink", m.util * 100, 0, 100],
      ],
      scope: ["util", "link load", "%", 100],
    },
    mmr: {
      kind: "net", dims: [1.6, 6.8, 2.6], what: "Carrier cage",
      rows: [
        ["Cross-connect", "0.6 dB", "2 mated LC pairs × 0.3 dB", 0.6, 0, 3],
        ["Jumper", "0.15 µs", "30 m of patch fibre", 0.15, 0, 1],
        ["Carriers", "2 racks", "two operators for route diversity", 2, 0, 4],
        ["Link load", f0(m.util * 100) + " %", "same light, now on our side", m.util * 100, 0, 100],
      ],
      scope: ["util", "link load", "%", 100],
    },
    core: {
      kind: "net", dims: [1.2, 1.8, 2.9], what: "Router chassis",
      rows: [
        ["Queue wait", f0(m.queueNs) + " ns", "W = ρ/(1−ρ)·t_s, ρ " + f2(m.util) + ", t_s 30 ns", m.queueNs, 0, 400],
        ["Hop time", f1(core) + " µs", "4.5 lookup + 0.6 cut-through + queues", core, 0, 10],
        ["Paths", "4", "ECMP over the spine switches", 4, 0, 8],
        ["Port load", f0(m.util * 100) + " %", "ρ = λ / μ", m.util * 100, 0, 100],
      ],
      scope: ["queueNs", "queue wait", "ns", 1],
    },
    leaf: {
      kind: "net", dims: [0.6, 15.5, 0.3], what: "Fibre trough",
      rows: [
        ["Leaf switch", f2(leaf) + " µs", "0.6 µs + 30 ns serialization + queue", leaf, 0, 2],
        ["In building", f1(0.15 + core + leaf + 0.08) + " µs", "meet-me room to the server", 0.15 + core + leaf + 0.08, 0, 12],
        ["Door to door", f0(prop + 0.15 + core + leaf + 0.08) + " µs", "cable landing to the server", prop + core + leaf, 0, 600],
        ["Queue wait", f0(m.queueNs) + " ns", "M/M/1 at the port", m.queueNs, 0, 400],
      ],
      scope: ["queueNs", "queue wait", "ns", 1],
    },
    server: {
      kind: "net", dims: [0.6, 1.2, 2.2], what: "42U rack · 16 GPUs",
      rows: [
        ["Rack", f1(m.rackKw) + " kW", "480 kW of GPU compute over " + C.GPU_RACKS + " racks", m.rackKw, 0, 45],
        ["Per GPU", f0(m.gpuW) + " W", "of " + C.GPU_W + " W TDP; 2.4 kW with its share of servers", m.gpuW, 0, C.GPU_W],
        ["Junction", f1(m.tj) + " °C", "T_j = T_in + P·Rθ, Rθ " + C.GPU_RTH + " K/W", m.tj, C.INLET, C.GPU_THROTTLE],
        ["Answer", "46 ms", "inference on one 8-GPU server", 46, 0, 100],
      ],
      scope: ["tj", "GPU junction", "°C", 1],
    },
    aisle: {
      kind: "heat", dims: [1.2, 3.6, 2.2], what: "Hot aisle", mark: ["cold", "hot"],
      rows: [
        ["GPU rack air", f2((m.rackKw * 1000) / (1.16 * 1005 * C.AIR_DT)) + " m³/s", "V̇ = Q / (ρ·c_p·ΔT)", (m.rackKw * 1000) / (1.16 * 1005 * C.AIR_DT), 0, 4],
        ["Hall air", f1(m.air) + " m³/s", "ṁ = " + f0(m.mAir) + " kg/s", m.air, 0, 90],
        ["ΔT", C.AIR_DT + " K", C.INLET + " → " + (C.INLET + C.AIR_DT) + " °C across the servers", C.AIR_DT, 0, 20],
        ["Heat", f1(m.rackKw) + " kW", "per GPU rack, every watt", m.rackKw, 0, 45],
      ],
      scope: ["rackKw", "rack heat", "kW", 1],
    },
    crah: {
      kind: "heat", dims: [2.2, 1.2, 2.8], what: "Air handler · 4 units", mark: ["hot", "cold", "chws", "chwr"],
      rows: [
        ["Per unit", f0((m.it * 1000) / C.CRAH.count) + " kW", "P_IT / " + C.CRAH.count, (m.it * 1000) / C.CRAH.count, 0, 300],
        ["Coil ε", f2(m.coilEff), "ε = ΔT_air / (T_air,in − T_chw,in)", m.coilEff, 0, 1],
        ["Fan speed", f0(m.crahN * 100) + " %", "airflow ∝ heat at fixed ΔT", m.crahN * 100, 0, 100],
        ["Fan power", kw(m.fans), "P = P_d·N³, " + C.CRAH.count + " × " + C.CRAH.fanKw + " kW", m.fans * 1000, 0, C.CRAH.count * C.CRAH.fanKw],
      ],
      scope: ["fans", "fan power", "kW", 1000],
    },
    chw: {
      kind: "heat", dims: [0.17, 12, 0.17], what: "DN150 loop · 120 m", mark: ["chws", "chwr"],
      rows: [
        ["Flow", f1(m.chwFlow) + " L/s", "Q = P / (c_p·ΔT), ΔT 6 K", m.chwFlow, 0, 50],
        ["Velocity", f2(m.v) + " m/s", "v = Q / A, D " + C.CHW.pipeD + " m", m.v, 0, 3],
        ["Reynolds", (m.re / 1000).toFixed(0) + "k", "Re = ρvD/μ, turbulent above 4k", m.re / 1000, 0, 300],
        ["Pump", kw(m.chwPump), "P = Q·Δp / η, Δp " + f0(m.dpChw) + " kPa (Swamee–Jain)", m.chwPump * 1000, 0, 20],
      ],
      scope: ["chwPump", "pump power", "kW", 1000],
    },
    chiller: {
      kind: "heat", dims: [9.6, 3.4, 3.6], what: "Water-cooled chiller · N+1", mark: ["evap", "cond", "chws", "cwr"],
      rows: [
        ["Lift", f1(m.tCond - m.tEvap) + " K", "T_cond − T_evap = " + f1(m.tCond) + " − " + f1(m.tEvap), m.tCond - m.tEvap, 0, 30],
        ["COP", f2(m.cop), C.CARNOT_SHARE + " × Carnot " + f1(m.carnot), m.cop, 0, 12],
        ["Compressor", kw(m.chiller), "P = Q / COP", m.chiller * 1000, 0, 200],
        ["Rejected", f0(m.rejected * 1000) + " kW", "IT + compressor + pump heat", m.rejected * 1000, 0, 1500],
      ],
      scope: ["cop", "COP", "", 1],
    },
    tower: {
      kind: "heat", dims: [6.8, 7.6, 7.4], what: "Tower cell · fan Ø 4.4 m · 2 cells", mark: ["wb", "cws", "cwr"],
      rows: [
        ["Approach", f1(m.approach) + " K", "water out − wet bulb", m.approach, 0, 8],
        ["Range", f1(m.cwReturn - m.cwSupply) + " K", "water in − water out", m.cwReturn - m.cwSupply, 0, 10],
        ["Evaporation", f2(m.evaporation) + " m³/h", "0.85·Q / h_fg, 2.42 MJ/kg", m.evaporation, 0, 3],
        ["Make-up", f2(m.evaporation + m.blowdown) + " m³/h", "evaporation + blowdown at " + C.TOWER.coc + " cycles", m.evaporation + m.blowdown, 0, 4],
      ],
      scope: ["cwSupply", "water to chillers", "°C", 1],
    },
    solar: {
      kind: "sun", dims: [4.8, 49, 2.6], what: "77 tables · 5,830 bifacial modules · 3.5 MWp",
      rows: [
        ["Output", f0(flow.solar) + " kW", "P = P_STC·G_POA/1000·η_DC·bifacial, capped at " + f0(mg.PV.acKw) + " kW AC", flow.solar, 0, mg.PV.acKw],
        ["On the panels", f0(pv.poa) + " W/m²", "G_POA = DNI·cos θ + DHI·(1 + cos β)/2", pv.poa, 0, 1100],
        ["Clipped", f0(pv.clipped) + " kW", "DC above the inverters' limit", pv.clipped, 0, 600],
        ["Spilled", f0(flow.curt) + " kW", "surplus with the battery full", flow.curt, 0, 2000],
      ],
      scope: ["solar", "solar output", "kW", 1],
    },
    bess: {
      kind: "battery", dims: [9.0, 2.6, 2.7], what: "4 LFP containers · 2.5 MW / 15 MWh",
      rows: [
        ["Charge", f0(soc * 100) + " %", f1(flow.soc / 1000) + " of 15 MWh; 2 MWh never touched", soc * 100, 0, 100],
        ["Power", (flow.chg > 1 ? "+" + f0(flow.chg) : flow.dis > 1 ? "−" + f0(flow.dis) : "0") + " kW", "limit 2,500 kW either way; η 96.5 % each way", flow.chg > 1 ? flow.chg : flow.dis, 0, 2500],
        ["Covers", f1(autonomy) + " h", "(E − reserve) / load", autonomy, 0, 18],
        ["Cycle life", "6,000+", "LFP at 80 % depth of discharge", 6000, 0, 10000],
      ],
      scope: ["soc", "battery charge", "%", 1],
    },
    biomass: {
      kind: "fuel", dims: [4.0, 2.6, 2.6], what: "Gasifier + 750 kW gas engine",
      rows: [
        ["Output", f0(flow.bio) + " kW", "dispatched after sunset and when the battery runs low", flow.bio, 0, mg.BIO.kw],
        ["Husk burn", f0(burnKg) + " kg/h", "ṁ = P / (η·LHV), η 25 %, 14 MJ/kg", burnKg, 0, 800],
        ["Stockpile", "60 days", "500 t under cover (report 4.3)", 60, 0, 90],
        ["Year", g.year ? f0(g.year.fuelT) + " t" : "…", "husk burned in the simulated year", g.year ? g.year.fuelT : 0, 0, 5000],
      ],
      scope: ["bio", "engine output", "kW", 1],
    },
    ups: {
      kind: "supply", dims: [1.2, 6.0, 2.2], what: "Switchboard · UPS · ride-through jars", mark: ["solar", "bio", "dis", "unserved"],
      rows: [
        ["Site load", f0(flow.load) + " kW", "IT × PUE + battery HVAC", flow.load, 0, 1600],
        ["UPS", f1(m.upsEff * 100) + " %", "loss = S·(a + b·x + c·x²)", m.upsEff * 100, 90, 100],
        ["Ride-through", f0(m.runtime) + " min", "UPS jars alone, Peukert 1.15", m.runtime, 0, 40],
        ["PUE", f2(m.pue), "site power / IT power", m.pue, 1, 2],
      ],
      scope: ["load", "site load", "kW", 1],
    },
  };
  return T[id];
}
