/* ============================================================================
   app.js — the UI (React 18 + htm, no build step).
   Screens: Today (pre-session §15a) → Live logging (§15b); Progress (§13);
   History; Settings / onboarding. Reads plans from the deterministic engine,
   persists through the store, and optionally polishes a session with Claude.
   ========================================================================== */
(function () {
  "use strict";
  const { useState, useEffect, useMemo, useRef, useCallback } = React;
  const html = htm.bind(React.createElement);
  const E = window.GymEngine, Store = window.GymStore, AI = window.GymAI;

  /* ------------------------------------------------------------------ utils */
  const todayISO = () => E.toISO(new Date());
  const cls = (...xs) => xs.filter(Boolean).join(" ");
  function fmtDate(iso) {
    const d = new Date(iso + "T00:00:00");
    return d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  }
  function shortDate(iso) {
    const d = new Date(iso + "T00:00:00");
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  function download(name, text) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    a.download = name; a.click(); URL.revokeObjectURL(a.href);
  }
  // Rebuild the engine context for ad-hoc single-lift pricing (swaps / add-exercise).
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
  function repriceLine(state, exerciseName, slotMeta) {
    const lib = E.LIB_BY_NAME[exerciseName];
    if (!lib) return null;
    const band = slotMeta.band || "isolation";
    const sets = slotMeta.sets || 3;
    const line = E.prescribe(lib, band, sets, state.logs || [], makeCtx(state));
    line.slot_label = slotMeta.slot_label || lib.primary;
    line.is_lateral_delt = !!slotMeta.is_lateral_delt;
    line.warmup = !!slotMeta.warmup;
    const grip = E.gripAdvisory ? null : null; void grip;
    return line;
  }

  /* ------------------------------------------------------------------ icons */
  const P = {
    today: "M6 2v3M18 2v3M3 8h18M5 5h14a2 2 0 012 2v12a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2z",
    chart: "M4 19V5M4 19h16M8 16v-5M12 16V8M16 16v-3M20 16v-7",
    history: "M3 12a9 9 0 109-9 9 9 0 00-7 3.3M3 4v4h4M12 7v5l3 2",
    gear: "M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 13a7.9 7.9 0 000-2l2-1.6-2-3.4-2.4 1a8 8 0 00-1.7-1l-.4-2.6H9.1l-.4 2.6a8 8 0 00-1.7 1l-2.4-1-2 3.4L2.6 11a7.9 7.9 0 000 2l-2 1.6 2 3.4 2.4-1a8 8 0 001.7 1l.4 2.6h4.8l.4-2.6a8 8 0 001.7-1l2.4 1 2-3.4z",
    swap: "M7 4l-4 4 4 4M3 8h13a4 4 0 014 4M17 20l4-4-4-4M21 16H8a4 4 0 01-4-4",
    check: "M5 12l5 5L20 6",
    info: "M12 8h.01M11 12h1v5h1M12 3a9 9 0 100 18 9 9 0 000-18z",
    bolt: "M13 2L3 14h7l-1 8 10-12h-7z",
    plus: "M12 5v14M5 12h14",
    flag: "M5 21V4M5 4h11l-2 4 2 4H5",
    sparkle: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z",
    clock: "M12 7v5l3 2M12 3a9 9 0 100 18 9 9 0 000-18z",
  };
  const Icon = ({ d, size = 22, stroke = "currentColor", fill = "none", style }) =>
    html`<svg width=${size} height=${size} viewBox="0 0 24 24" fill=${fill} stroke=${stroke}
            stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" style=${style}>
      <path d=${P[d] || d}/></svg>`;

  const Spinner = () => html`<span class="g-spinner"/>`;

  /* ------------------------------------------------------------------ toast */
  function useToast() {
    const [toast, setToast] = useState(null);
    const show = useCallback((msg, kind) => {
      setToast({ msg, kind });
      clearTimeout(show._t); show._t = setTimeout(() => setToast(null), 2600);
    }, []);
    const node = toast && html`<div class=${cls("g-toast", toast.kind)}>${toast.msg}</div>`;
    return [node, show];
  }

  /* ============================================================ readout card */
  function ReadoutCard({ line, onSwap }) {
    const flag = (line.flags && line.flags[0]) || "work";
    const tagText = {
      work: "Work", increase: "Go heavier", reps_bump: "Add reps", freeze: "Hold",
      cap_hold: "Hold 1", reentry: "Re-entry", deload: "Deload", forced_deload: "Reset",
      estimated: "Calibrate", needs_input: "Set start",
    }[flag] || flag;
    const bw = line.equipment === "bodyweight" || line.weight == null && line.flags.includes("needs_input");
    const weightText = line.weight == null ? (line.flags.includes("needs_input") ? "?" : "BW")
      : (line.equipment === "bodyweight" && line.weight === 0 ? "BW" : line.weight);
    const showUnit = typeof weightText === "number";
    return html`
      <div class="g-card" data-flag=${flag}>
        <div class="accent"/>
        <div class="slotrow">
          <span class="slotlabel">${line.slot_label}${line.is_lateral_delt ? " · fixed" : ""}</span>
          <span class=${cls("g-tag", flag)}>${tagText}</span>
        </div>
        <div class="exname">${line.exercise}</div>
        <div class="g-readout">
          <div class=${cls("g-weight", showUnit ? "" : "bw")}>
            <span class="num">${weightText}</span>
            ${showUnit && html`<span class="unit">kg</span>`}
          </div>
          <div class="g-subreadouts">
            <div class="g-metric"><span class="v">${line.sets}×${line.target_reps}</span><span class="k">sets · reps</span></div>
            <div class="g-metric"><span class="v">${line.rest_low}-${line.rest_high}</span><span class="k">rest (s)</span></div>
          </div>
        </div>
        ${line.note && html`<div class=${cls("g-note", line.ai_cue && "ai")}>
          <span class="ic">${html`<${Icon} d=${line.ai_cue ? "sparkle" : "bolt"} size=${16}/>`}</span>
          <span>${line.note}</span></div>`}
        ${line.last_time && html`<div class="g-lasttime">Last time · ${line.last_time.summary}</div>`}
        <div class="cardactions">
          <button class="g-btn ghost sm" onClick=${() => onSwap(line)}>
            <${Icon} d="flag" size=${15}/> Flag / swap
          </button>
        </div>
      </div>`;
  }

  /* ============================================================ swap modal */
  function SwapModal({ state, line, onClose, onPick }) {
    const lib = E.LIB_BY_NAME[line.exercise] || {};
    const roleAlts = (lib.alts || []).filter((n) => E.LIB_BY_NAME[n]);
    // also offer same-primary-muscle movements as broader options
    const more = E.LIBRARY
      .filter((e) => e.name !== line.exercise && e.primary === lib.primary && !roleAlts.includes(e.name))
      .filter((e) => !line.is_lateral_delt || e.lateral_delt)
      .slice(0, 4).map((e) => e.name);
    const options = roleAlts.concat(more);
    return html`
      <div class="g-overlay" onClick=${onClose}>
        <div class="g-modal" onClick=${(e) => e.stopPropagation()}>
          <h3>Swap movement</h3>
          <div class="g-help">Machine taken or unavailable? Pick an equivalent — the app re-prices it to the right load for you.</div>
          <div class="g-chiprow">
            ${options.map((n) => html`<button key=${n} class="g-chip" onClick=${() => onPick(n)}>${n}</button>`)}
          </div>
          <button class="g-btn block ghost" onClick=${onClose}>Keep ${line.exercise}</button>
        </div>
      </div>`;
  }

  /* ============================================================ TODAY screen */
  function TodayScreen({ state, refresh, toast, onStart }) {
    const t = todayISO();
    const planned = E.plannedForDate(t, state.cycleWeek);
    const [plan, setPlan] = useState(null);
    const [busy, setBusy] = useState(false);
    const [swap, setSwap] = useState(null);
    const [aiBusy, setAiBusy] = useState(false);
    const builtFor = useRef(null);

    // Build (or load cached) plan for training days.
    useEffect(() => {
      if (!planned.session) { setPlan(null); return; }
      if (builtFor.current === t && plan) return;
      let alive = true;
      (async () => {
        const cached = await Store.getPrescription(t);
        if (cached && cached.payload && cached.payload.session_key === planned.session) {
          if (alive) { setPlan(cached.payload); builtFor.current = t; }
          return;
        }
        const p = E.buildSession(planned.session, state, { todayISO: t });
        await Store.savePrescription(t, planned.session, p, "engine");
        if (alive) { setPlan(p); builtFor.current = t; }
      })();
      return () => { alive = false; };
    }, [t, planned.session, state.cycleWeek, state.logs.length]);

    const doSwap = useCallback(async (name) => {
      const line = swap;
      const idx = plan.items.findIndex((x) => x === line);
      const slotMeta = { band: line.band, sets: line.sets, slot_label: line.slot_label, is_lateral_delt: line.is_lateral_delt, warmup: line.warmup };
      const repriced = repriceLine(state, name, slotMeta);
      setSwap(null);
      if (!repriced || idx < 0) return;
      const items = plan.items.slice(); items[idx] = repriced;
      const next = Object.assign({}, plan, { items });
      setPlan(next);
      await Store.savePrescription(t, planned.session, next, plan.source || "engine");
      toast("Swapped to " + name, "good");
    }, [swap, plan, state, t, planned.session, toast]);

    const coachWithAI = useCallback(async () => {
      const key = (Store.config().anthropicKey || "").trim();
      if (!key) { toast("Add an Anthropic key in Settings first", "bad"); return; }
      setAiBusy(true);
      const reprice = (name, orig) => repriceLine(state, name, { band: orig.band, sets: orig.sets, slot_label: orig.slot_label, is_lateral_delt: orig.is_lateral_delt, warmup: orig.warmup });
      const out = await AI.enhance(plan, { apiKey: key, libByName: E.LIB_BY_NAME, reprice });
      setAiBusy(false);
      if (out.changed) {
        const next = Object.assign({}, out.plan, { source: "claude" });
        setPlan(next);
        await Store.savePrescription(t, planned.session, next, "claude");
        toast("Coached by Claude", "good");
      } else {
        toast(out.error ? "AI unavailable — kept the plan" : "No changes suggested", out.error ? "bad" : null);
      }
    }, [plan, state, t, planned.session, toast]);

    // ---- rest / cardio / off days ----
    if (!planned.session) {
      const isCardio = planned.kind === "cardio";
      return html`
        <div class="g-dayhead">
          <div class="eyebrow">${planned.day} · ${fmtDate(t)}</div>
          <div class="title">${isCardio ? "Zone 2 Cardio" : "Rest Day"}</div>
          <div class="sub">${isCardio ? "Low-intensity, conversational pace" : "Recovery — no lifting today"}</div>
        </div>
        <div class="g-card"><div class="accent" style=${{ background: isCardio ? "var(--mint)" : "var(--faint)" }}/>
          ${isCardio ? html`
            <div class="exname">Steady-state cardio</div>
            <div class="g-note"><span class="ic"><${Icon} d="clock" size=${16}/></span>
              <span>20–30 min at an easy, talkable pace (incline walk, bike, or row). Heart rate ~60–70% max. ${planned.buffer ? "Buffer day — also fine as a full rest if you need it." : ""}</span></div>`
          : html`
            <div class="exname">Take the day</div>
            <div class="g-note"><span class="ic"><${Icon} d="bolt" size=${16}/></span>
              <span>Sleep, food, and walking are the work today. The split puts your hardest sessions on the weekend.</span></div>`}
        </div>
        <div class="g-section-title">Log progress</div>
        <div class="g-help" style=${{ margin: "0 4px" }}>Pop over to the Progress tab to record waist & shoulder measurements — weekly is plenty.</div>`;
    }

    // ---- training day ----
    return html`
      <div class="g-dayhead">
        <div class="eyebrow">${planned.day} · Week ${state.cycleWeek} of cycle · ${fmtDate(t)}</div>
        <div class="title">${plan ? plan.session_label : "…"}</div>
        <div class="sub">${plan ? `${plan.items.length} movements · ${plan.cap_min} min cap` : "Building your session"}</div>
      </div>

      ${plan && plan.banners.map((b, i) => html`
        <div key=${i} class=${cls("g-banner", b.tone === "warn" ? "warn" : "good")}>
          <span class="ic"><${Icon} d="info" size=${16}/></span><span>${b.text}</span></div>`)}

      ${(Store.config().anthropicKey || "").trim() && plan && plan.source !== "claude" && html`
        <button class="g-btn block ghost" style=${{ marginTop: 8 }} onClick=${coachWithAI} disabled=${aiBusy}>
          ${aiBusy ? html`<${Spinner}/> Coaching…` : html`<${Icon} d="sparkle" size=${16}/> Coach this session with Claude`}
        </button>`}
      ${plan && plan.source === "claude" && html`
        <div class="g-banner ai"><span class="ic"><${Icon} d="sparkle" size=${15}/></span>
          <span>Cues refined by Claude. Loads and reps still come straight from your program's rules.</span></div>`}

      ${plan ? plan.items.map((line, i) => html`<${ReadoutCard} key=${i} line=${line} onSwap=${setSwap}/>`)
             : html`<div class="g-empty"><${Spinner}/></div>`}

      ${plan && html`<div class="g-sticky-cta">
        <button class="g-btn go block" onClick=${() => onStart(plan)}>Start session →</button>
      </div>`}

      ${swap && html`<${SwapModal} state=${state} line=${swap} onClose=${() => setSwap(null)} onPick=${doSwap}/>`}`;
  }

  /* ========================================================= LIVE LOGGING */
  function LiveLogging({ state, plan, onDone, onCancel, toast }) {
    const t = todayISO();
    const initial = useMemo(() => plan.items.map((it) => ({
      exercise: it.exercise, equipment: it.equipment,
      slot_label: it.slot_label, is_lateral_delt: it.is_lateral_delt,
      rest_low: it.rest_low, rest_high: it.rest_high, warmup: it.warmup,
      target: `${it.sets}×${it.target_reps}`,
      sets: Array.from({ length: it.sets }, () => ({
        weight: it.weight == null ? "" : it.weight, reps: it.target_reps, rpe: "", done: false,
      })),
    })), [plan]);
    const [entries, setEntries] = useState(initial);
    const [rest, setRest] = useState(null); // {left,total}
    const [addOpen, setAddOpen] = useState(false);
    const [saving, setSaving] = useState(false);

    // rest countdown
    useEffect(() => {
      if (!rest) return;
      if (rest.left <= 0) { setRest(null); return; }
      const id = setTimeout(() => setRest((r) => r && { ...r, left: r.left - 1 }), 1000);
      return () => clearTimeout(id);
    }, [rest]);

    const setField = (ei, si, key, val) => {
      setEntries((es) => es.map((e, i) => i !== ei ? e : {
        ...e, sets: e.sets.map((s, j) => j !== si ? s : { ...s, [key]: val }),
      }));
    };
    const toggleDone = (ei, si) => {
      setEntries((es) => es.map((e, i) => {
        if (i !== ei) return e;
        const sets = e.sets.map((s, j) => j !== si ? s : { ...s, done: !s.done });
        if (sets[si].done) setRest({ left: e.rest_low, total: e.rest_low });
        return { ...e, sets };
      }));
    };
    const addSet = (ei) => setEntries((es) => es.map((e, i) => i !== ei ? e : {
      ...e, sets: e.sets.concat([{ ...e.sets[e.sets.length - 1], done: false }]),
    }));
    const addExercise = (name) => {
      setAddOpen(false);
      const line = repriceLine(state, name, { band: "isolation", sets: 3, slot_label: (E.LIB_BY_NAME[name] || {}).primary });
      if (!line) return;
      setEntries((es) => es.concat([{
        exercise: name, equipment: line.equipment, slot_label: line.slot_label,
        rest_low: line.rest_low, rest_high: line.rest_high, target: `${line.sets}×${line.target_reps}`,
        sets: Array.from({ length: line.sets }, () => ({ weight: line.weight == null ? "" : line.weight, reps: line.target_reps, rpe: "", done: false })),
      }]));
    };

    const finish = async () => {
      setSaving(true);
      const rows = [];
      entries.forEach((e) => e.sets.forEach((s) => {
        const reps = parseInt(s.reps, 10);
        if (!reps || reps <= 0) return;
        const w = s.weight === "" || s.weight == null ? (e.equipment === "bodyweight" ? 0 : null) : parseFloat(s.weight);
        rows.push({
          exercise: e.exercise, weight: w, reps,
          rpe: s.rpe === "" ? null : parseFloat(s.rpe),
          notes: "", date: t, session_type: plan.session_key,
          week_of_cycle: state.cycleWeek, data_source: "logged",
        });
      }));
      if (!rows.length) { setSaving(false); toast("Log at least one set", "bad"); return; }
      await Store.addLogs(rows);
      // advance the 4-week cycle counter where due (§2a)
      const start = (state.profile && state.profile.program_start) || t;
      const nextWeek = E.maybeAdvanceCycle({ profile: state.profile, cycleWeek: state.cycleWeek }, t);
      if (nextWeek !== state.cycleWeek) await Store.setCycle(nextWeek);
      setSaving(false);
      onDone(rows.length);
    };

    const completed = entries.reduce((n, e) => n + e.sets.filter((s) => s.done).length, 0);

    return html`
      <div class="g-dayhead">
        <div class="eyebrow">Logging · ${plan.session_label}</div>
        <div class="title" style=${{ fontSize: "30px" }}>In session</div>
        <div class="sub">${completed} sets done · tap ✓ as you finish each set</div>
      </div>

      ${entries.map((e, ei) => html`
        <div class="g-log-ex" key=${ei}>
          <div class="head">
            <span class="name">${e.exercise}${e.is_lateral_delt ? " · fixed" : ""}</span>
            <span class="target">${e.target}</span>
          </div>
          ${e.warmup && ei === 0 && html`<div class="g-help" style=${{ margin: "-2px 0 8px" }}>Warm-up first: 2 light ramp sets (~50% then ~75%). Log your working sets below.</div>`}
          ${e.sets.map((s, si) => html`
            <div class=${cls("g-set", s.done && "done")} key=${si}>
              <div class="ix">${si + 1}</div>
              <div class="g-field"><label>kg</label>
                <input class="g-num" inputMode="decimal" value=${s.weight}
                  placeholder=${e.equipment === "bodyweight" ? "BW" : ""}
                  onChange=${(ev) => setField(ei, si, "weight", ev.target.value)}/></div>
              <div class="g-field"><label>reps</label>
                <input class="g-num" inputMode="numeric" value=${s.reps}
                  onChange=${(ev) => setField(ei, si, "reps", ev.target.value)}/></div>
              <div class="g-field"><label>RPE</label>
                <input class="g-num" inputMode="decimal" value=${s.rpe} placeholder="–"
                  onChange=${(ev) => setField(ei, si, "rpe", ev.target.value)}/></div>
              <button class=${cls("g-check", s.done && "on")} onClick=${() => toggleDone(ei, si)} aria-label="set done">
                <${Icon} d="check" size=${20}/></button>
            </div>`)}
          <button class="g-btn ghost sm" onClick=${() => addSet(ei)}><${Icon} d="plus" size=${14}/> Add set</button>
        </div>`)}

      <button class="g-btn ghost block" style=${{ marginTop: 6 }} onClick=${() => setAddOpen(true)}>
        <${Icon} d="plus" size=${16}/> Add an exercise</button>

      ${rest && html`
        <div class="g-rest">
          <div class="row">
            <div><div class="lbl">Rest</div><div class="t">${String(Math.floor(rest.left / 60)).padStart(1, "0")}:${String(rest.left % 60).padStart(2, "0")}</div></div>
            <button class="skip" onClick=${() => setRest(null)}>Skip</button>
          </div>
          <div class="bar" style=${{ width: (100 * rest.left / rest.total) + "%" }}/>
        </div>`}

      <div class="g-sticky-cta" style=${{ display: "flex", gap: 8 }}>
        <button class="g-btn ghost" onClick=${onCancel}>Cancel</button>
        <button class="g-btn mint" style=${{ flex: 1 }} onClick=${finish} disabled=${saving}>
          ${saving ? html`<${Spinner}/> Saving…` : "Finish & save"}</button>
      </div>

      ${addOpen && html`
        <div class="g-overlay" onClick=${() => setAddOpen(false)}>
          <div class="g-modal" onClick=${(ev) => ev.stopPropagation()}>
            <h3>Add an exercise</h3>
            <div class="g-help">Adds an extra movement to today's log, priced from your history.</div>
            <div class="g-chiprow" style=${{ maxHeight: "46vh", overflow: "auto" }}>
              ${E.LIBRARY.map((x) => html`<button key=${x.name} class="g-chip" onClick=${() => addExercise(x.name)}>${x.name}</button>`)}
            </div>
            <button class="g-btn block ghost" onClick=${() => setAddOpen(false)}>Close</button>
          </div>
        </div>`}`;
  }

  /* ============================================================== PROGRESS */
  function ProgressScreen({ state, refresh, toast }) {
    const [rows, setRows] = useState(null);
    const [form, setForm] = useState({ waist: "", shoulder: "", bw: "" });
    const reload = useCallback(async () => setRows(await Store.getMeasurements()), []);
    useEffect(() => { reload(); }, [reload]);

    const save = async () => {
      const m = {
        date: todayISO(),
        waist_cm: form.waist ? parseFloat(form.waist) : null,
        shoulder_cm: form.shoulder ? parseFloat(form.shoulder) : null,
        bodyweight_kg: form.bw ? parseFloat(form.bw) : null,
        notes: "",
      };
      if (m.waist_cm == null && m.shoulder_cm == null && m.bodyweight_kg == null) { toast("Enter at least one number", "bad"); return; }
      await Store.addMeasurement(m);
      setForm({ waist: "", shoulder: "", bw: "" });
      await reload(); toast("Measurement saved", "good");
    };

    const data = (rows || []).filter((r) => r.waist_cm != null || r.shoulder_cm != null);
    return html`
      <div class="g-dayhead"><div class="eyebrow">Progress</div><div class="title" style=${{ fontSize: 32 }}>Measurements</div>
        <div class="sub">Track the V-taper: waist down, shoulders up</div></div>

      <div class="g-panel">
        <div class="g-fieldset">
          <div><span class="g-label">Waist (cm)</span><input class="g-input" inputMode="decimal" value=${form.waist} onChange=${(e) => setForm({ ...form, waist: e.target.value })}/></div>
          <div><span class="g-label">Shoulders</span><input class="g-input" inputMode="decimal" value=${form.shoulder} onChange=${(e) => setForm({ ...form, shoulder: e.target.value })}/></div>
          <div><span class="g-label">Weight (kg)</span><input class="g-input" inputMode="decimal" value=${form.bw} onChange=${(e) => setForm({ ...form, bw: e.target.value })}/></div>
        </div>
        <button class="g-btn primary block" style=${{ marginTop: 14 }} onClick=${save}>Save today</button>
      </div>

      ${data.length >= 2 ? html`<${Trend} data=${data}/>` : html`
        <div class="g-empty"><div class="big">No trend yet</div><div>Log a couple of weeks to see your shape change.</div></div>`}

      ${(rows || []).length > 0 && html`
        <div class="g-section-title">History</div>
        <div class="g-panel">
          ${rows.slice().reverse().map((r, i) => html`<div class="g-row" key=${i}>
            <span class="k">${shortDate(r.date)}</span>
            <span class="v">${[r.waist_cm && `W ${r.waist_cm}`, r.shoulder_cm && `S ${r.shoulder_cm}`, r.bodyweight_kg && `${r.bodyweight_kg}kg`].filter(Boolean).join(" · ")}</span>
          </div>`)}
        </div>`}`;
  }

  function Trend({ data }) {
    const W = 520, H = 150, pad = 22;
    const xs = data.map((_, i) => i);
    const ys = data.flatMap((d) => [d.waist_cm, d.shoulder_cm].filter((v) => v != null));
    const min = Math.min.apply(null, ys), max = Math.max.apply(null, ys);
    const span = max - min || 1;
    const X = (i) => pad + (i / Math.max(1, data.length - 1)) * (W - pad * 2);
    const Y = (v) => H - pad - ((v - min) / span) * (H - pad * 2);
    const path = (key) => data.map((d, i) => (d[key] == null ? null : `${X(i)},${Y(d[key])}`)).filter(Boolean).join(" ");
    return html`
      <div class="g-section-title">Trend</div>
      <div class="g-panel">
        <svg class="g-trend" viewBox=${`0 0 ${W} ${H}`} preserveAspectRatio="none">
          ${[0, 0.5, 1].map((f, i) => html`<line key=${i} class="grid" x1=${pad} x2=${W - pad} y1=${pad + f * (H - pad * 2)} y2=${pad + f * (H - pad * 2)}/>`)}
          <polyline class="waist" points=${path("waist_cm")}/>
          <polyline class="shoulder" points=${path("shoulder_cm")}/>
          ${data.map((d, i) => html`<g key=${i}>
            ${d.waist_cm != null && html`<circle class="dot-w" cx=${X(i)} cy=${Y(d.waist_cm)} r="3"/>`}
            ${d.shoulder_cm != null && html`<circle class="dot-s" cx=${X(i)} cy=${Y(d.shoulder_cm)} r="3"/>`}
          </g>`)}
        </svg>
        <div class="g-legend"><span><span class="sw" style=${{ background: "var(--amber)" }}/>Waist</span><span><span class="sw" style=${{ background: "var(--mint)" }}/>Shoulders</span></div>
      </div>`;
  }

  /* =============================================================== HISTORY */
  function HistoryScreen({ state }) {
    const real = (state.logs || []).filter((l) => l.session_type !== "measurement");
    const byDay = {};
    real.forEach((l) => { (byDay[l.date] = byDay[l.date] || []).push(l); });
    const days = Object.keys(byDay).sort().reverse();
    if (!days.length) return html`<div class="g-empty"><div class="big">No sessions yet</div><div>Finish a session and it shows up here.</div></div>`;
    return html`
      <div class="g-dayhead"><div class="eyebrow">History</div><div class="title" style=${{ fontSize: 32 }}>Training log</div>
        <div class="sub">${real.length} sets across ${days.length} days</div></div>
      ${days.map((day) => {
        const rows = byDay[day];
        const type = rows[0].session_type;
        const byEx = {};
        rows.forEach((r) => { (byEx[r.exercise] = byEx[r.exercise] || []).push(r); });
        const label = type === "baseline" ? "Baseline" : (E.SESSIONS[type] ? E.SESSIONS[type].label : type);
        return html`<div class="g-history-day" key=${day}>
          <div class="d">${shortDate(day)}</div>
          <div class="meta">${label} · ${rows.length} sets</div>
          ${Object.keys(byEx).map((ex) => html`<div class="ln" key=${ex}>
            <span class="ex">${ex}</span> · ${byEx[ex].map((s) => `${s.weight == null ? "BW" : s.weight}×${s.reps}`).join(", ")}
          </div>`)}
        </div>`;
      })}`;
  }

  /* =============================================================== SETTINGS */
  function SettingsScreen({ state, mode, refresh, toast, onReseed }) {
    const cfg = Store.config();
    const [url, setUrl] = useState(cfg.supabaseUrl || "");
    const [key, setKey] = useState(cfg.supabaseKey || "");
    const [aiKey, setAiKey] = useState(cfg.anthropicKey || "");
    const [start, setStart] = useState((state.profile && state.profile.program_start) || cfg.programStart || todayISO());
    const [status, setStatus] = useState(null);
    const [busy, setBusy] = useState(false);
    const fileRef = useRef(null);

    const connect = async () => {
      if (!url.trim() || !key.trim()) { toast("Paste both the URL and the anon key", "bad"); return; }
      setBusy(true);
      const { status } = await Store.connect(url, key);
      if (status.ok) { await Store.seedIfEmpty({ programStart: start }); }
      setStatus(status); setBusy(false);
      if (status.ok) { toast("Connected & synced", "good"); refresh(); }
      else toast("Couldn't connect — check the URL/key & that schema.sql ran", "bad");
    };
    const disconnect = async () => { await Store.disconnect(); setStatus(null); toast("Disconnected — local only", null); refresh(); };
    const saveAi = () => { Store.saveConfig({ anthropicKey: aiKey.trim() }); toast(aiKey.trim() ? "AI key saved on this device" : "AI key cleared", "good"); };
    const saveStart = async () => {
      Store.saveConfig({ programStart: start });
      await Store.upsertProfile({ program_start: start });
      toast("Program start updated", "good"); refresh();
    };
    const exportData = async () => { const d = await Store.exportAll(); download(`gym-backup-${todayISO()}.json`, JSON.stringify(d, null, 2)); };
    const importData = async (file) => {
      try { const d = JSON.parse(await file.text()); await Store.importAll(d); toast("Imported", "good"); refresh(); }
      catch (e) { toast("Import failed: " + e.message, "bad"); }
    };
    const reset = async () => {
      if (!confirm("Erase all logs, measurements and prescriptions, and reset to week 1? Seed data will be restored.")) return;
      await Store.clearAll(); await onReseed(); toast("Reset done", "good"); refresh();
    };

    return html`
      <div class="g-dayhead"><div class="eyebrow">Settings</div><div class="title" style=${{ fontSize: 32 }}>Setup & sync</div></div>

      <div class="g-section-title">Sync (Supabase)</div>
      <div class="g-panel">
        <div class="g-row"><span class="k">Status</span>
          <span class="v" style=${{ color: mode === "cloud" ? "var(--mint)" : "var(--gold)" }}>${mode === "cloud" ? "Synced" : "Local only"}</span></div>
        <span class="g-label">Project URL</span>
        <input class="g-input" placeholder="https://xxxx.supabase.co" value=${url} onChange=${(e) => setUrl(e.target.value)}/>
        <span class="g-label">Anon public key</span>
        <input class="g-input" placeholder="eyJ…" value=${key} onChange=${(e) => setKey(e.target.value)}/>
        <div style=${{ display: "flex", gap: 8, marginTop: 12 }}>
          <button class="g-btn primary" style=${{ flex: 1 }} onClick=${connect} disabled=${busy}>${busy ? html`<${Spinner}/> Connecting…` : "Connect & sync"}</button>
          ${mode === "cloud" && html`<button class="g-btn danger" onClick=${disconnect}>Disconnect</button>`}
        </div>
        ${status && html`<div class="g-help" style=${{ color: status.ok ? "var(--mint)" : "var(--red)" }}>${status.detail}</div>`}
        <div class="g-help">Create a free project at supabase.com, run the included <b>schema.sql</b> in its SQL editor, then paste the Project URL and anon key from Settings → API. The same data then follows you onto every device.</div>
      </div>

      <div class="g-section-title">AI coaching (optional)</div>
      <div class="g-panel">
        <span class="g-label">Anthropic API key</span>
        <input class="g-input" placeholder="sk-ant-…" value=${aiKey} onChange=${(e) => setAiKey(e.target.value)} type="password"/>
        <button class="g-btn block" style=${{ marginTop: 12 }} onClick=${saveAi}>Save key</button>
        <div class="g-help">Stored only on this device, never synced. With a key, the “Coach this session” button lets Claude refine the cues and vary exercises. Loads and reps always come from the program's rules — never the model.</div>
      </div>

      <div class="g-section-title">Program</div>
      <div class="g-panel">
        <div class="g-row"><span class="k">Cycle week</span><span class="v">${state.cycleWeek} / 4</span></div>
        <span class="g-label">Program start date</span>
        <input class="g-input" type="date" value=${start} onChange=${(e) => setStart(e.target.value)}/>
        <button class="g-btn block" style=${{ marginTop: 12 }} onClick=${saveStart}>Update start date</button>
        <div class="g-help">Drives the re-entry ramp (first 2 weeks hold weight) and deload timing (first deload after 4 weeks).</div>
      </div>

      <div class="g-section-title">Data</div>
      <div class="g-panel">
        <button class="g-btn block ghost" onClick=${exportData}>Export backup (.json)</button>
        <button class="g-btn block ghost" style=${{ marginTop: 8 }} onClick=${() => fileRef.current.click()}>Import backup</button>
        <input ref=${fileRef} type="file" accept="application/json" style=${{ display: "none" }} onChange=${(e) => e.target.files[0] && importData(e.target.files[0])}/>
        <button class="g-btn block danger" style=${{ marginTop: 8 }} onClick=${reset}>Reset all training data</button>
      </div>

      <div class="g-section-title">About</div>
      <div class="g-panel">
        <div class="g-help" style=${{ fontSize: 13 }}>
          This planner runs your program as <b>exact rules</b> — the split, progression, deloads, re-entry and absence haircuts are deterministic, so your loads are reliable session to session. Claude is an optional layer for coaching cues and variety, fenced so it can never change your numbers. It works fully offline; add Supabase to sync across devices.
        </div>
      </div>`;
  }

  /* =============================================================== ONBOARD */
  function Onboarding({ onLocal, onCloud }) {
    return html`
      <div class="g-app">
        <div class="g-topbar"><div class="g-brand">${BrandMark()}<h1>Iron Console</h1></div></div>
        <div class="g-dayhead"><div class="eyebrow">Welcome</div><div class="title" style=${{ fontSize: 34 }}>Let's set up</div>
          <div class="sub">Your AI-driven V-taper program, on your phone.</div></div>
        <div class="g-panel">
          <div class="exname" style=${{ fontSize: 17, marginBottom: 6 }}>Sync across devices</div>
          <div class="g-help" style=${{ marginTop: 0 }}>Recommended. Connect a free Supabase project so your log follows you everywhere. You'll need your Project URL and anon key (and to run schema.sql once).</div>
          <button class="g-btn primary block" style=${{ marginTop: 12 }} onClick=${onCloud}>Set up sync</button>
        </div>
        <div class="g-panel">
          <div class="exname" style=${{ fontSize: 17, marginBottom: 6 }}>Just this device</div>
          <div class="g-help" style=${{ marginTop: 0 }}>Start now, data stays in this browser. You can connect sync later in Settings.</div>
          <button class="g-btn block" style=${{ marginTop: 12 }} onClick=${onLocal}>Start local</button>
        </div>
      </div>`;
  }

  function BrandMark() {
    return html`<svg class="mark" viewBox="0 0 32 32" fill="none">
      <path d="M5 16h22" stroke="var(--amber)" stroke-width="3" stroke-linecap="round"/>
      <rect x="3" y="11" width="4" height="10" rx="1.5" fill="var(--ink)"/>
      <rect x="25" y="11" width="4" height="10" rx="1.5" fill="var(--ink)"/>
      <rect x="7.5" y="9" width="3.5" height="14" rx="1.5" fill="var(--muted)"/>
      <rect x="21" y="9" width="3.5" height="14" rx="1.5" fill="var(--muted)"/>
    </svg>`;
  }

  /* =================================================================== APP */
  function App() {
    const [ready, setReady] = useState(false);
    const [needsSetup, setNeedsSetup] = useState(false);
    const [forceCloud, setForceCloud] = useState(false);
    const [mode, setMode] = useState("local");
    const [state, setState] = useState(null);
    const [tab, setTab] = useState("today");
    const [session, setSession] = useState(null); // active live-logging plan
    const [toastNode, toast] = useToast();

    const refresh = useCallback(async () => { setState(await Store.loadState()); }, []);
    const reseed = useCallback(async () => { await Store.seedIfEmpty(); await refresh(); }, [refresh]);

    useEffect(() => {
      (async () => {
        const m = await Store.init();
        const cfg = Store.config();
        const configured = !!(cfg.supabaseUrl && cfg.supabaseKey) || cfg.startedLocal;
        setMode(m);
        if (!configured) { setNeedsSetup(true); setReady(true); return; }
        await Store.seedIfEmpty();
        await refresh();
        setReady(true);
      })();
    }, [refresh]);

    if (!ready) return html`<div class="g-app"><div class="g-empty"><${Spinner}/><div style=${{ marginTop: 10 }}>Loading…</div></div></div>`;

    if (needsSetup && !forceCloud) {
      return html`<${Onboarding}
        onLocal=${async () => { Store.saveConfig({ startedLocal: true }); await Store.seedIfEmpty(); await refresh(); setNeedsSetup(false); }}
        onCloud=${() => { setForceCloud(true); setNeedsSetup(false); setTab("settings"); }}/>`;
    }

    // After choosing cloud setup but before state exists, still render shell on Settings.
    const syncClass = mode === "cloud" ? "cloud" : "local";
    const navItems = [
      ["today", "today", "Today"], ["progress", "chart", "Progress"],
      ["history", "history", "History"], ["settings", "gear", "Settings"],
    ];

    return html`
      <div class="g-app">
        <div class="g-topbar">
          <div class="g-brand">${BrandMark()}<h1>Iron Console</h1></div>
          <span class=${cls("g-syncpill", syncClass)}><span class="dot"/>${mode === "cloud" ? "Synced" : "Local"}</span>
        </div>

        ${session ? html`<${LiveLogging}
            state=${state} plan=${session} toast=${toast}
            onCancel=${() => setSession(null)}
            onDone=${async (n) => { setSession(null); await refresh(); setTab("today"); toast(`Saved ${n} sets`, "good"); }}/>`
          : !state ? html`<div class="g-empty"><${Spinner}/></div>`
          : tab === "today" ? html`<${TodayScreen} state=${state} refresh=${refresh} toast=${toast} onStart=${(p) => setSession(p)}/>`
          : tab === "progress" ? html`<${ProgressScreen} state=${state} refresh=${refresh} toast=${toast}/>`
          : tab === "history" ? html`<${HistoryScreen} state=${state}/>`
          : html`<${SettingsScreen} state=${state || { cycleWeek: 1, profile: {} }} mode=${mode} refresh=${async () => { setMode(Store.mode()); await refresh(); }} toast=${toast} onReseed=${reseed}/>`}
      </div>

      ${!session && html`<nav class="g-nav">
        ${navItems.map(([id, ic, label]) => html`
          <button key=${id} class=${cls("item", tab === id && "active")} onClick=${() => setTab(id)}>
            <${Icon} d=${ic} size=${22}/><span>${label}</span></button>`)}
      </nav>`}
      ${toastNode}`;
  }

  ReactDOM.createRoot(document.getElementById("root")).render(html`<${App}/>`);
})();
