/* ============================================================================
   AI Gym Routine Scheduler — Coaching Engine (v4 spec)
   ----------------------------------------------------------------------------
   Pure, deterministic implementation of the locked rules in the spec:
   scheduling (§2/§2a), session structure (§3/§3a), progression & grip
   fail-safe (§8), DUP rep bands (§7), calibration (§5), deload (§10),
   re-entry (§0) and extended-absence (§14c), substitution (§9).

   This file is the single source of truth for the seed data. A Node build
   script reads the same constants to generate the Supabase schema seed, so
   the app and the database never drift apart.

   Dual-mode: attaches to window.GymEngine in a browser, and exports via
   module.exports under Node so it can be unit-tested.
   ========================================================================== */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.GymEngine = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* ---------------------------------------------------------------- profile */
  // §0 User Profile (Locked In)
  const PROFILE = {
    training_age: "Intermediate (1–3 years)",
    body_comp_goal: "Skinny-fat correction — V-taper hypertrophy + progressive ab training",
    equipment_access: "Full commercial gym",
    injuries: "None reported",
    known_limiter: "Grip/forearm fatigue on vertical pulling (§8 fail-safe, not an injury)",
    nutrition_context: "Maintenance / slight deficit — moderate recovery capacity",
    units: "kg",
    weekday_cap_min: 60,
    weekend_cap_min: 90,
    cardio_cap_min: 30,
    reentry_days: 14, // §0 re-entry ramp: hold weight for the first 2 weeks
  };

  /* -------------------------------------------------------------- rep bands */
  // §7 DUP default rep ranges, by the role a movement plays in a session.
  const BANDS = {
    weekday_main: [5, 8],     // intensity day compounds
    weekend_main: [10, 15],   // volume day compounds
    isolation: [10, 15],      // within the 10–20 band, a concrete target
    lateral_delt: [12, 20],   // §7 — always higher rep, never 5–8
    rear_delt: [12, 20],
    ab_weighted: [10, 15],
    ab_lower: [8, 15],
    calves: [10, 15],
  };

  /* ---------------------------------------------------------------- library */
  // §3a seeded library, enriched with the metadata §16 asks the DB to store.
  // inc: load increment in kg. null = machine/cable increment unknown until the
  // lifter reports it (§9d); engine falls back to 2.5 for progression math.
  // roles: which session slots this movement can fill. ld: lateral-delt flag.
  // vtaper: movements the AI biases toward (§4) — width-builders.
  function ex(name, type, primary, secondary, equip, inc, roles, sessions, alts, opt) {
    opt = opt || {};
    return {
      name, type, primary,
      secondary: secondary || [],
      equipment: equip, increment: inc,
      roles, sessions,
      lateral_delt: !!opt.ld,
      vtaper: !!opt.vtaper,
      grip_limited: !!opt.grip,
      rest: opt.rest || (type === "compound" ? [120, 180] : [60, 90]),
      alts: alts || [],
      data_source: "seeded",
    };
  }

  const LIBRARY = [
    // ---- Chest
    ex("Bench Press (Dumbbell)", "compound", "chest", ["triceps", "front delt"], "dumbbell", 2.5, ["chest_press", "chest_flat"], ["backchest", "push"], ["Barbell Bench Press", "Machine Chest Press"]),
    ex("Barbell Bench Press", "compound", "chest", ["triceps", "front delt"], "barbell", 5, ["chest_press", "chest_flat"], ["backchest", "push"], ["Bench Press (Dumbbell)", "Machine Chest Press"]),
    ex("Machine Chest Press", "compound", "chest", ["triceps"], "machine", null, ["chest_press", "chest_flat"], ["backchest", "push"], ["Barbell Bench Press", "Bench Press (Dumbbell)"]),
    ex("Incline Bench Press (Smith Machine)", "compound", "upper chest", ["front delt", "triceps"], "machine", 5, ["chest_press", "chest_incline"], ["backchest", "push"], ["Incline Barbell Press", "Incline Dumbbell Bench Press"], { vtaper: true }),
    ex("Incline Dumbbell Bench Press", "compound", "upper chest", ["front delt", "triceps"], "dumbbell", 2.5, ["chest_press", "chest_incline"], ["backchest", "push"], ["Incline Barbell Press", "Incline Bench Press (Smith Machine)"], { vtaper: true }),
    ex("Incline Barbell Press", "compound", "upper chest", ["front delt", "triceps"], "barbell", 5, ["chest_press", "chest_incline"], ["backchest", "push"], ["Incline Bench Press (Smith Machine)", "Incline Dumbbell Bench Press"], { vtaper: true }),
    ex("Decline Dumbbell Bench Press", "compound", "chest", ["triceps"], "dumbbell", 2.5, ["chest_press", "chest_flat"], ["push", "backchest"], ["Bench Press (Dumbbell)", "Machine Chest Press"]),
    ex("Cable Fly Crossovers", "isolation", "chest", [], "cable", null, ["chest_iso"], ["push", "backchest"], ["Pec Deck Machine Flyes", "Incline Dumbbell Flyes"]),
    ex("Pec Deck Machine Flyes", "isolation", "chest", [], "machine", null, ["chest_iso"], ["push", "backchest"], ["Cable Fly Crossovers", "Incline Dumbbell Flyes"]),
    ex("Incline Dumbbell Flyes", "isolation", "upper chest", [], "dumbbell", 2.5, ["chest_iso"], ["push", "backchest"], ["Cable Fly Crossovers", "Pec Deck Machine Flyes"], { vtaper: true }),
    ex("Low-to-High Cable Fly", "isolation", "upper chest", [], "cable", null, ["chest_iso"], ["push", "backchest"], ["Incline Dumbbell Flyes", "Cable Fly Crossovers"], { vtaper: true }),
    ex("Weighted Dips", "compound", "chest", ["triceps"], "bodyweight", 2.5, ["chest_press", "chest_flat", "triceps_iso"], ["push", "backchest"], ["Machine Chest Press", "Close-Grip Bench Press"]),

    // ---- Back
    ex("Lat Pulldown (Cable)", "compound", "lats", ["biceps"], "cable", null, ["back_vertical"], ["pull", "backchest"], ["Neutral-Grip Lat Pulldowns", "Pull Up (Assisted)"], { vtaper: true }),
    ex("Wide-Grip Lat Pulldown", "compound", "lats", ["biceps"], "cable", null, ["back_vertical"], ["pull", "backchest"], ["Lat Pulldown (Cable)", "Neutral-Grip Lat Pulldowns"], { vtaper: true }),
    ex("Neutral-Grip Lat Pulldowns", "compound", "lats", ["biceps"], "cable", null, ["back_vertical"], ["pull", "backchest"], ["Lat Pulldown (Cable)", "Chin-Ups"], { vtaper: true }),
    ex("Pull Up", "compound", "lats", ["biceps"], "bodyweight", 2.5, ["back_vertical"], ["pull", "backchest"], ["Pull Up (Assisted)", "Lat Pulldown (Cable)"], { vtaper: true, grip: true }),
    ex("Pull Up (Assisted)", "compound", "lats", ["biceps"], "machine", null, ["back_vertical"], ["pull", "backchest"], ["Pull Up", "Lat Pulldown (Cable)"], { vtaper: true, grip: true }),
    ex("Chin-Ups", "compound", "lats", ["biceps"], "bodyweight", 2.5, ["back_vertical"], ["pull", "backchest"], ["Pull Up (Assisted)", "Lat Pulldown (Cable)"], { vtaper: true, grip: true }),
    ex("Inverted Rows", "compound", "back", ["biceps", "rear delt"], "bodyweight", null, ["back_horizontal", "back_secondary"], ["pull", "backchest"], ["Seated Cable Row – V Grip", "Chest-Supported Machine Rows"]),
    ex("Bent Over Row (Barbell)", "compound", "back", ["biceps", "rear delt"], "barbell", 5, ["back_horizontal", "back_secondary"], ["pull", "backchest"], ["T-Bar Rows", "Dumbbell Rows"]),
    ex("Dumbbell Rows", "compound", "back", ["biceps", "rear delt"], "dumbbell", 2.5, ["back_horizontal", "back_secondary"], ["pull", "backchest"], ["Bent Over Row (Barbell)", "T-Bar Rows"]),
    ex("Meadows Rows", "compound", "back", ["biceps", "rear delt"], "barbell", 5, ["back_horizontal", "back_secondary"], ["pull", "backchest"], ["T-Bar Rows", "Dumbbell Rows"]),
    ex("T-Bar Rows", "compound", "back", ["biceps", "rear delt"], "machine", 5, ["back_horizontal", "back_secondary"], ["pull", "backchest"], ["Bent Over Row (Barbell)", "Meadows Rows"]),
    ex("Seated Cable Row – V Grip", "compound", "back", ["biceps", "rear delt"], "cable", null, ["back_horizontal", "back_secondary"], ["pull", "backchest"], ["Chest-Supported Machine Rows", "Inverted Rows"]),
    ex("Chest-Supported Machine Rows", "compound", "back", ["rear delt"], "machine", null, ["back_horizontal", "back_secondary"], ["pull", "backchest"], ["Seated Cable Row – V Grip", "T-Bar Rows"]),
    ex("Straight-Arm Cable Pullovers", "isolation", "lats", [], "cable", null, ["back_secondary", "lat_iso"], ["pull", "backchest"], ["Straight-Arm Lat Pulldown", "Neutral-Grip Lat Pulldowns"], { vtaper: true }),
    ex("Straight-Arm Lat Pulldown", "isolation", "lats", [], "cable", null, ["lat_iso"], ["pull", "backchest"], ["Straight-Arm Cable Pullovers", "Neutral-Grip Lat Pulldowns"], { vtaper: true }),

    // ---- Shoulders
    ex("Lateral Raise (Dumbbell)", "isolation", "lateral delt", [], "dumbbell", 2.5, ["lateral_delt"], ["arms", "legs", "backchest", "push", "pull"], ["Cable Lateral Raises", "Machine Lateral Raises"], { ld: true, vtaper: true, rest: [60, 90] }),
    ex("Cable Lateral Raises", "isolation", "lateral delt", [], "cable", null, ["lateral_delt"], ["arms", "legs", "backchest", "push", "pull"], ["Lateral Raise (Dumbbell)", "Machine Lateral Raises"], { ld: true, vtaper: true, rest: [60, 90] }),
    ex("Machine Lateral Raises", "isolation", "lateral delt", [], "machine", null, ["lateral_delt"], ["arms", "legs", "backchest", "push", "pull"], ["Lateral Raise (Dumbbell)", "Cable Lateral Raises"], { ld: true, vtaper: true, rest: [60, 90] }),
    ex("Face Pulls", "isolation", "rear delt", [], "cable", null, ["rear_delt"], ["push", "pull", "backchest"], ["Cable Face Pulls", "Rear Delt Reverse Fly (Machine)"]),
    ex("Cable Face Pulls", "isolation", "rear delt", [], "cable", null, ["rear_delt"], ["push", "pull", "backchest"], ["Face Pulls", "Rear Delt Dumbbell Flyes"]),
    ex("Rear Delt Reverse Fly (Machine)", "isolation", "rear delt", [], "machine", null, ["rear_delt"], ["push", "pull", "backchest"], ["Rear Delt Dumbbell Flyes", "Cable Face Pulls"]),
    ex("Rear Delt Dumbbell Flyes", "isolation", "rear delt", [], "dumbbell", 2.5, ["rear_delt"], ["push", "pull", "backchest"], ["Rear Delt Reverse Fly (Machine)", "Cable Face Pulls"]),
    ex("Incline Dumbbell Y-Raises", "isolation", "rear delt", ["lower trap"], "dumbbell", 2.5, ["rear_delt"], ["push", "pull", "backchest"], ["Face Pulls", "Rear Delt Dumbbell Flyes"]),

    // ---- Biceps
    ex("Hammer Curl (Dumbbell)", "isolation", "biceps", ["forearm"], "dumbbell", 2.5, ["biceps_heavy", "biceps_iso"], ["arms", "pull"], ["Concentration Curls", "Reverse Cable Curls"]),
    ex("Preacher Curl (Barbell)", "isolation", "biceps", [], "barbell", 5, ["biceps_heavy", "biceps_iso"], ["arms", "pull"], ["EZ-Bar Curls", "Incline Dumbbell Curls"]),
    ex("Bicep Curl (Cable)", "isolation", "biceps", [], "cable", null, ["biceps_iso"], ["arms", "pull"], ["Dumbbell Bicep Curls", "EZ-Bar Curls"]),
    ex("Dumbbell Bicep Curls", "isolation", "biceps", [], "dumbbell", 2.5, ["biceps_heavy", "biceps_iso"], ["arms", "pull"], ["Bicep Curl (Cable)", "Incline Dumbbell Curls"]),
    ex("Concentration Curls", "isolation", "biceps", [], "dumbbell", 2.5, ["biceps_iso"], ["arms", "pull"], ["Hammer Curl (Dumbbell)", "Bicep Curl (Cable)"]),
    ex("Incline Dumbbell Curls", "isolation", "biceps", [], "dumbbell", 2.5, ["biceps_iso"], ["arms", "pull"], ["Dumbbell Bicep Curls", "Preacher Curl (Barbell)"]),
    ex("EZ-Bar Curls", "isolation", "biceps", [], "barbell", 5, ["biceps_heavy", "biceps_iso"], ["arms", "pull"], ["Preacher Curl (Barbell)", "Dumbbell Bicep Curls"]),
    ex("Reverse Cable Curls", "isolation", "biceps", ["forearm"], "cable", null, ["biceps_iso"], ["arms", "pull"], ["Hammer Curl (Dumbbell)", "Bicep Curl (Cable)"]),

    // ---- Triceps
    ex("Triceps Rope Pushdown", "isolation", "triceps", [], "cable", null, ["triceps_iso"], ["arms", "push", "backchest"], ["Straight-Bar Cable Pushdowns", "Overhead Triceps Extension (Cable)"]),
    ex("Straight-Bar Cable Pushdowns", "isolation", "triceps", [], "cable", null, ["triceps_iso"], ["arms", "push"], ["Triceps Rope Pushdown", "Overhead Triceps Extension (Cable)"]),
    ex("Overhead Triceps Extension (Cable)", "isolation", "triceps", [], "cable", null, ["triceps_iso"], ["arms", "push"], ["Overhead Dumbbell Extensions", "Triceps Rope Pushdown"]),
    ex("Overhead Dumbbell Extensions", "isolation", "triceps", [], "dumbbell", 2.5, ["triceps_iso"], ["arms", "push"], ["Overhead Triceps Extension (Cable)", "EZ-Bar Skull Crushers"]),
    ex("EZ-Bar Skull Crushers", "isolation", "triceps", [], "barbell", 5, ["triceps_iso", "triceps_heavy"], ["arms", "push"], ["Overhead Dumbbell Extensions", "Close-Grip Bench Press"]),
    ex("Close-Grip Bench Press", "compound", "triceps", ["chest"], "barbell", 5, ["triceps_iso", "triceps_heavy", "chest_press"], ["arms", "push", "backchest"], ["EZ-Bar Skull Crushers", "Weighted Dips"]),

    // ---- Legs: quads / glutes
    ex("Barbell Back Squat", "compound", "quads", ["glutes"], "barbell", 5, ["lower_compound"], ["legs"], ["Hack Squat", "Leg Press"]),
    ex("Hack Squat", "compound", "quads", ["glutes"], "machine", null, ["lower_compound"], ["legs"], ["Barbell Back Squat", "Leg Press"]),
    ex("Leg Press", "compound", "quads", ["glutes"], "machine", null, ["lower_compound"], ["legs"], ["Hack Squat", "Goblet Squat"]),
    ex("Goblet Squat", "compound", "quads", ["glutes"], "dumbbell", 2.5, ["lower_compound"], ["legs"], ["Leg Press", "Bulgarian Split Squat"]),
    ex("Bulgarian Split Squat", "compound", "quads", ["glutes"], "dumbbell", 2.5, ["lower_compound", "quad_iso"], ["legs"], ["Walking Lunges", "Goblet Squat"]),
    ex("Walking Lunges", "compound", "quads", ["glutes"], "dumbbell", 2.5, ["lower_compound"], ["legs"], ["Bulgarian Split Squat", "Goblet Squat"]),
    ex("Leg Extensions", "isolation", "quads", [], "machine", null, ["quad_iso"], ["legs"], ["Hack Squat", "Goblet Squat"]),

    // ---- Legs: hamstrings / posterior chain
    ex("Romanian Deadlift (Barbell)", "compound", "hamstrings", ["glutes", "lower back"], "barbell", 5, ["posterior_chain"], ["legs"], ["Cable Pull-Throughs", "Lying Leg Curls"]),
    ex("Seated Leg Curls", "isolation", "hamstrings", [], "machine", null, ["knee_flexion", "posterior_chain"], ["legs"], ["Lying Leg Curls", "Cable Pull-Throughs"]),
    ex("Lying Leg Curls", "isolation", "hamstrings", [], "machine", null, ["knee_flexion", "posterior_chain"], ["legs"], ["Seated Leg Curls", "Cable Pull-Throughs"]),
    ex("Cable Pull-Throughs", "compound", "hamstrings", ["glutes"], "cable", null, ["posterior_chain"], ["legs"], ["Romanian Deadlift (Barbell)", "Lying Leg Curls"]),

    // ---- Glutes accessory
    ex("Hip Thrusts", "compound", "glutes", ["hamstrings"], "barbell", 5, ["posterior_chain"], ["legs"], ["Cable Pull-Throughs", "Romanian Deadlift (Barbell)"]),

    // ---- Calves
    ex("Standing Calf Raises", "isolation", "calves", [], "machine", null, ["calves"], ["legs", "push", "pull"], ["Seated Calf Raises"]),
    ex("Seated Calf Raises", "isolation", "calves", [], "machine", null, ["calves"], ["legs"], ["Standing Calf Raises"]),

    // ---- Abs / core
    ex("Weighted Cable Crunches", "isolation", "abs", [], "cable", null, ["ab_flexion"], ["push", "pull"], ["Machine Ab Crunches", "Hanging Leg Raises"]),
    ex("Machine Ab Crunches", "isolation", "abs", [], "machine", null, ["ab_flexion"], ["push", "pull"], ["Weighted Cable Crunches", "Hanging Leg Raises"]),
    ex("Hanging Leg Raises", "isolation", "lower abs", [], "bodyweight", 2.5, ["ab_lower"], ["push", "pull"], ["Machine Ab Crunches", "Weighted Cable Crunches"]),
  ];

  const LIB_BY_NAME = {};
  LIBRARY.forEach((e) => (LIB_BY_NAME[e.name] = e));

  /* ----------------------------------------------------------- baseline logs */
  // §5 baseline lift data. Parsed into individual set rows so the progression
  // engine has real history to read on day one. data_source marks them as the
  // lifter's reported baseline, not algorithmically estimated.
  // Format: [name, "w×r, w×r, ...", noteOrNull, {rpe?:{setIndex:val}}]
  const BASELINE_RAW = [
    ["Bench Press (Dumbbell)", "17.5×12, 20×12, 22.5×8", null],
    ["Incline Bench Press (Smith Machine)", "50×12, 60×8, 50×10", "Top set inconsistent — 50–55kg working weight"],
    ["Cable Fly Crossovers", "10×12, 15×7, 10×10", null],
    ["Triceps Rope Pushdown", "25×15, 30×12, 30×6", null],
    ["Rear Delt Reverse Fly (Machine)", "32×15, 32×15, 32×15", "All sets top of range at RPE10 — ready to increase", { rpe: { 0: 10, 1: 10, 2: 10 } }],
    ["Lateral Raise (Dumbbell)", "7.5×10, 5×20, 5×15, 5×15, 5×12", "Weight inconsistent — standardize to 5–6kg working weight"],
    ["Overhead Triceps Extension (Cable)", "10×12, 10×10, 5×12, 5×10", "Single-arm"],
    ["Hammer Curl (Dumbbell)", "10×12, 12.5×7, 10×8", null],
    ["Preacher Curl (Barbell)", "15×15, 15×12, 15×10", "Hit 15/12/10 vs an 8-rep target — too light, increase"],
    ["Pull Up", "0×5", "Bodyweight — 5 reps"],
    ["Pull Up (Assisted)", "20×12, 20×8", "Grip/forearm fatigue noted — see grip fail-safe"],
    ["Bent Over Row (Barbell)", "40×8, 45×8, 50×8, 50×7", null],
    ["Lat Pulldown (Cable)", "29×12, 36×12, 43×8, 43×7", null],
    ["Seated Cable Row – V Grip", "29×12, 36×8, 36×5", null],
    ["Bicep Curl (Cable)", "20×12, 25×12, 25×10", null],
    // Weighted Cable Crunch + Hanging Leg Raise intentionally have NO history
    // so they trigger the calibration pass (§5) on first appearance.
  ];

  function parseBaseline(daysAgoISO) {
    const rows = [];
    BASELINE_RAW.forEach(([name, sets, note, opt]) => {
      opt = opt || {};
      sets.split(",").forEach((chunk, i) => {
        const m = chunk.trim().match(/^([\d.]+)\s*[×x]\s*([\d.]+)/);
        if (!m) return;
        rows.push({
          exercise: name,
          weight: parseFloat(m[1]),
          reps: parseInt(m[2], 10),
          rpe: opt.rpe && opt.rpe[i] != null ? opt.rpe[i] : null,
          notes: i === 0 ? note || "" : "",
          date: daysAgoISO,
          session_type: "baseline",
          week_of_cycle: 1,
          data_source: "user-reported-baseline",
        });
      });
    });
    return rows;
  }

  /* ------------------------------------------------------- session structure */
  // §3 — each session is an ordered list of slots. A slot names the role(s) a
  // movement must fill, the rep band, and whether it is the fixed lateral-delt
  // slot (§4a). `distinct` forces a different exercise/angle from an earlier
  // slot's pick. `count` repeats a slot (e.g. Pull's 3 biceps movements).
  // §4 width-priority redesign. The V-taper is driven by lateral-delt frequency
  // (a fixed ld slot on every lifting day), lat width (vertical pulls + a lat
  // isolation), and upper-chest emphasis (incline pressing leads the chest).
  // Rear delts now get a real slot on Push and Pull (they were in the library
  // but no slot ever asked for them). Abs are one focused slot per weekend day
  // — flexion on Push, lower abs on Pull — so neither pattern is skipped and
  // neither day is padded with two ab moves at the expense of the target muscles.
  const SESSIONS = {
    // Accessory upper day: balanced arms (heavy bi + heavy/iso tri) + width delt.
    arms: {
      label: "Arms",
      kind: "weekday",
      slots: [
        { role: "biceps_heavy", band: "weekday_main", label: "Heavy biceps", warmup: true },
        { role: "triceps_heavy", band: "weekday_main", label: "Heavy triceps — compound" },
        { role: "triceps_iso", band: "isolation", label: "Triceps isolation — new angle", distinctFrom: 1 },
        { role: "lateral_delt", band: "lateral_delt", label: "Lateral delt — width", ld: true },
      ],
    },
    // Maintenance lower day, keeping the lateral-delt width slot in rotation.
    legs: {
      label: "Legs",
      kind: "weekday",
      slots: [
        { role: "lower_compound", band: "weekday_main", label: "Heavy lower compound", warmup: true },
        { role: "posterior_chain", band: "weekday_main", label: "Posterior chain hinge" },
        { role: ["knee_flexion", "quad_iso"], band: "isolation", label: "Knee flexion / quad isolation" },
        { role: "lateral_delt", band: "lateral_delt", label: "Lateral delt — width", ld: true },
      ],
    },
    // Dedicated WIDTH day: lat width (vertical + isolation), upper chest, lateral.
    backchest: {
      label: "Back/Chest",
      kind: "weekday",
      slots: [
        { role: "back_vertical", band: "weekday_main", label: "Vertical pull — lat width", warmup: true },
        { role: "chest_incline", band: "weekday_main", label: "Incline press — upper chest" },
        { role: "lat_iso", band: "isolation", label: "Lat isolation — width" },
        { role: "lateral_delt", band: "lateral_delt", label: "Lateral delt — width", ld: true },
      ],
    },
    // Push — 3 chest (incline-led) / 2 delts (lateral + rear) / 1 triceps / 1 ab.
    push: {
      label: "Push",
      kind: "weekend",
      slots: [
        { role: "chest_incline", band: "weekend_main", label: "Incline press — upper chest", warmup: true },
        { role: "chest_flat", band: "weekend_main", label: "Flat / mid-chest press" },
        { role: "chest_iso", band: "isolation", label: "Chest fly — stretch & squeeze" },
        { role: "lateral_delt", band: "lateral_delt", label: "Lateral delt — width", ld: true },
        { role: "rear_delt", band: "rear_delt", label: "Rear delt — round the shoulder" },
        { role: "triceps_iso", band: "isolation", label: "Triceps isolation" },
        { role: "ab_flexion", band: "ab_weighted", label: "Weighted ab — flexion" },
      ],
    },
    // Pull — 4 back (1 vertical + 2 rows + lat isolation) / rear delt / biceps / ab.
    pull: {
      label: "Pull",
      kind: "weekend",
      slots: [
        { role: "back_vertical", band: "weekend_main", label: "Vertical pull — lat width", warmup: true },
        { role: "back_horizontal", band: "weekend_main", label: "Row — back thickness" },
        { role: "back_horizontal", band: "isolation", label: "Row — second angle", distinctFrom: 1 },
        { role: "lat_iso", band: "isolation", label: "Lat isolation — width" },
        { role: "rear_delt", band: "rear_delt", label: "Rear delt — round the shoulder" },
        { role: "biceps_iso", band: "isolation", label: "Biceps" },
        { role: "ab_lower", band: "ab_lower", label: "Lower abs" },
      ],
    },
  };

  /* --------------------------------------------------------------- calendar */
  // §2 fixed calendar + §2a 4-week rotating split. The explicit calendar in §2
  // governs which DAY a slot falls on (Tue = Weekday A, Thu = Weekday B,
  // Sat = Push, Sun = Pull, Wed/Fri = Cardio, Mon = off). §2a governs which
  // session CONTENT fills Weekday A / B for the current cycle week.
  const SPLIT = {
    1: { A: "arms", B: "legs", wknA: "push", wknB: "pull" },
    2: { A: "backchest", B: "arms", wknA: "push", wknB: "pull" },
    3: { A: "backchest", B: "legs", wknA: "push", wknB: "pull" },
    4: { A: "arms", B: "legs", wknA: "push", wknB: "pull" },
  };

  const DOW = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

  // Returns the planned slot for a calendar date given the cycle week (1–4).
  // kind: "weekday" | "weekend" | "cardio" | "off".
  function plannedForDate(date, cycleWeek) {
    const d = DOW[new Date(date + "T00:00:00").getDay()];
    const wk = SPLIT[((cycleWeek - 1) % 4) + 1];
    switch (d) {
      case "mon": return { kind: "off", label: "Rest day", session: null, day: "Monday" };
      case "tue": return { kind: "weekday", slot: "A", session: wk.A, day: "Tuesday" };
      case "wed": return { kind: "cardio", label: "Zone 2 cardio", session: null, day: "Wednesday" };
      case "thu": return { kind: "weekday", slot: "B", session: wk.B, day: "Thursday" };
      case "fri": return { kind: "cardio", label: "Zone 2 cardio", session: null, day: "Friday", buffer: true };
      case "sat": return { kind: "weekend", slot: "wknA", session: wk.wknA, day: "Saturday" };
      case "sun": return { kind: "weekend", slot: "wknB", session: wk.wknB, day: "Sunday" };
    }
  }

  /* ------------------------------------------------------- date / math utils */
  function toISO(d) {
    const z = new Date(d);
    return z.getFullYear() + "-" + String(z.getMonth() + 1).padStart(2, "0") + "-" + String(z.getDate()).padStart(2, "0");
  }
  function daysBetween(aISO, bISO) {
    const a = new Date(aISO + "T00:00:00"), b = new Date(bISO + "T00:00:00");
    return Math.round((b - a) / 86400000);
  }
  function roundTo(x, step) { return Math.round(x / step) * step; }
  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

  // Resolve the increment used for a lift: dumbbell 2.5 / barbell 5 fixed;
  // machine & cable use the lifter-reported value if known, else 2.5 (§9d).
  function incrementFor(exercise, reported) {
    if (exercise.increment != null) return exercise.increment;
    if (reported && reported[exercise.name] != null) return reported[exercise.name];
    return 2.5;
  }

  /* ----------------------------------------------------------- training week */
  // §10 deload cadence. trainingWeek is weeks since the program start. First
  // deload after 4 weeks (re-entry adjustment), then roughly every 6 weeks.
  function trainingWeek(startISO, todayISO) {
    return Math.floor(daysBetween(startISO, todayISO) / 7) + 1;
  }
  function isDeloadWeek(startISO, todayISO) {
    const w = trainingWeek(startISO, todayISO);
    if (w < 5) return false;
    if (w === 5) return true;          // first deload after 4 weeks
    return (w - 5) % 6 === 0;          // then every ~6 weeks
  }

  /* ----------------------------------------------------- absence adjustment */
  // §14c — global load haircut based on the gap since the last logged session.
  function absenceAdjustment(lastLogISO, todayISO) {
    if (!lastLogISO) return { mult: 1, holdDays: 0, gap: null, label: null };
    const gap = daysBetween(lastLogISO, todayISO);
    if (gap <= 7) return { mult: 1, holdDays: 0, gap, label: null };
    if (gap <= 14) return { mult: 0.9, holdDays: 0, gap, label: "−10% (2-week gap)" };
    if (gap <= 28) return { mult: 0.85, holdDays: 7, gap, label: "−15% (3–4 week gap), hold 1 week" };
    if (gap <= 56) return { mult: 0.8, holdDays: 14, gap, label: "−20% (5–8 week gap), hold 2 weeks" };
    return { mult: 0.75, holdDays: 14, gap, label: "−25% (9+ week gap), hold 2 weeks then ramp" };
  }

  /* --------------------------------------------------------- log inspection */
  function logsFor(name, logs) {
    return logs
      .filter((l) => l.exercise === name && l.session_type !== "measurement")
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }
  function lastSessionSets(name, logs, beforeISO) {
    const all = logsFor(name, logs).filter((l) => !beforeISO || l.date < beforeISO);
    if (!all.length) return null;
    const day = all[0].date;
    return { date: day, sets: all.filter((l) => l.date === day) };
  }
  // Working weight = the weight that appears in the most working sets (ties → heavier).
  function workingWeight(sets) {
    const tally = {};
    sets.forEach((s) => { tally[s.weight] = (tally[s.weight] || 0) + 1; });
    let best = null, bestN = -1;
    Object.keys(tally).forEach((w) => {
      const n = tally[w], wn = parseFloat(w);
      if (n > bestN || (n === bestN && wn > best)) { best = wn; bestN = n; }
    });
    return best;
  }
  function lastLogDate(logs) {
    const real = logs.filter((l) => l.session_type !== "measurement" && l.data_source !== "user-reported-baseline");
    if (!real.length) return null;
    return real.map((l) => l.date).sort().slice(-1)[0];
  }

  /* ===================================================================== §8 */
  // Core progression decision for one lift. Returns the next prescription line.
  function prescribe(exercise, band, slotSets, logs, ctx) {
    const [lo, hi] = BANDS[band];
    const inc = incrementFor(exercise, ctx.machineIncrements);
    const rest = exercise.rest;
    const isBodyweight = exercise.equipment === "bodyweight";

    const base = {
      exercise: exercise.name,
      equipment: exercise.equipment,
      band, rep_low: lo, rep_high: hi,
      rest_low: rest[0], rest_high: rest[1],
      sets: slotSets,
      flags: [],
    };

    const last = lastSessionSets(exercise.name, logs, ctx.todayISO + "~"); // include today-1 and earlier
    // ---- no history → calibration pass (§5)
    if (!last) {
      const est = estimateStartingWeight(exercise, logs, ctx);
      return Object.assign(base, {
        weight: est.weight,
        target_reps: lo,
        note: est.weight == null
          ? "First time — tell the app your starting weight"
          : "Calibration — set your baseline today",
        flags: est.weight == null ? ["needs_input"] : ["estimated"],
        last_time: null,
      });
    }

    const prev = lastSessionSets(exercise.name, logs, last.date);
    const ww = workingWeight(last.sets);
    const setsAtWW = last.sets.filter((s) => s.weight === ww);
    const repsAtWW = setsAtWW.map((s) => s.reps);
    const bestReps = Math.max.apply(null, repsAtWW);
    const allTop = setsAtWW.every((s) => s.reps >= hi);
    const anyFail = last.sets.some((s) => (s.rpe != null && s.rpe >= 10) || s.reps < lo);
    const increasedLastTime = prev ? ww > workingWeight(prev.sets) : false;

    const last_time = {
      date: last.date,
      summary: last.sets.map((s) => `${s.weight || "BW"}×${s.reps}`).join(", "),
    };

    let weight = ww, target = hi, note = "Push for the top of the range", flag = "work";

    // §0 re-entry ramp takes priority: hold weight, rebuild reps.
    if (ctx.reentryActive) {
      weight = ww; target = clamp(bestReps, lo, hi);
      note = "Re-entry ramp — hold weight, rebuild reps"; flag = "reentry";
    } else if (anyFail) {
      // §8 failure freeze
      weight = ww; target = bestReps;
      note = "Hold — match or beat last session"; flag = "freeze";
    } else if (allTop && !increasedLastTime) {
      const jump = inc / ww;
      if (ww > 0 && jump > 0.10) {
        // §8 disproportionate-jump fallback → add reps instead of weight
        weight = ww; target = hi + 2;
        note = `Big jump for the load — add reps (target ${hi + 2})`; flag = "reps_bump";
      } else {
        weight = isBodyweight ? ww : ww + inc;
        target = lo;
        note = isBodyweight ? `Add ${inc}kg or push reps` : `Load up — +${inc}kg`;
        flag = "increase";
      }
    } else if (allTop && increasedLastTime) {
      // §8 safety cap: never increase two sessions in a row
      weight = ww; target = hi;
      note = "Hold one session — no back-to-back increases"; flag = "cap_hold";
    }

    // §14c extended-absence haircut (applied after the progression decision).
    if (ctx.absence && ctx.absence.mult < 1) {
      weight = weight == null ? weight : roundTo(weight * ctx.absence.mult, isBodyweight ? 2.5 : 0.5);
      base.flags.push("absence");
      note = `${ctx.absence.label}. ${note}`;
    }

    // §10 deload week: cut ~10%, drop a set, keep reps in band.
    if (ctx.deloadWeek) {
      weight = weight == null ? weight : roundTo(weight * 0.9, isBodyweight ? 2.5 : 0.5);
      base.sets = Math.max(1, slotSets - 1);
      target = clamp(target, lo, hi);
      base.flags.push("deload");
      note = "Deload week — lighter, one less set. " + note;
    }

    // Forced per-lift deload (§10): RPE10 + missed reps in 2 consecutive sessions.
    if (forcedDeload(exercise.name, logs, [lo, hi])) {
      weight = weight == null ? weight : roundTo(ww * 0.9, isBodyweight ? 2.5 : 0.5);
      target = clamp(bestReps, lo, hi);
      if (!base.flags.includes("deload")) base.flags.push("forced_deload");
      note = "Forced deload — this lift stalled twice. Reset and rebuild.";
      flag = "freeze";
    }

    base.flags.unshift(flag);
    return Object.assign(base, { weight, target_reps: target, note, last_time });
  }

  // §10 forced deload trigger.
  function forcedDeload(name, logs, band) {
    const [lo, hi] = band;
    const byDay = {};
    logsFor(name, logs).forEach((l) => { (byDay[l.date] = byDay[l.date] || []).push(l); });
    const days = Object.keys(byDay).sort().reverse().slice(0, 2);
    if (days.length < 2) return false;
    return days.every((day) =>
      byDay[day].some((s) => (s.rpe != null && s.rpe >= 10)) &&
      byDay[day].some((s) => s.reps < lo)
    );
  }

  // §5 / §9c — estimate a starting weight for a never-logged lift from a related
  // logged movement sharing the primary muscle. Returns {weight|null}.
  function estimateStartingWeight(exercise, logs, ctx) {
    const related = LIBRARY.filter(
      (e) => e.name !== exercise.name && e.primary === exercise.primary && lastSessionSets(e.name, logs, ctx.todayISO + "~")
    );
    if (!related.length) return { weight: null };
    const ref = related[0];
    const ww = workingWeight(lastSessionSets(ref.name, logs, ctx.todayISO + "~").sets) || 0;
    // Conservative: same-equipment ~0.85×, otherwise start lighter still.
    const factor = ref.equipment === exercise.equipment ? 0.85 : 0.7;
    const w = exercise.equipment === "bodyweight" ? 0 : roundTo(ww * factor, 2.5);
    return { weight: w };
  }

  /* ---------------------------------------------- grip fail-safe note (§8) */
  function gripAdvisory(exercise, logs) {
    if (!exercise.grip_limited) return null;
    const recent = logsFor(exercise.name, logs).slice(0, 3);
    const flagged = recent.some((l) => /grip|forearm/i.test(l.notes || ""));
    if (!flagged && !PROFILE.known_limiter.match(/grip/i)) return null;
    return "Grip fatigue flagged on pulling — straps recommended, or swap to a chest-supported row.";
  }

  /* ============================================ exercise selection (§3a/§4) */
  // Deterministic but rotating selection. Within a slot's eligible pool we:
  //  • prefer movements with logged history (so progression has data),
  //  • bias V-taper builders (§4),
  //  • rotate using a per-cycle seed to add variety week to week,
  //  • never repeat a movement already chosen earlier in the same session.
  function eligible(slot, sessionKey, used) {
    const roles = Array.isArray(slot.role) ? slot.role : [slot.role];
    return LIBRARY.filter((e) => {
      if (used.has(e.name)) return false;
      if (!e.sessions.includes(sessionKey)) return false;
      return roles.some((r) => e.roles.includes(r));
    });
  }
  function pickForSlot(slot, sessionKey, used, logs, ctx, seed) {
    let pool = eligible(slot, sessionKey, used);
    if (slot.ld) pool = pool.filter((e) => e.lateral_delt); // §4a hard slot
    if (!pool.length) return null;

    // distinctFrom: avoid same primary muscle/angle as an earlier pick.
    if (slot.distinctFrom != null && ctx._picks && ctx._picks[slot.distinctFrom]) {
      const earlier = LIB_BY_NAME[ctx._picks[slot.distinctFrom]];
      const filtered = pool.filter((e) => e.name !== (earlier && earlier.name));
      if (filtered.length) pool = filtered;
    }

    const score = (e) => {
      let s = 0;
      const hist = lastSessionSets(e.name, logs, ctx.todayISO + "~");
      if (hist) s += 5;                       // history → progression works
      if (e.vtaper) s += 2;                   // §4 V-taper bias
      // rotation: gently de-prioritise what was used most recently
      const recency = ctx.recentlyUsed ? ctx.recentlyUsed.indexOf(e.name) : -1;
      if (recency === 0) s -= 3; else if (recency === 1) s -= 1.5;
      // seed jitter for variety across weeks
      s += ((hashStr(e.name + seed) % 100) / 100) * 1.5;
      return s;
    };
    pool.sort((a, b) => score(b) - score(a));
    return pool[0];
  }
  function hashStr(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) { h = (h * 31 + str.charCodeAt(i)) | 0; }
    return Math.abs(h);
  }

  function setCountFor(slot, def) {
    if (slot.warmup) return def.workingSets; // working sets; warm-ups added in UI
    return def.workingSets;
  }

  /* ====================================================== build a session  */
  // Top-level: given a session key + state, produce the ordered, fully-priced
  // plan the pre-session screen (§15a) renders. Pure & deterministic.
  function buildSession(sessionKey, state, opts) {
    opts = opts || {};
    const def = SESSIONS[sessionKey];
    if (!def) throw new Error("Unknown session: " + sessionKey);
    const logs = state.logs || [];
    const todayISO = opts.todayISO || toISO(new Date());
    const startISO = state.profile && state.profile.program_start ? state.profile.program_start : todayISO;

    const ctx = {
      todayISO,
      machineIncrements: state.machineIncrements || {},
      reentryActive: daysBetween(startISO, todayISO) < (state.profile && state.profile.reentry_days || PROFILE.reentry_days),
      absence: absenceAdjustment(lastLogDate(logs), todayISO),
      deloadWeek: isDeloadWeek(startISO, todayISO),
      recentlyUsed: recentExerciseOrder(logs),
      _picks: {},
    };

    const workingSets = def.kind === "weekend" ? 3 : 3;
    const used = new Set();
    const items = [];

    def.slots.forEach((slot, idx) => {
      const choice = pickForSlot(slot, sessionKey, used, logs, ctx, sessionKey + ctx.deloadWeek + idx);
      if (!choice) return;
      used.add(choice.name);
      ctx._picks[idx] = choice.name;

      const line = prescribe(choice, slot.band, setCountFor(slot, { workingSets }), logs, ctx);
      line.slot_label = slot.label;
      line.is_lateral_delt = !!slot.ld;
      line.warmup = !!slot.warmup;
      const grip = gripAdvisory(choice, logs);
      if (grip) line.note = grip;
      items.push(line);
    });

    return {
      session_key: sessionKey,
      session_label: def.label,
      kind: def.kind,
      cap_min: def.kind === "weekend" ? PROFILE.weekend_cap_min : PROFILE.weekday_cap_min,
      date: todayISO,
      cycle_week: state.cycleWeek || 1,
      banners: buildBanners(ctx),
      items,
    };
  }

  function buildBanners(ctx) {
    const b = [];
    if (ctx.reentryActive) b.push({ tone: "warn", text: "Re-entry ramp — weeks 1–2 hold at last logged weight (§0)." });
    if (ctx.deloadWeek) b.push({ tone: "warn", text: "Deload week — loads cut ~10%, one less set per lift (§10)." });
    if (ctx.absence && ctx.absence.label) b.push({ tone: "warn", text: "Returning after a gap — " + ctx.absence.label + " (§14c)." });
    return b;
  }

  // Order of exercises by how recently they were last performed (most recent first).
  function recentExerciseOrder(logs) {
    const lastDate = {};
    logs.forEach((l) => {
      if (l.session_type === "measurement") return;
      if (!lastDate[l.exercise] || l.date > lastDate[l.exercise]) lastDate[l.exercise] = l.date;
    });
    return Object.keys(lastDate).sort((a, b) => (lastDate[a] < lastDate[b] ? 1 : -1));
  }

  /* ================================================= availability swap (§9) */
  // §9a/§9b — swap an unavailable movement for an alternative in the same role,
  // carrying over an equivalent starting weight via the conversion heuristics.
  const CONVERSIONS = [
    // [fromPattern, toPattern, factor] — multiply the from-weight to estimate to-weight.
    [/dumbbell/i, /barbell/i, 2.4],     // total DB → barbell (≈ ×1.2 of total, DB total = 2×per-hand)
    [/barbell/i, /dumbbell/i, 1 / 2.4],
    [/smith/i, /barbell/i, 0.92],
    [/leg press/i, /hack squat/i, 0.55],
    [/hack squat/i, /leg press/i, 1.8],
  ];
  function convertWeight(fromName, toName, w) {
    if (w == null) return null;
    for (const [a, b, f] of CONVERSIONS) {
      if (a.test(fromName) && b.test(toName)) return roundTo(w * f, 2.5);
    }
    return roundTo(w, 0.5); // same-class movements: keep the load, adjust by feel
  }
  function swapExercise(line, state, opts) {
    const current = LIB_BY_NAME[line.exercise];
    if (!current) return line;
    const altNames = current.alts.concat(
      // fall back to any same-role library movement if listed alts are also out
      LIBRARY.filter((e) => e.name !== current.name && e.roles.some((r) => (current.roles || []).includes(r))).map((e) => e.name)
    );
    const excluded = new Set((opts && opts.excluded) || []);
    const altName = altNames.find((n) => n !== current.name && !excluded.has(n) && LIB_BY_NAME[n]);
    if (!altName) return line;
    const alt = LIB_BY_NAME[altName];
    const newWeight = convertWeight(current.name, alt.name, line.weight);
    return Object.assign({}, line, {
      exercise: alt.name,
      equipment: alt.equipment,
      weight: newWeight,
      rest_low: alt.rest[0], rest_high: alt.rest[1],
      note: `Swapped in for ${current.name} (unavailable). Estimated starting weight — adjust by feel.`,
      flags: ["estimated", "swap"],
      is_lateral_delt: line.is_lateral_delt,
      last_time: lastSessionSets(alt.name, state.logs || [], (opts && opts.todayISO || toISO(new Date())) + "~") ? {
        summary: lastSessionSets(alt.name, state.logs, (opts && opts.todayISO || toISO(new Date())) + "~").sets.map((s) => `${s.weight || "BW"}×${s.reps}`).join(", "),
      } : null,
    });
  }

  /* ------------------------------------------------------- cycle bookkeeping */
  // §2a — advance the 4-week counter at the start of a new training week, but
  // never during a deload or because of an absence.
  function maybeAdvanceCycle(state, todayISO) {
    const start = state.profile && state.profile.program_start ? state.profile.program_start : todayISO;
    if (isDeloadWeek(start, todayISO)) return state.cycleWeek; // frozen during deload
    const w = trainingWeek(start, todayISO);
    // Map elapsed non-deload weeks onto the 1..4 cycle.
    return ((w - 1) % 4) + 1;
  }

  /* --------------------------------------------------------------- exports */
  return {
    PROFILE, BANDS, LIBRARY, LIB_BY_NAME, SESSIONS, SPLIT,
    parseBaseline, BASELINE_RAW,
    plannedForDate, buildSession, swapExercise, prescribe,
    absenceAdjustment, isDeloadWeek, trainingWeek, maybeAdvanceCycle,
    incrementFor, workingWeight, lastSessionSets, logsFor, lastLogDate,
    toISO, daysBetween, gripAdvisory, forcedDeload, convertWeight,
  };
});
