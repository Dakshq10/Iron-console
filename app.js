/* ============================================================================
   app.js — the UI (React 18 + htm, no build step).
   Layout: Home (workout feed) · Workout (suggestion, schedule, routines) ·
   Profile (level, stats, exercises, measures, calendar, settings), plus the
   live workout logger, exercise database and per-exercise history.
   The engine prescribes; the app only ever SUGGESTS when to train — any
   routine, or an empty workout, can be started on any day.
   ========================================================================== */
(function () {
  "use strict";
  const { useState, useEffect, useMemo, useRef, useCallback } = React;
  const html = htm.bind(React.createElement);
  const E = window.GymEngine, Store = window.GymStore, AI = window.GymAI, Game = window.GymGame;

  /* ================================================================ utils */
  const todayISO = () => E.toISO(new Date());
  const cls = (...xs) => xs.filter(Boolean).join(" ");
  const uid = () => Math.random().toString(36).slice(2, 10);
  const ROUTINES = ["push", "pull", "legs", "backchest", "arms"];

  const d0 = (iso) => new Date(iso + "T00:00:00");
  const wdayShort = (iso) => d0(iso).toLocaleDateString(undefined, { weekday: "short" });
  const wdayLong = (iso) => d0(iso).toLocaleDateString(undefined, { weekday: "long" });
  const shortDate = (iso) => d0(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  const longDate = (iso) => d0(iso).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short", year: "numeric" });
  function clock(isoTs) {
    if (!isoTs) return "";
    const d = new Date(isoTs);
    if (isNaN(d)) return "";
    return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  function ago(iso, t) {
    const n = E.daysBetween(iso, t);
    if (n <= 0) return "Today";
    if (n === 1) return "Yesterday";
    if (n < 7) return n + " days ago";
    if (n < 30) { const w = Math.round(n / 7); return w + (w === 1 ? " week ago" : " weeks ago"); }
    if (n < 365) { const m = Math.round(n / 30); return m + (m === 1 ? " month ago" : " months ago"); }
    const y = Math.round(n / 365); return y + (y === 1 ? " year ago" : " years ago");
  }
  function dur(s) {
    if (s == null || !isFinite(s)) return "—";
    s = Math.max(0, Math.round(s));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    if (h) return `${h}h ${m}min`;
    if (m) return s < 600 ? `${m}min ${sec}s` : `${m}min`;
    return `${sec}s`;
  }
  const restText = (s) => !s ? "Off" : s < 60 ? `${s}s` : `${Math.floor(s / 60)}min ${s % 60}s`;
  function num(x, dp) {
    if (x == null || !isFinite(x)) return "—";
    return Number(x).toLocaleString(undefined, { maximumFractionDigits: dp == null ? 1 : dp });
  }
  const kg = (x) => (x == null ? "—" : num(x) + " kg");
  function download(name, text) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    a.download = name; a.click(); URL.revokeObjectURL(a.href);
  }
  function useNow(ms) {
    const [now, setNow] = useState(Date.now());
    useEffect(() => { const id = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(id); }, [ms]);
    return now;
  }
  function sessionLabel(type) {
    if (E.SESSIONS[type]) return E.SESSIONS[type].label;
    if (type === "baseline") return "Baseline";
    return "Workout";
  }

  /* ========================================================= muscle groups */
  const GROUP_OF = {
    chest: "Chest", "upper chest": "Chest",
    lats: "Back", back: "Back",
    "lateral delt": "Shoulders", "rear delt": "Shoulders", "front delt": "Shoulders",
    biceps: "Arms", triceps: "Arms", forearm: "Arms",
    quads: "Legs", hamstrings: "Legs", glutes: "Legs", calves: "Legs",
    abs: "Core", "lower abs": "Core",
  };
  const GROUPS = ["Chest", "Back", "Shoulders", "Arms", "Legs", "Core"];
  const groupOf = (name) => {
    const lib = E.LIB_BY_NAME[name];
    return (lib && GROUP_OF[lib.primary]) || "Other";
  };
  const cap = (s) => String(s || "").replace(/\b\w/g, (c) => c.toUpperCase());
  const EQUIPMENT = ["barbell", "dumbbell", "machine", "cable", "bodyweight"];

  /* ================================================================= icons */
  const P = {
    home: "M3 10.5L12 3l9 7.5M5 9v11h5v-6h4v6h5V9",
    dumbbell: "M6.5 7v10M3.5 9.5v5M17.5 7v10M20.5 9.5v5M6.5 12h11",
    user: "M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0",
    search: "M11 18a7 7 0 100-14 7 7 0 000 14zM21 21l-5-5",
    chevDown: "M6 9l6 6 6-6",
    chevRight: "M9 6l6 6-6 6",
    back: "M15 5l-7 7 7 7",
    dots: "M5 12h.01M12 12h.01M19 12h.01",
    dotsV: "M12 5h.01M12 12h.01M12 19h.01",
    thumb: "M7 10v11H4V10zM7 10l4-7a2 2 0 012 2v4h5.5a2 2 0 012 2.3l-1.3 7.7a2 2 0 01-2 1.7H7",
    comment: "M21 12a8 8 0 01-11.8 7L4 20.5l1.5-4.6A8 8 0 1121 12z",
    share: "M12 3v12M7 8l5-5 5 5M5 14v6h14v-6",
    timer: "M12 8v5l3 2M9 2h6M12 21a8 8 0 100-16 8 8 0 000 16z",
    check: "M5 12.5l4.5 4.5L19 7",
    plus: "M12 5v14M5 12h14",
    x: "M6 6l12 12M18 6L6 18",
    trend: "M3 17l6-6 4 4 8-8M15 7h6v6",
    calendar: "M7 3v3M17 3v3M4 8h16M5 5h14a1 1 0 011 1v14a1 1 0 01-1 1H5a1 1 0 01-1-1V6a1 1 0 011-1z",
    gear: "M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 13a7.9 7.9 0 000-2l2-1.6-2-3.4-2.4 1a8 8 0 00-1.7-1l-.4-2.6H9.1l-.4 2.6a8 8 0 00-1.7 1l-2.4-1-2 3.4L2.6 11a7.9 7.9 0 000 2l-2 1.6 2 3.4 2.4-1a8 8 0 001.7 1l.4 2.6h4.8l.4-2.6a8 8 0 001.7-1l2.4 1 2-3.4z",
    ruler: "M3 17L17 3l4 4L7 21zM7 13l2 2M10 10l2 2M13 7l2 2",
    list: "M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01",
    swap: "M7 4l-4 4 4 4M3 8h13a4 4 0 014 4M17 20l4-4-4-4M21 16H8a4 4 0 01-4-4",
    trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
    sparkle: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z",
    info: "M12 8h.01M11 12h1v5h1M12 3a9 9 0 100 18 9 9 0 000-18z",
    fire: "M12 2c1 3 4 4.5 4 8a4 4 0 11-7.5-2C9 6.5 11 4 12 2zM9.5 13.5a2.2 2.2 0 104.5 1",
    trophy: "M7 4h10v3a5 5 0 01-10 0zM7 5H4v1.5A3.5 3.5 0 007.5 10M17 5h3v1.5A3.5 3.5 0 0116.5 10M9 14h6M12 11v3M8 20h8M10 20l.5-3.5h3L14 20",
    star: "M12 3.5l2.4 5 5.4.6-4 3.7 1.1 5.3L12 20.4 7.1 18l1.1-5.3-4-3.7 5.4-.6z",
    alert: "M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L14.7 3.9a2 2 0 00-3.4 0z",
    moon: "M20 14.5A8 8 0 019.5 4 8 8 0 1020 14.5z",
  };
  const Icon = ({ d, size = 22, sw = 1.8, style, fill = "none" }) =>
    html`<svg width=${size} height=${size} viewBox="0 0 24 24" fill=${fill} stroke="currentColor"
            stroke-width=${sw} stroke-linecap="round" stroke-linejoin="round" style=${style} aria-hidden="true">
      <path d=${P[d] || d}/></svg>`;
  const Spinner = () => html`<span class="h-spinner"/>`;

  // Exercise thumbnail: an equipment glyph in a white disc, ringed in the
  // muscle group's colour. Drawn in-house — no stock illustrations.
  const GLYPH = {
    barbell: "M2.5 12h19M5 8.5v7M7.5 7v10M16.5 7v10M19 8.5v7",
    dumbbell: "M6 12h12M6 9v6M8.5 8v8M15.5 8v8M18 9v6",
    cable: "M12 3.5a1.8 1.8 0 100 3.6 1.8 1.8 0 000-3.6zM12 7.1v9M8.5 16.1h7M5 3.5h14",
    machine: "M5 3v18M19 3v18M5 6.5h14M9 10h6M9 13h6M9 16h6",
    bodyweight: "M12 3.5a2 2 0 100 4 2 2 0 000-4zM12 7.5v7M8.5 20.5l3.5-6 3.5 6M7 10.5l5-2 5 2",
  };
  const GROUP_HUE = { Chest: "#FF6B5E", Back: "#4DA3FF", Shoulders: "#FFB547", Arms: "#B88CFF", Legs: "#3FD18A", Core: "#FF7EB6", Other: "#8E8E93" };
  function Thumb({ name, size = 44 }) {
    const lib = E.LIB_BY_NAME[name] || {};
    const g = GLYPH[lib.equipment] || GLYPH.dumbbell;
    const hue = GROUP_HUE[groupOf(name)] || "#8E8E93";
    return html`<span class="h-thumb" style=${{ width: size, height: size, boxShadow: `inset 0 0 0 2px ${hue}` }}>
      <svg width=${size * 0.58} height=${size * 0.58} viewBox="0 0 24 24" fill="none" stroke="#1C1C1E"
           stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d=${g}/></svg>
    </span>`;
  }

  /* ================================================================ toast */
  function useToast() {
    const [toast, setToast] = useState(null);
    const tRef = useRef(null);
    const show = useCallback((msg, kind) => {
      setToast({ msg, kind });
      clearTimeout(tRef.current); tRef.current = setTimeout(() => setToast(null), 2600);
    }, []);
    const node = toast && html`<div class=${cls("h-toast", toast.kind)} role="status">${toast.msg}</div>`;
    return [node, show];
  }

  /* ======================================================= engine helpers */
  function makeCtx(state) {
    const t = todayISO();
    const start = (state.profile && state.profile.program_start) || t;
    const reDays = (state.profile && state.profile.reentry_days) || E.PROFILE.reentry_days;
    return {
      todayISO: t,
      machineIncrements: state.machineIncrements || {},
      reentryActive: E.daysBetween(start, t) < reDays,
      absence: E.absenceAdjustment(E.lastLogDate(state.logs || []), t),
      deloadWeek: E.isDeloadWeek(start, t),
    };
  }
  // A rep band for movements added outside a routine.
  function bandFor(name, kind) {
    const lib = E.LIB_BY_NAME[name] || {};
    if (lib.lateral_delt) return "lateral_delt";
    if (lib.primary === "rear delt") return "rear_delt";
    if (lib.primary === "calves") return "calves";
    if (lib.primary === "abs") return "ab_weighted";
    if (lib.primary === "lower abs") return "ab_lower";
    if (lib.type === "compound") return kind === "weekday" ? "weekday_main" : "weekend_main";
    return "isolation";
  }
  function repriceLine(state, exerciseName, meta) {
    const lib = E.LIB_BY_NAME[exerciseName];
    if (!lib) return null;
    const line = E.prescribe(lib, meta.band || "isolation", meta.sets || 3, state.logs || [], makeCtx(state));
    line.slot_label = meta.slot_label || cap(lib.primary);
    line.is_lateral_delt = !!meta.is_lateral_delt;
    line.warmup = !!meta.warmup;
    return line;
  }
  // Last session's sets for the PREVIOUS column.
  function prevSets(name, logs) {
    const last = E.lastSessionSets(name, logs || [], todayISO() + "~");
    return last ? last.sets.map((s) => ({ weight: s.weight, reps: s.reps, rpe: s.rpe })) : [];
  }
  const fmtSet = (s, lib) => {
    if (!s) return "—";
    const w = s.weight == null || (s.weight === 0 && lib && lib.equipment === "bodyweight") ? "BW" : num(s.weight) + "kg";
    return `${w} x ${s.reps}`;
  };

  /* =========================================================== workouts */
  // One workout = all real rows sharing a date and session type.
  function buildWorkouts(state) {
    const by = {};
    (state.logs || []).forEach((l) => {
      if (l.session_type === "measurement") return;
      const id = l.date + "|" + (l.session_type || "custom");
      (by[id] = by[id] || []).push(l);
    });
    return Object.keys(by).map((id) => {
      const rows = by[id];
      const [date, type] = id.split("|");
      const meta = (state.meta || {})[id] || {};
      const order = [];
      const byEx = {};
      rows.slice().sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")))
        .forEach((r) => { if (!byEx[r.exercise]) { byEx[r.exercise] = []; order.push(r.exercise); } byEx[r.exercise].push(r); });
      const exercises = order.map((name) => ({ name, sets: E.orderSets(byEx[name]) }));
      const volume = rows.reduce((a, r) => a + (r.weight || 0) * (r.reps || 0), 0);
      return {
        id, date, type, rows, exercises, volume, sets: rows.length,
        title: meta.title || sessionLabel(type),
        duration_s: meta.duration_s != null ? meta.duration_s : null,
        started_at: meta.started_at || null,
        baseline: type === "baseline",
      };
    }).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : String(b.started_at || "").localeCompare(String(a.started_at || ""))));
  }
  function muscleSplit(workout) {
    const tally = {};
    workout.rows.forEach((r) => { const g = groupOf(r.exercise); tally[g] = (tally[g] || 0) + 1; });
    const total = workout.rows.length || 1;
    return Object.keys(tally).map((g) => ({ group: g, pct: Math.round((tally[g] / total) * 100) }))
      .sort((a, b) => b.pct - a.pct);
  }

  /* ===================================================== exercise stats */
  function exerciseStats(name, logs) {
    const lib = E.LIB_BY_NAME[name] || {};
    const rows = (logs || []).filter((l) => l.exercise === name && l.session_type !== "measurement");
    const by = {};
    rows.forEach((r) => { const k = r.date + "|" + (r.session_type || "custom"); (by[k] = by[k] || []).push(r); });
    const sessions = Object.keys(by).sort().map((k) => {
      const sets = E.orderSets(by[k]);
      const [date, type] = k.split("|");
      const volume = sets.reduce((a, s) => a + (s.weight || 0) * (s.reps || 0), 0);
      const heaviest = Math.max.apply(null, sets.map((s) => s.weight || 0));
      const maxReps = Math.max.apply(null, sets.map((s) => s.reps || 0));
      const best1rm = Math.max.apply(null, sets.map((s) => (s.weight || 0) * (1 + (s.reps || 0) / 30)));
      return { key: k, date, type, sets, volume, heaviest, maxReps, setCount: sets.length, best1rm };
    });
    const pick = (f) => sessions.reduce((best, s) => (best == null || f(s) > f(best) ? s : best), null);
    const allSets = sessions.flatMap((s) => s.sets.map((x) => Object.assign({ date: s.date }, x)));
    const bestRepsSet = allSets.reduce((b, s) => (!b || (s.reps || 0) > (b.reps || 0) || ((s.reps || 0) === (b.reps || 0) && (s.weight || 0) > (b.weight || 0)) ? s : b), null);
    const heavySet = allSets.reduce((b, s) => (!b || (s.weight || 0) > (b.weight || 0) || ((s.weight || 0) === (b.weight || 0) && (s.reps || 0) > (b.reps || 0)) ? s : b), null);
    return {
      lib, sessions,
      totalVolume: sessions.reduce((a, s) => a + s.volume, 0),
      totalSets: allSets.length,
      totalReps: allSets.reduce((a, s) => a + (s.reps || 0), 0),
      heaviest: heavySet, maxReps: bestRepsSet,
      maxSets: pick((s) => s.setCount),
      bestVolume: pick((s) => s.volume),
      best1rm: pick((s) => s.best1rm),
      inverse: !!lib.inverse_load,
      bodyweight: lib.equipment === "bodyweight",
    };
  }

  /* ================================================================ chart */
  // Line chart for one exercise metric over time. Tap anywhere to inspect the
  // nearest session; the header shows the selected value.
  function niceStep(span) {
    const raw = span / 3, mag = Math.pow(10, Math.floor(Math.log10(raw || 1)));
    const n = raw / mag;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
  }
  function LineChart({ points, unit, format }) {
    const [sel, setSel] = useState(null);
    const svgRef = useRef(null);
    useEffect(() => { setSel(null); }, [points]);
    if (!points.length) return html`<div class="h-chart-empty">No sessions logged for this movement yet.</div>`;
    const W = 340, H = 180, L = 44, R = 14, T = 14, B = 26;
    const vals = points.map((p) => p.value);
    let lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    if (lo === hi) { lo = lo > 0 ? lo * 0.8 : 0; hi = hi > 0 ? hi * 1.2 : 1; }
    const step = niceStep(hi - lo);
    lo = Math.max(0, Math.floor(lo / step) * step); hi = Math.ceil(hi / step) * step;
    const ticks = []; for (let v = lo; v <= hi + step / 2; v += step) ticks.push(v);
    const n = points.length;
    const X = (i) => (n === 1 ? (L + W - R) / 2 : L + (i / (n - 1)) * (W - L - R));
    const Y = (v) => T + (1 - (v - lo) / (hi - lo || 1)) * (H - T - B);
    const line = points.map((p, i) => `${X(i)},${Y(p.value)}`).join(" ");
    const area = `${X(0)},${H - B} ${line} ${X(n - 1)},${H - B}`;
    const cur = sel == null ? n - 1 : sel;
    const f = format || ((v) => num(v));
    const xLabels = n <= 4 ? points.map((_, i) => i) : [0, Math.round((n - 1) / 3), Math.round((2 * (n - 1)) / 3), n - 1];
    const onTap = (ev) => {
      const r = svgRef.current.getBoundingClientRect();
      const x = ((ev.clientX - r.left) / r.width) * W;
      let best = 0, bd = Infinity;
      points.forEach((_, i) => { const d = Math.abs(X(i) - x); if (d < bd) { bd = d; best = i; } });
      setSel(best);
    };
    return html`
      <div class="h-chart">
        <div class="h-chart-read">
          <span class="v">${f(points[cur].value)}${unit ? html`<small> ${unit}</small>` : null}</span>
          <span class="d">${shortDate(points[cur].date)}${sel == null ? " · latest" : ""}</span>
        </div>
        <svg ref=${svgRef} viewBox=${`0 0 ${W} ${H}`} class="h-chart-svg" onClick=${onTap} role="img"
             aria-label=${`Chart with ${n} sessions`}>
          ${ticks.map((v, i) => html`<g key=${i}>
            <line x1=${L} x2=${W - R} y1=${Y(v)} y2=${Y(v)} class="grid"/>
            <text x=${L - 8} y=${Y(v) + 4} class="ylab" text-anchor="end">${f(v)}</text></g>`)}
          ${n > 1 && html`<polygon points=${area} class="area"/>`}
          ${n > 1 && html`<polyline points=${line} class="line"/>`}
          ${points.map((p, i) => html`<circle key=${i} cx=${X(i)} cy=${Y(p.value)} r=${i === cur ? 5 : 3}
             class=${i === cur ? "dot on" : "dot"}/>`)}
          <line x1=${X(cur)} x2=${X(cur)} y1=${T} y2=${H - B} class="cursor"/>
          ${xLabels.map((i) => html`<text key=${"x" + i} x=${X(i)} y=${H - 6} class="xlab"
             text-anchor=${n === 1 ? "middle" : i === 0 ? "start" : i === n - 1 ? "end" : "middle"}>${shortDate(points[i].date)}</text>`)}
        </svg>
      </div>`;
  }

  // Weekly bars (profile dashboard).
  function WeekBars({ weeks }) {
    const max = Math.max(1, ...weeks.map((w) => w.value));
    return html`<div class="h-bars">
      ${weeks.map((w, i) => html`<div class="col" key=${i}>
        <div class="bar" style=${{ height: Math.max(3, (w.value / max) * 100) + "%" }} title=${num(w.value, 0)}/>
        <span>${w.label}</span></div>`)}
    </div>`;
  }

  /* ============================================================ CHARACTER */
  // Parametric lifter badge; tier (Bronze→Mythic) drives colour and trim.
  function CharacterAvatar({ level = 1, size = 120, glow = true }) {
    const t = Game.tierFor(level || 1);
    const c = t.color, order = t.order;
    const plate = 6.5 + order * 1.5;
    const mythic = order >= 5, showCrown = order >= 4, showStar = order >= 2 && !showCrown;
    const id = "av" + (level || 1) + "s" + size;
    const star = "M50 9 l2.1 4.5 4.9 .5 -3.7 3.3 1 4.8 -4.3 -2.5 -4.3 2.5 1 -4.8 -3.7 -3.3 4.9 -.5 Z";
    const mix = (pct, base) => "color-mix(in srgb, " + c + " " + pct + "%, " + base + ")";
    return html`
      <svg viewBox="0 0 100 100" width=${size} height=${size} aria-hidden="true"
           style=${{ filter: mythic ? `drop-shadow(0 0 9px ${c})` : (glow ? "drop-shadow(0 5px 12px rgba(0,0,0,.6))" : "none") }}>
        <defs>
          <radialGradient id=${id + "bg"} cx="50%" cy="36%" r="72%">
            <stop offset="0%" stop-color=${mix(26, "#2C2C2E")}/><stop offset="100%" stop-color="#1C1C1E"/>
          </radialGradient>
          <linearGradient id=${id + "pl"} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color=${c}/><stop offset="100%" stop-color=${mix(55, "#000")}/>
          </linearGradient>
        </defs>
        <circle cx="50" cy="50" r="46" fill=${`url(#${id}bg)`} stroke=${c} stroke-width="2.5"/>
        ${order >= 1 && html`<circle cx="50" cy="50" r="40" fill="none" stroke=${c} stroke-opacity="0.35" stroke-width="1"/>`}
        ${order >= 3 && html`<circle cx="50" cy="50" r="35" fill="none" stroke=${c} stroke-opacity="0.16" stroke-width="1"/>`}
        ${showCrown && html`<path d="M34 21 L40 12 L46 19 L50 9.5 L54 19 L60 12 L66 21 Z" fill=${c}/>`}
        ${showStar && html`<path d=${star} fill=${c}/>`}
        <rect x="20" y="30" width="60" height="4.4" rx="2.2" fill="#fff"/>
        <circle cx="22" cy="32.2" r=${plate} fill=${`url(#${id}pl)`}/>
        <circle cx="78" cy="32.2" r=${plate} fill=${`url(#${id}pl)`}/>
        <path d="M40 45 L44 34" stroke=${c} stroke-width="5" stroke-linecap="round"/>
        <path d="M60 45 L56 34" stroke=${c} stroke-width="5" stroke-linecap="round"/>
        <circle cx="50" cy="50" r="8.5" fill="#fff"/>
        <path d="M37 59 L63 59 L57.5 83 L42.5 83 Z" fill=${c} opacity="0.92"/>
      </svg>`;
  }

  /* ============================================================ primitives */
  function Sheet({ title, onClose, children, tall }) {
    useEffect(() => {
      const k = (e) => { if (e.key === "Escape") onClose(); };
      window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
    }, [onClose]);
    return html`
      <div class="h-overlay" onClick=${onClose}>
        <div class=${cls("h-sheet", tall && "tall")} role="dialog" aria-modal="true" aria-label=${title}
             onClick=${(e) => e.stopPropagation()}>
          <div class="h-grab"/>
          ${title && html`<div class="h-sheet-title">${title}</div>`}
          ${children}
        </div>
      </div>`;
  }
  function TopBar({ title, onBack, right, big }) {
    return html`<header class=${cls("h-top", big && "big")}>
      ${onBack ? html`<button class="h-iconbtn" onClick=${onBack} aria-label="Back"><${Icon} d="back" size=${26}/></button>` : null}
      <h1 class=${cls(onBack && "center")}>${title}</h1>
      <div class="h-top-right">${right || (onBack ? html`<span style=${{ width: 40 }}/>` : null)}</div>
    </header>`;
  }
  function Avatar({ name, size = 40 }) {
    const ch = (name || "").trim().charAt(0).toUpperCase();
    return html`<span class="h-avatar" style=${{ width: size, height: size, fontSize: size * 0.42 }}>
      ${ch || html`<${Icon} d="user" size=${size * 0.55}/>`}</span>`;
  }
  // A native <select> dressed as a pill — accessible and thumb-friendly.
  function PillSelect({ value, onChange, options, label, className }) {
    const cur = options.find((o) => String(o.value) === String(value));
    return html`<label class=${cls("h-pillsel", className)}>
      <span>${cur ? cur.label : label}</span>
      <select value=${value} onChange=${(e) => onChange(e.target.value)} aria-label=${label}>
        ${options.map((o) => html`<option key=${o.value} value=${o.value}>${o.label}</option>`)}
      </select>
    </label>`;
  }

  /* ===================================================== EXERCISE PICKER */
  // Full-screen exercise database: search (words in any order, so "chest
  // press machine" finds Machine Chest Press), equipment + muscle filters,
  // recent movements first. Tap a row to pick; the chart icon opens history.
  function haystack(e) {
    const extra = [];
    if ((e.roles || []).includes("shoulder_press")) extra.push("overhead ohp military shoulders");
    if (e.lateral_delt) extra.push("side delt shoulders");
    if (e.equipment === "dumbbell") extra.push("db");
    if (e.equipment === "barbell") extra.push("bb");
    return [e.name, e.equipment, e.primary, GROUP_OF[e.primary] || "", (e.secondary || []).join(" ")]
      .concat(extra).join(" ").toLowerCase();
  }
  function ExercisePicker({ state, title, current, onPick, onHistory, onClose, autoFocus }) {
    const [q, setQ] = useState("");
    const [equip, setEquip] = useState("all");
    const [muscle, setMuscle] = useState("all");
    const recent = useMemo(() => {
      const last = {};
      (state.logs || []).forEach((l) => {
        if (l.session_type === "measurement" || !E.LIB_BY_NAME[l.exercise]) return;
        if (!last[l.exercise] || l.date > last[l.exercise]) last[l.exercise] = l.date;
      });
      return Object.keys(last).sort((a, b) => (last[a] < last[b] ? 1 : -1)).slice(0, 8);
    }, [state.logs]);
    const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
    const match = (e) => (equip === "all" || e.equipment === equip)
      && (muscle === "all" || (GROUP_OF[e.primary] || "Other") === muscle)
      && tokens.every((t) => haystack(e).includes(t));
    const all = E.LIBRARY.filter(match).slice().sort((a, b) => a.name.localeCompare(b.name));
    const filtering = tokens.length || equip !== "all" || muscle !== "all";
    const curLib = current ? E.LIB_BY_NAME[current] : null;
    const suggested = curLib && !filtering
      ? Array.from(new Set((curLib.alts || []).concat(E.LIBRARY.filter((e) => e.name !== current && e.primary === curLib.primary).map((e) => e.name))))
          .filter((n) => n !== current && E.LIB_BY_NAME[n]).slice(0, 6)
      : [];
    const Row = (name) => {
      const e = E.LIB_BY_NAME[name];
      return html`<div class="h-exrow" key=${name}>
        <button class="main" onClick=${() => onPick(name)}>
          <${Thumb} name=${name} size=${48}/>
          <span class="txt"><span class="nm">${name}</span><span class="mu">${cap(e.primary)}</span></span>
        </button>
        ${onHistory && html`<button class="h-iconbtn ring" aria-label=${"History for " + name} onClick=${() => onHistory(name)}>
          <${Icon} d="trend" size=${20}/></button>`}
      </div>`;
    };
    return html`
      <div class="h-full" role="dialog" aria-modal="true" aria-label=${title}>
        <header class="h-top modal">
          <button class="h-textbtn" onClick=${onClose}>Cancel</button>
          <h1 class="center">${title}</h1>
          <span style=${{ width: 60 }}/>
        </header>
        <div class="h-pad">
          <label class="h-search">
            <${Icon} d="search" size=${20}/>
            <input type="search" placeholder="Search exercise" value=${q} autoFocus=${!!autoFocus}
                   onChange=${(e) => setQ(e.target.value)} aria-label="Search exercise"/>
            ${q && html`<button class="clear" onClick=${() => setQ("")} aria-label="Clear search"><${Icon} d="x" size=${16}/></button>`}
          </label>
          <div class="h-filters">
            <${PillSelect} label="All Equipment" value=${equip} onChange=${setEquip}
              options=${[{ value: "all", label: "All Equipment" }].concat(EQUIPMENT.map((x) => ({ value: x, label: cap(x) })))}/>
            <${PillSelect} label="All Muscles" value=${muscle} onChange=${setMuscle}
              options=${[{ value: "all", label: "All Muscles" }].concat(GROUPS.map((x) => ({ value: x, label: x })))}/>
          </div>
          ${suggested.length > 0 && html`<div class="h-label">Suggested swaps</div>${suggested.map(Row)}`}
          ${!filtering && recent.length > 0 && html`<div class="h-label">Recent Exercises</div>${recent.map(Row)}`}
          <div class="h-label">${filtering ? `${all.length} result${all.length === 1 ? "" : "s"}` : "All Exercises"}</div>
          ${all.length ? all.map((e) => Row(e.name))
            : html`<div class="h-empty small">No movement matches “${q}”. Try fewer words, or clear the filters.</div>`}
        </div>
      </div>`;
  }

  /* ==================================================== EXERCISE HISTORY */
  const METRICS = [
    { key: "volume", label: "Volume", unit: "kg", get: (s) => s.volume },
    { key: "heaviest", label: "Heaviest weight", unit: "kg", get: (s) => s.heaviest },
    { key: "reps", label: "Max reps", unit: "reps", get: (s) => s.maxReps },
    { key: "sets", label: "Sets", unit: "sets", get: (s) => s.setCount },
  ];
  function ExerciseHistory({ state, name, onBack, onOpen }) {
    const [tab, setTab] = useState("summary");
    const st = useMemo(() => exerciseStats(name, state.logs), [name, state.logs]);
    const defMetric = st.bodyweight || st.inverse ? "reps" : "volume";
    const [metric, setMetric] = useState(defMetric);
    useEffect(() => { setMetric(defMetric); setTab("summary"); }, [name]);
    const m = METRICS.find((x) => x.key === metric) || METRICS[0];
    const points = useMemo(() => st.sessions.map((s) => ({ date: s.date, value: m.get(s) })), [st, m]);
    const lib = st.lib;
    const pr = (label, value, sub) => html`<div class="h-statrow"><span class="k">${label}</span>
      <span class="v">${value}${sub ? html`<small>${sub}</small>` : null}</span></div>`;

    return html`
      <div class="h-screen">
        <${TopBar} title=${name} onBack=${onBack}/>
        <div class="h-tabs" role="tablist">
          ${[["summary", "Summary"], ["history", "History"], ["about", "About"]].map(([k, l]) => html`
            <button key=${k} role="tab" aria-selected=${tab === k} class=${cls(tab === k && "on")} onClick=${() => setTab(k)}>${l}</button>`)}
        </div>

        ${tab === "summary" && html`<div class="h-pad">
          <div class="h-exhead"><${Thumb} name=${name} size=${56}/>
            <div><div class="nm">${name}</div><div class="mu">${cap(lib.primary || "")}${lib.equipment ? " · " + cap(lib.equipment) : ""}</div></div></div>
          <div class="h-chips" role="group" aria-label="Chart metric">
            ${METRICS.map((x) => html`<button key=${x.key} class=${cls("h-chip", metric === x.key && "on")}
              aria-pressed=${metric === x.key} onClick=${() => setMetric(x.key)}>${x.label}</button>`)}
          </div>
          <${LineChart} points=${points} unit=${m.unit}/>
          ${st.inverse && html`<div class="h-note">Assisted movement: the weight is counter-balance, so a lower number is harder. Track reps here.</div>`}
          ${st.sessions.length > 0 && html`
            <div class="h-label">Records</div>
            <div class="h-group">
              ${!st.bodyweight && pr("Total volume lifted", kg(st.totalVolume))}
              ${!st.bodyweight && st.heaviest && pr("Heaviest weight", kg(st.heaviest.weight), ` × ${st.heaviest.reps} · ${shortDate(st.heaviest.date)}`)}
              ${st.maxReps && pr("Max reps in a set", num(st.maxReps.reps, 0) + " reps",
                ` @ ${st.maxReps.weight ? num(st.maxReps.weight) + "kg" : "BW"} · ${shortDate(st.maxReps.date)}`)}
              ${st.maxSets && pr("Max sets in a workout", num(st.maxSets.setCount, 0) + " sets", ` · ${shortDate(st.maxSets.date)}`)}
              ${!st.bodyweight && st.bestVolume && pr("Best workout volume", kg(st.bestVolume.volume), ` · ${shortDate(st.bestVolume.date)}`)}
              ${!st.bodyweight && !st.inverse && st.best1rm && st.best1rm.best1rm > 0 && pr("Estimated 1-rep max", kg(Math.round(st.best1rm.best1rm * 2) / 2), " · Epley")}
              ${pr("Workouts logged", num(st.sessions.length, 0))}
              ${pr("Total sets · reps", `${num(st.totalSets, 0)} · ${num(st.totalReps, 0)}`)}
            </div>`}
        </div>`}

        ${tab === "history" && html`<div>
          ${st.sessions.length === 0 && html`<div class="h-empty">Log this movement once and every set shows up here.</div>`}
          ${st.sessions.slice().reverse().map((s) => {
            const meta = (state.meta || {})[s.key] || {};
            const note = (s.sets.find((x) => x.notes) || {}).notes;
            return html`<section class="h-histblock" key=${s.key}>
              <div class="hd"><div class="t">${meta.title || sessionLabel(s.type)}</div>
                <div class="d">${shortDate(s.date)} ${d0(s.date).getFullYear()}${meta.started_at ? ", " + clock(meta.started_at) : ""}</div></div>
              <div class="ex"><${Thumb} name=${name} size=${36}/><span>${name}</span></div>
              ${note && html`<div class="h-exnote">${note}</div>`}
              <div class="h-settable">
                <div class="th"><span>SET</span><span>WEIGHT & REPS</span></div>
                ${s.sets.map((x, i) => html`<div class="tr" key=${i}><span class="ix">${i + 1}</span>
                  <span>${x.weight == null || (x.weight === 0 && st.bodyweight) ? "BW" : num(x.weight) + " kg"} x ${x.reps}
                  ${x.rpe != null ? html`<em> @ ${num(x.rpe)} rpe</em>` : null}</span></div>`)}
              </div>
            </section>`;
          })}
        </div>`}

        ${tab === "about" && html`<div class="h-pad">
          <div class="h-group">
            ${pr("Primary muscle", cap(lib.primary || "—"))}
            ${pr("Also works", (lib.secondary || []).length ? cap(lib.secondary.join(", ")) : "—")}
            ${pr("Equipment", cap(lib.equipment || "—"))}
            ${pr("Type", cap(lib.type || "—"))}
            ${lib.rest && pr("Default rest", lib.rest[0] % 60 === 0 && lib.rest[1] % 60 === 0
              ? `${lib.rest[0] / 60}–${lib.rest[1] / 60} min` : `${lib.rest[0]}–${lib.rest[1]} s`)}
            ${pr("Load step", lib.increment ? lib.increment + " kg" : "Set your machine's stack spacing")}
            ${pr("Appears in", (lib.sessions || []).filter((k) => E.SESSIONS[k]).map((k) => E.SESSIONS[k].label).join(", ") || "Added manually")}
          </div>
          ${(lib.alts || []).length > 0 && html`<div class="h-label">Swaps</div>
            ${lib.alts.filter((n) => E.LIB_BY_NAME[n]).map((n) => html`<div class="h-exrow" key=${n}>
              <button class="main" onClick=${() => onOpen(n)}><${Thumb} name=${n} size=${44}/>
              <span class="txt"><span class="nm">${n}</span><span class="mu">${cap(E.LIB_BY_NAME[n].primary)}</span></span></button>
              <span class="h-chev"><${Icon} d="chevRight" size=${18}/></span></div>`)}`}
        </div>`}
      </div>`;
  }

  /* ================================================================ HOME */
  function shareWorkout(w, toast) {
    const lines = [`${w.title} — ${shortDate(w.date)}`,
      `${w.duration_s != null ? dur(w.duration_s) + " · " : ""}${num(w.volume)} kg · ${w.sets} sets`]
      .concat(w.exercises.map((ex) => `• ${ex.name}: ${ex.sets.map((s) => fmtSet(s, E.LIB_BY_NAME[ex.name])).join(", ")}`));
    const text = lines.join("\n");
    if (navigator.share) { navigator.share({ title: w.title, text }).catch(() => {}); return; }
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => toast("Workout copied to clipboard", "good"), () => toast("Couldn't copy", "bad"));
  }

  function WorkoutStats({ w, withSets }) {
    return html`<div class="h-wstats">
      <div><span class="k">Time</span><span class="v">${dur(w.duration_s)}</span></div>
      <div><span class="k">Volume</span><span class="v">${num(w.volume)} kg</span></div>
      ${withSets && html`<div><span class="k">Sets</span><span class="v">${w.sets}</span></div>`}
    </div>`;
  }
  function Actions({ liked, onLike, onComment, onShare }) {
    return html`<div class="h-actions">
      <button class=${cls("h-iconbtn", liked && "liked")} onClick=${onLike} aria-pressed=${!!liked} aria-label="Like">
        <${Icon} d="thumb" size=${26} fill=${liked ? "currentColor" : "none"}/></button>
      <button class="h-iconbtn" onClick=${onComment} aria-label="Notes"><${Icon} d="comment" size=${26}/></button>
      <button class="h-iconbtn" onClick=${onShare} aria-label="Share"><${Icon} d="share" size=${26}/></button>
    </div>`;
  }

  function FeedCard({ w, name, t, liked, onLike, onOpen, onShare }) {
    const [more, setMore] = useState(false);
    const shown = more ? w.exercises : w.exercises.slice(0, 3);
    const rest = w.exercises.length - 3;
    return html`<article class="h-feedcard">
      <button class="h-feedhead" onClick=${onOpen}>
        <${Avatar} name=${name} size=${48}/>
        <span><span class="nm">${name || "You"}</span>
          <span class="when">${ago(w.date, t)}${w.started_at ? " · " + clock(w.started_at) : ""}</span></span>
      </button>
      <button class="h-feedbody" onClick=${onOpen}>
        <span class="title">${w.title}${w.baseline ? html` <span class="h-tag">Imported</span>` : null}</span>
        <${WorkoutStats} w=${w}/>
      </button>
      <div class="h-feedex">
        ${shown.map((ex) => html`<div class="ln" key=${ex.name}><${Thumb} name=${ex.name} size=${50}/>
          <span>${ex.sets.length} set${ex.sets.length === 1 ? "" : "s"} ${ex.name}</span></div>`)}
        ${rest > 0 && html`<button class="h-more" onClick=${() => setMore(!more)} aria-expanded=${more}>
          ${more ? "Show less" : `See ${rest} more exercise${rest === 1 ? "" : "s"}`}</button>`}
      </div>
      <${Actions} liked=${liked} onLike=${onLike} onComment=${onOpen} onShare=${onShare}/>
    </article>`;
  }

  function HomeScreen({ state, workouts, prefs, likes, onLike, onOpen, onBrowse, onGoWorkout, toast }) {
    const t = todayISO();
    return html`<div class="h-screen">
      <${TopBar} big title="Home" right=${html`<button class="h-iconbtn" onClick=${onBrowse} aria-label="Search exercises"><${Icon} d="search" size=${26}/></button>`}/>
      ${workouts.length === 0 ? html`<div class="h-empty">
          <div class="big">No workouts yet</div>
          <div>Finished workouts land here with their time, volume and every set.</div>
          <button class="h-btn primary" onClick=${onGoWorkout}>Start a workout</button></div>`
        : workouts.map((w) => html`<${FeedCard} key=${w.id} w=${w} t=${t} name=${prefs.display_name}
            liked=${!!likes[w.id]} onLike=${() => onLike(w.id)} onOpen=${() => onOpen(w.id)}
            onShare=${() => shareWorkout(w, toast)}/>`)}
    </div>`;
  }

  const OUTCOME = {
    as_prescribed: { text: "As prescribed", cls: "good" }, substituted: { text: "Substituted", cls: "warn" },
    partial: { text: "Partial", cls: "warn" }, skipped: { text: "Skipped", cls: "bad" },
  };
  function WorkoutDetail({ state, w, prefs, liked, onLike, onBack, onOpenExercise, toast }) {
    const notesRef = useRef(null);
    if (!w) return html`<div class="h-screen"><${TopBar} title="Workout Detail" onBack=${onBack}/>
      <div class="h-empty">This workout no longer exists.</div></div>`;
    const split = muscleSplit(w);
    const status = (state.sessionStatus || []).find((r) => r.date === w.date && r.session_key === w.type);
    const oc = status && OUTCOME[status.status];
    return html`<div class="h-screen">
      <${TopBar} title="Workout Detail" onBack=${onBack}/>
      <div class="h-pad">
        <div class="h-feedhead static"><${Avatar} name=${prefs.display_name} size=${48}/>
          <span><span class="nm">${prefs.display_name || "You"}</span>
            <span class="when">${longDate(w.date)}${w.started_at ? " · " + clock(w.started_at) : ""}</span></span></div>
        <div class="h-detail-title">${w.title}${oc ? html` <span class=${"h-tag " + oc.cls}>${oc.text}</span>` : null}</div>
        <${WorkoutStats} w=${w} withSets/>
        ${status && (status.substitutions || []).length > 0 && html`<div class="h-note">
          ${status.substitutions.map((x) => `${x.prescribed} → ${x.performed}`).join(" · ")}</div>`}
        <div class="h-rule"/>
        <${Actions} liked=${liked} onLike=${onLike}
          onComment=${() => notesRef.current && notesRef.current.scrollIntoView({ behavior: "smooth" })}
          onShare=${() => shareWorkout(w, toast)}/>
        <div class="h-rule"/>
        <div class="h-label">Muscle Split</div>
        ${split.map((s) => html`<div class="h-split" key=${s.group}>
          <div class="g">${s.group}</div>
          <div class="row"><div class="bar"><i style=${{ width: s.pct + "%" }}/></div><span>${s.pct}%</span></div></div>`)}
        <div class="h-label" ref=${notesRef}>Workout</div>
        ${w.exercises.map((ex) => {
          const lib = E.LIB_BY_NAME[ex.name] || {};
          const repsOnly = lib.equipment === "bodyweight" && ex.sets.every((s) => !s.weight);
          const note = (ex.sets.find((s) => s.notes) || {}).notes;
          return html`<section class="h-detailex" key=${ex.name}>
            <button class="hd" onClick=${() => onOpenExercise(ex.name)}><${Thumb} name=${ex.name} size=${44}/><span>${ex.name}</span></button>
            ${note && html`<div class="h-exnote">${note}</div>`}
            <div class="h-settable">
              <div class="th"><span>SET</span><span>${repsOnly ? "REPS" : "WEIGHT & REPS"}</span></div>
              ${ex.sets.map((s, i) => html`<div class="tr" key=${i}><span class="ix">${i + 1}</span>
                <span>${repsOnly ? s.reps : fmtSet(s, lib).replace("kg x", " kg x")}${s.rpe != null ? html`<em> @ ${num(s.rpe)} rpe</em>` : null}</span></div>`)}
            </div>
          </section>`;
        })}
      </div>
    </div>`;
  }

  /* ============================================================= WORKOUT */
  const ABBR = { arms: "Arms", legs: "Legs", backchest: "B/C", push: "Push", pull: "Pull", custom: "Free", baseline: "Base" };
  function cellText(d) {
    const s = d.s;
    if (d.status === "missed" && s.missed) return ABBR[s.missed.session] || "";
    if (s.kind === "done") return ABBR[s.session] || "Done";
    if (s.kind === "lift") return ABBR[s.session] || s.label;
    if (s.kind === "rest") return s.source === "planned" ? "Rest" : (s.source === "split" ? "Rest" : "");
    if (s.kind === "cardio") return "Z2";
    return "";
  }

  function usePreviews(state) {
    return useMemo(() => {
      const out = {};
      ROUTINES.forEach((k) => {
        try { out[k] = E.buildSession(k, state, { todayISO: todayISO() }); } catch (_) { out[k] = null; }
      });
      return out;
    }, [state.logs, state.cycleWeek, state.profile]);
  }

  function SuggestionCard({ state, previews, onStart, onChange }) {
    const t = todayISO();
    const s = E.suggestForDate(state, t, t);
    if (s.kind === "done") {
      return html`<div class="h-card suggest done">
        <div class="eyebrow">Today</div>
        <div class="row"><span class="h-donedot"><${Icon} d="check" size=${18} sw=${2.6}/></span>
          <div><div class="t">${s.label} done</div><div class="r">Rest up — or start another routine below.</div></div></div>
      </div>`;
    }
    if (s.kind === "lift") {
      const p = previews[s.session];
      return html`<div class="h-card suggest">
        <div class="eyebrow">Suggested today${s.source === "planned" ? " · scheduled by you" : ""}</div>
        <div class="t">${s.label}</div>
        <div class="r">${s.reason}</div>
        ${p && html`<div class="pv">${p.items.map((i) => i.exercise).join(", ")}</div>`}
        ${p && p.banners.map((b, i) => html`<div class="h-note warn" key=${i}><${Icon} d="info" size=${15}/> ${b.text}</div>`)}
        <button class="h-btn primary block" onClick=${() => onStart(s.session)}>Start Routine</button>
        <button class="h-textbtn small" onClick=${onChange}>Change today’s plan</button>
      </div>`;
    }
    const alt = s.alt || E.nextUp(state, t);
    return html`<div class="h-card suggest">
      <div class="eyebrow">Today</div>
      <div class="t">${s.kind === "cardio" ? "Zone 2 cardio" : "Rest day"}</div>
      <div class="r">${s.reason}${s.kind === "cardio" ? " — 20–30 min at a talkable pace." : "."} It's a suggestion: you decide.</div>
      ${alt && html`<div class="pv">Feel like lifting? <b>${alt.label}</b> is most due · ${alt.reason.toLowerCase()}.</div>
        <button class="h-btn secondary block" onClick=${() => onStart(alt.session)}>Start ${alt.label}</button>`}
      <button class="h-textbtn small" onClick=${onChange}>Schedule today</button>
    </div>`;
  }

  function WeekStrip({ state, onDay }) {
    const t = todayISO();
    const days = E.calendarDays(state, t, { weeksBack: 0, weeksAhead: 1 });
    return html`<div class="h-week" role="list">
      ${days.map((d) => html`<button key=${d.date} role="listitem"
          class=${cls("cell", "st-" + d.status, d.s.source === "planned" && "planned", d.isToday && "today")}
          onClick=${() => onDay(d.date)} aria-label=${`${longDate(d.date)}: ${cellText(d) || "nothing planned"}`}>
        <span class="wd">${wdayShort(d.date).slice(0, 1)}</span>
        <span class="dn">${d0(d.date).getDate()}</span>
        <span class="lb">${d.status === "done" ? html`<${Icon} d="check" size=${12} sw=${3}/>` : cellText(d)}</span>
      </button>`)}
    </div>`;
  }

  function ScheduleSheet({ state, date, onSet, onStart, onStartEmpty, onClose }) {
    const t = todayISO();
    const s = E.suggestForDate(state, date, t);
    const planned = (state.planned || {})[date];
    const past = date < t;
    const status = s.kind === "done" ? `Logged: ${s.label}`
      : planned ? `Scheduled by you: ${planned === "rest" ? "Rest day" : E.SESSIONS[planned].label}`
      : s.kind === "lift" ? `Suggested: ${s.label} — ${s.reason}`
      : s.kind === "cardio" ? "Suggested: Zone 2 cardio"
      : s.kind === "rest" ? "Suggested: rest" : "Nothing scheduled";
    return html`<${Sheet} title=${`${wdayLong(date)}, ${shortDate(date)}`} onClose=${onClose}>
      <div class="h-sheet-sub">${status}</div>
      ${!past && html`
        <div class="h-label tight">Schedule</div>
        <div class="h-routinegrid">
          ${ROUTINES.map((k) => html`<button key=${k} class=${cls("h-gridbtn", planned === k && "on")}
              aria-pressed=${planned === k} onClick=${() => onSet(date, k)}>${E.SESSIONS[k].label}</button>`)}
          <button class=${cls("h-gridbtn", planned === "rest" && "on")} aria-pressed=${planned === "rest"}
            onClick=${() => onSet(date, "rest")}><${Icon} d="moon" size=${16}/> Rest</button>
        </div>
        ${planned && html`<button class="h-btn secondary block" onClick=${() => onSet(date, null)}>Clear — use the app's suggestion</button>`}`}
      ${date === t && s.kind !== "done" && html`
        ${s.kind === "lift" && html`<button class="h-btn primary block" onClick=${() => onStart(s.session)}>Start ${s.label} now</button>`}
        <button class="h-btn secondary block" onClick=${onStartEmpty}>Start empty workout</button>`}
      <div class="h-foot">Scheduling is a plan, not a lock — any routine can be started on any day.</div>
    <//>`;
  }

  function RoutinePreview({ plan, onStart, onClose, onOpenExercise }) {
    return html`<${Sheet} title=${plan.session_label} onClose=${onClose} tall>
      <div class="h-sheet-sub">${plan.items.length} exercises · built from your history today</div>
      ${plan.items.map((it, i) => html`<button class="h-prevrow" key=${i} onClick=${() => onOpenExercise(it.exercise)}>
        <${Thumb} name=${it.exercise} size=${44}/>
        <span class="txt"><span class="nm">${it.exercise}</span>
          <span class="mu">${it.sets} × ${it.target_reps} · ${it.weight == null ? "set start weight" : it.weight === 0 && it.equipment === "bodyweight" ? "bodyweight" : it.weight + " kg"}</span>
          ${it.note && html`<span class="cue">${it.note}</span>`}</span>
      </button>`)}
      <button class="h-btn primary block" onClick=${onStart}>Start Routine</button>
    <//>`;
  }

  function WorkoutScreen({ state, mode, onStart, onStartEmpty, onSetPlanned, onOpenCalendar, onOpenExercise }) {
    const previews = usePreviews(state);
    const [dayFor, setDayFor] = useState(null);
    const [preview, setPreview] = useState(null);
    const t = todayISO();
    const sched = state.scheduleMode === "free" ? "Free schedule" : "Suggested split";
    return html`<div class="h-screen">
      <${TopBar} big title="Workout" right=${html`<span class=${cls("h-sync", mode)}>${mode === "cloud" ? "Synced" : "Local"}</span>`}/>
      <div class="h-pad">
        <div class="h-label first">Quick Start</div>
        <button class="h-btn tile block" onClick=${onStartEmpty}><${Icon} d="plus" size=${20}/> Start Empty Workout</button>

        <${SuggestionCard} state=${state} previews=${previews} onStart=${onStart} onChange=${() => setDayFor(t)}/>

        <div class="h-labelrow"><span class="h-label">This week</span>
          <button class="h-textbtn small" onClick=${onOpenCalendar}>${sched} · Calendar</button></div>
        <${WeekStrip} state=${state} onDay=${setDayFor}/>

        <div class="h-label">My Routines (${ROUTINES.length})</div>
        ${ROUTINES.map((k) => {
          const p = previews[k];
          return html`<div class="h-routine" key=${k}>
            <div class="hd"><span class="t">${E.SESSIONS[k].label}</span>
              <button class="h-iconbtn" onClick=${() => p && setPreview(p)} aria-label=${"Preview " + E.SESSIONS[k].label}><${Icon} d="dots" size=${24} sw=${3}/></button></div>
            <button class="pv" onClick=${() => p && setPreview(p)}>${p ? p.items.map((i) => i.exercise).join(", ") : "—"}</button>
            <button class="h-btn primary block" onClick=${() => onStart(k)}>Start Routine</button>
          </div>`;
        })}
      </div>
      ${dayFor && html`<${ScheduleSheet} state=${state} date=${dayFor} onClose=${() => setDayFor(null)}
          onSet=${(d, k) => { setDayFor(null); onSetPlanned(d, k); }}
          onStart=${(k) => { setDayFor(null); onStart(k); }}
          onStartEmpty=${() => { setDayFor(null); onStartEmpty(); }}/>`}
      ${preview && html`<${RoutinePreview} plan=${preview} onClose=${() => setPreview(null)}
          onOpenExercise=${(n) => { setPreview(null); onOpenExercise(n); }}
          onStart=${() => { const k = preview.session_key; setPreview(null); onStart(k); }}/>`}
    </div>`;
  }

  /* ============================================================ CALENDAR */
  function muscleFreshness(state, t) {
    const by = {};
    (state.logs || []).filter((l) => l.session_type !== "measurement").forEach((l) => {
      const g = groupOf(l.exercise);
      if (g === "Other") return;
      if (!by[g] || l.date > by[g]) by[g] = l.date;
    });
    return GROUPS.map((g) => ({ group: g, days: by[g] ? E.daysBetween(by[g], t) : null }))
      .sort((a, b) => (b.days == null ? 9999 : b.days) - (a.days == null ? 9999 : a.days));
  }

  function CalendarScreen({ state, onBack, onSetPlanned, onSetMode, onStart, onStartEmpty }) {
    const t = todayISO();
    const days = useMemo(() => E.calendarDays(state, t, { weeksBack: 1, weeksAhead: 4 }), [state.logs, state.planned, state.scheduleMode, t]);
    const [dayFor, setDayFor] = useState(null);
    const free = state.scheduleMode === "free";
    const weeks = [];
    days.forEach((d) => { (weeks[d.weekIndex] = weeks[d.weekIndex] || []).push(d); });
    const fresh = muscleFreshness(state, t);
    return html`<div class="h-screen">
      <${TopBar} title="Calendar" onBack=${onBack}/>
      <div class="h-pad">
        <div class="h-seg" role="radiogroup" aria-label="Schedule mode">
          <button role="radio" aria-checked=${!free} class=${cls(!free && "on")} onClick=${() => onSetMode("split")}>Suggested split</button>
          <button role="radio" aria-checked=${free} class=${cls(free && "on")} onClick=${() => onSetMode("free")}>Free schedule</button>
        </div>
        <div class="h-foot left">${free
          ? "No fixed days. Each day the app suggests whichever routine is most overdue for how often your split runs it. Tap any day to plan it yourself."
          : "Your 4-week rotation fills the calendar as suggestions, and a missed session slides to the next free day. Tap any day to override it — your plan always wins."}</div>

        <div class="h-cal">
          <div class="head">${["M", "T", "W", "T", "F", "S", "S"].map((d, i) => html`<span key=${i}>${d}</span>`)}</div>
          ${weeks.map((wk, wi) => html`<div class="wk" key=${wi}>
            ${wk.map((d) => html`<button key=${d.date}
                class=${cls("cell", "st-" + d.status, d.s.source === "planned" && "planned", d.isToday && "today", d.past && "past")}
                onClick=${() => setDayFor(d.date)} aria-label=${`${longDate(d.date)}: ${cellText(d) || "nothing planned"}`}>
              <span class="dn">${d0(d.date).getDate()}</span>
              <span class="lb">${cellText(d)}</span></button>`)}
          </div>`)}
        </div>
        <div class="h-legend">
          <span><i class="sw done"/>Done</span><span><i class="sw planned"/>Scheduled by you</span>
          <span><i class="sw sugg"/>Suggested</span><span><i class="sw missed"/>Not done</span>
        </div>

        ${!free && html`<div class="h-label">4-week rotation</div>
          <div class="h-group"><table class="h-cycle">
            <thead><tr><th>Wk</th><th>Tue</th><th>Thu</th><th>Sat</th><th>Sun</th></tr></thead>
            <tbody>${[1, 2, 3, 4].map((w) => {
              const s = E.SPLIT[w];
              return html`<tr key=${w} class=${state.cycleWeek === w ? "cur" : ""}><td>${w}</td>
                <td>${E.SESSIONS[s.A].label}</td><td>${E.SESSIONS[s.B].label}</td>
                <td>${E.SESSIONS[s.wknA].label}</td><td>${E.SESSIONS[s.wknB].label}</td></tr>`;
            })}</tbody></table></div>`}

        <div class="h-label">Muscle freshness</div>
        <div class="h-group">
          ${fresh.map((f) => html`<div class="h-statrow" key=${f.group}><span class="k">${f.group}</span>
            <span class=${cls("v", (f.days == null || f.days > 14) && "bad", f.days != null && f.days > 7 && f.days <= 14 && "warn")}>
              ${f.days == null ? "Never" : f.days === 0 ? "Today" : f.days + " days ago"}</span></div>`)}
        </div>
      </div>
      ${dayFor && html`<${ScheduleSheet} state=${state} date=${dayFor} onClose=${() => setDayFor(null)}
          onSet=${(d, k) => { setDayFor(null); onSetPlanned(d, k); }}
          onStart=${(k) => { setDayFor(null); onStart(k); }}
          onStartEmpty=${() => { setDayFor(null); onStartEmpty(); }}/>`}
    </div>`;
  }

  /* ============================================================== LOGGER */
  const RPE_OPTS = [{ value: "", label: "RPE" }].concat([6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10].map((v) => ({ value: String(v), label: String(v) })));
  const REST_OPTS = [0, 30, 45, 60, 75, 90, 120, 150, 180, 240, 300].map((v) => ({ value: String(v), label: "Rest Timer: " + restText(v) }));

  function mkSets(n, weight, reps) {
    return Array.from({ length: n }, (_, i) => ({
      weight: weight == null ? "" : String(weight), reps: "", rpe: "", done: false,
      target_reps: reps, rpe_required: i === n - 1,
    }));
  }
  const relabelLast = (sets) => sets.map((s, i) => Object.assign({}, s, { rpe_required: i === sets.length - 1 }));
  function entryFromLine(line, logs, extra) {
    return {
      uid: uid(), exercise: line.exercise, equipment: line.equipment,
      slot_label: line.slot_label, is_lateral_delt: !!line.is_lateral_delt, warmup: !!line.warmup,
      band: line.band, rest: line.rest_low || 90, prescribed: extra ? null : line.exercise,
      target_reps: line.target_reps, rep_low: line.rep_low, rep_high: line.rep_high,
      prescribed_weight: line.weight, sets_target: line.sets, cue: line.note || "", ai_cue: !!line.ai_cue,
      flags: line.flags || [], config_hint: line.config_hint || null, extra: !!extra,
      notes: "", station: "", prev: prevSets(line.exercise, logs),
      sets: mkSets(line.sets || 3, line.weight, line.target_reps),
    };
  }
  function newDraft(plan, logs) {
    return { plan, startedAt: Date.now(), entries: plan.items.map((l) => entryFromLine(l, logs, false)) };
  }
  const FLAG_TONE = { increase: "up", reps_bump: "up", freeze: "warn", forced_deload: "warn", deload: "warn", reentry: "warn", cap_hold: "", needs_input: "warn", estimated: "" };

  function Logger({ state, draft, onDraft, onDone, onDiscard, onMinimize, onOpenExercise, toast }) {
    const t = todayISO();
    const [plan, setPlan] = useState(draft.plan);
    const [entries, setEntries] = useState(draft.entries);
    const startedAt = draft.startedAt;
    const [rest, setRest] = useState(null);          // {endAt, total}
    const [picker, setPicker] = useState(null);      // {mode:"add"} | {mode:"swap", i}
    const [menuFor, setMenuFor] = useState(null);
    const [timerOpen, setTimerOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const [aiBusy, setAiBusy] = useState(false);
    const now = useNow(1000);

    useEffect(() => { onDraft({ plan, entries, startedAt }); }, [plan, entries]);

    const restLeft = rest ? Math.max(0, Math.ceil((rest.endAt - now) / 1000)) : 0;
    useEffect(() => {
      if (rest && restLeft <= 0) {
        setRest(null);
        try { navigator.vibrate && navigator.vibrate([180, 80, 180]); } catch (_) {}
      }
    }, [restLeft, rest]);
    const startRest = (sec) => { if (sec > 0) setRest({ endAt: Date.now() + sec * 1000, total: sec }); };
    const nudgeRest = (d) => setRest((r) => r && { endAt: r.endAt + d * 1000, total: Math.max(1, r.total + d) });

    const patchEntry = (i, patch) => setEntries((es) => es.map((e, j) => (j === i ? Object.assign({}, e, patch) : e)));
    const setField = (i, si, key, val) => setEntries((es) => es.map((e, j) => j !== i ? e : Object.assign({}, e, {
      sets: e.sets.map((s, k) => (k === si ? Object.assign({}, s, { [key]: val }) : s)),
    })));
    const toggleDone = (i, si) => {
      const e = entries[i], s = e.sets[si];
      const turningOn = !s.done;
      const fill = {};
      if (turningOn) {
        const p = e.prev[si];
        if (s.reps === "" || s.reps == null) fill.reps = String(s.target_reps || (p && p.reps) || "");
        if ((s.weight === "" || s.weight == null) && e.equipment !== "bodyweight" && p && p.weight != null) fill.weight = String(p.weight);
      }
      setEntries((es) => es.map((x, j) => j !== i ? x : Object.assign({}, x, {
        sets: x.sets.map((y, k) => (k === si ? Object.assign({}, y, fill, { done: turningOn }) : y)),
      })));
      if (turningOn) startRest(e.rest);
    };
    const copyPrev = (i, si) => {
      const p = entries[i].prev[si];
      if (!p) return;
      setEntries((es) => es.map((x, j) => j !== i ? x : Object.assign({}, x, {
        sets: x.sets.map((y, k) => (k === si ? Object.assign({}, y, { weight: p.weight == null ? "" : String(p.weight), reps: String(p.reps) }) : y)),
      })));
    };
    // Adding a set never renumbers earlier sets, so it can't read as a regression.
    const addSet = (i) => setEntries((es) => es.map((e, j) => {
      if (j !== i) return e;
      const last = e.sets[e.sets.length - 1] || {};
      return Object.assign({}, e, { sets: relabelLast(e.sets.concat([{ weight: last.weight == null ? "" : last.weight, reps: "", rpe: "", done: false, target_reps: e.target_reps }])) });
    }));
    const removeLastSet = (i) => setEntries((es) => es.map((e, j) => (j !== i || e.sets.length <= 1) ? e
      : Object.assign({}, e, { sets: relabelLast(e.sets.slice(0, -1)) })));
    const removeExercise = (i) => setEntries((es) => es.filter((_, j) => j !== i));
    const move = (i, d) => setEntries((es) => {
      const j = i + d; if (j < 0 || j >= es.length) return es;
      const c = es.slice(); const tmp = c[i]; c[i] = c[j]; c[j] = tmp; return c;
    });

    const swapAt = (i, name) => {
      const cur = entries[i];
      const line = repriceLine(state, name, { band: cur.band || bandFor(name, plan.kind), sets: cur.sets.length, slot_label: cur.slot_label, is_lateral_delt: cur.is_lateral_delt, warmup: cur.warmup });
      if (!line) { toast("Couldn't price that movement", "bad"); return; }
      const fresh = entryFromLine(line, state.logs, cur.extra);
      setEntries((es) => es.map((e, j) => j !== i ? e : Object.assign(fresh, {
        uid: e.uid, notes: e.notes, rest: e.rest, extra: e.extra,
        prescribed: e.prescribed, substituted_from: e.extra ? null : (e.substituted_from || e.prescribed),
      })));
      toast(`Swapped to ${name}`, "good");
    };
    const addExercise = (name) => {
      const line = repriceLine(state, name, { band: bandFor(name, plan.kind), sets: 3 });
      if (!line) return;
      setEntries((es) => es.concat([entryFromLine(line, state.logs, true)]));
    };

    const coach = async () => {
      const key = (Store.config().anthropicKey || "").trim();
      if (!key) return;
      setAiBusy(true);
      const reprice = (name, orig) => repriceLine(state, name, { band: orig.band, sets: orig.sets, slot_label: orig.slot_label, is_lateral_delt: orig.is_lateral_delt, warmup: orig.warmup });
      const out = await AI.enhance(plan, { apiKey: key, libByName: E.LIB_BY_NAME, reprice });
      setAiBusy(false);
      if (!out.changed) { toast(out.error ? "AI unavailable — kept the plan" : "No changes suggested", out.error ? "bad" : null); return; }
      const next = Object.assign({}, out.plan, { source: "claude" });
      setPlan(next);
      setEntries((es) => next.items.map((l) => entryFromLine(l, state.logs, false)).concat(es.filter((e) => e.extra)));
      try { await Store.savePrescription(t, next.session_key, next, "claude"); } catch (_) {}
      toast("Coached by Claude", "good");
    };

    const doneSets = entries.reduce((n, e) => n + e.sets.filter((s) => s.done).length, 0);
    const volume = entries.reduce((a, e) => a + e.sets.filter((s) => s.done)
      .reduce((b, s) => b + (parseFloat(s.weight) || 0) * (parseInt(s.reps, 10) || 0), 0), 0);
    const elapsed = Math.floor((now - startedAt) / 1000);
    const canCoach = (Store.config().anthropicKey || "").trim() && plan.items.length && plan.source !== "claude" && doneSets === 0;

    const finish = async () => {
      // A set counts if it was ticked or has reps typed in.
      const counted = (s) => s.done || parseInt(s.reps, 10) > 0;
      const missingRpe = [];
      entries.forEach((e) => {
        const logged = e.sets.filter(counted);
        if (!logged.length) return;
        const last = logged[logged.length - 1];
        if (last.rpe === "" || last.rpe == null) missingRpe.push(e.exercise);
      });
      if (missingRpe.length) { toast(`Add RPE to the last set of: ${missingRpe.join(", ")}`, "bad"); return; }
      const sessionKey = plan.session_key || "custom";
      const rows = [];
      entries.forEach((e) => {
        let ix = 0;
        e.sets.forEach((s) => {
          if (!counted(s)) return;
          const reps = parseInt(s.reps, 10) || parseInt(s.target_reps, 10) || 0;
          if (reps <= 0) return;
          const w = s.weight === "" || s.weight == null ? (e.equipment === "bodyweight" ? 0 : null) : parseFloat(s.weight);
          rows.push({
            exercise: e.exercise, weight: isFinite(w) ? w : null, reps,
            rpe: s.rpe === "" ? null : parseFloat(s.rpe), set_index: ix,
            station: (e.station || "").trim() || null,
            notes: ix === 0 ? (e.notes || "").trim() : "",
            date: t, session_type: sessionKey, week_of_cycle: state.cycleWeek, data_source: "logged",
          });
          ix += 1;
        });
      });
      if (!rows.length) { toast("Log at least one set — tick ✓ when a set is done", "bad"); return; }
      setSaving(true);
      try {
        const subs = entries.filter((e) => e.substituted_from).map((e) => ({ prescribed: e.substituted_from, performed: e.exercise }));
        const performed = entries.filter((e) => e.sets.some(counted)).map((e) => e.exercise);
        const anyMissing = plan.items.some((i) => !performed.includes(i.exercise) && !subs.some((x) => x.prescribed === i.exercise));
        const status = sessionKey === "custom" ? "free" : subs.length ? "substituted" : anyMissing ? "partial" : "as_prescribed";
        const start = (state.profile && state.profile.program_start) || t;
        const result = Game.sessionResult(state.logs || [], rows, { today: t, programStart: start });
        await Store.addLogs(rows);
        await Store.saveWorkout({
          date: t, session_key: sessionKey, status, substitutions: subs,
          note: anyMissing ? "Some prescribed movements were not logged" : "",
          duration_s: elapsed, started_at: new Date(startedAt).toISOString(), title: plan.session_label,
        });
        const nextWeek = E.maybeAdvanceCycle({ profile: state.profile, cycleWeek: state.cycleWeek }, t);
        if (nextWeek !== state.cycleWeek) await Store.setCycle(nextWeek);
        setSaving(false);
        onDone(result, t + "|" + sessionKey);
      } catch (err) {
        setSaving(false);
        toast("Save failed: " + (err.message || err) + " — your sets are still here", "bad");
      }
    };

    return html`<div class="h-logger">
      <header class="h-top logger">
        <button class="h-iconbtn" onClick=${onMinimize} aria-label="Minimise workout"><${Icon} d="chevDown" size=${28}/></button>
        <h1>Log Workout</h1>
        <div class="h-top-right">
          <button class=${cls("h-iconbtn", rest && "live")} onClick=${() => setTimerOpen(true)} aria-label="Rest timer"><${Icon} d="timer" size=${26}/></button>
          <button class="h-btn primary sm" onClick=${finish} disabled=${saving}>${saving ? html`<${Spinner}/>` : "Finish"}</button>
        </div>
      </header>
      <div class="h-logstats">
        <div><span class="k">Duration</span><span class="v blue">${dur(elapsed)}</span></div>
        <div><span class="k">Volume</span><span class="v">${num(volume)} kg</span></div>
        <div><span class="k">Sets</span><span class="v">${doneSets}</span></div>
        <div class="title">${plan.session_label}</div>
      </div>

      <div class="h-pad">
        ${(plan.banners || []).map((b, i) => html`<div class="h-note warn" key=${i}><${Icon} d="info" size=${15}/> ${b.text}</div>`)}
        ${canCoach && html`<button class="h-btn secondary block" onClick=${coach} disabled=${aiBusy}>
          ${aiBusy ? html`<${Spinner}/> Coaching…` : html`<${Icon} d="sparkle" size=${16}/> Coach this session with Claude`}</button>`}
        ${plan.source === "claude" && html`<div class="h-note"><${Icon} d="sparkle" size=${15}/> Cues refined by Claude. Loads and reps still come from your program's rules.</div>`}
        ${entries.length === 0 && html`<div class="h-empty small">
          <div class="big">Empty workout</div><div>Add exercises and log sets as you go. The app prices each one from your history.</div></div>`}

        ${entries.map((e, i) => {
          const lib = E.LIB_BY_NAME[e.exercise] || {};
          const tone = FLAG_TONE[(e.flags || [])[0]] || "";
          const bw = e.equipment === "bodyweight";
          const target = `${e.sets_target || e.sets.length} × ${e.target_reps}`
            + (e.prescribed_weight != null ? ` · ${e.prescribed_weight === 0 && bw ? "bodyweight" : e.prescribed_weight + " kg"}` : "");
          return html`<section class="h-logex" key=${e.uid}>
            <div class="hd">
              <${Thumb} name=${e.exercise} size=${44}/>
              <button class="nm" onClick=${() => onOpenExercise(e.exercise)}>${e.exercise}</button>
              <button class="h-iconbtn" onClick=${() => setMenuFor(i)} aria-label=${"Options for " + e.exercise}><${Icon} d="dotsV" size=${24} sw=${3}/></button>
            </div>
            ${e.substituted_from && html`<div class="h-sub">Swapped in for ${e.substituted_from}</div>`}
            <div class=${cls("h-cue", tone)}>
              ${e.ai_cue ? html`<${Icon} d="sparkle" size=${14}/>` : null}
              <span><b>Target ${target}</b>${e.cue ? " — " + e.cue : ""}</span></div>
            ${e.config_hint && html`<div class="h-note warn"><${Icon} d="alert" size=${14}/> ${e.config_hint}</div>`}
            ${e.warmup && i === 0 && html`<div class="h-note">Warm up first: two light ramp sets (~50%, then ~75%). Log working sets below.</div>`}
            <textarea class="h-notes" rows="1" placeholder="Add notes here..." value=${e.notes}
              onChange=${(ev) => patchEntry(i, { notes: ev.target.value })} aria-label=${"Notes for " + e.exercise}/>
            ${(e.equipment === "cable" || e.equipment === "machine") && html`
              <input class="h-station" placeholder="Station / machine (optional, e.g. left pulley)" value=${e.station}
                onChange=${(ev) => patchEntry(i, { station: ev.target.value })} aria-label="Station"/>`}
            <label class="h-resttimer">
              <${Icon} d="timer" size=${20}/>
              <span>Rest Timer: ${restText(e.rest)}</span>
              <select value=${String(e.rest)} onChange=${(ev) => patchEntry(i, { rest: parseInt(ev.target.value, 10) })} aria-label="Rest timer">
                ${REST_OPTS.map((o) => html`<option key=${o.value} value=${o.value}>${o.label}</option>`)}
              </select>
            </label>
            <div class="h-logtable" role="table" aria-label=${e.exercise + " sets"}>
              <div class="th" role="row"><span>SET</span><span>PREVIOUS</span><span>${bw ? "+KG" : "KG"}</span><span>REPS</span><span>RPE</span>
                <span><${Icon} d="check" size=${18} sw=${2.4}/></span></div>
              ${e.sets.map((s, si) => html`<div class=${cls("tr", s.done && "done", si % 2 === 1 && "alt")} role="row" key=${si}>
                <span class="ix">${si + 1}</span>
                <button class="prev" onClick=${() => copyPrev(i, si)} disabled=${!e.prev[si]} aria-label="Copy previous set">${fmtSet(e.prev[si], lib)}</button>
                <input class="cellin" inputMode="decimal" value=${s.weight} aria-label=${`Set ${si + 1} weight`}
                  placeholder=${bw ? "0" : (e.prev[si] && e.prev[si].weight != null ? String(e.prev[si].weight) : "—")}
                  onChange=${(ev) => setField(i, si, "weight", ev.target.value)}/>
                <input class="cellin" inputMode="numeric" value=${s.reps} placeholder=${String(s.target_reps || "")}
                  aria-label=${`Set ${si + 1} reps`} onChange=${(ev) => setField(i, si, "reps", ev.target.value)}/>
                <${PillSelect} label="RPE" value=${s.rpe} options=${RPE_OPTS}
                  className=${cls("rpe", s.rpe !== "" && "set", s.rpe_required && s.rpe === "" && s.done && "need")}
                  onChange=${(v) => setField(i, si, "rpe", v)}/>
                <button class=${cls("h-check", s.done && "on")} onClick=${() => toggleDone(i, si)}
                  aria-pressed=${s.done} aria-label=${`Set ${si + 1} done`}><${Icon} d="check" size=${20} sw=${2.6}/></button>
              </div>`)}
            </div>
            <div class="h-setfoot">Set 1 decides your next weight · RPE needed on the last set</div>
            <button class="h-btn tile block" onClick=${() => addSet(i)}><${Icon} d="plus" size=${18}/> Add Set</button>
          </section>`;
        })}

        <button class="h-btn primary block" onClick=${() => setPicker({ mode: "add" })}><${Icon} d="plus" size=${18}/> Add Exercise</button>
        <div class="h-twobtn">
          <button class="h-btn tile" onClick=${onMinimize}>Minimise</button>
          <button class="h-btn tile danger" onClick=${() => { if (confirm("Discard this workout? Nothing will be saved.")) onDiscard(); }}>Discard Workout</button>
        </div>
      </div>

      ${rest && html`<div class="h-restbar" role="timer" aria-live="off">
        <div class="fill" style=${{ width: (100 * restLeft / rest.total) + "%" }}/>
        <button class="h-textbtn" onClick=${() => nudgeRest(-15)}>−15</button>
        <span class="t">Rest ${Math.floor(restLeft / 60)}:${String(restLeft % 60).padStart(2, "0")}</span>
        <button class="h-textbtn" onClick=${() => nudgeRest(15)}>+15</button>
        <button class="h-btn primary sm" onClick=${() => setRest(null)}>Skip</button>
      </div>`}

      ${timerOpen && html`<${Sheet} title="Rest timer" onClose=${() => setTimerOpen(false)}>
        ${rest ? html`<div class="h-bigtime">${Math.floor(restLeft / 60)}:${String(restLeft % 60).padStart(2, "0")}</div>` : null}
        <div class="h-routinegrid">
          ${[60, 90, 120, 150, 180, 240].map((s) => html`<button key=${s} class="h-gridbtn" onClick=${() => { startRest(s); setTimerOpen(false); }}>${restText(s)}</button>`)}
        </div>
        ${rest && html`<button class="h-btn secondary block" onClick=${() => { setRest(null); setTimerOpen(false); }}>Stop timer</button>`}
      <//>`}

      ${menuFor != null && entries[menuFor] && html`<${Sheet} title=${entries[menuFor].exercise} onClose=${() => setMenuFor(null)}>
        <div class="h-menu">
          <button onClick=${() => { const i = menuFor; setMenuFor(null); setPicker({ mode: "swap", i }); }}><${Icon} d="swap" size=${20}/> Replace exercise</button>
          <button onClick=${() => { const n = entries[menuFor].exercise; setMenuFor(null); onOpenExercise(n); }}><${Icon} d="trend" size=${20}/> History & chart</button>
          <button onClick=${() => { move(menuFor, -1); setMenuFor(null); }} disabled=${menuFor === 0}><${Icon} d="back" size=${20} style=${{ transform: "rotate(90deg)" }}/> Move up</button>
          <button onClick=${() => { move(menuFor, 1); setMenuFor(null); }} disabled=${menuFor === entries.length - 1}><${Icon} d="back" size=${20} style=${{ transform: "rotate(-90deg)" }}/> Move down</button>
          <button onClick=${() => { removeLastSet(menuFor); setMenuFor(null); }} disabled=${entries[menuFor].sets.length <= 1}><${Icon} d="x" size=${20}/> Remove last set</button>
          <button class="danger" onClick=${() => { removeExercise(menuFor); setMenuFor(null); }}><${Icon} d="trash" size=${20}/> Remove exercise</button>
        </div>
      <//>`}

      ${picker && html`<${ExercisePicker} state=${state} autoFocus
        title=${picker.mode === "swap" ? "Replace Exercise" : "Add Exercise"}
        current=${picker.mode === "swap" ? entries[picker.i] && entries[picker.i].exercise : null}
        onClose=${() => setPicker(null)}
        onHistory=${(n) => { setPicker(null); onOpenExercise(n); }}
        onPick=${(n) => { const p = picker; setPicker(null); if (p.mode === "swap") swapAt(p.i, n); else addExercise(n); }}/>`}
    </div>`;
  }

  /* ============================================================= PROFILE */
  function ProfileScreen({ state, prefs, onOpen, onEditName }) {
    const t = todayISO();
    const start = (state.profile && state.profile.program_start) || t;
    const sum = useMemo(() => Game.summary(state.logs || [], { today: t, programStart: start }), [state.logs, t, start]);
    const weeks = useMemo(() => {
      const mon = E.mondayOf(t);
      const out = [];
      for (let i = 7; i >= 0; i--) {
        const wk = E.addDaysISO(mon, -7 * i), end = E.addDaysISO(wk, 6);
        const v = (state.logs || []).filter((l) => l.session_type !== "measurement" && l.session_type !== "baseline" && l.date >= wk && l.date <= end)
          .reduce((a, l) => a + (l.weight || 0) * (l.reps || 0), 0);
        out.push({ label: d0(wk).toLocaleDateString(undefined, { day: "numeric", month: "numeric" }), value: v, wk });
      }
      return out;
    }, [state.logs, t]);
    const thisWeekVol = weeks[weeks.length - 1].value;
    const tiles = [["exercises", "list", "Exercises"], ["measures", "ruler", "Measures"], ["calendar", "calendar", "Calendar"], ["settings", "gear", "Settings"]];
    return html`<div class="h-screen">
      <${TopBar} big title="Profile" right=${html`<button class="h-iconbtn" onClick=${() => onOpen("settings")} aria-label="Settings"><${Icon} d="gear" size=${26}/></button>`}/>
      <div class="h-pad">
        <div class="h-prohead">
          <${CharacterAvatar} level=${sum.level} size=${84} glow=${false}/>
          <div class="txt">
            ${prefs.display_name ? html`<div class="nm">${prefs.display_name}</div>`
              : html`<button class="h-textbtn" onClick=${onEditName}>Add your name</button>`}
            <div class="lv">Level ${sum.level} · ${sum.title} · <span style=${{ color: sum.color }}>${sum.tierName}</span></div>
            <div class="h-xp"><i style=${{ width: (sum.pct * 100) + "%", background: sum.color }}/></div>
            <div class="xpt">${sum.into} / ${sum.span} XP to level ${sum.level + 1}</div>
          </div>
        </div>
        <div class="h-prostats">
          <div><span class="k">Workouts</span><span class="v">${sum.sessionsCompleted}</span></div>
          <div><span class="k">Week streak</span><span class="v">${sum.streak}</span></div>
          <div><span class="k">PRs</span><span class="v">${sum.totalPRs}</span></div>
          <div><span class="k">Perfect weeks</span><span class="v">${sum.perfectWeeks}</span></div>
        </div>
        <div class="h-card">
          <div class="h-labelrow tight"><span class="h-label tight">This week</span>
            <span class="muted">${sum.week.raw} of ${sum.week.target} sessions</span></div>
          <div class="h-pips">${Array.from({ length: sum.week.target }, (_, i) => html`<i key=${i} class=${i < sum.week.raw ? "on" : ""}/>`)}</div>
          <div class="h-labelrow tight"><span class="h-label tight">Volume per week</span><span class="muted">${num(thisWeekVol, 0)} kg this week</span></div>
          <${WeekBars} weeks=${weeks}/>
        </div>
        <div class="h-label">Dashboard</div>
        <div class="h-tiles">
          ${tiles.map(([k, ic, l]) => html`<button key=${k} class="h-tile" onClick=${() => onOpen(k)}><${Icon} d=${ic} size=${24}/><span>${l}</span></button>`)}
        </div>
      </div>
    </div>`;
  }

  /* ============================================================ MEASURES */
  function MeasuresScreen({ toast, onBack }) {
    const [rows, setRows] = useState(null);
    const [form, setForm] = useState({ bw: "", bf: "" });
    const reload = useCallback(async () => setRows(await Store.getMeasurements()), []);
    useEffect(() => { reload(); }, [reload]);
    const save = async () => {
      const bw = form.bw ? parseFloat(form.bw) : null, bf = form.bf ? parseFloat(form.bf) : null;
      if (bw == null && bf == null) { toast("Enter body weight or body fat", "bad"); return; }
      if (bw != null && (!isFinite(bw) || bw <= 0 || bw > 700)) { toast("Enter a weight in kg between 1 and 700", "bad"); return; }
      if (bf != null && (!isFinite(bf) || bf <= 0 || bf > 100)) { toast("Body fat must be between 0 and 100%", "bad"); return; }
      await Store.addMeasurement({ date: todayISO(), bodyweight_kg: bw, bodyfat_pct: bf, notes: "" });
      setForm({ bw: "", bf: "" }); await reload(); toast("Measurement saved", "good");
    };
    const data = (rows || []).filter((r) => r.bodyweight_kg != null || r.bodyfat_pct != null)
      .slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const wt = data.filter((r) => r.bodyweight_kg != null).map((r) => ({ date: r.date, value: Number(r.bodyweight_kg) }));
    const bf = data.filter((r) => r.bodyfat_pct != null).map((r) => ({ date: r.date, value: Number(r.bodyfat_pct) }));
    const [which, setWhich] = useState("wt");
    return html`<div class="h-screen">
      <${TopBar} title="Measures" onBack=${onBack}/>
      <div class="h-pad">
        <div class="h-card">
          <div class="h-two">
            <label class="h-field"><span>Body weight (kg)</span><input inputMode="decimal" value=${form.bw} onChange=${(e) => setForm({ ...form, bw: e.target.value })}/></label>
            <label class="h-field"><span>Body fat (%)</span><input inputMode="decimal" value=${form.bf} onChange=${(e) => setForm({ ...form, bf: e.target.value })}/></label>
          </div>
          <button class="h-btn primary block" onClick=${save}>Save today</button>
        </div>
        <div class="h-chips">
          <button class=${cls("h-chip", which === "wt" && "on")} onClick=${() => setWhich("wt")}>Body weight</button>
          <button class=${cls("h-chip", which === "bf" && "on")} onClick=${() => setWhich("bf")}>Body fat</button>
        </div>
        <${LineChart} points=${which === "wt" ? wt : bf} unit=${which === "wt" ? "kg" : "%"}/>
        ${data.length > 0 && html`<div class="h-label">History</div>
          <div class="h-group">${data.slice().reverse().map((r, i) => html`<div class="h-statrow" key=${i}>
            <span class="k">${shortDate(r.date)} ${d0(r.date).getFullYear()}</span>
            <span class="v">${[r.bodyweight_kg != null && `${r.bodyweight_kg} kg`, r.bodyfat_pct != null && `${r.bodyfat_pct}%`].filter(Boolean).join(" · ")}</span></div>`)}</div>`}
      </div>
    </div>`;
  }

  /* ============================================================ SETTINGS */
  function SettingsScreen({ state, prefs, mode, refresh, toast, onReseed, onBack, onSetMode }) {
    const cfg = Store.config();
    const [name, setName] = useState(prefs.display_name || "");
    const [url, setUrl] = useState(cfg.supabaseUrl || "");
    const [key, setKey] = useState(cfg.supabaseKey || "");
    const [aiKey, setAiKey] = useState(cfg.anthropicKey || "");
    const [start, setStart] = useState((state.profile && state.profile.program_start) || cfg.programStart || todayISO());
    const [status, setStatus] = useState(null);
    const [busy, setBusy] = useState(false);
    const fileRef = useRef(null);
    const free = state.scheduleMode === "free";

    const saveName = async () => { const r = await Store.savePrefs({ display_name: name.trim() }); await refresh(); toast(r.synced ? "Name saved" : "Name saved on this device — run the schema migration to sync it", "good"); };
    const connect = async () => {
      if (!url.trim() || !key.trim()) { toast("Paste both the project URL and the anon key", "bad"); return; }
      setBusy(true);
      const { status } = await Store.connect(url, key);
      if (status.ok) await Store.seedIfEmpty({ programStart: start });
      setStatus(status); setBusy(false);
      if (status.ok) { toast("Connected & synced", "good"); refresh(); }
      else toast("Couldn't connect — check the URL and key, and that schema.sql ran", "bad");
    };
    const disconnect = async () => { await Store.disconnect(); setStatus(null); toast("Disconnected — this device only", null); refresh(); };
    const saveAi = () => { Store.saveConfig({ anthropicKey: aiKey.trim() }); toast(aiKey.trim() ? "AI key saved on this device" : "AI key cleared", "good"); };
    const saveStart = async () => { Store.saveConfig({ programStart: start }); await Store.upsertProfile({ program_start: start }); toast("Program start updated", "good"); refresh(); };
    const exportData = async () => { const d = await Store.exportAll(); download(`gym-backup-${todayISO()}.json`, JSON.stringify(d, null, 2)); };
    const importData = async (file) => {
      try { const d = JSON.parse(await file.text()); await Store.importAll(d); toast("Backup imported", "good"); refresh(); }
      catch (e) { toast("Import failed: " + e.message, "bad"); }
    };
    const reset = async () => {
      if (!confirm("Erase all logs, measurements, schedules and prescriptions, and reset to week 1? Seed data will be restored.")) return;
      await Store.clearAll(); await onReseed(); toast("Reset done", "good"); refresh();
    };

    return html`<div class="h-screen">
      <${TopBar} title="Settings" onBack=${onBack}/>
      <div class="h-pad">
        <div class="h-label first">Profile</div>
        <div class="h-card">
          <label class="h-field"><span>Name shown on your workouts</span><input value=${name} onChange=${(e) => setName(e.target.value)} placeholder="e.g. primeduck"/></label>
          <button class="h-btn secondary block" onClick=${saveName}>Save name</button>
        </div>

        <div class="h-label">Scheduling</div>
        <div class="h-card">
          <div class="h-seg" role="radiogroup" aria-label="Schedule mode">
            <button role="radio" aria-checked=${!free} class=${cls(!free && "on")} onClick=${() => onSetMode("split")}>Suggested split</button>
            <button role="radio" aria-checked=${free} class=${cls(free && "on")} onClick=${() => onSetMode("free")}>Free schedule</button>
          </div>
          <div class="h-foot left">Either way the app only suggests. You can start any routine, or an empty workout, on any day, and anything you schedule yourself overrides the suggestion.</div>
        </div>

        <div class="h-label">Sync (Supabase)</div>
        <div class="h-card">
          <div class="h-statrow"><span class="k">Status</span><span class=${cls("v", mode === "cloud" ? "good" : "warn")}>${mode === "cloud" ? "Synced" : "This device only"}</span></div>
          <label class="h-field"><span>Project URL</span><input placeholder="https://xxxx.supabase.co" value=${url} onChange=${(e) => setUrl(e.target.value)}/></label>
          <label class="h-field"><span>Anon public key</span><input placeholder="eyJ…" value=${key} onChange=${(e) => setKey(e.target.value)}/></label>
          <div class="h-twobtn">
            <button class="h-btn primary" onClick=${connect} disabled=${busy}>${busy ? html`<${Spinner}/> Connecting…` : "Connect & sync"}</button>
            ${mode === "cloud" && html`<button class="h-btn tile danger" onClick=${disconnect}>Disconnect</button>`}
          </div>
          ${status && html`<div class=${cls("h-foot left", status.ok ? "good" : "bad")}>${status.detail}</div>`}
          <div class="h-foot left">Run <b>schema.sql</b> in the Supabase SQL editor (including the new migration at the bottom), then paste the Project URL and anon key from Settings → API.</div>
        </div>

        <div class="h-label">AI coaching (optional)</div>
        <div class="h-card">
          <label class="h-field"><span>Anthropic API key</span><input type="password" placeholder="sk-ant-…" value=${aiKey} onChange=${(e) => setAiKey(e.target.value)}/></label>
          <button class="h-btn secondary block" onClick=${saveAi}>Save key</button>
          <div class="h-foot left">Stored only on this device. Adds a “Coach this session” button to the logger. Loads and reps always come from the program's rules.</div>
        </div>

        <div class="h-label">Program</div>
        <div class="h-card">
          <div class="h-statrow"><span class="k">Cycle week</span><span class="v">${state.cycleWeek} / 4</span></div>
          <label class="h-field"><span>Program start date</span><input type="date" value=${start} onChange=${(e) => setStart(e.target.value)}/></label>
          <button class="h-btn secondary block" onClick=${saveStart}>Update start date</button>
          <div class="h-foot left">Drives the re-entry ramp (first 2 weeks hold weight) and deload timing.</div>
        </div>

        <div class="h-label">Data</div>
        <div class="h-card">
          <button class="h-btn secondary block" onClick=${exportData}>Export backup (.json)</button>
          <button class="h-btn secondary block" onClick=${() => fileRef.current.click()}>Import backup</button>
          <input ref=${fileRef} type="file" accept="application/json" hidden onChange=${(e) => e.target.files[0] && importData(e.target.files[0])}/>
          <button class="h-btn tile danger block" onClick=${reset}>Reset all training data</button>
        </div>
        <div class="h-foot">Iron Console runs your program as exact rules. Claude is an optional coaching layer that can't change your numbers.</div>
      </div>
    </div>`;
  }

  /* ========================================================= ONBOARDING */
  function Onboarding({ onLocal, onCloud }) {
    return html`<div class="h-app"><div class="h-screen">
      <${TopBar} big title="Iron Console"/>
      <div class="h-pad">
        <p class="h-lede">Your V-taper program, logged set by set. Pick where your data lives — you can change it later in Settings.</p>
        <div class="h-card">
          <div class="h-cardtitle">Sync across devices</div>
          <div class="h-foot left">Recommended. Connect a free Supabase project (run schema.sql once, then paste its URL and anon key).</div>
          <button class="h-btn primary block" onClick=${onCloud}>Set up sync</button>
        </div>
        <div class="h-card">
          <div class="h-cardtitle">Just this device</div>
          <div class="h-foot left">Start now. Your data stays in this browser until you connect sync.</div>
          <button class="h-btn secondary block" onClick=${onLocal}>Start on this device</button>
        </div>
      </div>
    </div></div>`;
  }

  /* ====================================================== SESSION RESULT */
  function SessionResult({ result: r, onClose, onView }) {
    const [show, setShow] = useState(false);
    useEffect(() => { const id = setTimeout(() => setShow(true), 30); return () => clearTimeout(id); }, []);
    return html`<div class="h-overlay center" onClick=${onClose}>
      <div class=${cls("h-result", show && "in")} role="dialog" aria-modal="true" aria-label="Workout saved" onClick=${(e) => e.stopPropagation()}>
        <${CharacterAvatar} level=${r.newLevel} size=${104}/>
        ${r.leveledUp
          ? html`<div class="lvlup">Level up</div><div class="lvl">Level ${r.before.level} → <b>${r.newLevel}</b></div>
                 <div class="ttl" style=${{ color: r.tierColor }}>${r.newTitle} · ${r.newTierName}</div>`
          : html`<div class="lvl">Level ${r.newLevel} · <span style=${{ color: r.tierColor }}>${r.newTitle}</span></div>`}
        <div class="xp">+${r.earned} XP</div>
        <div class="h-xp big"><i style=${{ width: (r.after.pct * 100) + "%", background: r.tierColor }}/></div>
        <div class="sub">${r.after.into} / ${r.after.span} to next level</div>
        <div class="chips">
          <span class="chip"><${Icon} d="check" size=${14}/> ${r.setsLogged} sets</span>
          ${r.prCount > 0 && html`<span class="chip pr"><${Icon} d="trophy" size=${14}/> ${r.prCount} PR${r.prCount > 1 ? "s" : ""}</span>`}
          ${r.streak > 0 && html`<span class="chip fire"><${Icon} d="fire" size=${14}/> ${r.streak} week streak</span>`}
        </div>
        ${r.perfectWeek && html`<div class="perfect"><${Icon} d="star" size=${15}/> Perfect week — 4 sessions! +250 XP</div>`}
        ${r.prNames && r.prNames.length > 0 && html`<div class="prs">New PR${r.prNames.length > 1 ? "s" : ""}: ${r.prNames.slice(0, 3).join(", ")}</div>`}
        <button class="h-btn primary block" onClick=${onView}>View workout</button>
        <button class="h-textbtn" onClick=${onClose}>Done</button>
      </div>
    </div>`;
  }

  /* ============================================================ MINI BAR */
  function MiniBar({ draft, onResume }) {
    const now = useNow(1000);
    return html`<button class="h-minibar" onClick=${onResume}>
      <span class="dot"/><span class="t">${draft.plan.session_label}</span>
      <span class="d">${dur(Math.floor((now - draft.startedAt) / 1000))}</span>
      <span class="r">Resume</span></button>`;
  }

  /* ================================================================= APP */
  const DRAFT_KEY = "gym:draft";
  const loadDraft = () => { try { return JSON.parse(localStorage.getItem(DRAFT_KEY)); } catch (_) { return null; } };
  const saveDraft = (d) => { try { d ? localStorage.setItem(DRAFT_KEY, JSON.stringify(d)) : localStorage.removeItem(DRAFT_KEY); } catch (_) {} };
  function freeTitle() {
    const h = new Date().getHours();
    return (h < 12 ? "Morning" : h < 17 ? "Afternoon" : "Evening") + " workout";
  }

  function App() {
    const [ready, setReady] = useState(false);
    const [needsSetup, setNeedsSetup] = useState(false);
    const [mode, setMode] = useState("local");
    const [state, setState] = useState(null);
    const [tab, setTab] = useState("home");
    const [routes, setRoutes] = useState([]);
    const [session, setSession] = useState(null);   // live workout draft
    const [minimized, setMinimized] = useState(false);
    const [result, setResult] = useState(null);     // {res, id}
    const [likes, setLikes] = useState(() => Store.config().likes || {});
    const [toastNode, toast] = useToast();

    const refresh = useCallback(async () => { setState(await Store.loadState()); }, []);
    const reseed = useCallback(async () => { await Store.seedIfEmpty(); await refresh(); }, [refresh]);

    useEffect(() => {
      (async () => {
        const m = await Store.init();
        const cfg = Store.config();
        setMode(m);
        if (!(cfg.supabaseUrl && cfg.supabaseKey) && !cfg.startedLocal) { setNeedsSetup(true); setReady(true); return; }
        await Store.seedIfEmpty();
        await refresh();
        const d = loadDraft();
        if (d && d.plan && Array.isArray(d.entries)) { setSession(d); setMinimized(true); }
        setReady(true);
      })().catch((err) => { console.error(err); toast("Couldn't load your data: " + (err.message || err), "bad"); setReady(true); });
    }, [refresh]);

    const push = useCallback((r) => { setRoutes((rs) => rs.concat([r])); window.scrollTo(0, 0); }, []);
    const pop = useCallback(() => setRoutes((rs) => rs.slice(0, -1)), []);
    const openExercise = useCallback((ex) => push({ name: "exercise", ex }), [push]);
    const goTab = (k) => { setRoutes([]); setTab(k); window.scrollTo(0, 0); };

    const prefs = (state && state.prefs) || { display_name: "", schedule_mode: "split" };
    const workouts = useMemo(() => (state ? buildWorkouts(state) : []), [state && state.logs, state && state.meta]);

    const begin = (plan) => {
      const d = newDraft(plan, state.logs);
      saveDraft(d); setSession(d); setMinimized(false); setRoutes([]); window.scrollTo(0, 0);
    };
    const guardBusy = () => {
      if (!session) return false;
      toast("Finish or discard the workout in progress first", "bad");
      setMinimized(false); setRoutes([]);
      return true;
    };
    const startRoutine = async (key) => {
      if (guardBusy()) return;
      const t = todayISO();
      let plan = null;
      try { const c = await Store.getPrescription(t); if (c && c.payload && c.payload.session_key === key) plan = c.payload; } catch (_) {}
      if (!plan) {
        plan = E.buildSession(key, state, { todayISO: t });
        try { await Store.savePrescription(t, key, plan, "engine"); } catch (_) {}
      }
      begin(plan);
    };
    const startEmpty = () => {
      if (guardBusy()) return;
      begin({ session_key: "custom", session_label: freeTitle(), kind: "free", items: [], banners: [], date: todayISO() });
    };
    const setPlanned = async (date, key) => {
      const r = await Store.setPlanned(date, key);
      await refresh();
      const msg = !key ? "Back to the app's suggestion" : key === "rest" ? `Rest day set for ${wdayLong(date)}` : `${E.SESSIONS[key].label} scheduled for ${wdayLong(date)}`;
      toast(msg + (r.synced ? "" : " (this device — run the migration to sync)"), "good");
    };
    const setSchedMode = async (m) => {
      const r = await Store.savePrefs({ schedule_mode: m });
      await refresh();
      toast((m === "free" ? "Free schedule on" : "Suggested split on") + (r.synced ? "" : " (this device)"), "good");
    };
    const toggleLike = (id) => {
      const next = Object.assign({}, likes);
      if (next[id]) delete next[id]; else next[id] = true;
      setLikes(next); Store.saveConfig({ likes: next });
    };

    if (!ready) return html`<div class="h-app"><div class="h-empty"><${Spinner}/><div>Loading…</div></div></div>`;
    if (needsSetup) {
      return html`<${Onboarding}
        onLocal=${async () => { Store.saveConfig({ startedLocal: true }); await Store.seedIfEmpty(); await refresh(); setNeedsSetup(false); }}
        onCloud=${async () => { Store.saveConfig({ startedLocal: true }); await Store.seedIfEmpty(); await refresh(); setNeedsSetup(false); setTab("profile"); setRoutes([{ name: "settings" }]); }}/>`;
    }
    if (!state) return html`<div class="h-app"><div class="h-empty"><${Spinner}/></div>${toastNode}</div>`;

    const top = routes[routes.length - 1];
    const loggerShown = !!session && !minimized && !top;
    const navShown = !session || minimized;

    const renderRoute = (r) => {
      switch (r.name) {
        case "exercise": return html`<${ExerciseHistory} key=${r.ex} state=${state} name=${r.ex} onBack=${pop} onOpen=${openExercise}/>`;
        case "workout": {
          const w = workouts.find((x) => x.id === r.id);
          return html`<${WorkoutDetail} state=${state} w=${w} prefs=${prefs} liked=${!!(w && likes[w.id])}
            onLike=${() => w && toggleLike(w.id)} onBack=${pop} onOpenExercise=${openExercise} toast=${toast}/>`;
        }
        case "calendar": return html`<${CalendarScreen} state=${state} onBack=${pop} onSetPlanned=${setPlanned}
            onSetMode=${setSchedMode} onStart=${startRoutine} onStartEmpty=${startEmpty}/>`;
        case "exercises": return html`<${ExercisePicker} state=${state} title="Exercises" onClose=${pop}
            onPick=${openExercise} onHistory=${openExercise}/>`;
        case "measures": return html`<${MeasuresScreen} toast=${toast} onBack=${pop}/>`;
        case "settings": return html`<${SettingsScreen} state=${state} prefs=${prefs} mode=${mode} toast=${toast}
            onReseed=${reseed} onBack=${pop} onSetMode=${setSchedMode}
            refresh=${async () => { setMode(Store.mode()); await refresh(); }}/>`;
        default: return null;
      }
    };
    const renderTab = () => {
      if (tab === "workout") return html`<${WorkoutScreen} state=${state} mode=${mode} onStart=${startRoutine}
          onStartEmpty=${startEmpty} onSetPlanned=${setPlanned} onOpenCalendar=${() => push({ name: "calendar" })}
          onOpenExercise=${openExercise}/>`;
      if (tab === "profile") return html`<${ProfileScreen} state=${state} prefs=${prefs}
          onOpen=${(k) => push({ name: k })} onEditName=${() => push({ name: "settings" })}/>`;
      return html`<${HomeScreen} state=${state} workouts=${workouts} prefs=${prefs} likes=${likes} onLike=${toggleLike}
          onOpen=${(id) => push({ name: "workout", id })} onBrowse=${() => push({ name: "exercises" })}
          onGoWorkout=${() => goTab("workout")} toast=${toast}/>`;
    };
    const navItems = [["home", "home", "Home"], ["workout", "dumbbell", "Workout"], ["profile", "user", "Profile"]];

    return html`
      <div class=${cls("h-app", navShown && "with-nav", session && minimized && "with-mini")}>
        ${session && html`<div hidden=${!loggerShown}>
          <${Logger} key=${session.startedAt} state=${state} draft=${session} toast=${toast}
            onDraft=${(d) => saveDraft(d)}
            onMinimize=${() => { setMinimized(true); window.scrollTo(0, 0); }}
            onOpenExercise=${openExercise}
            onDiscard=${() => { saveDraft(null); setSession(null); setMinimized(false); toast("Workout discarded", null); }}
            onDone=${async (res, id) => {
              saveDraft(null); setSession(null); setMinimized(false);
              await refresh(); setRoutes([]); setTab("home"); window.scrollTo(0, 0);
              setResult({ res, id });
            }}/>
        </div>`}
        ${!loggerShown && (top ? renderRoute(top) : renderTab())}
      </div>
      ${session && minimized && html`<${MiniBar} draft=${session} onResume=${() => { setRoutes([]); setMinimized(false); window.scrollTo(0, 0); }}/>`}
      ${navShown && html`<nav class="h-nav" aria-label="Main">
        ${navItems.map(([id, ic, label]) => html`<button key=${id} class=${cls(tab === id && !top && "on", tab === id && "cur")}
            aria-current=${tab === id ? "page" : null} onClick=${() => goTab(id)}>
          <${Icon} d=${ic} size=${28}/><span>${label}</span></button>`)}
      </nav>`}
      ${result && html`<${SessionResult} result=${result.res} onClose=${() => setResult(null)}
          onView=${() => { const id = result.id; setResult(null); push({ name: "workout", id }); }}/>`}
      ${toastNode}`;
  }

  ReactDOM.createRoot(document.getElementById("root")).render(html`<${App}/>`);
})();
