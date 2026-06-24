/* ============================================================================
   game.js — the gamification layer (pure, derived, sync-safe by construction).
   ----------------------------------------------------------------------------
   Every number here is computed from the SAME training logs the rest of the app
   already stores and syncs. There is no extra table, no extra write, nothing to
   keep in sync: finish a session, the log rows land, and your XP / level /
   streak / perfect-week count fall straight out of them. Replay the logs on any
   device and you get the identical character.

   What earns XP
     • completing a lifting session            +100
     • each working set you log                  +4
     • a strength PR on a lift (new top weight) +20  (max 3 per session)
     • a "perfect week" — all 4 lifting          +250
       sessions in a calendar week covered
       (a made-up session counts)

   Levels use a gently steepening curve; tiers (Bronze→Mythic) drive how the
   on-screen lifter upgrades. Dual-mode: window.GymGame in the browser, and
   module.exports under Node for tests.
   ========================================================================== */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.GymGame = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const XP = {
    session: 100,
    perSet: 4,
    pr: 20,
    prCap: 3,
    perfectWeek: 250,
  };
  const WEEK_TARGET = 4;                 // Tue / Thu / Sat / Sun lifting sessions
  const LIFTING_DOW = { 2: true, 4: true, 6: true, 0: true }; // Tue,Thu,Sat,Sun

  /* ----------------------------------------------------------- level curve */
  // XP to go from level L to L+1. Starts at 200, +120 each level.
  function reqForLevel(L) { return 200 + (L - 1) * 120; }

  function levelFromXP(xp) {
    let level = 1, remaining = Math.max(0, Math.floor(xp || 0));
    while (remaining >= reqForLevel(level)) { remaining -= reqForLevel(level); level += 1; }
    const span = reqForLevel(level);
    const t = tierFor(level);
    return {
      level,
      into: remaining,
      span,
      pct: Math.max(0, Math.min(1, remaining / span)),
      toNext: span - remaining,
      title: t.title,
      tier: t.key,
      tierName: t.name,
      color: t.color,
    };
  }

  /* ------------------------------------------------------------- tiers */
  // Title + visual tier by level band. `rankInTier` (0..) lets the avatar add
  // small upgrades within a tier (bigger plates / brighter aura).
  const TIERS = [
    { max: 1,   key: "bronze",   name: "Bronze",   title: "Novice",      color: "#C98A5E" },
    { max: 3,   key: "bronze",   name: "Bronze",   title: "Initiate",    color: "#C98A5E" },
    { max: 5,   key: "silver",   name: "Silver",   title: "Apprentice",  color: "#C7D0D8" },
    { max: 8,   key: "silver",   name: "Silver",   title: "Journeyman",  color: "#C7D0D8" },
    { max: 11,  key: "gold",     name: "Gold",     title: "Adept",       color: "#E8B04B" },
    { max: 15,  key: "gold",     name: "Gold",     title: "Veteran",     color: "#E8B04B" },
    { max: 19,  key: "platinum", name: "Platinum", title: "Elite",       color: "#7FE3D0" },
    { max: 24,  key: "diamond",  name: "Diamond",  title: "Master",      color: "#6FB1FF" },
    { max: 9999,key: "mythic",   name: "Mythic",   title: "Iron Warden", color: "#B583FF" },
  ];
  function tierFor(level) {
    const band = TIERS.find((t) => level <= t.max) || TIERS[TIERS.length - 1];
    // ordinal of the tier (bronze=0 … mythic=5) for avatar feature gating
    const order = ["bronze", "silver", "gold", "platinum", "diamond", "mythic"].indexOf(band.key);
    return Object.assign({ order, rankInTier: 0 }, band);
  }

  /* -------------------------------------------------------- date helpers */
  function iso(d) {
    const z = new Date(d);
    return z.getFullYear() + "-" + String(z.getMonth() + 1).padStart(2, "0") + "-" + String(z.getDate()).padStart(2, "0");
  }
  function addDays(s, n) { return iso(new Date(new Date(s + "T00:00:00").getTime() + n * 86400000)); }
  function mondayOf(s) {
    const d = new Date(s + "T00:00:00");
    return addDays(s, -((d.getDay() + 6) % 7));
  }
  function dow(s) { return new Date(s + "T00:00:00").getDay(); }
  function isReal(l) { return l.session_type !== "measurement" && l.session_type !== "baseline"; }

  /* ------------------------------------------------- per-session breakdown */
  // Walks logs in date order, seeding strength PRs from the baseline so a first
  // real session at baseline weight is not falsely a PR. Returns the XP-earning
  // sessions (baseline days earn nothing but still seed the running maxes).
  function perSession(logs) {
    const byDate = {};
    (logs || []).forEach((l) => { (byDate[l.date] = byDate[l.date] || []).push(l); });
    const dates = Object.keys(byDate).sort();

    const runningMax = {};                 // exercise -> heaviest weight seen so far
    const sessions = [];                   // {date, type, sets, prs, xp}

    dates.forEach((date) => {
      const rows = byDate[date];
      const real = rows.filter(isReal);

      if (real.length) {
        // PRs are judged against everything strictly before today.
        const dayMax = {};
        real.forEach((r) => {
          if (r.weight == null || r.weight <= 0) return;
          if (dayMax[r.exercise] == null || r.weight > dayMax[r.exercise]) dayMax[r.exercise] = r.weight;
        });
        let prs = 0;
        Object.keys(dayMax).forEach((ex) => {
          if (runningMax[ex] == null || dayMax[ex] > runningMax[ex]) prs += 1;
        });
        prs = Math.min(prs, XP.prCap);
        const xp = XP.session + XP.perSet * real.length + XP.pr * prs;
        sessions.push({ date, type: real[0].session_type, sets: real.length, prs, xp });
      }

      // update running maxes with this day's loads (baseline included)
      rows.forEach((r) => {
        if (r.weight == null || r.weight <= 0) return;
        if (runningMax[r.exercise] == null || r.weight > runningMax[r.exercise]) runningMax[r.exercise] = r.weight;
      });
    });

    return sessions;
  }

  /* ------------------------------------------------------- perfect weeks */
  function perfectWeekCount(logs) {
    const weeks = {};
    (logs || []).filter(isReal).forEach((l) => {
      const wk = mondayOf(l.date);
      (weeks[wk] = weeks[wk] || new Set()).add(l.date);
    });
    let count = 0;
    Object.keys(weeks).forEach((wk) => { if (weeks[wk].size >= WEEK_TARGET) count += 1; });
    return count;
  }

  /* --------------------------------------------------------------- streak */
  // Consecutive scheduled lifting sessions completed, walking back from today.
  // Today is not counted against you if it is a lifting day not yet logged.
  function streak(logs, programStart, todayISO) {
    const done = new Set((logs || []).filter(isReal).map((l) => l.date));
    if (!programStart) programStart = todayISO;
    let n = 0;
    let d = todayISO;
    // guard against runaway loops
    for (let i = 0; i < 400 && d >= programStart; i++, d = addDays(d, -1)) {
      if (!LIFTING_DOW[dow(d)]) continue;     // only scheduled lifting days count
      if (d === todayISO && !done.has(d)) continue; // today still open — don't break
      if (done.has(d)) n += 1; else break;
    }
    return n;
  }

  /* ------------------------------------------------------------- summary */
  function summary(logs, opts) {
    opts = opts || {};
    const todayISO = opts.today || iso(new Date());
    const programStart = opts.programStart || null;

    const sessions = perSession(logs);
    const sessionXP = sessions.reduce((a, s) => a + s.xp, 0);
    const perfectWeeks = perfectWeekCount(logs);
    const totalXP = sessionXP + perfectWeeks * XP.perfectWeek;

    // this calendar week's coverage
    const weekStart = mondayOf(todayISO);
    const weekEnd = addDays(weekStart, 6);
    const weekDays = new Set(
      (logs || []).filter(isReal).filter((l) => l.date >= weekStart && l.date <= weekEnd).map((l) => l.date)
    );

    const totalPRs = sessions.reduce((a, s) => a + s.prs, 0);
    const lvl = levelFromXP(totalXP);

    return {
      totalXP,
      level: lvl.level,
      title: lvl.title,
      tier: lvl.tier,
      tierName: lvl.tierName,
      color: lvl.color,
      into: lvl.into,
      span: lvl.span,
      pct: lvl.pct,
      toNext: lvl.toNext,
      sessionsCompleted: sessions.length,
      totalPRs,
      perfectWeeks,
      streak: streak(logs, programStart, todayISO),
      week: { done: Math.min(weekDays.size, WEEK_TARGET), target: WEEK_TARGET, raw: weekDays.size },
      sessions,
    };
  }

  /* ----------------------------------------------- result of a finished day */
  // Diff the summary before vs after this session's rows to get exactly what
  // the finish screen should celebrate: XP gained, any level-up, perfect-week,
  // and which lifts were PRs.
  function sessionResult(prevLogs, newRows, opts) {
    opts = opts || {};
    const before = summary(prevLogs, opts);
    const after = summary((prevLogs || []).concat(newRows || []), opts);

    // PRs in THIS session, by name, judged against all prior logs.
    const runningMax = {};
    (prevLogs || []).forEach((r) => {
      if (r.weight == null || r.weight <= 0) return;
      if (runningMax[r.exercise] == null || r.weight > runningMax[r.exercise]) runningMax[r.exercise] = r.weight;
    });
    const dayMax = {};
    (newRows || []).forEach((r) => {
      if (r.weight == null || r.weight <= 0) return;
      if (dayMax[r.exercise] == null || r.weight > dayMax[r.exercise]) dayMax[r.exercise] = r.weight;
    });
    const prNames = Object.keys(dayMax).filter((ex) => runningMax[ex] == null || dayMax[ex] > runningMax[ex]);

    return {
      earned: after.totalXP - before.totalXP,
      setsLogged: (newRows || []).length,
      prNames,
      prCount: Math.min(prNames.length, XP.prCap),
      leveledUp: after.level > before.level,
      levelsGained: after.level - before.level,
      newLevel: after.level,
      newTitle: after.title,
      newTier: after.tier,
      newTierName: after.tierName,
      tierColor: after.color,
      perfectWeek: after.perfectWeeks > before.perfectWeeks,
      streak: after.streak,
      before: { level: before.level, totalXP: before.totalXP },
      after: { level: after.level, totalXP: after.totalXP, into: after.into, span: after.span, pct: after.pct },
    };
  }

  return {
    XP, WEEK_TARGET, reqForLevel, levelFromXP, tierFor,
    summary, sessionResult, perSession, perfectWeekCount, streak,
    _helpers: { mondayOf, addDays, dow },
  };
});
