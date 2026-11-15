/* AI use: the code in this file was written by an AI coding assistant (Claude, by Anthropic), directed by the team. See "Use of AI tools" in README.md. */
/* Red Route add-on: sunset on the walk day, and whether daylight or oxygen sets each leave-by time (DERIVED).
   Method: the NASA GISS Mars24 Sunclock, after Allison and McEwen (2000), Planet. Space Sci. 48, 215-235.
     Algorithm and worked examples: https://www.giss.nasa.gov/tools/mars24/help/algorithm.html (updated 2025-01-07)
     Technical notes on Mars solar time: https://www.giss.nasa.gov/tools/mars24/help/notes.html (updated 2023-05-15)
   The step names below (A-2 ... D-6) are the GISS page's. tests/daylight.test.mjs checks both worked examples on that page.
   Two more inputs, both opened and checked:
     Leap seconds (TAI-UTC): IERS, https://hpiers.obspm.fr/iers/bul/bulc/Leap_Second.dat (Bulletin C 72, July 2026:
       no leap second since 1 Jan 2017; like Mars24, later dates keep the last value).
     Mars equatorial and polar radius, 3396.2 and 3376.2 km: NASA Mars Fact Sheet,
       https://nssdc.gsfc.nasa.gov/planetary/factsheet/marsfact.html (to turn the plan's latitude into the
       planetographic latitude that Mars24 uses).
   The pure functions are on window.Mars24 (Node runs them for the tests). The block under Conditions is browser-only
   and only reads the plan: it changes no leave-by time and no check. */
