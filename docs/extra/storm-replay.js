/* AI use: the code in this file was written by an AI coding assistant (Claude, by Anthropic), directed by the team. See "Use of AI tools" in README.md. */
/* Red Route add-on: the solar storm of 20 May 2024 at Gale Crater, as NASA's Curiosity rover measured it (NASA DATA,
   our reading). The storm drill uses it for its "Real storm" choice.
   Source: NASA Planetary Data System, Planetary Plasma Interactions node (UCLA), data set MSL-M-RAD-3-RDR-V1.0
     (Curiosity's Radiation Assessment Detector, RAD), release 37, product RAD_RDR_2024_140_18_30_4190_V00 (sol 4190):
     https://pds-ppi.igpp.ucla.edu/data/MSL-M-RAD-3-RDR-V1.0/
   The value is TOT_DOSE_E, the dose rate in RAD's plastic detector (the one closest to body tissue), in micrograys
   per hour. validation/rad_storm_2024-05/ holds the script that read the archive and the 692 readings it returned
   (16 to 23 May 2024); tests/storm-replay.test.mjs checks every number below against that file.
   What is ours, not NASA's: the alarm line (1.5 times the normal level), holding each reading until the next one
   starts, and every sum. Limits: a reading is 8 to 16 minutes long, so times are known to about that; the rise IS
   the storm arriving (this data holds no earlier warning); RAD sits on the rover's deck in Gale Crater, not in a
   suit in Jezero; and detector E gives an absorbed dose in plastic, not a dose to a person.
   The pure functions are on window.StormReplay (Node runs them for the tests). Nothing here changes the plan. */
(function (root) {
  "use strict";
  const DAY = "2024-05-20";
  // start of the reading (UTC), its length in seconds, dose rate in detector E (micrograys per hour)
  const RAW = [["05:04:45", 961, 5.72292], ["05:21:50", 961, 9.97416], ["05:38:56", 481, 85.38292], ["05:48:02", 481, 214.03734],
    ["05:57:07", 481, 316.37013], ["06:06:13", 481, 343.28198], ["06:15:19", 481, 351.42427], ["06:24:24", 481, 348.04186],
    ["06:33:30", 481, 329.67357], ["06:42:36", 481, 308.34123], ["06:51:41", 481, 288.50204], ["07:00:47", 481, 280.77769],
    ["07:09:53", 481, 270.71957], ["07:18:58", 481, 255.39579], ["07:28:03", 481, 254.04659], ["07:37:09", 481, 243.85507],
    ["07:46:14", 481, 219.17321], ["07:55:20", 481, 191.7429], ["08:04:25", 481, 186.24972], ["08:13:30", 481, 182.57215],
    ["08:22:36", 481, 169.00397], ["08:31:41", 481, 161.43121], ["08:40:46", 481, 148.19339], ["08:49:54", 481, 135.44536],
    ["08:59:02", 481, 123.49482], ["09:08:10", 481, 120.24525], ["09:17:18", 481, 117.67651], ["09:26:26", 481, 102.81213],
    ["09:35:34", 481, 96.70819], ["09:44:42", 481, 99.79764], ["09:53:50", 481, 92.1256], ["10:02:58", 481, 91.17564]];
  const sec = (hms) => hms.split(":").reduce((s, x) => s * 60 + Number(x), 0);
  const hhmm = (s) => `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor(s / 60) % 60).padStart(2, "0")}`;
  const readings = RAW.map(([t, len, e]) => ({ utc: t, t: sec(t), len, e }));

  // Normal level: the median of the 85 readings in the 24 h before the rise (the test re-derives it from the full file).
  const QUIET = 5.54;       // micrograys per hour
  const ALARM_X = 1.5;      // our choice. In the 3.5 days before the rise, none of 301 readings passed even 1.25 times normal.

  const alarmR = readings.find((r) => r.e > ALARM_X * QUIET);
  const peakR = readings.reduce((a, b) => (b.e > a.e ? b : a));
  const alarmT = alarmR.t + alarmR.len;   // the crew can only know once the reading is finished
  const alarmToPeakMin = (peakR.t - alarmT) / 60;

  // Micrograys between two moments (seconds of the day, UTC). Each reading's rate is held from its start until the
  // next reading starts; a gap longer than twice the reading's own length is not filled in.
  function doseBetween(t0, t1) {
    let sum = 0;
    for (let i = 0; i < readings.length; i++) {
      const r = readings[i];
      let end = i + 1 < readings.length ? readings[i + 1].t : r.t + r.len;
      if (end - r.t > 2 * r.len) end = r.t + r.len;
      const lo = Math.max(r.t, t0), hi = Math.min(end, t1);
      if (hi > lo) sum += r.e * (hi - lo) / 3600;
    }
    return sum;
  }
  const last = readings[readings.length - 1];
  const MAX_MIN = Math.floor((last.t + last.len - alarmT) / 60);   // how far past the alarm the readings here reach

  // What a crew that starts for home at the alarm would take until it is inside, `minutes` later.
  function walkHome(minutes) {
    const m = Math.min(minutes, MAX_MIN);
    return { minutes: m, cut: minutes > MAX_MIN, ugy: doseBetween(alarmT, alarmT + m * 60), quiet_ugy: QUIET * m / 60 };
  }

  root.StormReplay = {
    day: DAY, readings, quiet: QUIET, alarmX: ALARM_X,
    alarm: { from: alarmR.utc, at: alarmT, atUtc: hhmm(alarmT), e: alarmR.e },
    peak: { from: peakR.utc, at: peakR.t, e: peakR.e, timesQuiet: peakR.e / QUIET },
    alarmToPeakMin, range_min: [28, 54], maxMin: MAX_MIN,
    doseBetween, walkHome,
    source: "https://pds-ppi.igpp.ucla.edu/data/MSL-M-RAD-3-RDR-V1.0/",
  };
})(typeof window !== "undefined" ? window : globalThis);
