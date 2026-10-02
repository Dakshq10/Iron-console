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

    // Days you scheduled yourself: [{date, session_key}] where session_key is a
    // routine key or "rest". No row = use the app's suggestion.
    async getPlanned() { return this._get("planned", []); },
    async setPlanned(date, sessionKey) {
      const list = this._get("planned", []).filter((r) => r.date !== date);
      if (sessionKey) list.push({ date, session_key: sessionKey, updated_at: new Date().toISOString() });
      this._set("planned", list);
      return { date, session_key: sessionKey || null };
    },

    async ping() { return { ok: true, detail: "On this device only" }; },
    async clearAll() {
      ["profile", "cycle", "exercises", "logs", "measurements", "prescriptions", "session_status", "planned", "meta"]
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

      async getPlanned() {
        const { data, error } = await client.from("planned_sessions").select("*");
        if (error) throw error;
        return data || [];
      },
      async setPlanned(date, sessionKey) {
        if (!sessionKey) {
          const { error } = await client.from("planned_sessions").delete().eq("date", date);
          if (error) throw error;
          return { date, session_key: null };
        }
        const { error } = await client.from("planned_sessions")
          .upsert({ date, session_key: sessionKey, updated_at: new Date().toISOString() });
        if (error) throw error;
        return { date, session_key: sessionKey };
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
        try { await client.from("session_status").delete().neq("session_key", "__none__"); } catch (_) {}
        try { await client.from("planned_sessions").delete().neq("session_key", "__none__"); } catch (_) {}
        localStorage.removeItem("gym:meta");
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
      lateral_delt: !!e.lateral_delt, vtaper: !!e.vtaper, grip_limited: !!e.grip_limited, inverse_load: !!e.inverse_load,
      rest_low: (e.rest || [])[0], rest_high: (e.rest || [])[1],
      alts: e.alts || [], data_source: e.data_source || "custom",
    };
  }
  function fromExRow(r) {
    return {
      name: r.name, type: r.type, primary: r.primary_muscle, secondary: r.secondary_muscles || [],
      equipment: r.equipment, increment: r.increment, roles: r.roles || [], sessions: r.sessions || [],
      lateral_delt: !!r.lateral_delt, vtaper: !!r.vtaper, grip_limited: !!r.grip_limited, inverse_load: !!r.inverse_load,
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

  function prefsFrom(profile) {
    const local = loadConfig().prefs || {};
    const p = profile || {};
    return {
      display_name: p.display_name || local.display_name || "",
      schedule_mode: (p.schedule_mode || local.schedule_mode) === "free" ? "free" : "split",
    };
  }
  function mergeMeta(sessionStatus) {
    const out = Object.assign({}, LocalBackend._get("meta", {}));
    (sessionStatus || []).forEach((r) => {
      if (r.duration_s == null && !r.started_at) return;
      out[r.date + "|" + r.session_key] = {
        duration_s: r.duration_s, started_at: r.started_at, title: r.title || "",
      };
    });
    return out;
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
      // Also backfills movements added to the library after the first seed
      // (e.g. the shoulder presses), so older databases pick them up.
      const exs = await backend.getExercises();
      const have = new Set((exs || []).map((e) => e.name));
      for (const e of E.LIBRARY) {
        if (have.has(e.name)) continue;
        try { await backend.addExercise(e); } catch (err) { console.warn("Exercise backfill skipped:", e.name, err.message || err); }
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
      const plannedRows = await this.getPlanned();
      const planned = {};
      plannedRows.forEach((r) => { if (r && r.date && r.session_key) planned[r.date] = r.session_key; });
      const prefs = prefsFrom(prof);
      return {
        profile: Object.assign({ reentry_days: E.PROFILE.reentry_days }, prof),
        cycleWeek: (cyc && cyc.week) || 1,
        logs: logs || [],
        machineIncrements: (prof && prof.machine_increments) || {},
        sessionStatus,
        meta: mergeMeta(sessionStatus),
        planned,
        prefs,
        scheduleMode: prefs.schedule_mode,
      };
    },

    /* ---- self-scheduling ---------------------------------------------------
       Cloud first; if the planned_sessions table hasn't been migrated yet the
       plan quietly lives on this device instead, so scheduling always works. */
    async getPlanned() {
      if (backend.mode === "cloud") {
        try { return await backend.getPlanned(); } catch (_) { /* not migrated */ }
      }
      return LocalBackend.getPlanned();
    },
    async setPlanned(date, sessionKey) {
      if (backend.mode === "cloud") {
        try { await backend.setPlanned(date, sessionKey); return { synced: true }; }
        catch (err) { console.warn("planned_sessions unavailable, saving on this device:", err.message || err); }
      }
      await LocalBackend.setPlanned(date, sessionKey);
      return { synced: backend.mode !== "cloud" };
    },

    /* ---- preferences (name, schedule mode) ---------------------------------
       Always kept on this device; also written to the synced profile when the
       profile has the columns (see the migration in schema.sql). */
    async savePrefs(patch) {
      const c = loadConfig();
      saveConfig({ prefs: Object.assign({}, c.prefs || {}, patch) });
      try { await backend.upsertProfile(patch); return { synced: true }; }
      catch (err) { console.warn("Profile prefs not synced:", err.message || err); return { synced: false }; }
    },

    /* ---- workout meta (duration, start time, title) ------------------------
       Stored on session_status when migrated, and always mirrored locally so a
       finished workout keeps its duration even before the migration runs. */
    async saveWorkout(row) {
      const meta = LocalBackend._get("meta", {});
      meta[row.date + "|" + row.session_key] = {
        duration_s: row.duration_s, started_at: row.started_at, title: row.title || "",
      };
      LocalBackend._set("meta", meta);
      try { await backend.setSessionStatus(row); }
      catch (_) {
        // older session_status without the new columns — save the core fields
        const { duration_s, started_at, title, ...core } = row; void duration_s; void started_at; void title;
        try { await backend.setSessionStatus(core); } catch (_) { /* a nicety — never block */ }
      }
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
