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
  const E = window.GymEngine, Store = window.GymStore, AI = window.GymAI, Game = window.GymGame;

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
    grid: "M4 5h7v6H4zM13 5h7v6h-7zM4 13h7v6H4zM13 13h7v6h-7z",
    fire: "M12 2c1 3 4 4.5 4 8a4 4 0 11-7.5-2C9 6.5 11 4 12 2zM9.5 13.5a2.2 2.2 0 104.5 1",
    trophy: "M7 4h10v3a5 5 0 01-10 0zM7 5H4v1.5A3.5 3.5 0 007.5 10M17 5h3v1.5A3.5 3.5 0 0116.5 10M9 14h6M12 11v3M8 20h8M10 20l.5-3.5h3L14 20",
    star: "M12 3.5l2.4 5 5.4.6-4 3.7 1.1 5.3L12 20.4 7.1 18l1.1-5.3-4-3.7 5.4-.6z",
    arrow: "M5 12h14M13 6l6 6-6 6",
    medal: "M8 4l4 7 4-7M12 11a5 5 0 100 10 5 5 0 000-10zm0 3.2l.9 1.8 2 .3-1.5 1.4.4 2L12 18l-1.8.9.4-2-1.5-1.4 2-.3z",
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

  /* ========================================================= CHARACTER */
  // A parametric, original lifter badge. Tier (Bronze→Mythic) drives colour,
  // aura rings, plate size, and a star/crown — nothing here is licensed art.
  function CharacterAvatar({ level = 1, size = 120, glow = true }) {
    const t = Game.tierFor(level || 1);
    const c = t.color, order = t.order;
    const plate = 6.5 + order * 1.5;
    const mythic = order >= 5;
    const showCrown = order >= 4;
    const showStar = order >= 2 && !showCrown;
    const uid = "av" + (level || 1) + "s" + size;
    const star = "M50 9 l2.1 4.5 4.9 .5 -3.7 3.3 1 4.8 -4.3 -2.5 -4.3 2.5 1 -4.8 -3.7 -3.3 4.9 -.5 Z";
    const mix = (pct, base) => "color-mix(in srgb, " + c + " " + pct + "%, " + base + ")";
    return html`
      <svg class="g-avatar-svg" viewBox="0 0 100 100" width=${size} height=${size}
           style=${{ filter: mythic ? `drop-shadow(0 0 9px ${c})` : (glow ? "drop-shadow(0 5px 12px rgba(0,0,0,.5))" : "none") }}>
        <defs>
          <radialGradient id=${uid + "bg"} cx="50%" cy="36%" r="72%">
            <stop offset="0%" stop-color=${mix(26, "var(--panel-2)")}/>
            <stop offset="100%" stop-color="var(--panel-2)"/>
          </radialGradient>
          <linearGradient id=${uid + "pl"} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color=${c}/>
            <stop offset="100%" stop-color=${mix(55, "#000")}/>
          </linearGradient>
        </defs>
        <rect x="6" y="6" width="88" height="88" rx="22" fill=${`url(#${uid}bg)`} stroke=${c} stroke-width="2"/>
        ${order >= 1 && html`<rect x="11" y="11" width="78" height="78" rx="18" fill="none" stroke=${c} stroke-opacity="0.35" stroke-width="1"/>`}
        ${order >= 3 && html`<rect x="15" y="15" width="70" height="70" rx="15" fill="none" stroke=${c} stroke-opacity="0.16" stroke-width="1"/>`}
        ${showCrown && html`<path d="M34 21 L40 12 L46 19 L50 9.5 L54 19 L60 12 L66 21 Z" fill=${c} stroke="#0004" stroke-width="0.5"/>`}
        ${showStar && html`<path d=${star} fill=${c} stroke="none"/>`}
        <rect x="20" y="30" width="60" height="4.4" rx="2.2" fill="var(--ink)"/>
        <circle cx="22" cy="32.2" r=${plate} fill=${`url(#${uid}pl)`} stroke="#0003" stroke-width="0.6"/>
        <circle cx="78" cy="32.2" r=${plate} fill=${`url(#${uid}pl)`} stroke="#0003" stroke-width="0.6"/>
        <path d="M40 45 L44 34" stroke=${c} stroke-width="5" stroke-linecap="round"/>
        <path d="M60 45 L56 34" stroke=${c} stroke-width="5" stroke-linecap="round"/>
        <circle cx="50" cy="50" r="8.5" fill="var(--ink)"/>
        <path d="M37 59 L63 59 L57.5 83 L42.5 83 Z" fill=${c} opacity="0.92"/>
        <path d="M37 59 L63 59 L61 65 L39 65 Z" fill="#fff" opacity="0.12"/>
      </svg>`;
  }

  // Compact status strip: avatar + level/title + XP bar + week pips + streak.
  function CharacterBar({ state, sum }) {
    const t = todayISO();
    const wk = E.weekSchedule(state, t, { weeksBack: 0, weeksAhead: 1 })
      .filter((d) => d.weekIndex === 0 && d.isLiftingDay);
    const pipClass = (s) => s.status === "done" ? "done"
      : s.status === "today" ? "today"
      : s.status === "missed" ? "missed"
      : s.status === "moved" ? "moved" : "up";
    return html`
      <div class="g-charbar">
        <div class="av"><${CharacterAvatar} level=${sum.level} size=${66} glow=${false}/></div>
        <div class="meta">
          <div class="toprow">
            <span class="lvl">Lv ${sum.level}</span>
            <span class="ttl">${sum.title}</span>
            <span class="tier" style=${{ color: sum.color }}>${sum.tierName}</span>
          </div>
          <div class="g-xpbar"><div class="fill" style=${{ width: (sum.pct * 100) + "%", background: sum.color }}/></div>
          <div class="botrow">
            <span class="xp">${sum.into} / ${sum.span} XP</span>
            <span class="pips" title="This week's lifting days">
              ${wk.map((d, i) => html`<span key=${i} class=${cls("pip", pipClass(d))}/>`)}
            </span>
            ${sum.streak > 0 && html`<span class="streak"><${Icon} d="fire" size=${13}/> ${sum.streak}</span>`}
          </div>
        </div>
      </div>`;
  }

  /* ============================================================ TODAY screen */
  function TodayScreen({ state, refresh, toast, onStart }) {
    const t = todayISO();
    const programStart = (state.profile && state.profile.program_start) || t;
    const sum = useMemo(
      () => Game.summary(state.logs || [], { today: t, programStart }),
      [state.logs, t, programStart]
    );

    const doneToday = E.sessionDoneOn(t, state.logs || []);
    const todays = doneToday ? null : E.todaysSession(state, t); // normal or make-up
    const mk = useMemo(() => E.makeups(state, t), [state.logs, t]);
    const sessionKey = todays ? todays.session : null;

    const [plan, setPlan] = useState(null);
    const [swap, setSwap] = useState(null);
    const [aiBusy, setAiBusy] = useState(false);
    const builtFor = useRef(null);

    // Build (or load cached) plan for the session we actually train today.
    useEffect(() => {
      if (!sessionKey) { setPlan(null); return; }
      const tag = t + ":" + sessionKey;
      if (builtFor.current === tag && plan) return;
      let alive = true;
      (async () => {
        const cached = await Store.getPrescription(t);
        if (cached && cached.payload && cached.payload.session_key === sessionKey) {
          if (alive) { setPlan(cached.payload); builtFor.current = tag; }
          return;
        }
        const p = E.buildSession(sessionKey, state, { todayISO: t });
        await Store.savePrescription(t, sessionKey, p, "engine");
        if (alive) { setPlan(p); builtFor.current = tag; }
      })();
      return () => { alive = false; };
    }, [t, sessionKey, state.cycleWeek, state.logs.length]);

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
      await Store.savePrescription(t, sessionKey, next, plan.source || "engine");
      toast("Swapped to " + name, "good");
    }, [swap, plan, state, t, sessionKey, toast]);

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
        await Store.savePrescription(t, sessionKey, next, "claude");
        toast("Coached by Claude", "good");
      } else {
        toast(out.error ? "AI unavailable — kept the plan" : "No changes suggested", out.error ? "bad" : null);
      }
    }, [plan, state, t, sessionKey, toast]);

    // ---- already trained today → completed view (fixes the stale "Start" CTA) ----
    if (doneToday) {
      const type = E.sessionTypeOn(t, state.logs || []);
      const label = type === "baseline" ? "Baseline" : (E.SESSIONS[type] ? E.SESSIONS[type].label : type);
      const todaySess = (sum.sessions || []).find((s) => s.date === t);
      const earned = todaySess ? todaySess.xp : 0;
      const setsN = todaySess ? todaySess.sets : 0;
      const prs = todaySess ? todaySess.prs : 0;
      const stillPending = mk.pending.filter((p) => !p.dueToday);
      return html`
        <${CharacterBar} state=${state} sum=${sum}/>
        <div class="g-dayhead">
          <div class="eyebrow">${fmtDate(t)}</div>
          <div class="title">Session complete</div>
          <div class="sub">${label} logged today — nice work.</div>
        </div>
        <div class="g-done-card">
          <div class="ring"><${Icon} d="check" size=${30}/></div>
          <div class="info">
            <div class="hd">${label} done</div>
            <div class="stats">${setsN} sets${prs ? ` · ${prs} PR${prs > 1 ? "s" : ""}` : ""}</div>
          </div>
          <div class="xp">+${earned}<span>XP</span></div>
        </div>
        ${stillPending.length > 0 && html`
          <div class="g-banner warn"><span class="ic"><${Icon} d="info" size=${16}/></span>
            <span>Still to catch up this week: ${stillPending.map((p) => p.label).join(", ")}. Open the Plan tab to knock it out.</span></div>`}
        <div class="g-section-title">Rest of today</div>
        <div class="g-help" style=${{ margin: "0 4px" }}>Food, sleep and an easy walk are the work now. Your next session is on the Plan tab.</div>`;
    }

    // ---- rest / cardio day (nothing to lift, nothing displaced here) ----
    if (!todays) {
      const planned = E.plannedForDate(t, state.cycleWeek);
      const isCardio = planned.kind === "cardio";
      const stillPending = mk.pending;
      return html`
        <${CharacterBar} state=${state} sum=${sum}/>
        <div class="g-dayhead">
          <div class="eyebrow">${planned.day} · ${fmtDate(t)}</div>
          <div class="title">${isCardio ? "Zone 2 Cardio" : "Rest Day"}</div>
          <div class="sub">${isCardio ? "Low-intensity, conversational pace" : "Recovery — no lifting today"}</div>
        </div>
        ${stillPending.length > 0 && html`
          <div class="g-banner warn"><span class="ic"><${Icon} d="info" size=${16}/></span>
            <span>Catch-up available: ${stillPending.map((p) => p.label).join(", ")}. See the Plan tab.</span></div>`}
        <div class="g-card"><div class="accent" style=${{ background: isCardio ? "var(--mint)" : "var(--faint)" }}/>
          ${isCardio ? html`
            <div class="exname">Steady-state cardio</div>
            <div class="g-note"><span class="ic"><${Icon} d="clock" size=${16}/></span>
              <span>20–30 min at an easy, talkable pace (incline walk, bike, or row). Heart rate ~60–70% max. ${planned.buffer ? "Buffer day — also fine as a full rest, or a make-up slot if you fell behind." : ""}</span></div>`
          : html`
            <div class="exname">Take the day</div>
            <div class="g-note"><span class="ic"><${Icon} d="bolt" size=${16}/></span>
              <span>Sleep, food, and walking are the work today. The split puts your hardest sessions on the weekend.</span></div>`}
        </div>
        <div class="g-section-title">Log progress</div>
        <div class="g-help" style=${{ margin: "0 4px" }}>Pop over to the Progress tab to record body weight & body fat — weekly is plenty.</div>`;
    }

    // ---- training day (normal or rescheduled make-up) ----
    const movedFromName = todays.isMakeup
      ? new Date((todays.movedFrom || todays.origDate) + "T00:00:00").toLocaleDateString(undefined, { weekday: "long" })
      : null;
    return html`
      <${CharacterBar} state=${state} sum=${sum}/>
      <div class="g-dayhead">
        <div class="eyebrow">${todays.isMakeup ? "Make-up session" : `Week ${state.cycleWeek} of cycle`} · ${fmtDate(t)}</div>
        <div class="title">${plan ? plan.session_label : "…"}</div>
        <div class="sub">${plan ? `${plan.items.length} movements · ${plan.cap_min} min cap` : "Building your session"}</div>
      </div>

      ${todays.isMakeup && html`
        <div class="g-banner warn"><span class="ic"><${Icon} d="arrow" size=${16}/></span>
          <span>Rescheduled from ${movedFromName}. Doing it today keeps your week on track.</span></div>`}

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
      // Compute the celebration payload from prior logs vs these rows BEFORE writing.
      const start = (state.profile && state.profile.program_start) || t;
      const result = Game.sessionResult(state.logs || [], rows, { today: t, programStart: start });
      await Store.addLogs(rows);
      // advance the 4-week cycle counter where due (§2a)
      const nextWeek = E.maybeAdvanceCycle({ profile: state.profile, cycleWeek: state.cycleWeek }, t);
      if (nextWeek !== state.cycleWeek) await Store.setCycle(nextWeek);
      setSaving(false);
      onDone(rows.length, result);
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
    const [form, setForm] = useState({ bw: "", bf: "" });
    const reload = useCallback(async () => setRows(await Store.getMeasurements()), []);
    useEffect(() => { reload(); }, [reload]);

    const save = async () => {
      const bw = form.bw ? parseFloat(form.bw) : null;
      const bf = form.bf ? parseFloat(form.bf) : null;
      if (bw == null && bf == null) { toast("Enter weight or body fat", "bad"); return; }
      if (bw != null && (!isFinite(bw) || bw <= 0 || bw > 700)) { toast("Enter a valid weight in kg", "bad"); return; }
      if (bf != null && (!isFinite(bf) || bf <= 0 || bf > 100)) { toast("Body fat must be between 0 and 100%", "bad"); return; }
      await Store.addMeasurement({ date: todayISO(), bodyweight_kg: bw, bodyfat_pct: bf, notes: "" });
      setForm({ bw: "", bf: "" });
      await reload(); toast("Measurement saved", "good");
    };

    // Only rows carrying weight or body fat, oldest → newest for the chart.
    const data = (rows || [])
      .filter((r) => r.bodyweight_kg != null || r.bodyfat_pct != null)
      .slice()
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const canChart =
      data.filter((r) => r.bodyweight_kg != null).length >= 2 ||
      data.filter((r) => r.bodyfat_pct != null).length >= 2;

    return html`
      <div class="g-dayhead"><div class="eyebrow">Progress</div><div class="title" style=${{ fontSize: 32 }}>Measurements</div>
        <div class="sub">Track body weight and body fat over time</div></div>

      <div class="g-panel">
        <div class="g-fieldset" style=${{ gridTemplateColumns: "1fr 1fr" }}>
          <div><span class="g-label">Weight (kg)</span><input class="g-input" inputMode="decimal" value=${form.bw} onChange=${(e) => setForm({ ...form, bw: e.target.value })}/></div>
          <div><span class="g-label">Body fat (%)</span><input class="g-input" inputMode="decimal" value=${form.bf} onChange=${(e) => setForm({ ...form, bf: e.target.value })}/></div>
        </div>
        <button class="g-btn primary block" style=${{ marginTop: 14 }} onClick=${save}>Save today</button>
      </div>

      ${canChart ? html`<${Trend} data=${data}/>` : html`
        <div class="g-empty"><div class="big">No trend yet</div><div>Log a couple of entries to see weight and body fat change.</div></div>`}

      ${data.length > 0 && html`
        <div class="g-section-title">History</div>
        <div class="g-panel">
          ${data.slice().reverse().map((r, i) => html`<div class="g-row" key=${i}>
            <span class="k">${shortDate(r.date)}</span>
            <span class="v">${[r.bodyweight_kg != null && `${r.bodyweight_kg} kg`, r.bodyfat_pct != null && `${r.bodyfat_pct}%`].filter(Boolean).join(" · ")}</span>
          </div>`)}
        </div>`}`;
  }

  function Trend({ data }) {
    const W = 520, H = 150, pad = 24;
    const n = data.length;
    const X = (i) => pad + (i / Math.max(1, n - 1)) * (W - pad * 2);

    // Weight (kg) and body fat (%) are different units on different scales, so
    // each line gets its OWN vertical range — a shared axis would flatten one
    // of them and hide the trend that matters.
    function series(key) {
      const pts = data.map((d, i) => ({ i, v: d[key] })).filter((p) => p.v != null);
      if (!pts.length) return null;
      const vals = pts.map((p) => p.v);
      const min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);
      const span = max - min;
      const Y = (v) => (span === 0 ? H / 2 : (H - pad) - ((v - min) / span) * (H - pad * 2));
      return { xy: pts.map((p) => ({ x: X(p.i), y: Y(p.v) })), first: vals[0], last: vals[vals.length - 1] };
    }
    const wt = series("bodyweight_kg");
    const bf = series("bodyfat_pct");
    const pointsOf = (s) => s.xy.map((p) => `${p.x},${p.y}`).join(" ");
    const delta = (s) => {
      const d = s.last - s.first;
      if (Math.abs(d) < 0.05) return "";
      return ` ${d > 0 ? "▲" : "▼"}${Math.abs(d).toFixed(1)}`;
    };

    return html`
      <div class="g-section-title">Trend</div>
      <div class="g-panel">
        <svg class="g-trend" viewBox=${`0 0 ${W} ${H}`} preserveAspectRatio="none">
          ${[0, 0.5, 1].map((f, i) => html`<line key=${i} class="grid" x1=${pad} x2=${W - pad} y1=${pad + f * (H - pad * 2)} y2=${pad + f * (H - pad * 2)}/>`)}
          ${wt && html`<polyline class="weight" points=${pointsOf(wt)}/>`}
          ${bf && html`<polyline class="bodyfat" points=${pointsOf(bf)}/>`}
          ${wt && wt.xy.map((p, i) => html`<circle key=${"w" + i} class="dot-wt" cx=${p.x} cy=${p.y} r="3"/>`)}
          ${bf && bf.xy.map((p, i) => html`<circle key=${"b" + i} class="dot-bf" cx=${p.x} cy=${p.y} r="3"/>`)}
        </svg>
        <div class="g-legend">
          ${wt && html`<span><span class="sw" style=${{ background: "var(--amber)" }}/>Weight · <b>${wt.last}</b> kg${delta(wt)}</span>`}
          ${bf && html`<span><span class="sw" style=${{ background: "var(--mint)" }}/>Body fat · <b>${bf.last}</b>%${delta(bf)}</span>`}
        </div>
        <div class="g-help" style=${{ margin: "6px 2px 0" }}>Each line uses its own scale, so weight and body fat both stay readable even though the units differ.</div>
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

  /* ================================================================== PLAN */
  const ABBR = { arms: "Arms", legs: "Legs", backchest: "B/C", push: "Push", pull: "Pull" };
  const wdayLong = (iso) => new Date(iso + "T00:00:00").toLocaleDateString(undefined, { weekday: "long" });
  const wdayShort = (iso) => new Date(iso + "T00:00:00").toLocaleDateString(undefined, { weekday: "short" });

  function DayModal({ day, onClose, onStart, t }) {
    const o = day.occupant;
    const statusText = {
      done: "Completed", today: "Scheduled today", upcoming: "Upcoming", makeup: "Make-up (rescheduled)",
      missed: "Missed", moved: "Moved to another day", "today-rest": "Rest / cardio", cardio: "Zone 2 cardio", off: "Rest day",
    }[day.status] || day.status;
    const dateLabel = new Date(day.date + "T00:00:00").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
    const canStart = o && o.status === "scheduled" && day.date === t;
    return html`
      <div class="g-overlay" onClick=${onClose}>
        <div class="g-modal" onClick=${(e) => e.stopPropagation()}>
          <h3>${dateLabel}</h3>
          <div class="g-row"><span class="k">Status</span><span class="v">${statusText}</span></div>
          ${o && html`<div class="g-row"><span class="k">Session</span><span class="v">${o.label}${o.isMakeup ? " (make-up)" : ""}</span></div>`}
          ${day.vacated && html`<div class="g-row"><span class="k">${day.vacated.cancelled ? "Cancelled" : "Moved"}</span>
            <span class="v">${day.vacated.label}${day.vacated.to ? " → " + wdayShort(day.vacated.to) : ""}</span></div>`}
          ${!o && day.planned.kind === "cardio" && html`<div class="g-help">Easy Zone 2 cardio, 20–30 min.${day.planned.buffer ? " Buffer day — also a make-up slot if you've fallen behind." : ""}</div>`}
          ${!o && day.planned.kind === "off" && html`<div class="g-help">Rest and recover — no lifting scheduled.</div>`}
          ${canStart
            ? html`<button class="g-btn go block" style=${{ marginTop: 12 }} onClick=${() => onStart({ session: o.session, date: day.date, origDate: day.date })}>Start ${o.label} →</button>`
            : html`<button class="g-btn block ghost" style=${{ marginTop: 12 }} onClick=${onClose}>Close</button>`}
        </div>
      </div>`;
  }

  function PlanScreen({ state, toast, onStart }) {
    const t = todayISO();
    const mk = useMemo(() => E.makeups(state, t), [state.logs, t]);
    const days = useMemo(() => E.weekSchedule(state, t, { weeksBack: 1, weeksAhead: 3 }), [state.logs, state.cycleWeek, t]);
    const [building, setBuilding] = useState(null);
    const [dayModal, setDayModal] = useState(null);

    const startMakeup = async (item) => {
      const keyId = item.session + item.date;
      setBuilding(keyId);
      const p = E.buildSession(item.session, state, { todayISO: t });
      setBuilding(null);
      onStart(p);
    };

    const weeks = [];
    days.forEach((d) => { (weeks[d.weekIndex] = weeks[d.weekIndex] || []).push(d); });

    const cellLabel = (d) => {
      if (d.status === "pre") return "";
      if (d.occupant) return ABBR[d.occupant.session] || d.occupant.label;
      if (d.planned.kind === "cardio") return "Z2";
      if (d.planned.kind === "off") return "Rest";
      return "";
    };
    const legend = [
      ["done", "Done"], ["today", "Today"], ["makeup", "Make-up"],
      ["upcoming", "Upcoming"], ["missed", "Missed"], ["moved", "Moved"],
    ];

    return html`
      <div class="g-dayhead">
        <div class="eyebrow">Plan</div>
        <div class="title" style=${{ fontSize: 32 }}>Schedule</div>
        <div class="sub">Calendar, catch-ups, and your 4-week rotation</div>
      </div>

      <div class="g-section-title">This week's catch-up</div>
      ${(mk.pending.length || mk.cancelled.length) ? html`
        ${mk.pending.map((p, i) => html`
          <div class="g-makeup" key=${"p" + i}>
            <div class="l">
              <div class="nm">${p.label}</div>
              <div class="mt">${p.dueToday ? "Due today" : "Planned " + wdayLong(p.date)} · was ${wdayShort(p.origDate)}</div>
            </div>
            <button class=${cls("g-btn", p.dueToday ? "go" : "primary", "sm")} onClick=${() => startMakeup(p)} disabled=${building === p.session + p.date}>
              ${building === p.session + p.date ? html`<${Spinner}/>` : "Start"}
            </button>
          </div>`)}
        ${mk.cancelled.map((c, i) => html`
          <div class="g-makeup gone" key=${"c" + i}>
            <div class="l"><div class="nm">${c.label}</div><div class="mt">Missed — ${c.reason}</div></div>
            <span class="g-tag freeze">Missed</span>
          </div>`)}
      ` : html`
        <div class="g-panel"><div class="g-help" style=${{ margin: 0 }}>You're on schedule — nothing to catch up. A missed Tuesday slides Wed → Thu (and bumps Thursday's session to Friday); a missed Thursday can be made up Friday. Arms never move to Friday, and nothing carries into the weekend.</div></div>`}

      <div class="g-section-title">Calendar</div>
      <div class="g-cal">
        <div class="g-cal-head">${["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d, i) => html`<span key=${i}>${d[0]}</span>`)}</div>
        ${weeks.map((wk, wi) => html`
          <div class="g-cal-week" key=${wi}>
            ${wk.map((d, di) => html`
              <button key=${di} class=${cls("g-cell", d.status, d.isToday && "is-today")} onClick=${() => setDayModal(d)}>
                <span class="dn">${new Date(d.date + "T00:00:00").getDate()}</span>
                <span class="cl">${cellLabel(d)}</span>
              </button>`)}
          </div>`)}
      </div>
      <div class="g-callegend">
        ${legend.map(([k, lbl], i) => html`<span key=${i}><i class=${cls("sw", k)}/>${lbl}</span>`)}
      </div>

      <div class="g-section-title">4-week rotation</div>
      <div class="g-panel" style=${{ padding: 0, overflow: "hidden" }}>
        <table class="g-cycle">
          <thead><tr><th>Wk</th><th>Tue</th><th>Thu</th><th>Sat</th><th>Sun</th></tr></thead>
          <tbody>
            ${[1, 2, 3, 4].map((w) => {
              const s = E.SPLIT[w];
              const cur = state.cycleWeek === w;
              return html`<tr key=${w} class=${cur ? "cur" : ""}>
                <td>${w}${cur ? " •" : ""}</td>
                <td>${E.SESSIONS[s.A].label}</td>
                <td>${E.SESSIONS[s.B].label}</td>
                <td>${E.SESSIONS[s.wknA].label}</td>
                <td>${E.SESSIONS[s.wknB].label}</td>
              </tr>`;
            })}
          </tbody>
        </table>
      </div>
      <div class="g-help" style=${{ margin: "0 4px" }}>Tue & Thu rotate across the cycle; Sat Push / Sun Pull are fixed. A lateral-raise slot appears every session for the V-taper.</div>

      ${dayModal && html`<${DayModal} day=${dayModal} t=${t} onClose=${() => setDayModal(null)}
        onStart=${(item) => { setDayModal(null); startMakeup(item); }}/>`}`;
  }

  /* ======================================================== SESSION RESULT */
  function SessionResult({ result, onClose }) {
    const [show, setShow] = useState(false);
    useEffect(() => { const id = setTimeout(() => setShow(true), 30); return () => clearTimeout(id); }, []);
    if (!result) return null;
    const r = result;
    return html`
      <div class="g-result-overlay" onClick=${onClose}>
        <div class=${cls("g-result-card", show && "in")} onClick=${(e) => e.stopPropagation()}>
          ${r.leveledUp && html`<div class="burst"/>`}
          <${CharacterAvatar} level=${r.newLevel} size=${112}/>
          ${r.leveledUp
            ? html`<div class="lvlup">LEVEL UP</div>
                   <div class="lvlnum">Level ${r.before.level} → <b>${r.newLevel}</b></div>
                   <div class="ttl" style=${{ color: r.tierColor }}>${r.newTitle} · ${r.newTierName}</div>`
            : html`<div class="lvlnum">Level ${r.newLevel} · <span style=${{ color: r.tierColor }}>${r.newTitle}</span></div>`}
          <div class="xpbig">+${r.earned} XP</div>
          <div class="g-xpbar big"><div class="fill" style=${{ width: (r.after.pct * 100) + "%", background: r.tierColor }}/></div>
          <div class="rsub">${r.after.into} / ${r.after.span} to next level</div>
          <div class="chips">
            <span class="chip"><${Icon} d="check" size=${13}/> ${r.setsLogged} sets</span>
            ${r.prCount > 0 && html`<span class="chip pr"><${Icon} d="trophy" size=${13}/> ${r.prCount} PR${r.prCount > 1 ? "s" : ""}</span>`}
            ${r.streak > 0 && html`<span class="chip fire"><${Icon} d="fire" size=${13}/> ${r.streak} day streak</span>`}
          </div>
          ${r.perfectWeek && html`<div class="perfect"><${Icon} d="star" size=${15}/> Perfect Week — all four sessions! +250 XP</div>`}
          ${r.prNames && r.prNames.length > 0 && html`<div class="prnames">New PR${r.prNames.length > 1 ? "s" : ""}: ${r.prNames.slice(0, 3).join(", ")}</div>`}
          <button class="g-btn go block" style=${{ marginTop: 14 }} onClick=${onClose}>Done</button>
        </div>
      </div>`;
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
    const [result, setResult] = useState(null);    // post-session celebration payload
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
      ["today", "today", "Today"], ["plan", "grid", "Plan"], ["progress", "chart", "Progress"],
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
            onDone=${async (n, res) => { setSession(null); await refresh(); setTab("today"); if (res) setResult(res); else toast(`Saved ${n} sets`, "good"); }}/>`
          : !state ? html`<div class="g-empty"><${Spinner}/></div>`
          : tab === "today" ? html`<${TodayScreen} state=${state} refresh=${refresh} toast=${toast} onStart=${(p) => setSession(p)}/>`
          : tab === "plan" ? html`<${PlanScreen} state=${state} toast=${toast} onStart=${(p) => setSession(p)}/>`
          : tab === "progress" ? html`<${ProgressScreen} state=${state} refresh=${refresh} toast=${toast}/>`
          : tab === "history" ? html`<${HistoryScreen} state=${state}/>`
          : html`<${SettingsScreen} state=${state || { cycleWeek: 1, profile: {} }} mode=${mode} refresh=${async () => { setMode(Store.mode()); await refresh(); }} toast=${toast} onReseed=${reseed}/>`}
      </div>

      ${!session && html`<nav class="g-nav">
        ${navItems.map(([id, ic, label]) => html`
          <button key=${id} class=${cls("item", tab === id && "active")} onClick=${() => setTab(id)}>
            <${Icon} d=${ic} size=${22}/><span>${label}</span></button>`)}
      </nav>`}
      ${result && html`<${SessionResult} result=${result} onClose=${() => setResult(null)}/>`}
      ${toastNode}`;
  }

  ReactDOM.createRoot(document.getElementById("root")).render(html`<${App}/>`);
})();
