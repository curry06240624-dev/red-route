/* AI use: the code in this file was written by an AI coding assistant (Claude, by Anthropic), directed by the team. See "Use of AI tools" in README.md. */
/* Red Route add-on: spoken alerts in the Astronaut view (off by default).
   A "Voice: off / on" button next to the Map button. When it is on, the browser's own speech synthesis
   (window.speechSynthesis and SpeechSynthesisUtterance: no audio files, no packages, no requests of ours) reads out:
     - the status word and the line under it, only when the word changes (GO, HEAD HOME SOON, TURN BACK NOW, HOME);
     - one sentence when the crew arrives at a stop ("At Three Forks. Leave by T plus 2 hours 11.").
   It speaks the text the screen already shows (#aWord, #aSpare, #aSite), so it adds no new numbers.
   It wakes up on the app's "redroute:time" event (no timer polling). It never says the same sentence twice in a row,
   drops a sentence that no longer matches the screen, and goes quiet at once when the voice is turned off,
   the Astronaut view closes, or a drill card opens. */
(() => {
  "use strict";
  const astro = document.getElementById("astro"), exit = document.getElementById("aExit");
  if (!astro || !exit || !exit.parentNode) return;
  const synth = window.speechSynthesis;
  const OK = !!synth && typeof synth.speak === "function" && typeof window.SpeechSynthesisUtterance === "function";

  /* ---------- the button, with the note under it ---------- */
  const box = document.createElement("div");
  box.className = "sv";
  box.innerHTML = '<button type="button" class="astro-btn sv-btn" id="aVoice" aria-pressed="false" aria-describedby="aVoiceNote"'
    + ' title="Read the status out loud when it changes">Voice: off</button>'
    + '<small class="sv-note" id="aVoiceNote">Spoken by your browser. A demo of hands-free alerts; on a real EVA the suit would speak.</small>';
  exit.parentNode.insertBefore(box, exit);
  if (!OK) { box.hidden = true; return; }   // no speech in this browser: no button
  exit.parentNode.classList.add("sv-has");
  const btn = box.querySelector("button");

  /* ---------- turning screen text into words that sound right ---------- */
  const unit = (x, w) => `${+x} ${w}${+x === 1 ? "" : "s"}`;
  function speakable(text) {
    return String(text || "")
      .replace(/−/g, "minus ")
      // "T+2:11" -> "T plus 2 hours 11", "T+0:45" -> "T plus 45 minutes", "T+3:00" -> "T plus 3 hours"
      .replace(/T\+(\d+):(\d\d)/g, (_, h, m) => (+h ? `T plus ${unit(h, "hour")}${+m ? ` ${+m}` : ""}` : `T plus ${unit(m, "minute")}`))
      // "1 h 35 min" -> "1 hour 35 minutes", "29 min" -> "29 minutes"
      .replace(/(\d+) h (\d+) min\b/g, (_, h, m) => `${unit(h, "hour")}${+m ? ` ${unit(m, "minute")}` : ""}`)
      .replace(/(\d+) min\b/g, (_, m) => unit(m, "minute"))
      // spell out the letters, so a voice does not read "EVA" as a name
      .replace(/\bEVA\b/g, "E V A")
      .replace(/\bEV([12])\b/g, "E V $1")
      .replace(/\s+/g, " ").trim();
  }
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const sentence = (parts) => parts.map((p) => speakable(p).replace(/[\s.:;,]+$/, "")).filter(Boolean).map((p) => `${cap(p)}.`).join(" ");
  const siteKey = (site) => (site || "").split(/:\s+/)[0].trim();   // "At Three Forks: leave by T+2:11" -> "At Three Forks"
  const statusLine = (now) => sentence([now.word.toLowerCase(), now.spare]);   // "Turn back now. No time left if a crewmate gets hurt."
  const siteLine = (site) => sentence(site.split(/:\s+/));                     // "At Three Forks. Leave by T plus 2 hours 11."

  const txt = (id) => { const e = document.getElementById(id); return e ? e.textContent.replace(/\s+/g, " ").trim() : ""; };
  const read = () => ({ word: txt("aWord"), spare: txt("aSpare"), site: txt("aSite") });
  const drillOpen = () => { const d = document.querySelector(".drill-card"); return !!d && !d.hidden; };

  /* ---------- speaking, one sentence at a time ---------- */
  const S = { on: false, seen: null, last: "", cur: null, queue: [], afterCancel: false };
  // a sentence still matches the screen: the status word it announced is still shown, or the crew is still at that stop
  const valid = (it, now) => (it.kind === "status" ? it.key === now.word : it.key === siteKey(now.site));
  const busy = () => !!S.cur && (!S.cur.started || synth.speaking || synth.pending);

  // An English voice that runs on the device. If there is none, the browser picks its own English voice
  // (u.lang = "en-US"); in Chrome that can be an online "Google ..." voice.
  function voice() {
    let vs = [];
    try { vs = synth.getVoices() || []; } catch (e) { /* no list yet */ }
    const en = vs.filter((v) => v.localService && /^en([-_]|$)/i.test(v.lang || ""));
    return en.find((v) => v.default) || en.find((v) => /^en[-_]us/i.test(v.lang)) || en[0] || null;
  }

  function hush() {   // stop the sentence being spoken and anything the browser still has queued
    if (S.cur) clearTimeout(S.cur.timer);
    S.cur = null;
    try { synth.cancel(); } catch (e) { /* ignore */ }
    S.afterCancel = true;
  }
  function stopAll(forget) {
    S.queue = [];
    hush();
    if (forget) S.last = "";
  }

  function start(it) {
    const u = new SpeechSynthesisUtterance(it.text), v = voice();
    if (v) u.voice = v;
    u.lang = v ? v.lang : "en-US";
    it.u = u;   // keep a reference: some browsers drop the "end" event of an utterance nobody holds
    const done = () => { if (S.cur === it) { S.cur = null; pump(); } };
    u.onend = done;
    u.onerror = done;
    S.cur = it;
    const go = () => {
      if (S.cur !== it || !S.on) return;
      try {
        if (synth.paused) synth.resume();
        synth.speak(u);
        S.last = it.text;
      } catch (e) { S.cur = null; return; }
      it.started = true;
    };
    // Something else still in the browser's queue (the silent start-up sentence), or a cancel just now:
    // clear it and wait a moment, because some browsers drop a sentence spoken right after cancel().
    if (S.afterCancel || synth.speaking || synth.pending) {
      if (synth.speaking || synth.pending) { try { synth.cancel(); } catch (e) { /* ignore */ } }
      S.afterCancel = false;
      it.timer = setTimeout(go, 100);
    } else go();
  }

  function pump() {
    if (busy()) return;   // still talking: its "end" event calls pump again
    S.cur = null;
    S.queue.sort((a, b) => (a.kind === "status" ? 0 : 1) - (b.kind === "status" ? 0 : 1));   // status before arrivals
    while (S.queue.length) {
      const it = S.queue.shift();
      if (it.text && it.text !== S.last) { start(it); return; }   // never the same sentence twice in a row
    }
  }

  /* ---------- listening to the clock ---------- */
  document.addEventListener("redroute:time", () => {
    if (astro.hidden) { S.seen = null; return; }
    const now = read(), prev = S.seen;
    S.seen = now;
    if (!prev) return;                    // the view just opened: this is the starting point, nothing has changed yet
    if (!S.on || drillOpen()) return;     // voice off or a drill card on top: follow along silently
    S.queue = S.queue.filter((it) => valid(it, now));
    if (S.cur && !valid(S.cur, now)) { if (busy()) hush(); else S.cur = null; }   // out of date: stop it
    if (now.word && now.word !== prev.word) S.queue.push({ kind: "status", key: now.word, text: statusLine(now) });
    const k = siteKey(now.site);
    if (k && k !== siteKey(prev.site)) S.queue.push({ kind: "site", key: k, text: siteLine(now.site) });
    pump();
  });

  // quiet at once when the Astronaut view closes or a drill card opens
  new MutationObserver((recs) => {
    for (const r of recs) {
      const t = r.target;
      if (t === astro) { if (astro.hidden) { S.seen = null; if (S.on) stopAll(true); } }
      else if (S.on && t.classList && t.classList.contains("drill-card") && !t.hidden) stopAll(false);
    }
  }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ["hidden"] });

  function paint() {
    btn.textContent = S.on ? "Voice: on" : "Voice: off";
    btn.setAttribute("aria-pressed", String(S.on));
    btn.classList.toggle("on", S.on);
  }
  btn.addEventListener("click", () => {
    S.on = !S.on;
    paint();
    if (!S.on) { stopAll(true); return; }
    // Browsers allow speech only after a tap. A silent, empty sentence inside this tap unlocks it (iPhone Safari needs this).
    try { const u = new SpeechSynthesisUtterance(""); u.volume = 0; synth.speak(u); } catch (e) { /* ignore */ }
  });
  window.addEventListener("pagehide", () => { if (S.on) stopAll(true); });
})();
