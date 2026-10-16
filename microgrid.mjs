// The off-grid power system of the data center, from the project's Preliminary Energy
// Yield Assessment v2.0: 3.5 MWp single-axis trackers, 2.5 MW / 15 MWh LFP battery, 750 kW biomass CHP, 622 kW IT.
// createMicrogrid() is self-contained so the build can inline it into the page.

export function createMicrogrid() {
  const D = Math.PI / 180;
  const SITE = { lat: 6.4, lon: 81.1, tz: 5.5 };
  const GHI_MONTH = [5.1, 5.7, 6.0, 5.6, 5.3, 5.0, 5.0, 5.2, 5.4, 5.0, 4.7, 4.9]; // kWh/m²/day, report table 3.3
  const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const PV = { kwp: 3500, acKw: 2850, limit: 55, dcLoss: 0.80, bifacial: 1.06, inverter: 0.965, albedo: 0.2, tables: 77 };
  const BESS = { kwh: 15000, kw: 2500, reserve: 2000, eta: 0.965, hvacKw: 12 };
  const BIO = { kw: 750, ramp: 600, eff: 0.25, lhv: 14, stockT: 500 }; // kW/h ramp, MJ/kg
  const LOAD = { it: 622, pue: 1.32, shedKw: 72 };

  // ---- the sun: declination, equation of time, hour angle (Spencer / NOAA approximations)
  function sun(doy, hours) {
    const g = (2 * Math.PI * (doy - 1)) / 365;
    const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g);
    const eot = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g)); // minutes
    const solar = hours + (eot + 4 * SITE.lon - 60 * SITE.tz) / 60;
    const H = (solar - 12) * 15 * D;
    const phi = SITE.lat * D;
    const cosZ = Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(H);
    const z = Math.acos(Math.max(-1, Math.min(1, cosZ)));
    const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(decl) * Math.cos(phi)) + Math.PI; // from north, clockwise
    const east = Math.sin(z) * Math.sin(az), north = Math.sin(z) * Math.cos(az), up = Math.cos(z);
    return { cosZ, elev: 90 - z / D, az: az / D, east, north, up, solarNoon: 12 - (eot + 4 * SITE.lon - 60 * SITE.tz) / 60 };
  }
  const haurwitz = (cosZ) => (cosZ > 0.01 ? 1098 * cosZ * Math.exp(-0.057 / cosZ) : 0); // W/m², clear sky
  const monthOf = (doy) => { let d = doy; for (let m = 0; m < 12; m++) { if (d <= MONTH_DAYS[m]) return m; d -= MONTH_DAYS[m]; } return 11; };
  const midDoy = (m) => MONTH_DAYS.slice(0, m).reduce((a, b) => a + b, 0) + 15;
  // scale so that an average day of each month delivers the report's monthly GHI
  const SCALE = GHI_MONTH.map((ghi, m) => { let h = 0; for (let t = 0; t < 24; t += 0.1) h += haurwitz(sun(midDoy(m), t).cosZ) * 0.1; return (ghi * 1000) / h; });

  // ---- one tracker row and the plant
  function pv(doy, hours, weather = 1, plantOn = true) {
    const s = sun(doy, hours);
    const m = monthOf(doy);
    const ghi = haurwitz(s.cosZ) * SCALE[m] * weather;
    const diffuse = Math.min(0.95, 0.18 + 0.72 * Math.max(0, 1 - weather / 1.15));
    const dhi = ghi * diffuse;
    const dni = s.cosZ > 0.03 ? (ghi - dhi) / s.cosZ : 0;
    // horizontal N–S axis: the ideal rotation turns the panel normal toward the sun in the east–up plane
    let R = s.up > 0 ? Math.atan2(s.east, s.up) / D : 0;
    R = Math.max(-PV.limit, Math.min(PV.limit, R));
    const n = [Math.sin(R * D), 0, Math.cos(R * D)];
    const cosI = Math.max(0, n[0] * s.east + n[2] * s.up);
    const poa = dni * cosI + dhi * (1 + Math.cos(R * D)) / 2 + ghi * PV.albedo * (1 - Math.cos(R * D)) / 2;
    const dc = (PV.kwp * poa) / 1000 * PV.dcLoss * PV.bifacial;
    const ac = plantOn ? Math.min(PV.acKw, dc * PV.inverter) : 0;
    return { ...s, ghi, dni, dhi, poa, R, dc, ac, clipped: plantOn ? Math.max(0, dc * PV.inverter - PV.acKw) : 0 };
  }

  // ---- weather: a seeded year of daily clearness, mean 1 within each month, more broken in the inter-monsoons
  function weatherYear(seed = 7) {
    let a = seed >>> 0;
    const rnd = () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const CLOUDY = [0.18, 0.08, 0.06, 0.2, 0.22, 0.18, 0.16, 0.14, 0.12, 0.3, 0.38, 0.32]; // chance of a cloudy day
    const out = [];
    for (let m = 0; m < 12; m++) {
      const days = [];
      let spell = 0;
      for (let d = 0; d < MONTH_DAYS[m]; d++) {
        const p = spell > 0 ? 0.55 : CLOUDY[m];
        const cloudy = rnd() < p;
        spell = cloudy ? spell + 1 : 0;
        days.push(cloudy ? 0.22 + 0.4 * rnd() : 0.95 + 0.3 * rnd());
      }
      const mean = days.reduce((x, y) => x + y, 0) / days.length;
      days.forEach((f) => out.push(Math.min(1.3, f / mean)));
    }
    return out;
  }

  // ---- dispatch: solar first, battery second, biomass when the sun is down or the battery is low
  function newState(soc = 12000) { return { soc, bio: 0, bioOn: false, fuelT: 0, unserved: 0, shed: 0, outageH: 0, shedH: 0, curtailed: 0, solarKwh: 0, bioKwh: 0, bioH: 0, loadKwh: 0, servedKwh: 0 }; }
  function step(st, dtH, { hours, load, solar, bioOk = true, bessOk = true, useBio = true }) {
    const night = hours >= 21 || hours < 7.5;
    const lowSoc = st.soc < 0.45 * BESS.kwh;
    const highSoc = st.soc > 0.9 * BESS.kwh;
    const want = useBio && bioOk && solar < load && (night || lowSoc || !bessOk) && !(highSoc && !night);
    st.bioOn = want;
    const target = want ? BIO.kw : 0;
    st.bio += Math.max(-BIO.ramp * dtH * 2, Math.min(BIO.ramp * dtH, target - st.bio));
    if (!bioOk || !useBio) st.bio = 0;
    let supply = solar + st.bio;
    let net = load - supply;
    let dis = 0, chg = 0, curt = 0, unserved = 0;
    const floorOf = (emergency) => (emergency ? 0 : BESS.reserve);
    if (net > 0) {
      if (bessOk) {
        const avail = Math.max(0, st.soc - floorOf(false)) * BESS.eta / dtH;
        dis = Math.min(net, BESS.kw, avail);
        let rest = net - dis;
        if (rest > 1e-6) { const emer = Math.max(0, st.soc - dis * dtH / BESS.eta) * BESS.eta / dtH; const more = Math.min(rest, BESS.kw - dis, emer); dis += more; rest -= more; }
        st.soc -= (dis * dtH) / BESS.eta;
        unserved = rest;
      } else unserved = net;
    } else if (net < 0) {
      if (bessOk) { chg = Math.min(-net, BESS.kw, Math.max(0, BESS.kwh - st.soc) / BESS.eta / dtH); st.soc += chg * dtH * BESS.eta; }
      curt = -net - chg;
    }
    st.soc = Math.max(0, Math.min(BESS.kwh, st.soc));
    const shed = Math.min(unserved, LOAD.shedKw);
    const outage = unserved - shed;
    st.unserved += unserved * dtH;
    st.shed += shed * dtH;
    if (shed > 1) st.shedH += dtH;
    if (outage > 1) st.outageH += dtH;
    st.curtailed += curt * dtH;
    st.solarKwh += solar * dtH;
    st.bioKwh += st.bio * dtH;
    if (st.bio > 1) st.bioH += dtH;
    st.loadKwh += load * dtH;
    st.servedKwh += (load - unserved) * dtH;
    st.fuelT += (st.bio * dtH * 3600) / (BIO.eff * BIO.lhv * 1000) / 1000;
    return { solar, bio: st.bio, dis, chg, curt, unserved, shed, outage, soc: st.soc, load, bioOn: st.bioOn };
  }

  // ---- a whole year at 15-minute steps, for any configuration
  function year({ kwp = PV.kwp, kwh = BESS.kwh, useBio = true, seed = 7, it = LOAD.it, pue = LOAD.pue, map = false } = {}) {
    const wx = weatherYear(seed);
    const keep = { kwp: PV.kwp, kwh: BESS.kwh, ac: PV.acKw };
    PV.kwp = kwp; PV.acKw = keep.ac * (kwp / keep.kwp); BESS.kwh = kwh; BESS.kw = Math.max(2500, kwh / 6);
    const st = newState(kwh * 0.8);
    const load = it * pue + BESS.hvacKw;
    const cells = map ? new Uint8Array(365 * 24) : null;
    const dt = 0.25;
    // biomass planned maintenance: a week in March and a week in August, when the sun is strongest
    const outage = (doy) => (doy >= 70 && doy < 77) || (doy >= 220 && doy < 227);
    for (let doy = 1; doy <= 365; doy++) {
      for (let q = 0; q < 96; q++) {
        const hours = q * dt;
        const p = pv(doy, hours + dt / 2, wx[doy - 1]);
        const r = step(st, dt, { hours, load, solar: p.ac, useBio, bioOk: !outage(doy) });
        if (cells && q % 4 === 3) {
          const i = (doy - 1) * 24 + Math.floor(hours);
          cells[i] = r.outage > 1 ? 4 : r.shed > 1 ? 5 : r.solar >= load * 0.98 ? 1 : r.bio >= r.dis && r.bio > 1 ? 3 : 2;
        }
      }
    }
    PV.kwp = keep.kwp; PV.acKw = keep.ac; BESS.kwh = 15000; BESS.kw = 2500;
    const hoursAll = 8760;
    return {
      uptime: 1 - st.outageH / hoursAll, full: 1 - (st.outageH + st.shedH) / hoursAll, outageH: st.outageH, shedH: st.shedH,
      solarGwh: st.solarKwh / 1e6, bioGwh: st.bioKwh / 1e6, loadGwh: st.loadKwh / 1e6, curtGwh: st.curtailed / 1e6, unservedMwh: st.unserved / 1000,
      bioH: st.bioH, fuelT: st.fuelT, cells, landHa: (kwp / 1000) * 1.8,
    };
  }

  // the smallest solar-and-battery plant that reaches 99.9 % with no biomass at all
  function solarOnlySizing(target = 0.999) {
    let best = null;
    for (const kwp of [3500, 4500, 5500, 6500, 7500, 8500, 10000]) {
      for (const kwh of [15000, 20000, 25000, 30000, 40000, 50000, 60000]) {
        const y = year({ kwp, kwh, useBio: false });
        if (y.uptime >= target) { const cost = kwp * 0.75 + kwh * 0.33; if (!best || cost < best.cost) best = { kwp, kwh, cost, y }; break; }
      }
    }
    return best;
  }

  return { SITE, PV, BESS, BIO, LOAD, GHI_MONTH, sun, pv, weatherYear, newState, step, year, solarOnlySizing, monthOf };
}