(function (root) {
  "use strict";
  const RAD = Math.PI / 180;
  const sin = (d) => Math.sin(d * RAD), cos = (d) => Math.cos(d * RAD), tan = (d) => Math.tan(d * RAD);
  const mod = (x, n) => ((x % n) + n) % n;
  const clamp1 = (x) => Math.max(-1, Math.min(1, x));

  /* ---------- A. days since the J2000 epoch ---------- */
  // IERS table: from this date on, TAI-UTC is this many seconds
  const LEAP = [[1972, 1, 10], [1972, 7, 11], [1973, 1, 12], [1974, 1, 13], [1975, 1, 14], [1976, 1, 15], [1977, 1, 16],
    [1978, 1, 17], [1979, 1, 18], [1980, 1, 19], [1981, 7, 20], [1982, 7, 21], [1983, 7, 22], [1985, 7, 23], [1988, 1, 24],
    [1990, 1, 25], [1991, 1, 26], [1992, 7, 27], [1993, 7, 28], [1994, 7, 29], [1996, 1, 30], [1997, 7, 31], [1999, 1, 32],
    [2006, 1, 33], [2009, 1, 34], [2012, 7, 35], [2015, 7, 36], [2017, 1, 37]].map(([y, m, s]) => [Date.UTC(y, m - 1, 1), s]);

  // A-2: Julian Date (UT) from Unix milliseconds. JavaScript time, like the Java time Mars24 uses, has no leap seconds.
  const jdUT = (ms) => 2440587.5 + ms / 8.64e7;

  // A-3, A-4: TT - UTC in seconds: TAI-UTC from the table + 32.184 s; the GISS formula before 1972
  function ttMinusUtc(ms) {
    if (ms < LEAP[0][0]) {
      const T = (jdUT(ms) - 2451545.0) / 36525;
      return 64.184 + 59 * T - 51.2 * T ** 2 - 67.1 * T ** 3 - 16.4 * T ** 4;
    }
    let s = 0;
    for (const [from, v] of LEAP) if (ms >= from) s = v;
    return s + 32.184;
  }

  // B-3: the seven perturbation terms: amplitude A (deg), period tau (Julian years), phase phi (deg)
  const PERT = [[0.0071, 2.2353, 49.409], [0.0057, 2.7543, 168.173], [0.0039, 1.1177, 191.837], [0.0037, 15.7866, 21.736],
    [0.0021, 2.1354, 15.704], [0.0020, 2.4694, 95.528], [0.0018, 32.8493, 49.095]];

  // D-1: solar declination (planetographic, deg) from Ls
  const declination = (ls) => Math.asin(0.42565 * sin(ls)) / RAD + 0.25 * sin(ls);
  // D-5: solar zenith angle (deg); H = hour angle = west longitude - subsolar longitude
  const zenith = (dec, lat, H) => Math.acos(clamp1(sin(dec) * sin(lat) + cos(dec) * cos(lat) * cos(H))) / RAD;
  // D-6: solar azimuth (deg from north), with atan2 as the page advises
  const azimuth = (dec, lat, H) => mod(Math.atan2(sin(H), cos(lat) * tan(dec) - sin(lat) * cos(H)) / RAD, 360);

  /* Every quantity of the GISS steps at one moment.
     ms: Unix milliseconds (UTC). lonW: longitude in degrees WEST (Mars24 counts west; west = 360 - east).
     lat: PLANETOGRAPHIC latitude in degrees (only Z and A use it). Angles in degrees, times in Mars hours. */
  function at(ms, lonW = 0, lat = 0) {
    const jd = jdUT(ms);                                          // A-2
    const ttUtc = ttMinusUtc(ms);                                 // A-4 (s)
    const jdTT = jd + ttUtc / 86400;                              // A-5
    const dt = jdTT - 2451545.0;                                  // A-6: days since J2000 (TT)
    const M = 19.3871 + 0.52402073 * dt;                          // B-1: Mars mean anomaly
    const aFMS = 270.3871 + 0.524038496 * dt;                     // B-2: angle of the Fictitious Mean Sun
    let pbs = 0;                                                  // B-3: perturbers (0.985626 = 360 / 365.25)
    for (const [A, tau, phi] of PERT) pbs += A * cos(0.985626 * dt / tau + phi);
    const nuM = (10.691 + 3.0e-7 * dt) * sin(M) + 0.623 * sin(2 * M) + 0.050 * sin(3 * M)
      + 0.005 * sin(4 * M) + 0.0005 * sin(5 * M) + pbs;           // B-4: equation of center, nu - M
    const lsRaw = aFMS + nuM, ls = mod(lsRaw, 360);               // B-5: areocentric solar longitude Ls
    const eot = 2.861 * sin(2 * ls) - 0.071 * sin(4 * ls) + 0.002 * sin(6 * ls) - nuM;   // C-1: equation of time (deg)
    const msd = (jdTT - 2451549.5) / 1.0274912517 + 44796.0 - 0.0009626;              // C-2: Mars Sol Date
    const mtc = mod(24 * msd, 24);   // C-2: Coordinated Mars Time = mean solar time at the prime meridian (GISS: MST, Airy Mean Time)
    const lmst = mod(mtc - lonW / 15, 24);                        // C-3: local mean solar time
    const ltst = mod(lmst + eot / 15, 24);                        // C-4: local true solar time
    const subLon = mod(mtc * 15 + eot + 180, 360);                // C-5: subsolar longitude (deg west)
    const dec = declination(ls);                                  // D-1: solar declination (planetographic)
    const rM = 1.52367934 * (1.00436 - 0.09309 * cos(M) - 0.004336 * cos(2 * M) - 0.00031 * cos(3 * M) - 0.00003 * cos(4 * M));   // D-2 (AU)
    const lM = mod(ls + 85.061 - 0.015 * sin(71 + 2 * ls) - 5.5e-6 * dt, 360);        // D-3: heliocentric longitude
    const bM = -(1.8497 - 2.23e-5 * dt) * sin(ls - 144.50 + 2.57e-6 * dt);             // D-4: heliocentric latitude
    const H = lonW - subLon;                                      // hour angle (D-5)
    const Z = zenith(dec, lat, H);                                // D-5: solar zenith angle
    const A = azimuth(dec, lat, H);                               // D-6: solar azimuth
    return { jdUT: jd, ttUtc, jdTT, dt, M, aFMS, pbs, nuM, lsRaw, ls, eot, msd, mtc, lmst, ltst, subLon, dec, rM, lM, bM, H, Z, A };
  }

  // D-5 asks for planetographic latitude. The plan's map latitudes are planetocentric (Mars 2000 sphere), so:
  // tan(graphic) = (a / b)^2 x tan(centric), a and b = Mars's equatorial and polar radius (NASA Mars Fact Sheet).
  const planetographic = (latC) => Math.atan((3396.2 / 3376.2) ** 2 * tan(latC)) / RAD;

  /* ---------- Mars clock time and Earth (SI) time ----------
     A sol is 24 h 39 min 35.244 s = 88,775.244 SI seconds (GISS technical notes). One Mars hour of local solar time is
     1/24 of a sol (61 min 38.97 s) and one Mars minute is 1/1440 of a sol (61.649 s). The plan's T+ minutes are SI
     minutes, so N plan minutes move the Mars clock by N x 86,400 / 88,775.244 Mars minutes (about 2.7 % fewer).
     This is the mean rate. True solar time also drifts by the change of the equation of time: at most about 6 s over
     the 3.6-hour time budget in any season; the tests check this against the full calculation. */
  const SOL_S = 88775.244;
  const MARS_HOUR_MS = SOL_S * 1000 / 24;
  const siToMarsMin = (min) => min * 86400 / SOL_S;
  const marsToSiMin = (min) => min * SOL_S / 86400;

  // the moment nearest nearMs at which local true solar time at west longitude lonW reads `hours`
  function momentAtLtst(hours, nearMs, lonW) {
    let t = nearMs;
    for (let i = 0; i < 12; i++) {
      const d = mod(hours - at(t, lonW).ltst + 12, 24) - 12;   // Mars hours still to go, between -12 and +12
      t += d * MARS_HOUR_MS;
      if (Math.abs(d) < 1e-10) break;
    }
    return t;
  }

  /* Sunrise (sign -1) or sunset (sign +1) of the sol whose true local noon is noonMs: the moment the Sun's centre
     is on a flat, level horizon (zenith angle Z = 90 deg in D-5). No refraction, no hills, no twilight.
     With Z = 90 deg, D-5 gives cos H0 = -tan(lat) tan(dec), and by C-3 to C-5 the local true solar time is then exactly
     12 h - H0 / 15 (sunrise) or 12 h + H0 / 15 (sunset). The declination is read at the event itself, so the search
     repeats until the moment stops moving. */
  function sunEvent(noonMs, lonW, lat, sign) {
    let t = noonMs, ltst = 12;
    for (let i = 0; i < 12; i++) {
      const c = -tan(lat) * tan(at(t, lonW, lat).dec);
      if (!(c > -1 && c < 1)) return null;                  // Sun up all sol or down all sol: never at Jezero's latitude
      ltst = 12 + sign * Math.acos(c) / RAD / 15;
      const next = momentAtLtst(ltst, noonMs, lonW);
      const done = Math.abs(next - t) < 1;                  // within a millisecond
      t = next;
      if (done) break;
    }
    return { ms: t, ltst };
  }

  /* One walk day.
     date: "YYYY-MM-DD" (UTC). The sol used is the one whose start time at base camp falls nearest to 12:00 UTC that day.
     startH: the first step outside (T+0), in local true solar time (hours). lonE, latC: base camp as stored in the plan
     (east longitude, planetocentric latitude). backMin: T+ minutes (SI) when the crew is back at base camp.
     stops: [{ id, name, leaveByMin: the app's oxygen leave-by (T+ SI minutes), homeMin: walk home from the stop (SI minutes) }]
     Daylight leave-by = sunset minus the walk home from that stop, minus nothing else. */
  function walkDay({ date, startH, lonE, latC, backMin, stops = [] }) {
    const lonW = mod(-lonE, 360), lat = planetographic(latC);
    const ref = Date.parse(`${date}T12:00:00Z`);
    if (!isFinite(ref)) return null;
    const startMs = momentAtLtst(startH, ref, lonW);
    const noonMs = momentAtLtst(12, startMs, lonW);
    const rise = sunEvent(noonMs, lonW, lat, -1), set = sunEvent(noonMs, lonW, lat, +1);
    const clock = (min) => startH + siToMarsMin(min) / 60;     // T+ (SI minutes) -> local true solar time (Mars hours)
    const back = clock(backMin);
    const sunset = set ? set.ltst : null, sunrise = rise ? rise.ltst : null;
    return {
      date, startH, startMs, lonW, lat, ls: at(startMs, lonW, lat).ls,
      sunrise, sunset, sunsetMs: set ? set.ms : null, back,
      beforeSunrise: sunrise != null && startH < sunrise,
      spareMin: sunset == null ? null : marsToSiMin((sunset - back) * 60),   // daylight left when back at base (SI minutes)
      stops: stops.map((s) => {
        const oxygen = clock(s.leaveByMin);
        const daylight = sunset == null ? null : sunset - siToMarsMin(s.homeMin) / 60;
        return { id: s.id, name: s.name, oxygen, oxygenMin: s.leaveByMin, daylight,
          daylightMin: daylight == null ? null : marsToSiMin((daylight - startH) * 60),
          first: daylight != null && daylight < oxygen ? "daylight" : "oxygen" };
      }),
    };
  }

  // Clock text "HH:MM" from Mars hours. Rounded the cautious way: down for sunset and leave-by times, up for "back at base".
  const clockText = (h, up) => {
    const m = mod(up ? Math.ceil(h * 60 - 1e-6) : Math.floor(h * 60 + 1e-6), 1440);
    return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  };

  const Mars24 = { at, jdUT, ttMinusUtc, declination, zenith, azimuth, planetographic, momentAtLtst, sunEvent, walkDay, clockText,
    siToMarsMin, marsToSiMin, SOL_S, MARS_HOUR_MS };
  root.Mars24 = Mars24;

  /* ---------- the block under Conditions (browser only) ---------- */
  if (typeof document === "undefined") return;

  const GISS = "https://www.giss.nasa.gov/tools/mars24/help/algorithm.html";
  const pick = { start: 9, date: "" };          // the user's choices; they survive every redraw of the panels
  const todayUtc = () => new Date().toISOString().slice(0, 10);
  const menuTime = (h) => `${String(Math.floor(h)).padStart(2, "0")}:${h % 1 ? "30" : "00"}`;
  const spareText = (min) => `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")} min`;
  const season = (ls) => ["spring", "summer", "autumn", "winter"][Math.floor(ls / 90) % 4];   // Jezero is in the north

  // The block sits right after #conditions, not inside it: app.js rewrites #conditions when the live space-weather
  // feed answers, without a "redroute:render" event.
  function box() {
    const cond = document.getElementById("conditions");
    if (!cond) return null;
    let b = document.getElementById("dl24");
    if (!b) {
      b = document.createElement("section");
      b.id = "dl24"; b.className = "dl24"; b.dataset.src = "derived";
      let opts = "";
      for (let h = 7; h <= 13; h += 0.5) opts += `<option value="${h}"${h === pick.start ? " selected" : ""}>${menuTime(h)}</option>`;
      b.innerHTML = `<div class="lbl">Daylight on the walk day · Mars24</div>
        <div class="dl24-pick">
          <label title="Mars local true solar time at base camp">Start <select id="dl24Start">${opts}</select></label>
          <label>Date (UTC) <input type="date" id="dl24Date" min="2000-01-01" max="2099-12-31" value="${pick.date || todayUtc()}"></label>
          <span class="dl24-ls" id="dl24Ls"></span>
        </div>
        <div id="dl24Out"></div>`;
      b.addEventListener("change", (e) => {
        if (e.target.id === "dl24Start") pick.start = Number(e.target.value);
        if (e.target.id === "dl24Date") pick.date = /^\d{4}-\d{2}-\d{2}$/.test(e.target.value) ? e.target.value : "";
        render();
      });
    }
    if (cond.nextElementSibling !== b) cond.after(b);
    return b;
  }

  function render() {
    const R = window.RedRoute, api = R && R.api, m = R && R.S && R.S.m;
    if (!api || !m || !Array.isArray(m.timeline) || !m.timeline.length || !Array.isArray(m.order)) return;
    const b = box();
    const base = b && api.stopById(m.order[0]);
    if (!base) return;
    const tl = m.timeline, stops = [];
    m.order.forEach((id, i) => {   // the stops on the walk: not the base camp at the start and the end
      if (i === 0 || i === m.order.length - 1 || !tl[i]) return;
      stops.push({ id, name: api.shortName(api.stopById(id)), leaveByMin: api.leaveBy(tl[i]), homeMin: tl[i].back_min });
    });
    const dateIn = b.querySelector("#dl24Date");
    let date = pick.date || todayUtc();
    if (date < "2000-01-01" || date > "2099-12-31") date = todayUtc();
    if (dateIn.value !== date) dateIn.value = date;
    const d = Mars24.walkDay({ date, startH: pick.start, lonE: base.lon, latC: base.lat, backMin: tl[tl.length - 1].arrive_min, stops });
    const out = b.querySelector("#dl24Out"), lsEl = b.querySelector("#dl24Ls");
    if (!d) { out.innerHTML = ""; lsEl.textContent = ""; return; }
    lsEl.textContent = `Ls ${d.ls.toFixed(1)}° · northern ${season(d.ls)}`;
    lsEl.title = "Mars season (areocentric solar longitude) at the start of the walk";
    const ct = Mars24.clockText, tplus = (min) => (min >= 0 ? `T+${api.hm(min)}` : "before the start");
    let html;
    if (d.sunset == null) {
      html = '<p class="dl24-sum">The Sun does not rise and set on this sol at base camp.</p>';
    } else {
      const ok = d.spareMin >= 0;
      html = `<div class="cond-row"><span>Sunset</span><b class="${ok ? "ok" : "bad"}">${ok ? "OK" : "AFTER SUNSET"}</b></div>
        <p class="dl24-sum">Start ${menuTime(pick.start)}. Back at base camp ${ct(d.back, true)}. Sunset ${ct(d.sunset)}. ${ok
          ? `Daylight to spare: ${spareText(Math.floor(d.spareMin + 1e-6))}` : `Back ${spareText(Math.ceil(-d.spareMin - 1e-6))} after sunset`}</p>`;
      if (d.beforeSunrise) html += `<div class="cond-row"><span>Start</span><b class="warn">BEFORE SUNRISE</b><span class="s">Sunrise is at ${ct(d.sunrise, true)}.</span></div>`;
      for (const s of d.stops) {
        const dayFirst = s.first === "daylight";
        html += `<div class="cond-row"><span>${api.esc(s.name)}</span><b class="${dayFirst ? "warn" : "ok"}">${dayFirst ? "DAYLIGHT FIRST" : "OXYGEN FIRST"}</b>
          <span class="s">Leave by ${ct(s.oxygen)} for oxygen (${tplus(s.oxygenMin)}), by ${ct(s.daylight)} for daylight (${tplus(s.daylightMin)}).</span></div>`;
      }
    }
    html += `<p class="dl24-note">Computed with the <a href="${GISS}" target="_blank" rel="noopener">NASA GISS Mars24 method</a> (DERIVED). Sunrise and sunset are for a flat horizon: hills and the crater rim are not included. No twilight margin.
      Times are Mars local true solar time at base camp. A Mars hour is 1/24 of a sol (1 h 1 min 39 s), so clock times run a little slower than the plan's T+ minutes. Spare time is in Earth hours, like the rest of the plan.
      Daylight leave-by = sunset minus the walk home from that stop.${d.sunrise != null ? ` Sunrise ${ct(d.sunrise, true)}.` : ""} The oxygen leave-by times are the plan's own and do not change.</p>`;
    if (out.innerHTML !== html) out.innerHTML = html;
  }

  document.addEventListener("redroute:render", render);
  // if the first redraw already happened before this file ran
  if (window.RedRoute && window.RedRoute.api && window.RedRoute.S && window.RedRoute.S.m) render();
})(typeof window !== "undefined" ? window : globalThis);
