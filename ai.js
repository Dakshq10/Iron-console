/* ============================================================================
   ai.js — optional Claude coaching layer (honest + safe by construction).
   ----------------------------------------------------------------------------
   The deterministic engine already produces a complete, valid plan. If — and
   only if — you add an Anthropic API key in Settings, this layer asks Claude to
   make the plan feel coached:

     • rewrite each exercise's short cue to be specific and motivating;
     • optionally swap a movement for one of ITS OWN listed alternatives, for
       variety or recovery — never for a different load.

   Hard guarantees (validation, not trust):
     • Claude may never change weights, reps, sets, or rest. Any swap is
       re-priced by the engine, so the numbers always come from the rules.
     • A swap is accepted only if the target is a real library exercise that
       can fill the same slot. Anything else is ignored.
     • Any network/parse/validation error → the original engine plan is used.

   Attaches to window.GymAI.  Calls api.anthropic.com directly from the browser
   (requires the anthropic-dangerous-direct-browser-access header).
   ========================================================================== */
(function (root) {
  "use strict";

  const ENDPOINT = "https://api.anthropic.com/v1/messages";
  const MODEL = "claude-opus-4-8";
  const TIMEOUT_MS = 25000;

  function clean(text) {
    return String(text || "").replace(/```json/gi, "").replace(/```/g, "").trim();
  }
  function firstJsonObject(text) {
    const s = clean(text);
    const a = s.indexOf("{"), b = s.lastIndexOf("}");
    if (a === -1 || b === -1 || b < a) return null;
    try { return JSON.parse(s.slice(a, b + 1)); } catch (_) { return null; }
  }

  // Compact, model-friendly description of the plan + the only allowed swaps.
  function describe(plan, libByName) {
    return plan.items.map((it, i) => {
      const lib = libByName[it.exercise] || {};
      const alts = (lib.alts || []).filter((n) => libByName[n]); // real movements only
      return {
        slot: i,
        slot_label: it.slot_label,
        exercise: it.exercise,
        prescribed: `${it.weight == null ? "—" : it.weight + "kg"} · ${it.sets}×${it.target_reps} · rest ${it.rest_low}-${it.rest_high}s`,
        current_cue: it.note || "",
        allowed_alternatives: alts,
        is_lateral_delt: !!it.is_lateral_delt,
      };
    });
  }

  function systemPrompt() {
    return [
      "You are an expert hypertrophy coach reviewing today's auto-generated session for an intermediate lifter",
      "whose goal is skinny-fat correction and a V-taper (width: lateral delts, upper chest, lats).",
      "",
      "You may do TWO things only:",
      "1. Rewrite each exercise's coaching cue: one short, specific, motivating line (max ~90 chars).",
      "   Reference tempo, mind-muscle focus, the V-taper goal, or grip/recovery where relevant.",
      "2. Optionally replace an exercise with ONE of its listed allowed_alternatives — only for variety,",
      "   a fresh stimulus, or recovery. Keep lateral-delt slots on a lateral-delt movement.",
      "",
      "You must NOT change or mention specific weights, rep counts, set counts, or rest times — those are fixed by the program's rules.",
      "Do not invent exercises. Only use the exact names provided.",
      "",
      'Respond with ONLY a JSON object, no prose, of the form:',
      '{"items":[{"slot":0,"exercise":"<original or an allowed alternative>","cue":"<short cue>"}, ...]}',
      "Include every slot exactly once.",
    ].join("\n");
  }

  async function callClaude(apiKey, plan, libByName, signal) {
    const payload = {
      model: MODEL,
      max_tokens: 1024,
      system: systemPrompt(),
      messages: [{
        role: "user",
        content:
          "Session: " + plan.session_label + " (" + plan.kind + ").\n" +
          "Banners: " + (plan.banners || []).map((b) => b.text).join(" ") + "\n\n" +
          "Slots:\n" + JSON.stringify(describe(plan, libByName), null, 2) +
          "\n\nReturn the JSON now.",
      }],
    };
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify(payload),
      signal,
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error("Anthropic " + res.status + ": " + t.slice(0, 200));
    }
    const data = await res.json();
    const text = (data.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
    return firstJsonObject(text);
  }

  /* --------------------------------------------------------------- enhance */
  // opts: { apiKey, libByName, reprice(exerciseName, item, index)->line|null }
  async function enhance(plan, opts) {
    opts = opts || {};
    const apiKey = (opts.apiKey || "").trim();
    if (!apiKey) return { plan, source: "engine", changed: false };

    const libByName = opts.libByName || {};
    const reprice = typeof opts.reprice === "function" ? opts.reprice : null;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let parsed;
    try {
      parsed = await callClaude(apiKey, plan, libByName, controller.signal);
    } catch (err) {
      clearTimeout(timer);
      console.warn("Claude enhancement failed, using engine plan:", err.message || err);
      return { plan, source: "engine", changed: false, error: String(err.message || err) };
    }
    clearTimeout(timer);

    if (!parsed || !Array.isArray(parsed.items)) {
      return { plan, source: "engine", changed: false };
    }

    // Validate + apply, item by item. Anything invalid is silently skipped.
    const bySlot = {};
    parsed.items.forEach((it) => { if (it && typeof it.slot === "number") bySlot[it.slot] = it; });

    let changed = false;
    const items = plan.items.map((orig, i) => {
      const suggestion = bySlot[i];
      if (!suggestion) return orig;

      let line = orig;
      const lib = libByName[orig.exercise] || {};
      const allowed = (lib.alts || []).filter((n) => libByName[n]);

      // (2) optional swap — must be an allowed alternative and respect the LD slot.
      const wantName = typeof suggestion.exercise === "string" ? suggestion.exercise.trim() : "";
      if (wantName && wantName !== orig.exercise && allowed.includes(wantName)) {
        const target = libByName[wantName];
        const ldOk = !orig.is_lateral_delt || (target && target.lateral_delt);
        if (target && ldOk && reprice) {
          const repriced = reprice(wantName, orig, i);
          if (repriced) {
            // carry the slot framing across to the re-priced line
            repriced.slot_label = orig.slot_label;
            repriced.is_lateral_delt = orig.is_lateral_delt;
            repriced.warmup = orig.warmup;
            line = repriced;
            changed = true;
          }
        }
      }

      // (1) cue rewrite — cosmetic only, never touches numbers.
      if (typeof suggestion.cue === "string" && suggestion.cue.trim()) {
        line = Object.assign({}, line, { note: suggestion.cue.trim().slice(0, 120), ai_cue: true });
        changed = true;
      }
      return line;
    });

    return {
      plan: Object.assign({}, plan, { items }),
      source: changed ? "claude" : "engine",
      changed,
    };
  }

  root.GymAI = { enhance, MODEL };
})(typeof self !== "undefined" ? self : this);
