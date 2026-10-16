// The one model every number on the figure comes from: a small time-stepped plant simulation.
// createPlant() is self-contained (no imports, no outer names) so the build can inline its source into the page.
// Units: MW, kW, °C, K, L/s, m³/h, kPa, Hz, seconds. Equipment data are typical published values, cited in SOURCES.

export function createPlant() {
  const C = {
    RACKS: 30, // 5 rows × 6 racks in Phase 1; 13 of them hold the 200 GPUs
    GPU_RACKS: 13,
    GPU_SHARE: 480 / 622, // GPU compute share of IT load (report 6.1)
    SERVER_KW: 10.2, // one 8-GPU HGX/DGX-class server at full load (2 per rack)
    GPU_W: 700, // SXM accelerator TDP
    GPU_RTH: 0.055, // K/W junction-to-inlet at design airflow
    GPU_TAU: 25, // s, heatsink thermal time constant
    GPU_THROTTLE: 87, // °C
    INLET: 24, // °C cold-aisle supply (ASHRAE A1 recommended 18–27)
    AIR_DT: 12, // K across the servers
    CRAH: { count: 4, fanKw: 6, effDesign: 0 }, // fan-wall units, 22 kW fans each at design airflow
    CHW: { supply: 14, ret: 20, pipeD: 0.154, length: 120, rough: 4.5e-5, fixed: 140 }, // DN150 steel, kPa through coils + evaporators at design
    CW: { range: 6, flowDesign: 0, fixed: 160, towerHead: 60 }, // kPa
    PUMP_EFF: 0.78 * 0.95, // pump × motor
    CARNOT_SHARE: 0.42, // real chiller COP / Carnot COP at these lifts
    TOWER: { cells: 2, fanKw: 7.5, approachMin: 2.5, approachSpan: 2.5, coc: 4 },
    UPS: { mw: 1.0, a: 0.008, b: 0.02, c: 0.012 }, // loss = MW·(a + b·x + c·x²), x = load share
    BATTERY: { mwh: 0.25, ratedMin: 15, peukert: 1.15, cells: 240, rInt: 0.0006 }, // UPS ride-through jars, 15 min at 1 MW
    TX: { mva: 2, noLoad: 0.0025, load: 0.016, pf: 0.95, hv: 11e3, mv: 415 }, // site 11 kV / 415 V // MW losses at rated
    GEN: { count: 3, mw: 1.6, crank: 1.2, run: 6.5, transfer: 10, H: 1.6, sfc: 0.205, tankL: 53000 }, // kg/kWh, L
    MISC: 0.042, // lighting, NOC, security, ancillary (report 6.1)
    LOAD: { min: 0.3, max: 1.2, step: 0.1, start: 0.622 }, // Phase 1 is 622 kW IT; Phase 2 adds 216 GPUs
    FIBRE: { km: 40, dbPerKm: 0.35, connectors: 4, connDb: 0.3, splices: 10, spliceDb: 0.05, budget: 18, usPerKm: 4.895 },
  };
  C.CW.flowDesign = (C.LOAD.max * 1.2 * 1e6) / (4186 * C.CW.range); // L/s, sized for full load
  const s = { t: 0, day: 9.5 * 60, tj: C.INLET + C.GPU_W * 0.92 * C.GPU_RTH, soc: 1, f: 0, pm: 0, integ: 0, online: false, fuel: C.GEN.tankL, wasSource: "utility" };

  const wetBulbAt = (minutes) => 22 + 1.8 * Math.sin((2 * Math.PI * (minutes / 60 - 10)) / 24); // °C, site wet bulb 20–24 °C (report 6.2)
  const friction = (re, d, e) => 0.25 / Math.log10(e / (3.7 * d) + 5.74 / re ** 0.9) ** 2; // Swamee–Jain

  function steady(load, wb, util = 0.5) {
    const it = load;
    const x = it / C.LOAD.max;
    const rackKw = (it * 1000 * C.GPU_SHARE) / C.GPU_RACKS; // a GPU rack
    const gpuW = C.GPU_W * Math.min(1.05, (it * 1000 * C.GPU_SHARE) / 200 / 2.4);
    const mAir = (it * 1e6) / (1005 * C.AIR_DT); // kg/s
    const air = mAir / 1.16; // m³/s at ~30 °C
    const crahN = x; // airflow share of design, ΔT held constant
    const fans = (C.CRAH.count * C.CRAH.fanKw * crahN ** 3) / 1000; // affinity law: P ∝ N³
    const coilEff = C.AIR_DT / (C.INLET + C.AIR_DT - C.CHW.supply); // ε = ΔT_air / (T_air,in − T_chw,in)
    const chwFlow = (it * 1e6) / (4186 * (C.CHW.ret - C.CHW.supply)); // L/s
    const area = (Math.PI * C.CHW.pipeD ** 2) / 4;
    const v = chwFlow / 1000 / area;
    const re = (999.2 * v * C.CHW.pipeD) / 1.17e-3;
    const f = friction(re, C.CHW.pipeD, C.CHW.rough);
    const dpPipe = (f * (C.CHW.length / C.CHW.pipeD) * 999.2 * v * v) / 2 / 1000; // kPa
    const dpChw = dpPipe + C.CHW.fixed * x * x;
    const chwPump = (chwFlow / 1000) * dpChw / C.PUMP_EFF / 1000; // MW
    // heat out: tower approach grows with the heat it rejects; the chiller's lift follows the weather
    let chiller = it / 6, rejected = it, cwSupply = 0, cwReturn = 0, cop = 6, carnot = 10, tEvap = 0, tCond = 0, approach = 0, towerX = 0;
    for (let i = 0; i < 3; i++) {
      rejected = it + chiller + chwPump;
      towerX = rejected / (C.LOAD.max * 1.2);
      approach = C.TOWER.approachMin + C.TOWER.approachSpan * towerX;
      cwSupply = wb + approach;
      const range = (rejected * 1e6) / (4186 * C.CW.flowDesign);
      cwReturn = cwSupply + range;
      tEvap = C.CHW.supply - 2;
      tCond = cwReturn + 1.5;
      carnot = (tEvap + 273.15) / (tCond - tEvap);
      cop = C.CARNOT_SHARE * carnot;
      chiller = it / cop;
    }
    const cwFlow = C.CW.flowDesign;
    const cwPump = (cwFlow / 1000) * (C.CW.fixed + C.CW.towerHead) / C.PUMP_EFF / 1000;
    const towerFans = (C.TOWER.cells * C.TOWER.fanKw * Math.min(1, towerX) ** 3) / 1000;
    const evaporation = ((rejected * 1e6 * 0.85) / 2.42e6) * 3.6; // m³/h, 85 % of the heat leaves as latent heat
    const blowdown = evaporation / (C.TOWER.coc - 1);
    const ups = C.UPS.mw * (C.UPS.a + C.UPS.b * x + C.UPS.c * x * x);
    const pumps = chwPump + cwPump;
    const sub = it + chiller + fans + towerFans + pumps + ups + C.MISC;
    const sMva = sub / C.TX.pf;
    const transformer = C.TX.noLoad + C.TX.load * (sMva / C.TX.mva) ** 2;
    const total = sub + transformer;
    const runtime = C.BATTERY.ratedMin * (C.UPS.mw / Math.max(0.1, it / 0.97)) ** C.BATTERY.peukert;
    const hv = (total * 1e6) / (Math.sqrt(3) * C.TX.hv * C.TX.pf);
    const mvA = (total * 1e6) / (Math.sqrt(3) * C.TX.mv * C.TX.pf);
    const fuelLph = (total * 1000 * C.GEN.sfc) / 0.84;
    const fibreLoss = C.FIBRE.km * C.FIBRE.dbPerKm + C.FIBRE.connectors * C.FIBRE.connDb + C.FIBRE.splices * C.FIBRE.spliceDb;
    const queueNs = (util / (1 - util)) * 30; // M/M/1 wait at a 400G port, 1500 B = 30 ns service
    return {
      it, x, rackKw, gpuW, air, mAir, crahN, fans, coilEff, chwFlow, v, re, f, dpPipe, dpChw, chwPump, cwPump, pumps,
      chiller, rejected, cop, carnot, tEvap, tCond, cwSupply, cwReturn, approach, cwFlow, towerX, towerFans, evaporation, blowdown,
      ups, upsEff: it / (it + ups), transformer, total, pue: total / it, runtime, hv, mvA, fuelLph, wb, fibreLoss, util, queueNs,
      fanShare: Math.min(1, 0.2 + 0.8 * towerX),
    };
  }

  // one step of the dynamic states: GPU junction temperature, battery, generator frequency, fuel, weather, traffic
  function step(dt, { load, source, drillClock = 0, idle = false, accel = 2 }) {
    s.t += dt;
    s.day = (s.day + dt * accel) % 1440;
    const wb = wetBulbAt(s.day);
    const util = Math.min(0.92, Math.max(0.08, (0.22 + 0.55 * (load / C.LOAD.max)) * (1 + 0.14 * Math.sin(s.t * 0.83) + 0.08 * Math.sin(s.t * 2.17 + 1.3))));
    const m = steady(load, wb, util);
    const target = C.INLET + m.gpuW * C.GPU_RTH;
    s.tj += (target - s.tj) * (1 - Math.exp(-dt / C.GPU_TAU));
    // battery: discharge on battery (Peukert-corrected), slow float recharge otherwise
    if (source === "battery") s.soc = Math.max(0, s.soc - dt / 60 / m.runtime);
    else s.soc = Math.min(1, s.soc + dt / 3600 / 2);
    // generators: crank and run up, then the swing equation with an isochronous PI governor once on line
    if (source === "battery") {
      s.online = false;
      const r = Math.min(1, Math.max(0, (drillClock - C.GEN.crank) / (C.GEN.run - C.GEN.crank)));
      s.f = 50 * r * r * (3 - 2 * r);
      s.pm = 0; s.integ = 0;
    } else if (source === "gen") {
      if (!s.online) { s.online = true; s.f = 50; s.pm = 0.03; s.integ = 0; }
      const pe = m.total / (C.GEN.count * C.GEN.mw);
      for (let i = 0; i < 8; i++) {
        const h = dt / 8;
        const e = (50 - s.f) / 50;
        s.integ += e * h;
        const cmd = Math.min(1.1, Math.max(0, 9 * e + 14 * s.integ + 0.03));
        s.pm += (cmd - s.pm) * (h / 0.25);
        s.f += (50 * (s.pm - pe) / (2 * C.GEN.H)) * h;
      }
      s.fuel = Math.max(0, s.fuel - (m.fuelLph * dt) / 3600);
    } else { s.online = false; s.f = idle ? 50 : Math.max(0, s.f - dt * 25); }
    s.wasSource = source;
    const cellV = 2.15 - 0.22 * (1 - s.soc) - (source === "battery" ? 0.14 * m.x : 0);
    return { ...m, tj: s.tj, soc: s.soc, freq: s.f, fuel: s.fuel, day: s.day, cellV, busV: cellV * C.BATTERY.cells, pm: s.pm };
  }

  return { C, s, steady, step, wetBulbAt };
}

export const SOURCES = [
  "Plant sizes, monthly irradiance and the 24-hour dispatch: the project's Preliminary Energy Yield Assessment v2.0.",
  "Sun: NOAA / Spencer solar position at the site; clear-sky irradiance after Haurwitz, scaled to the report's monthly GHI.",
  "Trackers: horizontal N–S single axis, ±55°, bifacial gain 6 %, DC losses 20 %, 2.85 MW AC inverter limit.",
  "Battery: LFP, 2.5 MW / 15 MWh, 93 % round trip, 2 MWh reserve used only in an emergency.",
  "Biomass: 750 kW gasifier and engine, 25 % electrical efficiency, paddy husk at 14 MJ/kg; a week of overhaul in March and August.",
  "Weather: a seeded year of clear and cloudy days, more cloud in the inter-monsoons; not a bankable P50/P90 series.",
  "Cooling: water-cooled chillers at 0.42 × Carnot, towers 2.5–5 K over a 20–24 °C wet bulb; GPUs 700 W, 2.4 kW each with infrastructure.",
];
