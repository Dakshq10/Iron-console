/* ============================================================================
   store.js — persistence + sync repository.
   ----------------------------------------------------------------------------
   Presents ONE async interface to the app. Two interchangeable backends:

     • Cloud  — Supabase (cross-device sync; the whole point of the app).
     • Local  — browser localStorage (works offline / before you add keys).

   The app never cares which is active. Add your Supabase URL + anon key in
   Settings and the store "upgrades" to synced; everything else is identical.

   Attaches to window.GymStore. Depends on window.GymEngine (seed data) and,
   in cloud mode, the supabase-js UMD global (window.supabase).
   ========================================================================== */
(function (root) {
  "use strict";
  const E = root.GymEngine;

  /* ----------------------------------------------------- local config store */
  // App config (keys, mode, program start) lives in localStorage PER DEVICE.
  // Sensitive keys are intentionally never synced to the cloud.
  const CFG_KEY = "gym:config";
  function loadConfig() {
    try { return JSON.parse(localStorage.getItem(CFG_KEY)) || {}; }
    catch (_) { return {}; }
  }
  function saveConfig(patch) {
    const c = Object.assign(loadConfig(), patch);
    localStorage.setItem(CFG_KEY, JSON.stringify(c));
    return c;
  }

  /* --------------------------------------------------------- date utilities */
  function mondayOfThisWeek() {
    const d = new Date();
    const day = (d.getDay() + 6) % 7; // 0 = Monday
    d.setDate(d.getDate() - day);
    return E.toISO(d);
  }
  function dayBefore(iso) {
    return E.toISO(new Date(new Date(iso + "T00:00:00").getTime() - 86400000));
  }

  /* ===========================================================================
     LOCAL BACKEND — localStorage arrays in a `gym:` namespace.
     ========================================================================= */
  const LocalBackend = {
    mode: "local",
    _get(key, def) {
      try { const v = JSON.parse(localStorage.getItem("gym:" + key)); return v == null ? def : v; }
      catch (_) { return def; }
    },
    _set(key, val) { localStorage.setItem("gym:" + key, JSON.stringify(val)); },

    async getProfile() { return this._get("profile", null); },
    async upsertProfile(patch) {
      const cur = this._get("profile", {}) || {};
      const next = Object.assign({}, cur, patch, { updated_at: new Date().toISOString() });
      this._set("profile", next);
      return next;
    },
    async getCycle() { return this._get("cycle", { week: 1 }); },
    async setCycle(week) { this._set("cycle", { week }); return { week }; },

    async getExercises() { return this._get("exercises", []); },
    async addExercise(ex) {
      const list = this._get("exercises", []);
      if (!list.some((e) => e.name === ex.name)) { list.push(ex); this._set("exercises", list); }
      return ex;
    },

    async getLogs() { return this._get("logs", []); },
    async addLogs(rows) {
      const list = this._get("logs", []);
      const stamped = rows.map((r, i) => Object.assign(
        { id: uid(), created_at: new Date().toISOString(), set_index: r.set_index != null ? r.set_index : i },
        r
      ));
      this._set("logs", list.concat(stamped));
      return stamped;
    },

    async getMeasurements() { return this._get("measurements", []); },
    async addMeasurement(m) {
      const list = this._get("measurements", []);
      const row = Object.assign({ id: uid(), created_at: new Date().toISOString() }, m);
      list.push(row); this._set("measurements", list);
      return row;
    },

    async getSessionStatus() { return this._get("session_status", []); },
    async setSessionStatus(row) {
      const list = this._get("session_status", []).filter((r) => !(r.date === row.date && r.session_key === row.session_key));
      const next = Object.assign({ updated_at: new Date().toISOString() }, row);
      list.push(next); this._set("session_status", list);
      return next;
    },

    async getPrescription(date) {
      const list = this._get("prescriptions", []);
      return list.filter((p) => p.date === date).slice(-1)[0] || null;
    },
    async savePrescription(date, sessionKey, payload, source) {
      const list = this._get("prescriptions", []).filter((p) => p.date !== date);
      const row = { id: uid(), date, session_key: sessionKey, payload, source, created_at: new Date().toISOString() };
      list.push(row); this._set("prescriptions", list);
      return row;
    },

    async ping() { return { ok: true, detail: "On this device only" }; },
    async clearAll() {
      ["profile", "cycle", "exercises", "logs", "measurements", "prescriptions"]
        .forEach((k) => localStorage.removeItem("gym:" + k));
    },
  };

  /* ===========================================================================
     CLOUD BACKEND — Supabase. Same interface; maps table columns <-> app shape.
     ========================================================================= */
  function CloudBackend(client) {
    return {
      mode: "cloud",
      client,

      async getProfile() {
        const { data, error } = await client.from("profile").select("*").eq("id", "me").maybeSingle();
        if (error) throw error;
        return data || null;
      },
      async upsertProfile(patch) {
        const row = Object.assign({ id: "me", updated_at: new Date().toISOString() }, patch);
        const { data, error } = await client.from("profile").upsert(row).select().maybeSingle();
        if (error) throw error;
        return data;
      },
      async getCycle() {
        const { data, error } = await client.from("cycle").select("*").eq("id", "me").maybeSingle();
        if (error) throw error;
        return data || { week: 1 };
      },
      async setCycle(week) {
        const { error } = await client.from("cycle")
          .upsert({ id: "me", week, updated_at: new Date().toISOString() });
        if (error) throw error;
        return { week };
      },

      async getExercises() {
        const { data, error } = await client.from("exercises").select("*");
        if (error) throw error;
        return (data || []).map(fromExRow);
      },
      async addExercise(ex) {
        const { error } = await client.from("exercises").upsert(toExRow(ex));
        if (error) throw error;
        return ex;
      },

      async getLogs() {
        const { data, error } = await client.from("logs").select("*");
        if (error) throw error;
        return (data || []).map(stripMeta);
      },
      async addLogs(rows) {
        const { data, error } = await client.from("logs").insert(rows).select();
        if (error) throw error;
        return data || rows;
      },

      async getMeasurements() {
        const { data, error } = await client.from("measurements").select("*").order("date", { ascending: true });
        if (error) throw error;
        return data || [];
      },
      async addMeasurement(m) {
        const { data, error } = await client.from("measurements").insert(m).select().maybeSingle();
        if (error) throw error;
        return data;
      },

      async getSessionStatus() {
        const { data, error } = await client.from("session_status").select("*");
        if (error) return [];                       // table not migrated yet — degrade quietly
        return data || [];
      },
      async setSessionStatus(row) {
        const payload = Object.assign({ updated_at: new Date().toISOString() }, row);
        const { data, error } = await client.from("session_status").upsert(payload).select().maybeSingle();
        if (error) throw error;
        return data;
      },

      async getPrescription(date) {
        const { data, error } = await client.from("prescriptions")
          .select("*").eq("date", date).order("created_at", { ascending: false }).limit(1);
        if (error) throw error;
        return (data && data[0]) || null;
      },
      async savePrescription(date, sessionKey, payload, source) {
        await client.from("prescriptions").delete().eq("date", date);
        const { data, error } = await client.from("prescriptions")
          .insert({ date, session_key: sessionKey, payload, source }).select().maybeSingle();
        if (error) throw error;
        return data;
      },

      async ping() {
        const { error } = await client.from("profile").select("id").limit(1);
        if (error) return { ok: false, detail: error.message };
        return { ok: true, detail: "Synced via Supabase" };
      },
      async clearAll() {
        for (const t of ["logs", "measurements", "prescriptions"]) {
          await client.from(t).delete().neq("id", "00000000-0000-0000-0000-000000000000");
        }
        await client.from("cycle").upsert({ id: "me", week: 1 });
      },
    };
  }

  // exercises table <-> engine exercise shape
  function toExRow(e) {
    return {
      name: e.name, type: e.type, primary_muscle: e.primary,
      secondary_muscles: e.secondary || [], equipment: e.equipment, increment: e.increment,
      roles: e.roles || [], sessions: e.sessions || [],
      lateral_delt: !!e.lateral_delt, vtaper: !!e.vtaper, grip_limited: !!e.grip_limited,
      rest_low: (e.rest || [])[0], rest_high: (e.rest || [])[1],
      alts: e.alts || [], data_source: e.data_source || "custom",
    };
  }
  function fromExRow(r) {
    return {
      name: r.name, type: r.type, primary: r.primary_muscle, secondary: r.secondary_muscles || [],
      equipment: r.equipment, increment: r.increment, roles: r.roles || [], sessions: r.sessions || [],
      lateral_delt: !!r.lateral_delt, vtaper: !!r.vtaper, grip_limited: !!r.grip_limited,
      rest: [r.rest_low, r.rest_high], alts: r.alts || [], data_source: r.data_source,
    };
  }
  function stripMeta(r) {
    // logs columns already match the engine row shape; just drop db-only fields.
    // set_index and station MUST survive — the progression rules depend on them.
    const { created_at, ...rest } = r; void created_at; return rest;
  }

  function uid() {
    return "loc-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  }

  /* ===========================================================================
     PUBLIC STORE
     ========================================================================= */
  let backend = LocalBackend;

  const GymStore = {
    config: loadConfig,
    saveConfig,

    // Decide the backend from saved config. Call once at startup.
    async init() {
      const c = loadConfig();
      if (c.supabaseUrl && c.supabaseKey && root.supabase && root.supabase.createClient) {
        try {
          const client = root.supabase.createClient(c.supabaseUrl, c.supabaseKey, {
            auth: { persistSession: false },
          });
          backend = CloudBackend(client);
        } catch (err) {
          console.warn("Supabase init failed, using local store:", err);
          backend = LocalBackend;
        }
      } else {
        backend = LocalBackend;
      }
      return backend.mode;
    },

    // Connect (or reconnect) to Supabase with new credentials, and verify.
    async connect(url, key) {
      saveConfig({ supabaseUrl: url.trim(), supabaseKey: key.trim() });
      const mode = await this.init();
      const status = await backend.ping();
      return { mode, status };
    },

    // Drop cloud credentials and fall back to local.
    async disconnect() {
      saveConfig({ supabaseUrl: "", supabaseKey: "" });
      backend = LocalBackend;
      return "local";
    },

    mode() { return backend.mode; },
    async status() { return backend.ping(); },

    /* ---- seed: only fills what is empty, so it is safe to run repeatedly ---- */
    async seedIfEmpty(opts) {
      opts = opts || {};
      const c = loadConfig();
      const programStart = opts.programStart || c.programStart || mondayOfThisWeek();
      saveConfig({ programStart });

      // profile
      let profile = await backend.getProfile();
      if (!profile) {
        profile = await backend.upsertProfile(Object.assign({}, E.PROFILE, { program_start: programStart }));
      } else if (!profile.program_start) {
        profile = await backend.upsertProfile({ program_start: programStart });
      }

      // cycle
      const cyc = await backend.getCycle();
      if (!cyc || cyc.week == null) await backend.setCycle(1);

      // exercises
      const exs = await backend.getExercises();
      if (!exs.length) {
        for (const e of E.LIBRARY) await backend.addExercise(e);
      }

      // logs (baseline)
      const logs = await backend.getLogs();
      if (!logs.length) {
        const base = E.parseBaseline(dayBefore(profile.program_start || programStart));
        await backend.addLogs(base);
      }
      return true;
    },

    /* ---- assemble the engine state object -------------------------------- */
    async loadState() {
      const [profile, cyc, logs] = await Promise.all([
        backend.getProfile(), backend.getCycle(), backend.getLogs(),
      ]);
      const prof = profile || Object.assign({}, E.PROFILE, { program_start: mondayOfThisWeek() });
      let sessionStatus = [];
      try { sessionStatus = await backend.getSessionStatus(); } catch (_) { sessionStatus = []; }
      return {
        profile: Object.assign({ reentry_days: E.PROFILE.reentry_days }, prof),
        cycleWeek: (cyc && cyc.week) || 1,
        logs: logs || [],
        machineIncrements: (prof && prof.machine_increments) || {},
        sessionStatus,
      };
    },

    /* ---- thin pass-throughs the app uses --------------------------------- */
    getProfile: (...a) => backend.getProfile(...a),
    upsertProfile: (...a) => backend.upsertProfile(...a),
    getCycle: (...a) => backend.getCycle(...a),
    setCycle: (...a) => backend.setCycle(...a),
    getExercises: (...a) => backend.getExercises(...a),
    addExercise: (...a) => backend.addExercise(...a),
    getLogs: (...a) => backend.getLogs(...a),
    addLogs: (...a) => backend.addLogs(...a),
    getMeasurements: (...a) => backend.getMeasurements(...a),
    addMeasurement: (...a) => backend.addMeasurement(...a),
    getSessionStatus: (...a) => backend.getSessionStatus(...a),
    setSessionStatus: (...a) => backend.setSessionStatus(...a),
    getPrescription: (...a) => backend.getPrescription(...a),
    savePrescription: (...a) => backend.savePrescription(...a),
    async clearAll() { return backend.clearAll(); },

    /* ---- whole-database export / import (manual backup) ------------------ */
    async exportAll() {
      const [profile, cycle, exercises, logs, measurements] = await Promise.all([
        backend.getProfile(), backend.getCycle(), backend.getExercises(),
        backend.getLogs(), backend.getMeasurements(),
      ]);
      return { profile, cycle, exercises, logs, measurements, exported_at: new Date().toISOString() };
    },
    async importAll(data) {
      if (data.profile) await backend.upsertProfile(data.profile);
      if (data.cycle) await backend.setCycle(data.cycle.week || 1);
      if (Array.isArray(data.exercises)) for (const e of data.exercises) await backend.addExercise(e);
      if (Array.isArray(data.logs) && data.logs.length) await backend.addLogs(data.logs.map(stripMeta));
      if (Array.isArray(data.measurements)) for (const m of data.measurements) await backend.addMeasurement(m);
      return true;
    },

    _helpers: { mondayOfThisWeek, dayBefore },
  };

  root.GymStore = GymStore;
})(typeof self !== "undefined" ? self : this);
