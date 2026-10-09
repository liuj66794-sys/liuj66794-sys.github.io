// scripts/runtime/multiuser-config.mjs
var multiuserConfig = Object.freeze({ "auth": false, "sync": false, "ai": false, "supabaseUrl": "", "publishableKey": "", "callbackUrl": "" });

// scripts/runtime/record-codec.mjs
var containers = /* @__PURE__ */ new Set(["l1uj-study-progress-v1", "l1uj-study-tasks-v1", "zhixu-mistakes-v1"]);
var maps = /* @__PURE__ */ new Set(["zc-progress-v1", "zsb-prep-checks", "zsb-prep-checks-meta-v1", "zsb-mistakes-v1"]);
var unsafe = (key) => ["__proto__", "constructor", "prototype"].includes(key);
var recordKey = (bucket, id) => JSON.stringify([bucket, id]);
function splitRecord(key, raw) {
  if (raw == null) return {};
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return { _: { raw } };
  }
  if (containers.has(key) && data?.version === 1 && data.entries && !Array.isArray(data.entries)) return { ...data.entries };
  if (key === "l1uj-knowledge-v1" && data?.version === 1) return Object.fromEntries([
    ...Object.entries(data.points || {}).map(([id, value]) => ["point:" + id, value]),
    ...Object.entries(data.sources || {}).map(([id, value]) => ["source:" + id, value])
  ]);
  if (key === "l1uj-reading-v1" && Array.isArray(data?.entries)) return Object.fromEntries(data.entries.map((entry) => [entry.path, entry]));
  if ((maps.has(key) || key.startsWith("l1uj-sections-v1:")) && data && typeof data === "object" && !Array.isArray(data)) return { ...data };
  return { _: { raw } };
}
function joinRecord(key, records) {
  const safe2 = Object.fromEntries(Object.entries(records).filter(([id]) => !unsafe(id)));
  if (containers.has(key)) return JSON.stringify({ version: 1, entries: safe2 });
  if (key === "l1uj-knowledge-v1") return JSON.stringify({ version: 1, points: Object.fromEntries(Object.entries(safe2).filter(([id]) => id.startsWith("point:")).map(([id, value]) => [id.slice(6), value])), sources: Object.fromEntries(Object.entries(safe2).filter(([id]) => id.startsWith("source:")).map(([id, value]) => [id.slice(7), value])) });
  if (key === "l1uj-reading-v1") return JSON.stringify({ version: 1, entries: Object.values(safe2).sort((a, b) => b.updatedAt - a.updatedAt) });
  if (maps.has(key) || key.startsWith("l1uj-sections-v1:")) return JSON.stringify(safe2);
  return safe2._?.raw ?? null;
}
function diffRecords(bucket, before, after) {
  const a = splitRecord(bucket, before), b = splitRecord(bucket, after);
  return [.../* @__PURE__ */ new Set([...Object.keys(a), ...Object.keys(b)])].filter((id) => !unsafe(id) && JSON.stringify(a[id]) !== JSON.stringify(b[id])).map((record_id) => ({ bucket, record_id, payload: b[record_id] ?? null, deleted: !(record_id in b) }));
}

// scripts/runtime/account-writer.mjs
function createAccountWriter({ locks, changed = () => {
} } = {}) {
  let owner = null, state = "guest", generation = 0, release;
  const update = (next) => {
    state = next;
    changed();
  };
  return {
    get writable() {
      return !owner || state === "writer";
    },
    get state() {
      return state;
    },
    get reason() {
      return state === "unsupported" ? "\u6D4F\u89C8\u5668\u4E0D\u652F\u6301\u5B89\u5168\u7684\u591A\u6807\u7B7E\u534F\u8C03\uFF1B\u8D26\u53F7\u5B66\u4E60\u8BB0\u5F55\u53EA\u8BFB\uFF0C\u8BF7\u4F7F\u7528\u652F\u6301 Web Locks \u7684 HTTPS \u6D4F\u89C8\u5668\u3002" : "\u5F53\u524D\u8D26\u53F7\u5DF2\u7531\u53E6\u4E00\u6807\u7B7E\u9875\u4FDD\u5B58\uFF0C\u6216\u6B63\u5728\u83B7\u53D6\u5199\u5165\u6743\u3002\u672C\u9875\u53EA\u8BFB\uFF1A\u8BF7\u5173\u95ED\u53E6\u4E00\u5B66\u4E60\u6807\u7B7E\u540E\u91CD\u65B0\u52A0\u8F7D\uFF0C\u907F\u514D\u8BB0\u5F55\u4E92\u76F8\u8986\u76D6\u3002";
    },
    setOwner(next) {
      if (next === owner) return;
      const ticket = ++generation;
      release?.();
      release = void 0;
      owner = next;
      if (!next) {
        update("guest");
        return;
      }
      if (!locks?.request) {
        update("unsupported");
        return;
      }
      update("acquiring");
      try {
        Promise.resolve(locks.request("zhixu-account-writer-v1:" + encodeURIComponent(next), { mode: "exclusive", ifAvailable: true }, async (lock) => {
          if (ticket !== generation) return;
          if (!lock) {
            update("readonly");
            return;
          }
          const held = new Promise((resolve) => {
            release = resolve;
          });
          update("writer");
          await held;
        })).catch(() => {
          if (ticket === generation) update("unsupported");
        });
      } catch {
        update("unsupported");
      }
    },
    stop() {
      ++generation;
      release?.();
      release = void 0;
      update(owner ? "readonly" : "guest");
    }
  };
}

// scripts/runtime/study-storage.mjs
var OWNER_KEY = "zhixu-active-owner-v1";
var STORAGE_EVENT = "zhixu:storage";
var REMOTE_EVENT = "zhixu:cloud-records";
var prefix = "zhixu-account-v1:";
function cachedOwner(session, { enabled = true, now = Date.now() } = {}) {
  if (!enabled) return null;
  try {
    const owner = session.getItem(OWNER_KEY), cached = JSON.parse(session.getItem("zhixu-auth-v1") || "null");
    if (owner && cached?.user?.id === owner && Number(cached.expires_at) * 1e3 > now) return owner;
    session.removeItem(OWNER_KEY);
  } catch {
  }
  return null;
}
function isStudyKey(key) {
  return /^(?:l1uj-(?:reading|study-progress|study-tasks|knowledge|guided|sections|learning-guide-note|study-backup-at|cs-answers|english-answers|politics-answers)|zhixu-(?:mistakes|review-session)|zhixu:cs-|zc-|zsb-(?:mistakes|prep-checks|quiz|course-done)|zzkk:)/.test(key);
}
var empty = () => ({ version: 1, values: {}, revisions: {}, pending: [], conflicts: {}, cursor: 0 });
function createStudyStorage({ storage, sessionStorage, enabled = true, owner = null, uuid = () => crypto.randomUUID(), onChange = () => {
}, writer } = {}) {
  let active = owner, locked = false, staged = null;
  const assertWritable = () => {
    if (enabled && active && writer && !writer.writable) throw new Error(writer.reason);
  };
  writer?.setOwner(enabled ? active : null);
  const envelopeKey = () => prefix + encodeURIComponent(active);
  const load = () => {
    if (staged) return staged;
    const raw = storage.getItem(envelopeKey());
    const data = raw ? JSON.parse(raw) : empty();
    if (data.version !== 1 || !data.values || !Array.isArray(data.pending)) throw new Error("\u8D26\u53F7\u7F13\u5B58\u683C\u5F0F\u5F02\u5E38\uFF0C\u8BF7\u5148\u5BFC\u51FA\u6062\u590D\uFF0C\u4E0D\u80FD\u8986\u76D6");
    return data;
  };
  const save = (data, detail) => {
    if (staged) {
      staged = data;
      return;
    }
    storage.setItem(envelopeKey(), JSON.stringify(data));
    onChange(detail);
  };
  const needsNamespace = (key) => enabled && active && isStudyKey(key);
  const keys = () => {
    if (locked) return [];
    const native = Array.from({ length: storage.length }, (_, i) => storage.key(i)).filter((k) => k && !k.startsWith(prefix) && !(enabled && active && isStudyKey(k)));
    return [.../* @__PURE__ */ new Set([...native, ...enabled && active ? Object.keys(load().values) : []])];
  };
  const api = {
    get owner() {
      return active;
    },
    get writable() {
      return !locked && (!enabled || !active || !writer || writer.writable);
    },
    get writeBlockedReason() {
      return writer?.reason || "\u6B63\u5728\u5207\u6362\u8EAB\u4EFD\uFF0C\u6682\u4E0D\u4FDD\u5B58\u5B66\u4E60\u8BB0\u5F55";
    },
    get length() {
      return keys().length;
    },
    key(index) {
      return keys()[index] ?? null;
    },
    getItem(key) {
      if (locked && isStudyKey(key)) return null;
      return needsNamespace(key) ? load().values[key] ?? null : storage.getItem(key);
    },
    setItem(key, value) {
      api.write(key, String(value));
    },
    removeItem(key) {
      api.write(key, null);
    },
    write(key, value) {
      if (locked && isStudyKey(key)) throw new Error("\u6B63\u5728\u5207\u6362\u8EAB\u4EFD\uFF0C\u6682\u4E0D\u4FDD\u5B58\u5B66\u4E60\u8BB0\u5F55");
      if (!needsNamespace(key)) {
        value == null ? storage.removeItem(key) : storage.setItem(key, value);
        return;
      }
      assertWritable();
      const data = load(), before = data.values[key] ?? null;
      if (before === value) return;
      for (const change of diffRecords(key, before, value)) {
        const id = recordKey(key, change.record_id);
        const previous = data.pending.findLast((p) => recordKey(p.bucket, p.record_id) === id);
        data.pending.push({ ...change, request_id: uuid(), base_revision: data.revisions[id] ?? 0, ...previous ? { dependsOn: previous.request_id } : {} });
      }
      if (value == null) delete data.values[key];
      else data.values[key] = value;
      save(data);
    },
    setOwner(next) {
      active = next || null;
      locked = false;
      writer?.setOwner(enabled ? active : null);
      if (sessionStorage) next ? sessionStorage.setItem(OWNER_KEY, next) : sessionStorage.removeItem(OWNER_KEY);
      onChange();
    },
    lock() {
      locked = true;
    },
    snapshot() {
      if (!active || locked) throw new Error("\u9700\u8981\u767B\u5F55");
      return structuredClone(load());
    },
    update(mutator, detail) {
      if (!active || locked) throw new Error("\u9700\u8981\u767B\u5F55");
      assertWritable();
      const data = load();
      mutator(data);
      save(data, detail);
    },
    transaction(action) {
      if (!active || !enabled) return action();
      assertWritable();
      if (staged) throw new Error("\u4E0D\u652F\u6301\u5D4C\u5957\u5B58\u50A8\u4E8B\u52A1");
      staged = load();
      try {
        const result = action();
        const data = staged;
        staged = null;
        if (result?.applied !== false) save(data);
        return result;
      } finally {
        staged = null;
      }
    },
    applyRemote(record, data) {
      const id = recordKey(record.bucket, record.record_id);
      const parts = splitRecord(record.bucket, data.values[record.bucket]);
      if (record.deleted_at || record.deleted) delete parts[record.record_id];
      else parts[record.record_id] = record.payload;
      const raw = joinRecord(record.bucket, parts);
      if (raw == null) delete data.values[record.bucket];
      else data.values[record.bucket] = raw;
      data.revisions[id] = record.revision;
    },
    clearDeletedOwner(expectedOwner) {
      if (!expectedOwner || expectedOwner !== active) throw new Error("\u8D26\u53F7\u5F52\u5C5E\u5DF2\u53D8\u5316\uFF0C\u4E0D\u80FD\u6E05\u7406\u7F13\u5B58");
      storage.setItem("zhixu-deleted-account-v1:" + encodeURIComponent(expectedOwner), "1");
      storage.removeItem(envelopeKey());
      if (sessionStorage) for (let i = sessionStorage.length - 1; i >= 0; i--) {
        const key = sessionStorage.key(i);
        if (key?.startsWith("zhixu-session-v1:" + encodeURIComponent(expectedOwner) + ":")) sessionStorage.removeItem(key);
      }
      api.setOwner(null);
    }
  };
  return api;
}
var singleton;
var unavailableStorage = Object.freeze({
  unavailable: true,
  owner: null,
  length: 0,
  key: () => null,
  getItem: () => null,
  setItem: () => {
    throw new Error("\u6D4F\u89C8\u5668\u5B58\u50A8\u4E0D\u53EF\u7528\uFF0C\u8BF7\u590D\u5236\u4FDD\u7559\u5F53\u524D\u4F5C\u7B54");
  },
  removeItem: () => {
    throw new Error("\u6D4F\u89C8\u5668\u5B58\u50A8\u4E0D\u53EF\u7528");
  }
});
function getStudyStorage() {
  if (typeof window !== "undefined" && window.ZhixuStudyStorage) return window.ZhixuStudyStorage;
  if (singleton) return singleton;
  if (typeof window === "undefined") {
    if (globalThis.localStorage) return globalThis.localStorage;
    throw new Error("\u5B66\u4E60\u5B58\u50A8\u4EC5\u5728\u6D4F\u89C8\u5668\u521D\u59CB\u5316");
  }
  let owner = null;
  try {
    owner = cachedOwner(window.sessionStorage, { enabled: multiuserConfig.auth });
  } catch {
  }
  let native, session;
  try {
    native = window.localStorage;
    session = window.sessionStorage;
  } catch {
    return unavailableStorage;
  }
  const changed = (detail) => {
    for (const name of [STORAGE_EVENT, "l1uj:study", "l1uj:reading", "zhixu:mistakes"]) window.dispatchEvent(new CustomEvent(name));
    if (detail?.remote) window.dispatchEvent(new CustomEvent(REMOTE_EVENT));
  };
  const writer = createAccountWriter({ locks: window.navigator?.locks, changed });
  singleton = createStudyStorage({ storage: native, sessionStorage: session, enabled: multiuserConfig.auth, owner, writer, onChange: changed });
  window.ZhixuStudyStorage = singleton;
  window.addEventListener("storage", (event) => {
    if (event.storageArea !== native || !singleton.owner) return;
    if (event.key === "zhixu-deleted-account-v1:" + encodeURIComponent(singleton.owner)) {
      singleton.lock();
      writer.stop();
      for (let i = session.length - 1; i >= 0; i--) {
        const key = session.key(i);
        if (key?.startsWith("zhixu-auth-v1") || key?.startsWith("zhixu-session-v1:" + encodeURIComponent(singleton.owner) + ":") || key === OWNER_KEY) session.removeItem(key);
      }
      window.location.reload();
      return;
    }
    if (event.key === prefix + encodeURIComponent(singleton.owner)) changed({ remote: true });
  });
  window.addEventListener("pagehide", () => writer.stop());
  window.addEventListener("pageshow", (event) => {
    if (event.persisted && singleton.owner) window.location.reload();
  });
  return singleton;
}

// scripts/runtime/tab-auth-storage.mjs
function clearTabAuthStorage(session) {
  for (let i = session.length - 1; i >= 0; i--) {
    const key = session.key(i);
    if (key === "zhixu-auth-v1" || key?.startsWith("zhixu-auth-v1-") || key === "zhixu-active-owner-v1" || key === "zhixu-recovery-v1") session.removeItem(key);
  }
}
function tabAuthStorage(session, channel = "zhixu-auth-document-" + crypto.randomUUID()) {
  const key = (name) => {
    if (name !== channel && !name.startsWith(channel + "-")) throw new Error("\u975E\u5F53\u524D\u8EAB\u4EFD\u5B58\u50A8\u952E");
    return "zhixu-auth-v1" + name.slice(channel.length);
  };
  return { storageKey: channel, storage: {
    getItem: (name) => session.getItem(key(name)),
    setItem: (name, value) => session.setItem(key(name), value),
    removeItem: (name) => session.removeItem(key(name))
  } };
}

// scripts/runtime/email-confirmation.mjs
function consumeEmailConfirmation(location2, history2, callbackUrl) {
  const url = new URL(location2.href), params = new URLSearchParams(url.hash.slice(1));
  if (!params.has("token_hash")) return null;
  const token = params.get("token_hash"), type = params.get("type");
  history2.replaceState(history2.state, "", url.pathname + url.search);
  let callback;
  try {
    callback = new URL(callbackUrl);
  } catch {
    return null;
  }
  if (url.origin !== callback.origin || url.pathname !== callback.pathname || !["email", "recovery"].includes(type) || !/^[a-f0-9]{64}$/i.test(token || "")) return null;
  return { token_hash: token, type };
}

// scripts/runtime/auth-client.mjs
var emailConfirmation = typeof window === "undefined" ? null : consumeEmailConfirmation(window.location, window.history, multiuserConfig.callbackUrl);
var hasEmailConfirmation = () => Boolean(emailConfirmation);
var AUTH_EVENT = "zhixu:auth";
function createAuthClient({ client, storage, changed = () => {
}, initialRecovery = false, invalidated = () => {
} }) {
  let session = null, recovery = initialRecovery, ready = false;
  const apply = (next, event) => {
    const before = storage.owner;
    session = next;
    recovery = event === "PASSWORD_RECOVERY" || recovery && Boolean(next);
    if (before !== (next?.user?.id ?? null)) storage.setOwner(next?.user?.id ?? null);
    changed({ user: next?.user ?? null, recovery, previousOwner: before, identityChanged: before !== storage.owner });
  };
  const subscription = client.auth.onAuthStateChange((event, next) => {
    if (!ready) {
      session = next;
      if (event === "PASSWORD_RECOVERY") recovery = true;
      return;
    }
    apply(next, event);
  }).data.subscription;
  async function result(operation) {
    const { data, error } = await operation;
    if (error) throw new Error(error.message);
    return data;
  }
  return {
    client,
    get session() {
      return session;
    },
    get recovery() {
      return recovery;
    },
    async init() {
      const cached = await client.auth.getSession();
      if (cached.error) {
        if ([400, 401, 403].includes(cached.error.status)) invalidated();
        throw new Error("\u65E0\u6CD5\u6062\u590D\u767B\u5F55\u72B6\u6001\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u6216\u91CD\u65B0\u767B\u5F55");
      }
      const data = cached.data;
      if (data?.session) {
        const checked = await client.auth.getUser();
        const offline = checked.error && (!checked.error.status || checked.error.status >= 500) && storage.owner === data.session.user.id && data.session.expires_at * 1e3 > Date.now();
        if (!offline && (checked.error || !checked.data?.user || checked.data.user.id !== data.session.user.id)) {
          if (!checked.error || [400, 401, 403, 404].includes(checked.error.status)) invalidated();
          throw new Error("\u767B\u5F55\u72B6\u6001\u5931\u6548\uFF0C\u8BF7\u91CD\u65B0\u767B\u5F55");
        }
      }
      ready = true;
      apply(data?.session ?? null, "INITIAL_SESSION");
    },
    async signIn(email, password) {
      return result(client.auth.signInWithPassword({ email, password }));
    },
    async signUp(email, password, callbackUrl) {
      return result(client.auth.signUp({ email, password, options: { emailRedirectTo: callbackUrl } }));
    },
    async reset(email, callbackUrl) {
      return result(client.auth.resetPasswordForEmail(email, { redirectTo: callbackUrl }));
    },
    async resend(email, callbackUrl) {
      return result(client.auth.resend({ type: "signup", email, options: { emailRedirectTo: callbackUrl } }));
    },
    async confirmEmail(confirmation) {
      if (!confirmation || !["email", "recovery"].includes(confirmation.type)) throw new Error("\u9A8C\u8BC1\u94FE\u63A5\u65E0\u6548");
      const wasRecovery = recovery;
      recovery = confirmation.type === "recovery";
      try {
        return await result(client.auth.verifyOtp(confirmation));
      } catch (error) {
        recovery = wasRecovery;
        throw error;
      }
    },
    async updatePassword(password) {
      if (!recovery || !session) throw new Error("\u8BF7\u5148\u4ECE\u91CD\u8BBE\u90AE\u4EF6\u9A8C\u8BC1\u8EAB\u4EFD");
      const data = await result(client.auth.updateUser({ password }));
      recovery = false;
      changed({ user: session.user, recovery: false, identityChanged: false });
      return data;
    },
    async signOut() {
      storage.lock();
      try {
        await result(client.auth.signOut({ scope: "local" }));
        apply(null, "SIGNED_OUT");
      } catch (error) {
        storage.setOwner(session?.user?.id ?? null);
        throw error;
      }
    },
    async forgetDeleted(expectedId) {
      if (session?.user?.id !== expectedId) throw new Error("\u8D26\u53F7\u5DF2\u53D8\u5316\uFF0C\u672A\u6E05\u7406\u5176\u5B83\u8EAB\u4EFD");
      storage.lock();
      try {
        await client.auth.signOut({ scope: "local" });
      } finally {
        apply(null, "SIGNED_OUT");
      }
    },
    dispose() {
      subscription.unsubscribe();
    }
  };
}
var promise;
async function confirmPendingEmail() {
  const confirmation = emailConfirmation;
  emailConfirmation = null;
  if (!confirmation) throw new Error("\u9A8C\u8BC1\u94FE\u63A5\u5DF2\u4F7F\u7528\u6216\u65E0\u6548\uFF0C\u8BF7\u91CD\u65B0\u53D1\u9001\u90AE\u4EF6");
  const auth = await initAuth();
  if (!auth) throw new Error("\u8D26\u53F7\u670D\u52A1\u5C1A\u672A\u5F00\u653E");
  return auth.confirmEmail(confirmation);
}
function initAuth() {
  if (promise) return promise;
  if (!multiuserConfig.auth || typeof window === "undefined") return Promise.resolve(null);
  promise = (async () => {
    const { createClient } = await import("./supabase-browser.mjs");
    const client = createClient(multiuserConfig.supabaseUrl, multiuserConfig.publishableKey, { auth: {
      flowType: "pkce",
      detectSessionInUrl: true,
      autoRefreshToken: true,
      persistSession: true,
      ...tabAuthStorage(window.sessionStorage)
    } });
    const auth = createAuthClient({ client, storage: getStudyStorage(), initialRecovery: window.sessionStorage.getItem("zhixu-recovery-v1") === "1", invalidated: () => {
      client.auth.stopAutoRefresh();
      clearTabAuthStorage(window.sessionStorage);
    }, changed: (detail) => {
      if (!detail.user) for (let i = window.sessionStorage.length - 1; i >= 0; i--) {
        const key = window.sessionStorage.key(i);
        if (key?.startsWith("zhixu-auth-v1")) window.sessionStorage.removeItem(key);
      }
      detail.recovery ? window.sessionStorage.setItem("zhixu-recovery-v1", "1") : window.sessionStorage.removeItem("zhixu-recovery-v1");
      window.dispatchEvent(new CustomEvent(AUTH_EVENT, { detail }));
      if (detail.identityChanged) window.location.reload();
    } });
    try {
      await auth.init();
    } catch (error) {
      const before = getStudyStorage().owner;
      getStudyStorage().setOwner(null);
      auth.dispose();
      promise = null;
      if (before) window.location.reload();
      throw error;
    }
    const url = new URL(window.location.href);
    for (const key of ["code", "error", "error_description"]) url.searchParams.delete(key);
    if (window.location.search !== url.search) history.replaceState(history.state, "", url.pathname + url.search + url.hash);
    return auth;
  })();
  return promise;
}

// scripts/runtime/sync-engine.mjs
function createSyncEngine({ storage, transport, notify = () => {
}, now = Date.now }) {
  let running, controller, epoch = 0, retryAt = 0, failures = 0;
  const status = () => {
    const data = storage.snapshot();
    return { pending: data.pending.length, conflicts: Object.keys(data.conflicts).length, retryAt, lastSyncedAt: Number(data.lastSyncedAt) || 0 };
  };
  async function flush({ force = false } = {}) {
    if (running) return running;
    if (storage.writable === false) return { ...status(), error: storage.writeBlockedReason };
    if (!force && now() < retryAt) return status();
    const owner = storage.owner, generation = epoch;
    controller = new AbortController();
    const current = () => storage.owner === owner && generation === epoch && !controller.signal.aborted;
    running = (async () => {
      try {
        for (const original of storage.snapshot().pending) {
          const item = storage.snapshot().pending.find((p) => p.request_id === original.request_id);
          if (!item) continue;
          const id = recordKey(item.bucket, item.record_id);
          if (storage.snapshot().conflicts[id] || item.dependsOn) continue;
          const response = await transport.push(item, controller.signal);
          if (!current()) return;
          storage.update((data) => {
            if (response.status === "conflict") {
              data.conflicts[id] = response.record;
              return;
            }
            data.revisions[id] = response.record.revision;
            data.pending = data.pending.filter((p) => p.request_id !== item.request_id);
            for (const p of data.pending) if (p.dependsOn === item.request_id) {
              delete p.dependsOn;
              p.base_revision = response.record.revision;
            }
          });
        }
        const remote = await transport.pull(storage.snapshot().cursor, controller.signal);
        if (!current()) return;
        storage.update((data) => {
          for (const record of remote) {
            const id = recordKey(record.bucket, record.record_id);
            if (data.pending.some((p) => recordKey(p.bucket, p.record_id) === id)) {
              if ((data.revisions[id] ?? 0) < record.revision) data.conflicts[id] = record;
            } else storage.applyRemote(record, data);
            data.cursor = Math.max(data.cursor, Number(record.change_seq) || 0);
          }
          data.lastSyncedAt = now();
        }, { remote: true });
        failures = 0;
        retryAt = 0;
        notify(status());
        return status();
      } catch (error) {
        if (current()) {
          retryAt = now() + Math.min(6e4, 1e3 * 2 ** failures++);
          notify({ error: "\u7F51\u7EDC\u6216\u670D\u52A1\u4E0D\u53EF\u7528\uFF0C\u8BB0\u5F55\u5DF2\u7559\u5728\u5F53\u524D\u8D26\u53F7\uFF0C\u7A0D\u540E\u91CD\u8BD5", ...status() });
        }
        throw error;
      } finally {
        running = null;
      }
    })();
    return running;
  }
  function stop() {
    epoch++;
    controller?.abort();
  }
  function resolve(id, choice) {
    if (!["local", "remote"].includes(choice)) throw new Error("\u5FC5\u987B\u660E\u786E\u9009\u62E9\u672C\u673A\u6216\u4E91\u7AEF");
    const data = storage.snapshot(), record = data.conflicts[id];
    if (!record) return;
    const local = data.pending.filter((p) => recordKey(p.bucket, p.record_id) === id).at(-1);
    storage.update((next) => {
      next.pending = next.pending.filter((p) => recordKey(p.bucket, p.record_id) !== id);
      storage.applyRemote(record, next);
      delete next.conflicts[id];
      if (choice === "local" && local) {
        const item = { ...local, request_id: crypto.randomUUID(), base_revision: record.revision };
        delete item.dependsOn;
        next.pending.push(item);
        storage.applyRemote({ ...item, revision: record.revision }, next);
      }
    }, { remote: true });
  }
  return { flush, stop, resolve, status };
}

// scripts/runtime/supabase-transport.mjs
function createSupabaseTransport(client) {
  return {
    async push(item, signal) {
      const { data, error } = await client.rpc("sync_study", {
        p_request_id: item.request_id,
        p_bucket: item.bucket,
        p_record_id: item.record_id,
        p_payload: item.payload,
        p_base_revision: item.base_revision,
        p_deleted: item.deleted
      }).abortSignal(signal);
      if (error) throw new Error("\u540C\u6B65\u5199\u5165\u5931\u8D25");
      return data;
    },
    async pull(cursor, signal) {
      const all = [];
      for (; ; ) {
        const { data, error } = await client.from("study_records").select("*").gt("change_seq", cursor).order("change_seq").limit(200).abortSignal(signal);
        if (error) throw new Error("\u540C\u6B65\u8BFB\u53D6\u5931\u8D25");
        all.push(...data);
        if (data.length < 200) return all;
        cursor = data.at(-1).change_seq;
      }
    }
  };
}

// scripts/runtime/mistake-store.mjs
var SUBJECTS = { "zsb-math": "\u9AD8\u6570", "zsb-english": "\u82F1\u8BED", "zsb-politics": "\u653F\u6CBB", "zsb-cs": "\u8BA1\u7B97\u673A" };
var REVIEW_LABELS = { pending: "\u5F85\u8BA2\u6B63", scheduled: "\u5F85\u590D\u6D4B", mastered: "\u5DF2\u5DE9\u56FA" };
var object = (value) => value && typeof value === "object" && !Array.isArray(value);
var number = (value) => Number.isFinite(value) && value >= 0 ? value : 0;
function canonicalLesson(id) {
  return /^\d+$/.test(String(id)) ? String(Number(id)) : String(id || "");
}
function mistakeId(q) {
  return q.slug === "zsb-politics" ? `${q.slug}:bank:${q.ref}` : `${q.slug}:${canonicalLesson(q.lessonId)}:${q.ref}`;
}
function safeLessonPath(value, base = "/blog/") {
  if (typeof value !== "string" || /[\\\u0000-\u001f]/.test(value)) return "";
  try {
    const url = new URL(value, "https://study.invalid");
    return url.origin === "https://study.invalid" && url.pathname.startsWith(`${base}lessons/`) ? url.pathname : "";
  } catch {
    return "";
  }
}
function parseMistakeBackup(text, base = "/blog/") {
  if (typeof text !== "string" || text.length > 8e6) throw new Error("\u5907\u4EFD\u6587\u4EF6\u8FC7\u5927\uFF0C\u9650\u5236\u4E3A 8 MB\u3002");
  const data = JSON.parse(text);
  if (data.version !== 1 || !object(data.entries) || Object.keys(data.entries).length > 2e4) throw new Error("\u8FD9\u4E0D\u662F\u6709\u6548\u7684\u77E5\u5E8F\u9519\u9898\u5907\u4EFD\u3002");
  const incoming = [];
  const optionalMarkup = (value) => value === void 0 || typeof value === "string" && value.length <= 6e4;
  const optionalTeaching = (value) => value === void 0 || object(value) && JSON.stringify(value).length <= 2e4;
  for (const [id, q] of Object.entries(data.entries)) {
    if (!object(q) || !SUBJECTS[q.slug] || typeof q.ref !== "string" || id !== mistakeId(q) || typeof q.stem !== "string" || q.stem.length > 3e4 || !REVIEW_LABELS[q.status] || !optionalMarkup(q.stemHtml) || !optionalMarkup(q.explanationHtml) || !optionalTeaching(q.teaching) || !optionalTeaching(q.subjective) || !Array.isArray(q.options) || !q.options.every((o) => object(o) && typeof o.value === "string" && typeof o.text === "string" && optionalMarkup(o.html)) || !Array.isArray(q.answer) || !q.answer.every((a) => typeof a === "string")) throw new Error("\u5907\u4EFD\u4E2D\u7684\u9898\u76EE\u683C\u5F0F\u65E0\u6548\uFF0C\u672A\u5BFC\u5165\u4EFB\u4F55\u8BB0\u5F55\u3002");
    incoming.push({
      ...q,
      id,
      source: safeLessonPath(q.source, base),
      wrongs: number(q.wrongs),
      successDays: number(q.successDays),
      dueAt: number(q.dueAt),
      updatedAt: number(q.updatedAt),
      lastSuccessAt: number(q.lastSuccessAt),
      recentAttempts: Array.isArray(q.recentAttempts) ? q.recentAttempts.filter((x) => typeof x === "string").slice(-30) : []
    });
  }
  return incoming;
}

// scripts/runtime/guided-state.mjs
var GUIDED_PREFIX = "l1uj-guided-v1:";
var plain = (value) => value && typeof value === "object" && !Array.isArray(value);
var safeId = (value) => typeof value === "string" && /^[a-z0-9-]{1,80}$/.test(value);
function validGuideState(value) {
  if (!plain(value) || value.version !== 1 || typeof value.signature !== "string" || value.signature.length > 8e4) return false;
  if (Object.keys(value).some((k) => !["version", "signature", "step", "answers", "note", "recall", "updatedAt", "round", "drafts"].includes(k))) return false;
  if (value.drafts !== void 0 && (!plain(value.drafts) || Object.keys(value.drafts).length > 100 || !Object.entries(value.drafts).every(([id, draft]) => safeId(id) && typeof draft === "string" && draft.length <= 6e3))) return false;
  if (!Number.isInteger(value.step) || value.step < 0 || value.step > 100 || !Number.isInteger(value.round) || value.round < 1) return false;
  if (!Number.isFinite(value.updatedAt) || value.updatedAt < 0 || !plain(value.answers) || Object.keys(value.answers).length > 100) return false;
  if (typeof value.note !== "string" || value.note.length > 2e3 || typeof value.recall !== "string" || value.recall.length > 2e3) return false;
  return Object.entries(value.answers).every(([id, a]) => safeId(id) && plain(a) && Object.keys(a).every((k) => ["picked", "hinted", "revealed"].includes(k)) && (a.picked === null || Number.isInteger(a.picked) && a.picked >= 0 && a.picked < 20) && typeof a.hinted === "boolean" && typeof a.revealed === "boolean" && (!a.revealed || a.picked === null));
}

// scripts/runtime/cs-learning-state.mjs
var plain2 = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
var safe = (value) => typeof value === "string" && /^[a-z][a-z0-9-]{0,79}$/.test(value) && !["constructor", "prototype"].includes(value);
var isCsLearningKey = (key) => key === "zhixu:cs-pointer:1" || /^zhixu:cs-course:(?:[1-9]|1\d|2\d):1$/.test(key);
function validCsLearningState(value) {
  if (!plain2(value) || value.version !== 1 || !safe(value.step)) return false;
  if (Object.keys(value).some((k) => !["version", "step", "answers", "labs", "updatedAt", "signature"].includes(k))) return false;
  if (value.updatedAt !== void 0 && (!Number.isSafeInteger(value.updatedAt) || value.updatedAt < 0)) return false;
  if (value.signature !== void 0 && (typeof value.signature !== "string" || value.signature.length > 80)) return false;
  if (!plain2(value.answers) || !plain2(value.labs) || Object.keys(value.answers).length > 100 || Object.keys(value.labs).length > 100) return false;
  return Object.entries(value.answers).every(([id, a]) => safe(id) && plain2(a) && Object.keys(a).every((k) => ["choice", "submitted"].includes(k)) && Number.isInteger(a.choice) && a.choice >= 0 && a.choice < 20 && typeof a.submitted === "boolean") && Object.entries(value.labs).every(([id, n]) => safe(id) && Number.isInteger(n) && n >= 0 && n < 100);
}

// docs/.vuepress/study-backup.mjs
var BACKUP_FORMAT = "l1uj-study-backup";
var BACKUP_VERSION = 1;
var DEFAULT_BASE = "/blog/";
var STUDY_STORAGE_KEYS = Object.freeze([
  "l1uj-reading-v1",
  "zc-progress-v1",
  "zsb-mistakes-v1",
  "zhixu-mistakes-v1",
  "zsb-prep-checks",
  "l1uj-study-progress-v1",
  "l1uj-study-tasks-v1",
  "zsb-prep-checks-meta-v1",
  // 知识点三盒；小节完成按课存为 l1uj-sections-v1:<slug>:<lessonId>（动态前缀，见 keyInfo）
  "l1uj-knowledge-v1"
]);
var LESSON_SLUGS = /* @__PURE__ */ new Set([
  "zsb-math",
  "zsb-english",
  "zsb-politics",
  "zsb-cs",
  "pi-agent",
  "engineering-skills",
  "a-shares",
  "english",
  "policy"
]);
var EXAM_SLUGS = /* @__PURE__ */ new Set(["zsb-math", "zsb-english", "zsb-politics", "zsb-cs"]);
var SAFE_KEY = /^[A-Za-z0-9_.-]{1,180}$/;
var SAFE_ID = /^[A-Za-z0-9_-]{1,120}$/;
var SAFE_POLITICS_LESSON_ID = /^[\p{L}\p{N}_.:-]{1,180}$/u;
var SAFE_SCOPE = /^#[\p{L}\p{N}_.:-]{1,180}$|^[\p{L}\p{N}_.:-]{1,180}$/u;
var ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
var ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
var MAX_ENTRIES = 2e3;
var MAX_JSON_LENGTH = 5e6;
var PATH_ANSWER_PREFIXES = [
  "l1uj-cs-answers-v1:",
  "l1uj-english-answers-v1:",
  "l1uj-politics-answers-v1:"
];
var SECTIONS_PREFIX = "l1uj-sections-v1:";
var SECTIONS_KEY = /^(zsb-(?:math|english|politics|cs)):([\p{L}\p{N}_.:-]{1,180})$/u;
var CONTAINER_MODES = Object.freeze({
  reading: "reading",
  studyProgress: "study-progress",
  studyTasks: "study-tasks",
  prepMeta: "prep-meta",
  knowledge: "knowledge",
  sections: "sections"
});
function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function hasUnsafeProperty(name) {
  return name === "__proto__" || name === "prototype" || name === "constructor";
}
function ownKeys(value) {
  return Object.keys(value);
}
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}
function equalValue(left, right) {
  return stableStringify(left) === stableStringify(right);
}
function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}
function isTimestamp(value) {
  return Number.isInteger(value) && value >= 0;
}
function isDateString(value) {
  return typeof value === "string" && ISO_DAY.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`));
}
function isInstantString(value) {
  return typeof value === "string" && ISO_INSTANT.test(value) && Number.isFinite(Date.parse(value));
}
function isSafeMapKey(value, pattern = SAFE_KEY) {
  return typeof value === "string" && !hasUnsafeProperty(value) && pattern.test(value);
}
function normalizeBase(base = DEFAULT_BASE) {
  if (typeof base !== "string" || !base.startsWith("/") || !base.endsWith("/") || /[?#\\\u0000-\u001f]/.test(base) || base.includes("..")) return null;
  return base;
}
function isSameBasePath(path, base = DEFAULT_BASE) {
  if (typeof path !== "string" || !path.startsWith(base) || /[?#\\\u0000-\u001f]/.test(path)) return false;
  const relative = path.slice(base.length);
  if (!relative || relative.includes("..") || relative.startsWith("/")) return false;
  return true;
}
function isLessonPath(path, base = DEFAULT_BASE) {
  if (!isSameBasePath(path, base)) return false;
  const relative = path.slice(base.length);
  const reading = relative.match(/^courses\/([\w-]+)\/l\/([^/]+)\/$/);
  const interactive = relative.match(/^lessons\/([\w-]+)\/lessons\/([^/]+)\.html$/);
  const match = reading || interactive;
  if (!match || !LESSON_SLUGS.has(match[1])) return false;
  return isLessonFileName(match[2]);
}
function isLessonFileName(value) {
  try {
    const name = decodeURIComponent(value);
    return name.length > 0 && name.length <= 240 && !name.includes("..") && /^[\p{L}\p{N}_().（）·—－-]+$/u.test(name);
  } catch {
    return false;
  }
}
function isInteractivePath(path, base = DEFAULT_BASE) {
  if (!isSameBasePath(path, base)) return false;
  const relative = path.slice(base.length);
  const match = relative.match(/^lessons\/([\w-]+)\/lessons\/([^/]+)\.html$/);
  return Boolean(match && LESSON_SLUGS.has(match[1]) && isLessonFileName(match[2]));
}
function isPrepCheckKey(key, base = DEFAULT_BASE) {
  if (typeof key !== "string" || !key.startsWith(base) || /[?\\\u0000-\u001f]/.test(key)) return false;
  const relative = key.slice(base.length);
  const match = relative.match(/^prep\/[A-Za-z0-9_-]+\/#w(\d{1,2})$/);
  return Boolean(match && Number(match[1]) >= 1 && Number(match[1]) <= 29);
}
function isAllowedPathAnswerKey(key, base = DEFAULT_BASE) {
  for (const prefix2 of PATH_ANSWER_PREFIXES) {
    if (!key.startsWith(prefix2)) continue;
    const suffix = key.slice(prefix2.length);
    const needsScope = prefix2 !== "l1uj-cs-answers-v1:";
    if (needsScope) {
      const delimiter = suffix.lastIndexOf(":");
      if (delimiter <= 0 || !SAFE_SCOPE.test(suffix.slice(delimiter + 1))) return false;
      return isInteractivePath(suffix.slice(0, delimiter), base);
    }
    return isInteractivePath(suffix, base);
  }
  return false;
}
function keyInfo(key, base = DEFAULT_BASE) {
  if (isCsLearningKey(key)) return { kind: "cs-learning" };
  if (key.startsWith("l1uj-learning-guide-note-v1:") && isLessonPath(key.slice("l1uj-learning-guide-note-v1:".length), base)) return { kind: "learning-guide-note" };
  if (key === "l1uj-reading-v1") return { kind: "l1uj-reading-v1", mode: CONTAINER_MODES.reading };
  if (key === "zc-progress-v1") return { kind: "zc-progress-v1" };
  if (key === "zsb-mistakes-v1") return { kind: "zsb-mistakes-v1" };
  if (key === "zhixu-mistakes-v1") return { kind: "zhixu-mistakes-v1", mode: CONTAINER_MODES.studyProgress };
  if (key === "zsb-prep-checks") return { kind: "zsb-prep-checks" };
  if (key === "l1uj-study-progress-v1") return { kind: "l1uj-study-progress-v1", mode: CONTAINER_MODES.studyProgress };
  if (key === "l1uj-study-tasks-v1") return { kind: "l1uj-study-tasks-v1", mode: CONTAINER_MODES.studyTasks };
  if (key === "zsb-prep-checks-meta-v1") return { kind: "zsb-prep-checks-meta-v1", mode: CONTAINER_MODES.prepMeta };
  if (key === "l1uj-knowledge-v1") return { kind: "l1uj-knowledge-v1", mode: CONTAINER_MODES.knowledge };
  if (key.startsWith(GUIDED_PREFIX) && /^zsb-(?:english|politics|math|cs):[a-z0-9-]{1,80}:[a-z0-9-]{1,80}$/.test(key.slice(GUIDED_PREFIX.length))) return { kind: "l1uj-guided-v1" };
  if (key.startsWith(SECTIONS_PREFIX)) {
    const match = key.slice(SECTIONS_PREFIX.length).match(SECTIONS_KEY);
    if (match && !hasUnsafeProperty(match[2])) return { kind: "l1uj-sections-v1", id: key.slice(SECTIONS_PREFIX.length), mode: CONTAINER_MODES.sections };
  }
  if (key.startsWith("zc-progress-items-v1:") && SAFE_ID.test(key.slice("zc-progress-items-v1:".length))) {
    return { kind: "zc-progress-items-v1", id: key.slice("zc-progress-items-v1:".length) };
  }
  if (key.startsWith("zsb-course-done-") && SAFE_ID.test(key.slice("zsb-course-done-".length))) {
    return { kind: "zsb-course-done", id: key.slice("zsb-course-done-".length) };
  }
  if (key.startsWith("zzkk:v2:lesson:") && SAFE_POLITICS_LESSON_ID.test(key.slice("zzkk:v2:lesson:".length))) {
    return { kind: "zzkk:v2:lesson", id: key.slice("zzkk:v2:lesson:".length) };
  }
  if (key.startsWith("zzkk:v2:card:") && SAFE_ID.test(key.slice("zzkk:v2:card:".length))) {
    return { kind: "zzkk:v2:card", id: key.slice("zzkk:v2:card:".length) };
  }
  if (key.startsWith("zzkk:v2:wrong:") && SAFE_ID.test(key.slice("zzkk:v2:wrong:".length))) {
    return { kind: "zzkk:v2:wrong", id: key.slice("zzkk:v2:wrong:".length) };
  }
  if (isAllowedPathAnswerKey(key, base)) {
    if (key.startsWith("l1uj-cs-answers-v1:")) return { kind: "l1uj-cs-answers-v1" };
    if (key.startsWith("l1uj-english-answers-v1:")) return { kind: "l1uj-english-answers-v1" };
    return { kind: "l1uj-politics-answers-v1" };
  }
  return null;
}
function isAllowedStudyKey(key, base = DEFAULT_BASE) {
  return Boolean(normalizeBase(base) && typeof key === "string" && keyInfo(key, base));
}
function addError(errors, path, message2) {
  errors.push(`${path}: ${message2}`);
}
function checkObjectKeys(value, allowed, path, errors, required = []) {
  if (!isPlainObject(value)) {
    addError(errors, path, "\u5FC5\u987B\u662F\u5BF9\u8C61");
    return false;
  }
  for (const key of ownKeys(value)) {
    if (hasUnsafeProperty(key) || !allowed.has(key)) addError(errors, `${path}.${key}`, "\u5305\u542B\u672A\u5141\u8BB8\u7684\u5B57\u6BB5");
  }
  for (const key of required) if (!Object.prototype.hasOwnProperty.call(value, key)) addError(errors, `${path}.${key}`, "\u7F3A\u5C11\u5B57\u6BB5");
  return true;
}
function checkString(value, path, errors, { min = 0, max = 5e3, pattern } = {}) {
  if (typeof value !== "string" || value.length < min || value.length > max || pattern && !pattern.test(value)) {
    addError(errors, path, "\u5B57\u7B26\u4E32\u683C\u5F0F\u4E0D\u7B26\u5408\u8981\u6C42");
    return false;
  }
  return true;
}
function checkNonNegativeInteger(value, path, errors) {
  if (!isNonNegativeInteger(value)) {
    addError(errors, path, "\u5FC5\u987B\u662F\u975E\u8D1F\u6574\u6570");
    return false;
  }
  return true;
}
function checkTimestamp(value, path, errors) {
  if (!isTimestamp(value)) {
    addError(errors, path, "\u5FC5\u987B\u662F\u975E\u8D1F\u6BEB\u79D2\u65F6\u95F4\u6233");
    return false;
  }
  return true;
}
function validateReading(value, errors, base) {
  if (!checkObjectKeys(value, /* @__PURE__ */ new Set(["version", "entries"]), "records.l1uj-reading-v1", errors, ["version", "entries"])) return;
  if (value.version !== 1) addError(errors, "records.l1uj-reading-v1.version", "\u53EA\u652F\u6301\u7248\u672C 1");
  if (!Array.isArray(value.entries) || value.entries.length > 40) {
    addError(errors, "records.l1uj-reading-v1.entries", "\u5FC5\u987B\u662F\u6700\u591A 40 \u9879\u7684\u6570\u7EC4");
    return;
  }
  const seen = /* @__PURE__ */ new Set();
  const allowed = /* @__PURE__ */ new Set(["path", "slug", "subject", "mode", "title", "updatedAt", "y", "offset", "anchor", "chapter"]);
  value.entries.forEach((entry, index) => {
    const path = `records.l1uj-reading-v1.entries[${index}]`;
    if (!checkObjectKeys(entry, allowed, path, errors, ["path", "title", "updatedAt", "y"])) return;
    if (!isLessonPath(entry.path, base) || seen.has(entry.path)) addError(errors, `${path}.path`, "\u5FC5\u987B\u662F\u540C\u4E00\u7AD9\u70B9\u4E0B\u552F\u4E00\u7684\u8BFE\u7A0B\u8DEF\u5F84");
    seen.add(entry.path);
    checkString(entry.title, `${path}.title`, errors, { min: 1, max: 180 });
    checkTimestamp(entry.updatedAt, `${path}.updatedAt`, errors);
    if (typeof entry.y !== "number" || !Number.isFinite(entry.y) || entry.y < 0) addError(errors, `${path}.y`, "\u5FC5\u987B\u662F\u975E\u8D1F\u6570\u5B57");
    if (entry.slug != null) checkString(entry.slug, `${path}.slug`, errors, { pattern: /^[\w-]+$/ });
    if (entry.subject != null) checkString(entry.subject, `${path}.subject`, errors, { max: 80 });
    if (entry.mode != null && entry.mode !== "reading" && entry.mode !== "interactive") addError(errors, `${path}.mode`, "\u53EA\u80FD\u662F reading \u6216 interactive");
    if (entry.offset != null && (typeof entry.offset !== "number" || !Number.isFinite(entry.offset))) addError(errors, `${path}.offset`, "\u5FC5\u987B\u662F\u6709\u9650\u6570\u5B57");
    if (entry.anchor != null) checkString(entry.anchor, `${path}.anchor`, errors, { max: 100 });
    if (entry.chapter != null) checkString(entry.chapter, `${path}.chapter`, errors, { max: 100 });
  });
}
function validateMathProgress(value, errors) {
  if (!checkObjectKeys(value, new Set(Object.keys(value || {})), "records.zc-progress-v1", errors)) return;
  const countFields = /* @__PURE__ */ new Set([
    "visits",
    "quizRight",
    "quizTotal",
    "recallOk",
    "recallNo",
    "quizRoundTotal",
    "quizAnswered",
    "quizCorrect",
    "quizFirstTryCorrect",
    "recallRoundTotal",
    "recallAnswered",
    "recallGood",
    "recallBad",
    "answered",
    "correct",
    "cardsReviewed",
    "cardsGood",
    "cardsBad"
  ]);
  const booleanFields = /* @__PURE__ */ new Set([
    "exerciseComplete",
    "allCorrect",
    "quizReviewNeeded",
    "reviewNeeded",
    "quizComplete",
    "quizAllCorrect",
    "manualDone",
    "manualActivity",
    "cardsReviewNeeded"
  ]);
  const stringFields = /* @__PURE__ */ new Set(["status", "exerciseStatus", "statusLabel", "mastery", "lessonId"]);
  const allowedFields = /* @__PURE__ */ new Set([...countFields, ...booleanFields, ...stringFields, "summary"]);
  for (const [lesson, record] of Object.entries(value)) {
    if (!isSafeMapKey(lesson, SAFE_ID)) addError(errors, `records.zc-progress-v1.${lesson}`, "\u8BFE\u6B21\u952E\u4E0D\u5B89\u5168");
    if (!checkObjectKeys(record, allowedFields, `records.zc-progress-v1.${lesson}`, errors)) continue;
    for (const field of countFields) if (record[field] != null) checkNonNegativeInteger(record[field], `records.zc-progress-v1.${lesson}.${field}`, errors);
    for (const field of booleanFields) if (record[field] != null && typeof record[field] !== "boolean") addError(errors, `records.zc-progress-v1.${lesson}.${field}`, "\u5FC5\u987B\u662F\u5E03\u5C14\u503C");
    for (const field of stringFields) if (record[field] != null) checkString(record[field], `records.zc-progress-v1.${lesson}.${field}`, errors, { max: 180 });
    if (record.status != null && !["not-started", "in-progress", "exercise-complete"].includes(record.status)) addError(errors, `records.zc-progress-v1.${lesson}.status`, "\u72B6\u6001\u503C\u4E0D\u53D7\u652F\u6301");
    if (record.exerciseStatus != null && !["not-started", "in-progress", "exercise-complete"].includes(record.exerciseStatus)) addError(errors, `records.zc-progress-v1.${lesson}.exerciseStatus`, "\u72B6\u6001\u503C\u4E0D\u53D7\u652F\u6301");
    if (record.mastery != null && !["verified", "needs-review", "unassessed"].includes(record.mastery)) addError(errors, `records.zc-progress-v1.${lesson}.mastery`, "\u638C\u63E1\u72B6\u6001\u503C\u4E0D\u53D7\u652F\u6301");
    if (record.summary != null) validateMathSummary(record.summary, errors, `records.zc-progress-v1.${lesson}.summary`);
  }
}
function validateMathSummary(value, errors, path) {
  const countFields = /* @__PURE__ */ new Set([
    "quizTotal",
    "quizAnswered",
    "quizCorrect",
    "quizFirstTryCorrect",
    "recallTotal",
    "recallAnswered",
    "recallGood",
    "recallBad",
    "total",
    "answered",
    "correct",
    "visits"
  ]);
  const booleanFields = /* @__PURE__ */ new Set(["quizReviewNeeded", "recallReviewNeeded", "exerciseComplete", "allCorrect", "reviewNeeded"]);
  const stringFields = /* @__PURE__ */ new Set(["lessonId", "status", "statusLabel", "mastery"]);
  if (!checkObjectKeys(value, /* @__PURE__ */ new Set([...countFields, ...booleanFields, ...stringFields, "legacy"]), path, errors)) return;
  for (const field of countFields) if (value[field] != null) checkNonNegativeInteger(value[field], `${path}.${field}`, errors);
  for (const field of booleanFields) if (value[field] != null && typeof value[field] !== "boolean") addError(errors, `${path}.${field}`, "\u5FC5\u987B\u662F\u5E03\u5C14\u503C");
  for (const field of stringFields) if (value[field] != null) checkString(value[field], `${path}.${field}`, errors, { max: 180 });
  if (value.status != null && !["not-started", "in-progress", "exercise-complete"].includes(value.status)) addError(errors, `${path}.status`, "\u72B6\u6001\u503C\u4E0D\u53D7\u652F\u6301");
  if (value.mastery != null && !["verified", "needs-review", "unassessed"].includes(value.mastery)) addError(errors, `${path}.mastery`, "\u638C\u63E1\u72B6\u6001\u503C\u4E0D\u53D7\u652F\u6301");
  if (value.legacy != null && checkObjectKeys(value.legacy, /* @__PURE__ */ new Set(["quizRight", "quizTotal", "recallOk", "recallNo"]), `${path}.legacy`, errors)) {
    for (const field of ["quizRight", "quizTotal", "recallOk", "recallNo"]) checkNonNegativeInteger(value.legacy[field], `${path}.legacy.${field}`, errors);
  }
}
function validateMathItems(value, errors) {
  const path = "records.zc-progress-items-v1";
  if (!checkObjectKeys(value, /* @__PURE__ */ new Set(["quiz", "recall", "legacy"]), path, errors, ["quiz", "recall", "legacy"])) return;
  if (isPlainObject(value.quiz)) {
    for (const [id, item] of Object.entries(value.quiz)) {
      if (!isSafeMapKey(id)) addError(errors, `${path}.quiz.${id}`, "\u9898\u76EE\u952E\u4E0D\u5B89\u5168");
      if (!checkObjectKeys(item, /* @__PURE__ */ new Set(["attempts", "done"]), `${path}.quiz.${id}`, errors, ["attempts", "done"])) continue;
      if (!Array.isArray(item.attempts) || item.attempts.some((attempt) => typeof attempt !== "string" || attempt.length > 20)) addError(errors, `${path}.quiz.${id}.attempts`, "\u5FC5\u987B\u662F\u77ED\u5B57\u7B26\u4E32\u6570\u7EC4");
      if (typeof item.done !== "boolean") addError(errors, `${path}.quiz.${id}.done`, "\u5FC5\u987B\u662F\u5E03\u5C14\u503C");
    }
  }
  if (isPlainObject(value.recall)) {
    for (const [id, item] of Object.entries(value.recall)) {
      if (!isSafeMapKey(id)) addError(errors, `${path}.recall.${id}`, "\u56DE\u5FC6\u5361\u952E\u4E0D\u5B89\u5168");
      if (!checkObjectKeys(item, /* @__PURE__ */ new Set(["shown", "vote"]), `${path}.recall.${id}`, errors)) continue;
      if (item.shown != null && typeof item.shown !== "boolean") addError(errors, `${path}.recall.${id}.shown`, "\u5FC5\u987B\u662F\u5E03\u5C14\u503C");
      if (item.vote != null && item.vote !== "good" && item.vote !== "bad") addError(errors, `${path}.recall.${id}.vote`, "\u53EA\u80FD\u662F good \u6216 bad");
    }
  }
  const legacy = value.legacy;
  if (checkObjectKeys(legacy, /* @__PURE__ */ new Set(["quizRight", "quizTotal", "recallOk", "recallNo"]), `${path}.legacy`, errors)) {
    for (const field of ["quizRight", "quizTotal", "recallOk", "recallNo"]) checkNonNegativeInteger(legacy[field], `${path}.legacy.${field}`, errors);
  }
}
function validateEnglishAnswers(value, errors, path) {
  if (!checkObjectKeys(value, new Set(Object.keys(value || {})), path, errors)) return;
  for (const [index, item] of Object.entries(value)) {
    if (!/^\d+$/.test(index)) addError(errors, `${path}.${index}`, "\u9898\u53F7\u5FC5\u987B\u662F\u6570\u5B57");
    if (!checkObjectKeys(item, /* @__PURE__ */ new Set(["signature", "picked"]), `${path}.${index}`, errors, ["signature", "picked"])) continue;
    checkString(item.signature, `${path}.${index}.signature`, errors, { min: 1, max: 1e3 });
    if (!Number.isInteger(item.picked) || item.picked < 0) addError(errors, `${path}.${index}.picked`, "\u5FC5\u987B\u662F\u975E\u8D1F\u6574\u6570");
  }
}
function validateCsAnswers(value, errors, path) {
  if (!checkObjectKeys(value, new Set(Object.keys(value || {})), path, errors)) return;
  for (const [question, item] of Object.entries(value)) {
    if (!/^\d+$/.test(question)) addError(errors, `${path}.${question}`, "\u9898\u53F7\u5FC5\u987B\u662F\u6570\u5B57");
    if (!checkObjectKeys(item, /* @__PURE__ */ new Set(["signature", "attempts"]), `${path}.${question}`, errors, ["signature", "attempts"])) continue;
    checkString(item.signature, `${path}.${question}.signature`, errors, { min: 1, max: 1e3 });
    if (!Array.isArray(item.attempts) || item.attempts.length > 20 || item.attempts.some((attempt) => typeof attempt !== "string" || attempt.length > 20)) addError(errors, `${path}.${question}.attempts`, "\u5FC5\u987B\u662F\u77ED\u5B57\u7B26\u4E32\u6570\u7EC4");
  }
}
function validateCsMistakes(value, errors) {
  const path = "records.zsb-mistakes-v1";
  if (!checkObjectKeys(value, new Set(Object.keys(value || {})), path, errors)) return;
  for (const [lesson, questions] of Object.entries(value)) {
    if (!/^\d{4}$/.test(lesson)) addError(errors, `${path}.${lesson}`, "\u8BFE\u6B21\u952E\u5FC5\u987B\u662F\u56DB\u4F4D\u6570\u5B57");
    if (!isPlainObject(questions)) {
      addError(errors, `${path}.${lesson}`, "\u5FC5\u987B\u662F\u9519\u9898\u6620\u5C04");
      continue;
    }
    for (const [question, item] of Object.entries(questions)) {
      if (!/^\d+$/.test(question)) addError(errors, `${path}.${lesson}.${question}`, "\u9898\u53F7\u5FC5\u987B\u662F\u6570\u5B57");
      if (!checkObjectKeys(item, /* @__PURE__ */ new Set(["wrongs", "fixed", "t"]), `${path}.${lesson}.${question}`, errors, ["wrongs", "fixed"])) continue;
      if (!Number.isInteger(item.wrongs) || item.wrongs < 1) addError(errors, `${path}.${lesson}.${question}.wrongs`, "\u5FC5\u987B\u662F\u6B63\u6574\u6570");
      if (typeof item.fixed !== "boolean") addError(errors, `${path}.${lesson}.${question}.fixed`, "\u5FC5\u987B\u662F\u5E03\u5C14\u503C");
      if (item.t != null) checkString(item.t, `${path}.${lesson}.${question}.t`, errors, { max: 2e3 });
    }
  }
}
function validatePoliticsProgress(value, errors, path) {
  const allowed = /* @__PURE__ */ new Set([
    "best",
    "done",
    "at",
    "visits",
    "quizTotal",
    "quizRoundTotal",
    "quizAnswered",
    "quizCorrect",
    "quizComplete",
    "exerciseComplete",
    "quizAllCorrect",
    "quizReviewNeeded",
    "reviewNeeded",
    "exerciseStatus",
    "status",
    "cardsReviewed",
    "cardsGood",
    "cardsBad",
    "cardsReviewNeeded",
    "manualActivity",
    "manualDone"
  ]);
  if (!checkObjectKeys(value, allowed, path, errors)) return;
  if (value.best != null && (!Number.isFinite(value.best) || value.best < 0 || value.best > 100)) addError(errors, `${path}.best`, "\u5FC5\u987B\u662F 0 \u5230 100 \u7684\u6570\u5B57");
  if (value.done != null && typeof value.done !== "boolean") addError(errors, `${path}.done`, "\u5FC5\u987B\u662F\u5E03\u5C14\u503C");
  if (value.at != null && !isInstantString(value.at)) addError(errors, `${path}.at`, "\u5FC5\u987B\u662F ISO \u65F6\u95F4");
  for (const field of [
    "visits",
    "quizTotal",
    "quizRoundTotal",
    "quizAnswered",
    "quizCorrect",
    "cardsReviewed",
    "cardsGood",
    "cardsBad"
  ]) if (value[field] != null) checkNonNegativeInteger(value[field], `${path}.${field}`, errors);
  for (const field of [
    "done",
    "quizComplete",
    "exerciseComplete",
    "quizAllCorrect",
    "quizReviewNeeded",
    "reviewNeeded",
    "cardsReviewNeeded",
    "manualActivity",
    "manualDone"
  ]) if (value[field] != null && typeof value[field] !== "boolean") addError(errors, `${path}.${field}`, "\u5FC5\u987B\u662F\u5E03\u5C14\u503C");
  for (const field of ["exerciseStatus", "status"]) {
    if (value[field] != null && !["not-started", "in-progress", "exercise-complete"].includes(value[field])) {
      addError(errors, `${path}.${field}`, "\u5FC5\u987B\u662F\u5408\u6CD5\u7684\u8BFE\u7A0B\u72B6\u6001");
    }
  }
}
function validatePoliticsCard(value, errors, path) {
  if (!checkObjectKeys(value, /* @__PURE__ */ new Set(["box", "streak", "at"]), path, errors, ["box", "streak", "at"])) return;
  if (!Number.isInteger(value.box) || value.box < 0 || value.box > 3) addError(errors, `${path}.box`, "\u5FC5\u987B\u662F 0 \u5230 3 \u7684\u6574\u6570");
  checkNonNegativeInteger(value.streak, `${path}.streak`, errors);
  if (!isDateString(value.at)) addError(errors, `${path}.at`, "\u5FC5\u987B\u662F YYYY-MM-DD \u65E5\u671F");
}
function validatePoliticsWrong(value, errors, path) {
  const allowed = /* @__PURE__ */ new Set(["count", "firstAt", "lastAt", "stem", "options", "answer", "exp", "from"]);
  if (!checkObjectKeys(value, allowed, path, errors, ["count"])) return;
  if (!Number.isInteger(value.count) || value.count < 1) addError(errors, `${path}.count`, "\u5FC5\u987B\u662F\u6B63\u6574\u6570");
  for (const field of ["firstAt", "lastAt"]) if (value[field] != null && !isDateString(value[field])) addError(errors, `${path}.${field}`, "\u5FC5\u987B\u662F YYYY-MM-DD \u65E5\u671F");
  for (const field of ["stem", "exp", "from"]) if (value[field] != null) checkString(value[field], `${path}.${field}`, errors, { max: 5e3 });
  if (value.answer != null && typeof value.answer !== "string") addError(errors, `${path}.answer`, "\u5FC5\u987B\u662F\u5B57\u7B26\u4E32\u6216 null");
  if (value.options != null) {
    if (!Array.isArray(value.options) || value.options.length > 30) addError(errors, `${path}.options`, "\u5FC5\u987B\u662F\u9009\u9879\u6570\u7EC4");
    else value.options.forEach((option, index) => {
      const optionPath = `${path}.options[${index}]`;
      if (!checkObjectKeys(option, /* @__PURE__ */ new Set(["letter", "text"]), optionPath, errors, ["letter", "text"])) return;
      checkString(option.letter, `${optionPath}.letter`, errors, { min: 1, max: 4 });
      checkString(option.text, `${optionPath}.text`, errors, { max: 1e3 });
    });
  }
}
function validatePoliticsAnswers(value, errors, path) {
  if (!checkObjectKeys(value, new Set(Object.keys(value || {})), path, errors)) return;
  for (const [signature, item] of Object.entries(value)) {
    if (!/^h[A-Za-z0-9]+$/.test(signature)) addError(errors, `${path}.${signature}`, "\u9898\u76EE\u7B7E\u540D\u4E0D\u5B89\u5168");
    if (!checkObjectKeys(item, /* @__PURE__ */ new Set(["picked", "done"]), `${path}.${signature}`, errors, ["picked", "done"])) continue;
    if (!Array.isArray(item.picked) || item.picked.length > 26 || item.picked.some((letter) => typeof letter !== "string" || letter.length > 3)) addError(errors, `${path}.${signature}.picked`, "\u5FC5\u987B\u662F\u77ED\u5B57\u7B26\u4E32\u6570\u7EC4");
    if (typeof item.done !== "boolean") addError(errors, `${path}.${signature}.done`, "\u5FC5\u987B\u662F\u5E03\u5C14\u503C");
  }
}
function validateStudyProgress(value, errors, base) {
  const path = "records.l1uj-study-progress-v1";
  if (!checkObjectKeys(value, /* @__PURE__ */ new Set(["version", "entries"]), path, errors, ["version", "entries"])) return;
  if (value.version !== 1) addError(errors, `${path}.version`, "\u53EA\u652F\u6301\u7248\u672C 1");
  if (!isPlainObject(value.entries)) {
    addError(errors, `${path}.entries`, "\u5FC5\u987B\u662F\u5BF9\u8C61");
    return;
  }
  for (const [entryKey, entry] of Object.entries(value.entries)) {
    const match = entryKey.match(/^(zsb-(?:math|english|politics|cs)):([A-Za-z0-9_-]+)$/);
    const entryPath = `${path}.entries.${entryKey}`;
    if (!match || !EXAM_SLUGS.has(match[1])) addError(errors, entryPath, "\u5B66\u4E60\u8BB0\u5F55\u952E\u683C\u5F0F\u4E0D\u6B63\u786E");
    const allowed = /* @__PURE__ */ new Set(["slug", "id", "title", "path", "total", "answered", "correct", "reviewNeeded", "updatedAt"]);
    if (!checkObjectKeys(entry, allowed, entryPath, errors, ["slug", "id", "title", "path", "total", "answered", "correct", "reviewNeeded", "updatedAt"])) continue;
    if (entry.slug !== match?.[1] || entry.id !== match?.[2]) addError(errors, `${entryPath}.slug/id`, "\u5FC5\u987B\u4E0E entries \u952E\u4E00\u81F4");
    checkString(entry.title, `${entryPath}.title`, errors, { min: 1, max: 180 });
    if (!isLessonPath(entry.path, base)) addError(errors, `${entryPath}.path`, "\u5FC5\u987B\u662F\u540C\u4E00\u7AD9\u70B9\u4E0B\u7684\u8BFE\u7A0B\u8DEF\u5F84");
    for (const field of ["total", "answered", "correct", "reviewNeeded"]) checkNonNegativeInteger(entry[field], `${entryPath}.${field}`, errors);
    if (isNonNegativeInteger(entry.total) && isNonNegativeInteger(entry.answered) && entry.answered > entry.total) addError(errors, `${entryPath}.answered`, "\u4E0D\u80FD\u5927\u4E8E total");
    if (isNonNegativeInteger(entry.answered) && isNonNegativeInteger(entry.correct) && entry.correct > entry.answered) addError(errors, `${entryPath}.correct`, "\u4E0D\u80FD\u5927\u4E8E answered");
    if (isNonNegativeInteger(entry.total) && isNonNegativeInteger(entry.reviewNeeded) && entry.reviewNeeded > entry.total) addError(errors, `${entryPath}.reviewNeeded`, "\u4E0D\u80FD\u5927\u4E8E total");
    checkTimestamp(entry.updatedAt, `${entryPath}.updatedAt`, errors);
  }
}
function validateStudyTasks(value, errors) {
  const path = "records.l1uj-study-tasks-v1";
  if (!checkObjectKeys(value, /* @__PURE__ */ new Set(["version", "entries"]), path, errors, ["version", "entries"])) return;
  if (value.version !== 1) addError(errors, `${path}.version`, "\u53EA\u652F\u6301\u7248\u672C 1");
  if (!isPlainObject(value.entries)) {
    addError(errors, `${path}.entries`, "\u5FC5\u987B\u662F\u5BF9\u8C61");
    return;
  }
  for (const [entryKey, entry] of Object.entries(value.entries)) {
    const entryPath = `${path}.entries.${entryKey}`;
    const match = entryKey.match(/^lesson:(zsb-(?:math|english|politics|cs)):([A-Za-z0-9_-]+)$/);
    const auxiliary = /* @__PURE__ */ new Set(["review:politics", "wrong:cs", "wrong:politics"]);
    if (!match && !auxiliary.has(entryKey)) addError(errors, entryPath, "\u4EFB\u52A1\u952E\u683C\u5F0F\u4E0D\u6B63\u786E");
    if (!checkObjectKeys(entry, /* @__PURE__ */ new Set(["deferUntil", "limit", "updatedAt"]), entryPath, errors, ["updatedAt"])) continue;
    if (entry.deferUntil != null && !isDateString(entry.deferUntil)) addError(errors, `${entryPath}.deferUntil`, "\u5FC5\u987B\u662F YYYY-MM-DD \u65E5\u671F");
    if (entry.limit != null && ![1, 5, 10].includes(entry.limit)) addError(errors, `${entryPath}.limit`, "\u53EA\u80FD\u662F 1\u30015 \u6216 10");
    checkTimestamp(entry.updatedAt, `${entryPath}.updatedAt`, errors);
  }
}
function validateKnowledge(value, errors) {
  const path = "records.l1uj-knowledge-v1";
  if (!checkObjectKeys(value, /* @__PURE__ */ new Set(["version", "points", "sources"]), path, errors, ["version", "points"])) return;
  if (value.version !== 1) addError(errors, `${path}.version`, "\u53EA\u652F\u6301\u7248\u672C 1");
  if (!isPlainObject(value.points)) {
    addError(errors, `${path}.points`, "\u5FC5\u987B\u662F\u5BF9\u8C61");
    return;
  }
  for (const [id, point] of Object.entries(value.points)) {
    const pointPath = `${path}.points.${id}`;
    if (!isSafeMapKey(id)) addError(errors, pointPath, "\u77E5\u8BC6\u70B9\u952E\u4E0D\u5B89\u5168");
    const fields = /* @__PURE__ */ new Set(["box", "dueAt", "learnedAt", "lastResult", "history"]);
    if (!checkObjectKeys(point, fields, pointPath, errors, [...fields])) continue;
    if (!Number.isInteger(point.box) || point.box < 1 || point.box > 3) addError(errors, `${pointPath}.box`, "\u5FC5\u987B\u662F 1 \u5230 3 \u7684\u6574\u6570");
    checkTimestamp(point.dueAt, `${pointPath}.dueAt`, errors);
    checkTimestamp(point.learnedAt, `${pointPath}.learnedAt`, errors);
    if (!["correct", "wrong", "viewed"].includes(point.lastResult)) addError(errors, `${pointPath}.lastResult`, "\u53EA\u80FD\u662F correct\u3001wrong \u6216 viewed");
    if (!Array.isArray(point.history) || point.history.length > 50) {
      addError(errors, `${pointPath}.history`, "\u5FC5\u987B\u662F\u6700\u591A 50 \u6761\u7684\u5386\u53F2\u6570\u7EC4");
      continue;
    }
    point.history.forEach((entry, index) => {
      const entryPath = `${pointPath}.history[${index}]`;
      if (!checkObjectKeys(entry, /* @__PURE__ */ new Set(["at", "result"]), entryPath, errors, ["at", "result"])) return;
      checkTimestamp(entry.at, `${entryPath}.at`, errors);
      if (!["correct", "wrong", "viewed", "skip"].includes(entry.result)) addError(errors, `${entryPath}.result`, "\u7ED3\u679C\u503C\u4E0D\u53D7\u652F\u6301");
    });
  }
  if (value.sources == null) return;
  if (!isPlainObject(value.sources)) {
    addError(errors, `${path}.sources`, "\u5FC5\u987B\u662F\u5BF9\u8C61");
    return;
  }
  for (const [id, source] of Object.entries(value.sources)) {
    const sourcePath = `${path}.sources.${id}`;
    if (!isSafeMapKey(id)) addError(errors, sourcePath, "\u77E5\u8BC6\u70B9\u952E\u4E0D\u5B89\u5168");
    if (!checkObjectKeys(source, /* @__PURE__ */ new Set(["slug", "lessonId", "ref", "name"]), sourcePath, errors)) continue;
    if (source.slug != null && !EXAM_SLUGS.has(source.slug)) addError(errors, `${sourcePath}.slug`, "\u5B66\u79D1\u4E0D\u53D7\u652F\u6301");
    for (const field of ["lessonId", "ref", "name"]) if (source[field] != null) checkString(source[field], `${sourcePath}.${field}`, errors, { max: 180 });
  }
}
function validateSections(value, errors, path) {
  if (!isPlainObject(value)) {
    addError(errors, path, "\u5FC5\u987B\u662F\u5BF9\u8C61");
    return;
  }
  for (const [id, entry] of Object.entries(value)) {
    const entryPath = `${path}.${id}`;
    if (!isSafeMapKey(id, SAFE_SCOPE)) addError(errors, entryPath, "\u5C0F\u8282\u952E\u4E0D\u5B89\u5168");
    if (!checkObjectKeys(entry, /* @__PURE__ */ new Set(["done", "at"]), entryPath, errors, ["done", "at"])) continue;
    if (entry.done !== true) addError(errors, `${entryPath}.done`, "\u53EA\u80FD\u662F true");
    checkTimestamp(entry.at, `${entryPath}.at`, errors);
  }
}
function validatePrepMeta(value, errors, base) {
  const path = "records.zsb-prep-checks-meta-v1";
  if (!checkObjectKeys(value, new Set(Object.keys(value || {})), path, errors)) return;
  for (const [entryKey, entry] of Object.entries(value)) {
    const entryPath = `${path}.${entryKey}`;
    if (!isPrepCheckKey(entryKey, base)) addError(errors, entryPath, "\u5FC5\u987B\u662F\u540C\u4E00\u7AD9\u70B9\u7684\u5468\u8BA1\u5212\u8DEF\u5F84");
    if (!checkObjectKeys(entry, /* @__PURE__ */ new Set(["checked", "updatedAt"]), entryPath, errors, ["checked", "updatedAt"])) continue;
    if (typeof entry.checked !== "boolean") addError(errors, `${entryPath}.checked`, "\u5FC5\u987B\u662F\u5E03\u5C14\u503C");
    checkTimestamp(entry.updatedAt, `${entryPath}.updatedAt`, errors);
  }
}
function validateRecord(key, value, errors, base) {
  const info = keyInfo(key, base);
  if (!info) {
    addError(errors, `records.${key}`, "\u5B58\u50A8\u952E\u4E0D\u5728\u767D\u540D\u5355\u4E2D");
    return;
  }
  switch (info.kind) {
    case "cs-learning":
      if (!validCsLearningState(value)) addError(errors, `records.${key}`, "\u8BA1\u7B97\u673A\u5206\u8282\u5B66\u4E60\u8BB0\u5F55\u683C\u5F0F\u65E0\u6548");
      return;
    case "l1uj-guided-v1":
      if (!validGuideState(value)) addError(errors, `records.${key}`, "\u5C0F\u6B65\u5B66\u4E60\u8BB0\u5F55\u683C\u5F0F\u65E0\u6548");
      return;
    case "learning-guide-note":
      if (typeof value !== "string" || value.length > 2e3) errors.push(`records.${key}: \u56DE\u5FC6\u7B14\u8BB0\u987B\u4E3A 2000 \u5B57\u4EE5\u5185\u6587\u672C`);
      return;
    case "l1uj-reading-v1":
      return validateReading(value, errors, base);
    case "zc-progress-v1":
      return validateMathProgress(value, errors);
    case "zc-progress-items-v1":
      return validateMathItems(value, errors);
    case "zsb-course-done":
      if (value !== "1") addError(errors, `records.${key}`, "\u82F1\u8BED\u5B8C\u6210\u6807\u8BB0\u53EA\u80FD\u662F\u5B57\u7B26\u4E32 1");
      return;
    case "l1uj-english-answers-v1":
      return validateEnglishAnswers(value, errors, `records.${key}`);
    case "zsb-mistakes-v1":
      return validateCsMistakes(value, errors);
    case "zhixu-mistakes-v1":
      try {
        parseMistakeBackup(JSON.stringify(value), base);
      } catch (error) {
        addError(errors, `records.${key}`, error.message);
      }
      return;
    case "l1uj-cs-answers-v1":
      return validateCsAnswers(value, errors, `records.${key}`);
    case "zzkk:v2:lesson":
      return validatePoliticsProgress(value, errors, `records.${key}`);
    case "zzkk:v2:card":
      return validatePoliticsCard(value, errors, `records.${key}`);
    case "zzkk:v2:wrong":
      return validatePoliticsWrong(value, errors, `records.${key}`);
    case "l1uj-politics-answers-v1":
      return validatePoliticsAnswers(value, errors, `records.${key}`);
    case "zsb-prep-checks":
      if (!isPlainObject(value)) {
        addError(errors, `records.${key}`, "\u5FC5\u987B\u662F\u5468\u8BA1\u5212\u6620\u5C04");
        return;
      }
      for (const [entryKey, checked] of Object.entries(value)) {
        if (!isPrepCheckKey(entryKey, base)) addError(errors, `records.${key}.${entryKey}`, "\u5FC5\u987B\u662F\u540C\u4E00\u7AD9\u70B9\u7684\u5468\u8BA1\u5212\u8DEF\u5F84");
        if (checked !== 1) addError(errors, `records.${key}.${entryKey}`, "\u65E7\u5468\u8BA1\u5212\u6807\u8BB0\u53EA\u80FD\u662F\u6570\u5B57 1");
      }
      return;
    case "l1uj-study-progress-v1":
      return validateStudyProgress(value, errors, base);
    case "l1uj-study-tasks-v1":
      return validateStudyTasks(value, errors);
    case "l1uj-knowledge-v1":
      return validateKnowledge(value, errors);
    case "l1uj-sections-v1":
      return validateSections(value, errors, `records.${key}`);
    case "zsb-prep-checks-meta-v1":
      return validatePrepMeta(value, errors, base);
    default:
      addError(errors, `records.${key}`, "\u672A\u77E5\u5B58\u50A8\u952E");
  }
}
function validateStudyBackup(payload, { base = DEFAULT_BASE } = {}) {
  const errors = [];
  const normalizedBase = normalizeBase(base);
  if (!normalizedBase) {
    addError(errors, "base", "\u7AD9\u70B9 base \u5FC5\u987B\u662F\u5B89\u5168\u7684\u7EDD\u5BF9\u8DEF\u5F84");
    return { valid: false, errors };
  }
  if (!isPlainObject(payload)) {
    addError(errors, "backup", "\u5FC5\u987B\u662F JSON \u5BF9\u8C61");
    return { valid: false, errors };
  }
  if (!checkObjectKeys(payload, /* @__PURE__ */ new Set(["format", "version", "base", "createdAt", "records"]), "backup", errors, ["format", "version", "base", "createdAt", "records"])) {
    return { valid: false, errors };
  }
  if (payload.format !== BACKUP_FORMAT) addError(errors, "backup.format", `\u5FC5\u987B\u662F ${BACKUP_FORMAT}`);
  if (payload.version !== BACKUP_VERSION) addError(errors, "backup.version", "\u53EA\u652F\u6301\u7248\u672C 1");
  if (payload.base !== normalizedBase) addError(errors, "backup.base", `\u5FC5\u987B\u4E0E\u5F53\u524D\u7AD9\u70B9 base ${normalizedBase} \u4E00\u81F4`);
  checkTimestamp(payload.createdAt, "backup.createdAt", errors);
  if (!isPlainObject(payload.records)) {
    addError(errors, "backup.records", "\u5FC5\u987B\u662F\u5BF9\u8C61");
  } else {
    const keys = ownKeys(payload.records);
    if (keys.length > MAX_ENTRIES) addError(errors, "backup.records", `\u6700\u591A\u652F\u6301 ${MAX_ENTRIES} \u4E2A\u5B58\u50A8\u952E`);
    for (const key of keys) {
      if (!isAllowedStudyKey(key, normalizedBase)) addError(errors, `backup.records.${key}`, "\u5B58\u50A8\u952E\u4E0D\u5728\u767D\u540D\u5355\u4E2D");
      else validateRecord(key, payload.records[key], errors, normalizedBase);
    }
  }
  return { valid: errors.length === 0, errors };
}
function getStorage(storage) {
  const result = storage || (typeof window !== "undefined" ? getStudyStorage() : null);
  if (!result || typeof result.getItem !== "function" || typeof result.setItem !== "function") throw new TypeError("\u9700\u8981\u53EF\u7528\u7684 localStorage");
  return result;
}
function parseStoredValue(key, raw, base) {
  const info = keyInfo(key, base);
  if (!info) return { ok: false, errors: [`${key}: \u5B58\u50A8\u952E\u4E0D\u5728\u767D\u540D\u5355\u4E2D`] };
  if (info.kind === "learning-guide-note") return { ok: typeof raw === "string" && raw.length <= 2e3, value: raw, errors: raw?.length > 2e3 ? [`${key}: \u56DE\u5FC6\u7B14\u8BB0\u8D85\u8FC7 2000 \u5B57`] : [] };
  if (info.kind === "zsb-course-done") return { ok: raw === "1", value: raw, errors: raw === "1" ? [] : [`${key}: \u672C\u5730\u503C\u4E0D\u662F\u5B57\u7B26\u4E32 1`] };
  if (typeof raw !== "string" || raw.length > MAX_JSON_LENGTH) return { ok: false, errors: [`${key}: \u672C\u5730 JSON \u8FC7\u5927\u6216\u4E0D\u662F\u5B57\u7B26\u4E32`] };
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    return { ok: false, errors: [`${key}: \u672C\u5730 JSON \u65E0\u6CD5\u89E3\u6790`] };
  }
  const errors = [];
  validateRecord(key, value, errors, base);
  return { ok: errors.length === 0, value, errors };
}
function readStudyKeys(storage, base) {
  const keys = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key && isAllowedStudyKey(key, base)) keys.push(key);
  }
  return [...new Set(keys)].sort();
}
function rawValueFor(key, value) {
  return key.startsWith("l1uj-learning-guide-note-v1:") || key.startsWith("zsb-course-done-") ? value : JSON.stringify(value);
}
function createStudyBackup(storage, { base = DEFAULT_BASE, now = Date.now() } = {}) {
  const source = getStorage(storage);
  const normalizedBase = normalizeBase(base);
  if (!normalizedBase) throw new TypeError("\u7AD9\u70B9 base \u5FC5\u987B\u662F\u5B89\u5168\u7684\u7EDD\u5BF9\u8DEF\u5F84");
  if (!isTimestamp(now)) throw new TypeError("\u5907\u4EFD\u65F6\u95F4\u5FC5\u987B\u662F\u975E\u8D1F\u6BEB\u79D2\u65F6\u95F4\u6233");
  const records = {};
  const skipped = [];
  for (const key of readStudyKeys(source, normalizedBase)) {
    let raw;
    try {
      raw = source.getItem(key);
    } catch (error) {
      skipped.push({ key, reason: `\u8BFB\u53D6\u5931\u8D25\uFF1A${error instanceof Error ? error.message : String(error)}` });
      continue;
    }
    const parsed = parseStoredValue(key, raw, normalizedBase);
    if (!parsed.ok) skipped.push({ key, reason: parsed.errors.join("\uFF1B") });
    else records[key] = parsed.value;
  }
  const backup = { format: BACKUP_FORMAT, version: BACKUP_VERSION, base: normalizedBase, createdAt: now, records };
  return { backup, includedKeys: Object.keys(records), skipped };
}
function serializeStudyBackup(payload, options) {
  const result = validateStudyBackup(payload, options);
  if (!result.valid) throw new TypeError(`\u5907\u4EFD\u683C\u5F0F\u65E0\u6548\uFF1A${result.errors.join("\uFF1B")}`);
  return JSON.stringify(payload, null, 2);
}
function isMergeMode(info) {
  return info?.mode || null;
}
function itemTimestamp(info, item) {
  if (!item || typeof item !== "object") return null;
  if (info.kind === "l1uj-guided-v1" || info.kind === "cs-learning") return isTimestamp(item.updatedAt) ? item.updatedAt : null;
  if (info.mode === CONTAINER_MODES.reading || info.mode === CONTAINER_MODES.studyProgress || info.mode === CONTAINER_MODES.studyTasks || info.mode === CONTAINER_MODES.prepMeta) {
    return isTimestamp(item.updatedAt) ? item.updatedAt : null;
  }
  if (info.kind === "l1uj-knowledge-v1" && isTimestamp(item.learnedAt)) return item.learnedAt;
  if (info.kind === "l1uj-sections-v1" && isTimestamp(item.at)) return item.at;
  if (info.kind === "zzkk:v2:lesson" && isInstantString(item.at)) return Date.parse(item.at);
  if (info.kind === "zzkk:v2:card" && isDateString(item.at)) return Date.parse(`${item.at}T00:00:00Z`);
  if (info.kind === "zzkk:v2:wrong" && isDateString(item.lastAt)) return Date.parse(`${item.lastAt}T00:00:00Z`);
  return null;
}
function keyTimestamp(info, value) {
  return itemTimestamp(info, value);
}
function keyLabel(key, itemKey) {
  const labels = {
    "cs-learning": "\u8BA1\u7B97\u673A\u5206\u8282\u5B66\u4E60\u4F4D\u7F6E\u3001\u6F14\u793A\u4E0E\u5224\u65AD",
    "l1uj-reading-v1": "\u9605\u8BFB\u4F4D\u7F6E",
    "zc-progress-v1": "\u6570\u5B66\u7D2F\u8BA1\u8FDB\u5EA6",
    "zc-progress-items-v1": "\u6570\u5B66\u9010\u9898\u7EC3\u4E60",
    "zsb-course-done": "\u82F1\u8BED\u8BFE\u7A0B\u5B8C\u6210\u6807\u8BB0",
    "l1uj-english-answers-v1": "\u82F1\u8BED\u7B54\u9898\u72B6\u6001",
    "zsb-mistakes-v1": "\u8BA1\u7B97\u673A\u9519\u9898\u672C",
    "l1uj-cs-answers-v1": "\u8BA1\u7B97\u673A\u7B54\u9898\u8F6E\u6B21",
    "zzkk:v2:lesson": "\u653F\u6CBB\u8BFE\u7A0B\u8FDB\u5EA6",
    "zzkk:v2:card": "\u653F\u6CBB\u95EA\u5361\u4E09\u76D2",
    "zzkk:v2:wrong": "\u653F\u6CBB\u9519\u9898\u672C",
    "l1uj-politics-answers-v1": "\u653F\u6CBB\u7B54\u9898\u72B6\u6001",
    "zsb-prep-checks": "\u65E7\u7248\u5468\u8BA1\u5212\u6253\u5361",
    "l1uj-study-progress-v1": "\u7EDF\u4E00\u8BFE\u7A0B\u7EC3\u4E60\u8FDB\u5EA6",
    "l1uj-study-tasks-v1": "\u4ECA\u65E5\u4EFB\u52A1\u504F\u597D",
    "zsb-prep-checks-meta-v1": "\u65B0\u7248\u5468\u8BA1\u5212\u6253\u5361",
    "l1uj-knowledge-v1": "\u77E5\u8BC6\u70B9\u590D\u6D4B\u6392\u671F",
    "l1uj-sections-v1": "\u8BFE\u5185\u5C0F\u8282\u5B8C\u6210",
    "l1uj-guided-v1": "\u5C0F\u6B65\u5B66\u4E60\u4F4D\u7F6E\u3001\u4F5C\u7B54\u4E0E\u7B14\u8BB0"
  };
  const info = keyInfo(key);
  if (info?.kind === "l1uj-sections-v1") itemKey = key.slice(SECTIONS_PREFIX.length);
  const text = labels[info?.kind] || key;
  if (itemKey == null) return text;
  const subjectNames = { "zsb-math": "\u9AD8\u7B49\u6570\u5B66", "zsb-english": "\u516C\u5171\u82F1\u8BED", "zsb-politics": "\u653F\u6CBB\u7406\u8BBA", "zsb-cs": "\u8BA1\u7B97\u673A\u57FA\u7840" };
  const lesson = String(itemKey).match(/^(?:lesson:)?(zsb-(?:math|english|politics|cs)):(.+)$/);
  if (lesson) return `${text} \xB7 ${subjectNames[lesson[1]]} \u7B2C ${lesson[2]} \u8BFE`;
  const auxiliary = {
    "review:politics": "\u653F\u6CBB\u7406\u8BBA\u5230\u671F\u590D\u4E60",
    "wrong:cs": "\u8BA1\u7B97\u673A\u57FA\u7840\u9519\u9898",
    "wrong:politics": "\u653F\u6CBB\u7406\u8BBA\u9519\u9898"
  };
  if (auxiliary[itemKey]) return `${text} \xB7 ${auxiliary[itemKey]}`;
  const prep = String(itemKey).match(/\/prep\/([^/]+)\/#(w\d+)$/);
  if (prep) {
    const prepNames = { gaoshu: "\u9AD8\u7B49\u6570\u5B66", yingyu: "\u516C\u5171\u82F1\u8BED", zhengzhi: "\u653F\u6CBB\u7406\u8BBA", jisuanji: "\u8BA1\u7B97\u673A\u57FA\u7840" };
    return `${text} \xB7 ${prepNames[prep[1]] || prep[1]} ${prep[2]}`;
  }
  const interactive = String(itemKey).match(/\/lessons\/(zsb-(?:math|english|politics|cs))\/lessons\/([^/]+)\.html$/);
  if (interactive) return `${text} \xB7 ${subjectNames[interactive[1]]} \xB7 ${interactive[2]}`;
  return `${text} \xB7 ${itemKey}`;
}
function studyConflictId(key, itemKey = null) {
  return itemKey == null ? key : `${key}::${itemKey}`;
}
function conflictStatus(localTimestamp, incomingTimestamp) {
  if (localTimestamp == null || incomingTimestamp == null) return { status: "missing-timestamp", defaultAction: "requires-choice" };
  if (incomingTimestamp > localTimestamp) return { status: "incoming-newer", defaultAction: "import" };
  if (incomingTimestamp < localTimestamp) return { status: "local-newer", defaultAction: "keep-local" };
  return { status: "same-time", defaultAction: "keep-local" };
}
function normalizeDecision(decisions, id, key) {
  if (decisions instanceof Map) return decisions.get(id) || decisions.get(key) || null;
  if (decisions && typeof decisions === "object") return decisions[id] || decisions[key] || null;
  return null;
}
function resolveAction(conflict, decisions, untimestampedPolicy) {
  const explicit = normalizeDecision(decisions, conflict.id, conflict.key);
  if (explicit === "import" || explicit === "keep-local") return explicit;
  if (conflict.defaultAction !== "requires-choice") return conflict.defaultAction;
  if (untimestampedPolicy === "import" || untimestampedPolicy === "keep-local") return untimestampedPolicy;
  return "requires-choice";
}
function baseConflict({ key, itemKey = null, localTimestamp = null, incomingTimestamp = null, status, defaultAction }) {
  const id = studyConflictId(key, itemKey);
  return {
    id,
    key,
    itemKey,
    label: keyLabel(key, itemKey),
    status,
    defaultAction,
    action: defaultAction === "requires-choice" ? "requires-choice" : defaultAction,
    localTimestamp,
    incomingTimestamp
  };
}
function containerEntries(info, value) {
  if (info.mode === CONTAINER_MODES.reading) return value.entries.map((entry) => [entry.path, entry]);
  if (info.mode === CONTAINER_MODES.studyProgress || info.mode === CONTAINER_MODES.studyTasks) return Object.entries(value.entries);
  if (info.mode === CONTAINER_MODES.prepMeta) return Object.entries(value);
  if (info.mode === CONTAINER_MODES.knowledge) return Object.entries(value.points);
  if (info.mode === CONTAINER_MODES.sections) return Object.entries(value);
  return [];
}
function withContainerEntries(info, source, entries) {
  if (info.mode === CONTAINER_MODES.reading) {
    const result = { version: source.version, entries: entries.map(([, entry]) => entry) };
    return result;
  }
  if (info.mode === CONTAINER_MODES.studyProgress || info.mode === CONTAINER_MODES.studyTasks) return { version: source.version, entries: Object.fromEntries(entries) };
  if (info.mode === CONTAINER_MODES.knowledge) return { version: source.version, points: Object.fromEntries(entries) };
  return Object.fromEntries(entries);
}
function mergeKnowledgeSources(localValue, incomingValue, entries) {
  const merged = { ...localValue.sources || {} };
  for (const [id] of entries) if (!merged[id] && incomingValue.sources?.[id]) merged[id] = clone(incomingValue.sources[id]);
  return merged;
}
function mergeContainer(key, info, localValue, incomingValue, decisions, untimestampedPolicy) {
  const localEntries = new Map(containerEntries(info, localValue));
  const incomingEntries = containerEntries(info, incomingValue);
  const conflicts = [];
  for (const [itemKey, incomingItem] of incomingEntries) {
    const localItem = localEntries.get(itemKey);
    if (localItem == null) {
      localEntries.set(itemKey, clone(incomingItem));
      continue;
    }
    if (equalValue(localItem, incomingItem)) continue;
    const timestamps = conflictStatus(itemTimestamp(info, localItem), itemTimestamp(info, incomingItem));
    const conflict = baseConflict({
      key,
      itemKey,
      localTimestamp: itemTimestamp(info, localItem),
      incomingTimestamp: itemTimestamp(info, incomingItem),
      ...timestamps
    });
    conflict.action = resolveAction(conflict, decisions, untimestampedPolicy);
    conflicts.push(conflict);
    if (conflict.action === "import") localEntries.set(itemKey, clone(incomingItem));
  }
  const resultEntries = [...localEntries.entries()];
  if (info.mode === CONTAINER_MODES.reading) resultEntries.sort((left, right) => (itemTimestamp(info, right[1]) ?? 0) - (itemTimestamp(info, left[1]) ?? 0));
  const value = withContainerEntries(info, localValue, resultEntries);
  if (info.mode === CONTAINER_MODES.knowledge) {
    const sources = mergeKnowledgeSources(localValue, incomingValue, resultEntries);
    if (Object.keys(sources).length) value.sources = sources;
  }
  return { value, conflicts };
}
function makeImportPlan(payload, storage, { base = DEFAULT_BASE, decisions, untimestampedPolicy = "require" } = {}) {
  const normalizedBase = normalizeBase(base);
  const validation = validateStudyBackup(payload, { base: normalizedBase || base });
  if (!validation.valid) return { valid: false, errors: validation.errors, plan: [], conflicts: [], summary: emptySummary() };
  const plan = [];
  const conflicts = [];
  const summary = emptySummary();
  for (const key of Object.keys(payload.records).sort()) {
    const incomingValue = payload.records[key];
    let localRaw;
    try {
      localRaw = storage.getItem(key);
    } catch (error) {
      return { valid: false, errors: [`${key}: \u8BFB\u53D6\u672C\u5730\u8BB0\u5F55\u5931\u8D25\uFF1A${error instanceof Error ? error.message : String(error)}`], plan, conflicts, summary };
    }
    if (localRaw == null) {
      plan.push({ key, localRaw: null, finalValue: clone(incomingValue), action: "import", status: "new", conflicts: [] });
      summary.new += 1;
      summary.import += 1;
      continue;
    }
    const local = parseStoredValue(key, localRaw, normalizedBase);
    if (!local.ok) {
      const conflict2 = baseConflict({ key, status: "local-invalid", defaultAction: "requires-choice" });
      conflict2.action = resolveAction(conflict2, decisions, untimestampedPolicy);
      conflicts.push(conflict2);
      const finalValue2 = conflict2.action === "import" ? clone(incomingValue) : void 0;
      plan.push({ key, localRaw, finalValue: finalValue2, action: conflict2.action, status: "local-invalid", conflicts: [conflict2] });
      summary.conflicts += 1;
      if (conflict2.action === "requires-choice") summary.needsChoice += 1;
      else if (conflict2.action === "import") summary.import += 1;
      else summary.keepLocal += 1;
      continue;
    }
    const info = keyInfo(key, normalizedBase);
    if (isMergeMode(info)) {
      const merged = mergeContainer(key, info, local.value, incomingValue, decisions, untimestampedPolicy);
      conflicts.push(...merged.conflicts);
      const finalRaw = rawValueFor(key, merged.value);
      plan.push({ key, localRaw, finalValue: merged.value, action: finalRaw === localRaw ? "keep-local" : "merge", status: merged.conflicts.length ? "merged" : "unchanged", conflicts: merged.conflicts });
      summary.conflicts += merged.conflicts.length;
      for (const conflict2 of merged.conflicts) {
        if (conflict2.action === "requires-choice") summary.needsChoice += 1;
        else if (conflict2.action === "import") summary.import += 1;
        else summary.keepLocal += 1;
      }
      if (!merged.conflicts.length && finalRaw === localRaw) summary.unchanged += 1;
      continue;
    }
    if (equalValue(local.value, incomingValue) || localRaw === rawValueFor(key, incomingValue)) {
      plan.push({ key, localRaw, finalValue: local.value, action: "keep-local", status: "unchanged", conflicts: [] });
      summary.unchanged += 1;
      continue;
    }
    const timestamps = conflictStatus(keyTimestamp(info, local.value), keyTimestamp(info, incomingValue));
    const conflict = baseConflict({ key, localTimestamp: keyTimestamp(info, local.value), incomingTimestamp: keyTimestamp(info, incomingValue), ...timestamps });
    conflict.action = resolveAction(conflict, decisions, untimestampedPolicy);
    conflicts.push(conflict);
    const finalValue = conflict.action === "import" ? clone(incomingValue) : local.value;
    plan.push({ key, localRaw, finalValue, action: conflict.action, status: conflict.status, conflicts: [conflict] });
    summary.conflicts += 1;
    if (conflict.action === "requires-choice") summary.needsChoice += 1;
    else if (conflict.action === "import") summary.import += 1;
    else summary.keepLocal += 1;
  }
  summary.keys = plan.length;
  summary.canApply = summary.needsChoice === 0;
  return { valid: true, errors: [], plan, conflicts, summary };
}
function emptySummary() {
  return { keys: 0, new: 0, unchanged: 0, conflicts: 0, needsChoice: 0, import: 0, keepLocal: 0, canApply: false };
}
function previewStudyImport(payload, storage, options = {}) {
  const source = getStorage(storage);
  const result = makeImportPlan(payload, source, options);
  return {
    ...result,
    payload,
    ready: result.valid && result.summary.canApply,
    requiresChoice: result.valid && result.summary.needsChoice > 0
  };
}
function rollbackStorage(storage, snapshots, attempted) {
  const errors = [];
  for (const key of [...attempted].reverse()) {
    try {
      const previous = snapshots.get(key);
      if (previous == null) storage.removeItem(key);
      else storage.setItem(key, previous);
    } catch (error) {
      errors.push(`${key}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return errors;
}
function dispatchImportEvents() {
  if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") return;
  for (const name of ["l1uj:study", "l1uj:reading", "l1uj:backup-imported"]) {
    try {
      window.dispatchEvent(new CustomEvent(name));
    } catch {
    }
  }
}
function applyStudyImport(payload, storage, options = {}) {
  const source = getStorage(storage);
  if (source.transaction && !options.inTransaction) return source.transaction(() => applyStudyImport(payload, source, { ...options, inTransaction: true }));
  const preview = previewStudyImport(payload, source, options);
  if (!preview.valid || preview.requiresChoice) {
    return { ...preview, applied: false, rolledBack: false };
  }
  const writes = preview.plan.map((item) => ({ ...item, raw: item.finalValue === void 0 ? item.localRaw : rawValueFor(item.key, item.finalValue) })).filter((item) => item.raw !== item.localRaw);
  if (!writes.length) {
    dispatchImportEvents();
    return { ...preview, applied: true, rolledBack: false, writtenKeys: [] };
  }
  const snapshots = /* @__PURE__ */ new Map();
  for (const item of writes) {
    try {
      snapshots.set(item.key, source.getItem(item.key));
    } catch (error) {
      return { ...preview, applied: false, rolledBack: false, error: `${item.key}: \u5199\u5165\u524D\u8BFB\u53D6\u5931\u8D25\uFF1A${error instanceof Error ? error.message : String(error)}` };
    }
  }
  const attempted = [];
  try {
    for (const item of writes) {
      attempted.push(item.key);
      source.setItem(item.key, item.raw);
      if (source.getItem(item.key) !== item.raw) throw new Error("\u5199\u5165\u540E\u6821\u9A8C\u4E0D\u4E00\u81F4");
    }
    dispatchImportEvents();
    return { ...preview, applied: true, rolledBack: false, writtenKeys: writes.map((item) => item.key) };
  } catch (error) {
    const rollbackErrors = rollbackStorage(source, snapshots, attempted);
    return {
      ...preview,
      applied: false,
      rolledBack: rollbackErrors.length === 0,
      rollbackErrors,
      writtenKeys: [],
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

// scripts/runtime/migration.mjs
function previewLegacyMigration(legacy, target, options = {}) {
  if (!target.owner) throw new Error("\u8BF7\u5148\u767B\u5F55\u8981\u5BFC\u5165\u7684\u8D26\u53F7");
  const source = createStudyBackup(legacy, options);
  return { owner: target.owner, source, preview: previewStudyImport(source.backup, target, options) };
}
function confirmLegacyMigration(plan, target, { confirmedOwner, decisions = {}, ...options } = {}) {
  if (!confirmedOwner || confirmedOwner !== target.owner || confirmedOwner !== plan.owner) throw new Error("\u5FC5\u987B\u786E\u8BA4\u5F53\u524D\u8D26\u53F7\u5F52\u5C5E\uFF0C\u5207\u6362\u8D26\u53F7\u540E\u987B\u91CD\u65B0\u9884\u89C8");
  if (plan.source.skipped.length) throw new Error("\u5B58\u5728\u5F02\u5E38\u65E7\u8BB0\u5F55\uFF0C\u8BF7\u5148\u4FEE\u590D\u5E76\u91CD\u65B0\u9884\u89C8\uFF1B\u539F\u8BB0\u5F55\u672A\u5220\u9664");
  return applyStudyImport(plan.source.backup, target, { ...options, decisions });
}

// scripts/runtime/study-state.mjs
function studyIdentity(pathname, base = "/blog/") {
  let decoded;
  try {
    decoded = decodeURI(pathname);
  } catch {
    return null;
  }
  if (!decoded.startsWith(base)) return null;
  const relative = decoded.slice(base.length);
  const reading = relative.match(/^courses\/(zsb-(?:math|english|politics|cs))\/l\/(\d+|(?:xg|mzt|sz)\d+)\/$/);
  const practice = relative.match(/^lessons\/(zsb-(?:math|english|politics|cs))\/lessons\/(\d{4}|(?:xg|mzt|sz)\d+)(?:[-_][^/]+)?\.html$/);
  const match = reading || practice;
  if (!match) return null;
  const id = /^\d+$/.test(match[2]) ? String(Number(match[2])) : match[2];
  return { slug: match[1], id, key: `${match[1]}:${id}` };
}

// scripts/runtime/lesson-context.mjs
function sanitizeSelection(value) {
  return String(value ?? "").replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "[\u90AE\u7BB1\u5DF2\u9690\u85CF]").replace(/(?:Bearer\s+|sk-)[a-zA-Z0-9._-]{10,}/g, "[\u51ED\u636E\u5DF2\u9690\u85CF]").slice(0, 1500);
}
function lessonContext({ document: document2, location: location2, selection = "", base = "/blog/" }) {
  const identity = studyIdentity(location2.pathname, base);
  if (!identity) return null;
  const selected = document2?.getSelection?.();
  const anchor = selected?.anchorNode?.parentElement;
  if (anchor?.closest("input,textarea,[contenteditable],.zhixu-account-dialog,.zhixu-ai-panel")) selection = "";
  else if (!selection) selection = selected?.toString?.() || "";
  return { lessonKey: identity.key, section: (location2.hash || "").slice(1, 121), selectedText: sanitizeSelection(selection), sourcePath: location2.pathname };
}

// scripts/runtime/ai-stream.mjs
async function* readAIEvents(stream, { maxBytes = 25e4, signal } = {}) {
  if (!stream) throw new Error("missing_stream");
  const reader = stream.getReader(), decoder = new TextDecoder();
  let buffer = "", bytes = 0;
  try {
    for (; ; ) {
      if (signal?.aborted) throw new DOMException("\u5DF2\u53D6\u6D88", "AbortError");
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) throw new Error("stream_too_large");
      buffer += decoder.decode(value, { stream: true }).replace(/\r/g, "");
      let end;
      while ((end = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const data = frame.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
        if (data) yield data;
      }
      if (buffer.length > 65536) throw new Error("stream_frame_too_large");
    }
    buffer += decoder.decode();
    if (buffer.trim()) throw new Error("incomplete_stream_frame");
  } finally {
    await reader.cancel().catch(() => {
    });
    reader.releaseLock();
  }
}

// scripts/runtime/ai-tutor-client.mjs
function createAITutorClient({ endpoint, auth, publishableKey = "", fetcher = fetch }) {
  let controller;
  async function ask(input, { onDelta = () => {
  } } = {}) {
    if (!auth.session?.access_token) throw new Error("\u8BF7\u5148\u767B\u5F55");
    controller?.abort();
    controller = new AbortController();
    const active = controller;
    const timeout = setTimeout(() => active.abort(), 4e4);
    try {
      const response = await fetcher(endpoint, {
        method: "POST",
        signal: active.signal,
        headers: { "Content-Type": "application/json", Accept: "text/event-stream", Authorization: `Bearer ${auth.session.access_token}`, ...publishableKey ? { apikey: publishableKey } : {} },
        body: JSON.stringify({ ...input, requestId: crypto.randomUUID() })
      });
      if (!response.ok) throw new Error(response.status === 429 ? "\u4ECA\u65E5\u989D\u5EA6\u5DF2\u7528\u5B8C\u6216\u8BF7\u6C42\u8FC7\u5FEB\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5" : "AI \u6682\u4E0D\u53EF\u7528\uFF0C\u516C\u5F00\u8BFE\u7A0B\u4E0E\u4F5C\u7B54\u4E0D\u53D7\u5F71\u54CD");
      let result, partial = "";
      if (response.headers.get("content-type")?.includes("text/event-stream")) {
        for await (const data of readAIEvents(response.body, { signal: active.signal })) {
          const frame = JSON.parse(data);
          if (frame.type === "error") throw new Error("AI \u56DE\u7B54\u4E2D\u65AD\uFF0C\u8BF7\u91CD\u8BD5\uFF1B\u672C\u8BFE\u4F5C\u7B54\u4E0D\u53D7\u5F71\u54CD");
          if (frame.type === "delta") {
            if (typeof frame.text !== "string") throw new Error("AI \u8FD4\u56DE\u683C\u5F0F\u5F02\u5E38");
            partial += frame.text;
            if (partial.length > 2e4) throw new Error("AI \u56DE\u7B54\u8FC7\u957F");
            onDelta(partial);
          } else if (frame.type === "complete") {
            result = frame;
            break;
          }
        }
        if (!result) throw new Error("AI \u56DE\u7B54\u4E2D\u65AD\uFF0C\u8BF7\u91CD\u8BD5\uFF1B\u672C\u8BFE\u4F5C\u7B54\u4E0D\u53D7\u5F71\u54CD");
      } else result = await response.json();
      if (typeof result.answer !== "string" || result.answer.length > 2e4 || !Array.isArray(result.sources)) throw new Error("AI \u8FD4\u56DE\u683C\u5F0F\u5F02\u5E38");
      return result;
    } finally {
      clearTimeout(timeout);
    }
  }
  return {
    ask,
    cancel: () => controller?.abort(),
    async conversations() {
      const { data, error } = await auth.client.from("ai_conversations").select("*").order("created_at", { ascending: false });
      if (error) throw new Error("\u4F1A\u8BDD\u8BFB\u53D6\u5931\u8D25");
      return data;
    },
    async messages(id) {
      const owner = auth.session?.user?.id, rows = [], seen = /* @__PURE__ */ new Set();
      let total;
      if (!owner) throw new Error("\u8BF7\u5148\u767B\u5F55");
      for (let offset = 0; ; offset += 100) {
        if (auth.session?.user?.id !== owner) throw new Error("\u8D26\u53F7\u5DF2\u53D8\u5316\uFF0C\u8BF7\u91CD\u65B0\u8BFB\u53D6\u4F1A\u8BDD");
        const { data, error, count } = await auth.client.from("ai_messages").select("id,user_id,role,content,sources,created_at", { count: "exact" }).eq("conversation_id", id).order("created_at", { ascending: true }).order("role", { ascending: false }).order("id", { ascending: true }).range(offset, offset + 99);
        if (error || !Array.isArray(data) || !Number.isInteger(count)) throw new Error("\u4F1A\u8BDD\u8BFB\u53D6\u5931\u8D25\uFF0C\u6CA1\u6709\u8FD4\u56DE\u622A\u65AD\u7684\u5386\u53F2");
        total ??= count;
        if (count !== total || total > 5e3 || auth.session?.user?.id !== owner) throw new Error("\u4F1A\u8BDD\u53D8\u5316\u6216\u8D85\u8FC7\u4E0A\u9650\uFF0C\u8BF7\u5206\u6279\u67E5\u770B\u6216\u5BFC\u51FA\u5168\u90E8\u6570\u636E");
        for (const row of data) {
          if (row.user_id !== owner || seen.has(row.id)) throw new Error("\u4F1A\u8BDD\u5F52\u5C5E\u6216\u5206\u9875\u53D8\u5316\uFF0C\u8BF7\u91CD\u65B0\u8BFB\u53D6");
          seen.add(row.id);
          rows.push(row);
        }
        if (JSON.stringify(rows).length > 1e7) throw new Error("\u4F1A\u8BDD\u8FC7\u5927\uFF0C\u8BF7\u5BFC\u51FA\u5168\u90E8\u6570\u636E");
        if (rows.length === total) return rows;
        if (data.length !== 100 || rows.length > total) throw new Error("\u4F1A\u8BDD\u53D8\u5316\uFF0C\u8BF7\u91CD\u65B0\u8BFB\u53D6\uFF0C\u672A\u8FD4\u56DE\u90E8\u5206\u5386\u53F2");
      }
    },
    async removeConversation(id) {
      const { error } = await auth.client.from("ai_conversations").delete().eq("id", id);
      if (error) throw new Error("\u4F1A\u8BDD\u5220\u9664\u5931\u8D25");
    }
  };
}

// scripts/runtime/account-lifecycle.mjs
var DELETE_CONFIRMATION = "\u5220\u9664\u6211\u7684\u77E5\u5E8F\u8D26\u53F7";
var tables = {
  profiles: ["user_id,display_name,created_at", ["user_id"]],
  study_records: ["user_id,bucket,record_id,payload,schema_version,revision,change_seq,updated_at,deleted_at", ["bucket", "record_id"]],
  study_notes: ["id,user_id,lesson_key,content,revision,updated_at", ["id"]],
  ai_conversations: ["id,user_id,lesson_key,title,created_at", ["id"]],
  ai_messages: ["id,user_id,conversation_id,role,content,sources,created_at", ["id"]],
  ai_usage: ["user_id,period,requests", ["period"]]
};
function createAccountLifecycle({ auth, storage, endpoint, publishableKey, fetcher = fetch, now = () => (/* @__PURE__ */ new Date()).toISOString(), pageSize = 200, maxRows = 2e4, maxBytes = 2e7 }) {
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 1e3) throw new Error("\u65E0\u6548\u5206\u9875\u5927\u5C0F");
  const owner = () => {
    const id = auth.session?.user?.id;
    if (!id || storage.owner !== id) throw new Error("\u8BF7\u5148\u9A8C\u8BC1\u5F53\u524D\u5B66\u4E60\u8D26\u53F7");
    return id;
  };
  const stillOwner = (id) => {
    if (owner() !== id) throw new Error("\u5BFC\u51FA\u671F\u95F4\u8D26\u53F7\u5DF2\u53D8\u5316\uFF0C\u8BF7\u91CD\u65B0\u5BFC\u51FA");
  };
  return {
    async exportAll() {
      const id = owner(), startedAt = now(), local = storage.snapshot(), cloud = {};
      const verified = await auth.client.auth.getUser();
      stillOwner(id);
      if (verified.error || verified.data?.user?.id !== id) throw new Error("\u4E91\u8EAB\u4EFD\u6838\u9A8C\u5931\u8D25\uFF0C\u672A\u751F\u6210\u4E0D\u5B8C\u6574\u5BFC\u51FA\uFF1B\u672C\u673A\u5907\u4EFD\u4ECD\u53EF\u5355\u72EC\u5BFC\u51FA");
      let total = 0, bytes = new TextEncoder().encode(JSON.stringify(local)).length;
      if (bytes > maxBytes) throw new Error("\u672C\u673A\u5BFC\u51FA\u8D85\u8FC7\u5B89\u5168\u5927\u5C0F\uFF0C\u8BF7\u5148\u5355\u72EC\u5907\u4EFD");
      for (const [table, [columns, order]] of Object.entries(tables)) {
        const rows = [], seen = /* @__PURE__ */ new Set();
        let count;
        for (; ; ) {
          let query = auth.client.from(table).select(columns, { count: "exact" }).eq("user_id", id);
          for (const key of order) query = query.order(key);
          const result = await query.range(rows.length, rows.length + pageSize - 1);
          stillOwner(id);
          if (result.error || !Array.isArray(result.data) || !Number.isSafeInteger(result.count)) throw new Error("\u4E91\u5BFC\u51FA\u5931\u8D25\uFF1A" + table + "\uFF1B\u672A\u751F\u6210\u6B8B\u7F3A\u6587\u4EF6");
          count ??= result.count;
          if (result.count !== count) throw new Error("\u4E91\u8BB0\u5F55\u6570\u91CF\u5728\u5BFC\u51FA\u671F\u95F4\u53D8\u5316\uFF0C\u8BF7\u6682\u505C\u5176\u5B83\u8BBE\u5907\u5199\u5165\u540E\u91CD\u8BD5");
          if (count > maxRows || total + result.data.length > maxRows) throw new Error("\u5BFC\u51FA\u8D85\u8FC7\u5B89\u5168\u5927\u5C0F\uFF0C\u8BF7\u8054\u7CFB\u7AD9\u957F\u5206\u6279\u5BFC\u51FA");
          for (const row of result.data) {
            if (row.user_id !== id) throw new Error("\u5BFC\u51FA\u5F52\u5C5E\u6838\u9A8C\u5931\u8D25");
            const key = JSON.stringify(order.map((k) => row[k]));
            if (seen.has(key)) throw new Error("\u4E91\u6570\u636E\u5728\u5206\u9875\u671F\u95F4\u53D8\u5316\uFF0C\u8BF7\u91CD\u8BD5");
            bytes += new TextEncoder().encode(JSON.stringify(row)).length;
            if (bytes > maxBytes) throw new Error("\u5BFC\u51FA\u8D85\u8FC7\u5B89\u5168\u5927\u5C0F\uFF0C\u8BF7\u8054\u7CFB\u7AD9\u957F\u5206\u6279\u5BFC\u51FA");
            seen.add(key);
            rows.push(row);
          }
          total += result.data.length;
          if (rows.length === count) break;
          if (!result.data.length || rows.length > count) throw new Error("\u4E91\u5206\u9875\u7ED3\u679C\u4E0D\u5B8C\u6574\uFF0C\u672A\u751F\u6210\u6B8B\u7F3A\u6587\u4EF6");
        }
        cloud[table] = rows;
      }
      stillOwner(id);
      return {
        format: "zhixu-account-export",
        version: 1,
        owner: id,
        startedAt,
        finishedAt: now(),
        consistency: "\u975E\u4E8B\u52A1\u5FEB\u7167\uFF1B\u5BFC\u51FA\u524D\u8BF7\u6682\u505C\u5176\u5B83\u8BBE\u5907\u5199\u5165\u3002\u540C\u6761\u8BB0\u5F55\u66F4\u65B0\u53EF\u80FD\u8DE8\u8D8A\u8BFB\u53D6\u65F6\u523B\u3002",
        local,
        cloud,
        excluded: ["\u5BC6\u7801\u3001\u8BBF\u95EE/\u5237\u65B0\u4EE4\u724C\u548C API \u5BC6\u94A5", "\u540E\u53F0\u5E42\u7B49\u56DE\u6267\u3001\u8BF7\u6C42\u69FD\u3001\u5168\u7AD9\u8D39\u7528\u4E0E\u5B89\u5168\u65E5\u5FD7", "\u5176\u5B83\u8BBE\u5907\u672A\u540C\u6B65\u7F13\u5B58"],
        restoration: "\u6B64\u6587\u4EF6\u7528\u4E8E\u67E5\u770B\u548C\u6570\u636E\u643A\u5E26\uFF0C\u4E0D\u662F\u6570\u636E\u5E93\u5907\u4EFD\uFF1B\u8BF7\u52FF\u76F4\u63A5\u5F53\u4F5C\u65E7\u5B66\u4E60\u5907\u4EFD\u5BFC\u5165\u3002"
      };
    },
    async deleteSelf({ password, confirmation }) {
      const id = owner();
      if (confirmation !== DELETE_CONFIRMATION || typeof password !== "string" || password.length < 8 || password.length > 128) throw new Error("\u8BF7\u586B\u5199\u5F53\u524D\u5BC6\u7801\u5E76\u9010\u5B57\u786E\u8BA4\u6CE8\u9500");
      const result = await fetcher(endpoint, { method: "POST", headers: {
        "Content-Type": "application/json",
        apikey: publishableKey,
        Authorization: "Bearer " + auth.session.access_token
      }, body: JSON.stringify({ action: "delete", confirmation, password }) });
      stillOwner(id);
      let body;
      try {
        body = await result.json();
      } catch {
      }
      if (!result.ok || body?.deleted !== true) {
        const labels = { account_delete_disabled: "\u8D26\u53F7\u6CE8\u9500\u670D\u52A1\u6682\u672A\u5F00\u653E", reauthentication_failed: "\u5F53\u524D\u5BC6\u7801\u9A8C\u8BC1\u5931\u8D25\uFF0C\u8BF7\u91CD\u65B0\u767B\u5F55\u540E\u91CD\u8BD5", authentication_required: "\u767B\u5F55\u72B6\u6001\u5931\u6548\uFF0C\u8BF7\u91CD\u65B0\u767B\u5F55", delete_failed: "\u64A4\u9500\u4F1A\u8BDD\u6216\u6CE8\u9500\u5931\u8D25\uFF1B\u8BF7\u91CD\u65B0\u767B\u5F55\u6838\u5BF9\uFF0C\u672A\u81EA\u52A8\u91CD\u8BD5" };
        throw new Error(labels[body?.error] || "\u6CE8\u9500\u672A\u786E\u8BA4\u6210\u529F\uFF1B\u8BF7\u91CD\u65B0\u767B\u5F55\u6838\u5BF9\uFF0C\u672A\u81EA\u52A8\u91CD\u8BD5");
      }
      try {
        storage.clearDeletedOwner(id);
      } catch {
        storage.lock();
        throw new Error("\u4E91\u8D26\u53F7\u5DF2\u6CE8\u9500\uFF0C\u4F46\u672C\u673A\u7F13\u5B58\u6E05\u7406\u5931\u8D25\u3002\u8BF7\u5173\u95ED\u6240\u6709\u5B66\u4E60\u6807\u7B7E\u5E76\u624B\u52A8\u6E05\u7406\u672C\u7AD9\u6570\u636E\u3002");
      }
      try {
        await auth.forgetDeleted(id);
      } catch {
      }
      return true;
    }
  };
}

// scripts/runtime/ai-disclosure.mjs
function createAIDisclosure() {
  let lessonKey, captured = "", confirmed = "", consent = false;
  return {
    get preview() {
      return captured;
    },
    get selected() {
      return confirmed;
    },
    setContext(context) {
      if (context?.lessonKey !== lessonKey) {
        lessonKey = context?.lessonKey;
        captured = "";
        confirmed = "";
        consent = false;
      }
      if (context?.selectedText && context.selectedText !== captured) {
        captured = context.selectedText;
        confirmed = "";
      }
    },
    allow(value) {
      consent = value === true;
    },
    include() {
      confirmed = captured;
    },
    remove() {
      captured = "";
      confirmed = "";
    },
    reset() {
      lessonKey = void 0;
      captured = "";
      confirmed = "";
      consent = false;
    },
    input(context) {
      if (!consent) throw new Error("\u8BF7\u5148\u786E\u8BA4 AI \u53D1\u9001\u8303\u56F4\uFF1B\u672A\u53D1\u9001\u4EFB\u4F55\u5185\u5BB9");
      if (!context?.lessonKey || context.lessonKey !== lessonKey) throw new Error("\u8BFE\u7A0B\u5DF2\u53D8\u5316\uFF0C\u8BF7\u91CD\u65B0\u786E\u8BA4\u53D1\u9001\u8303\u56F4");
      return { ...context, selectedText: confirmed };
    }
  };
}

// scripts/runtime/account-tools.mjs
function node(tag, text = "", cls = "") {
  const el = document.createElement(tag);
  el.textContent = text;
  el.className = cls;
  return el;
}
function button(text, action) {
  const el = node("button", text);
  el.type = "button";
  el.addEventListener("click", action);
  return el;
}
function message() {
  const el = node("p");
  el.setAttribute("role", "status");
  el.setAttribute("aria-live", "polite");
  return el;
}
function download(backup, base) {
  const url = URL.createObjectURL(new Blob([serializeStudyBackup(backup, { base })], { type: "application/json" }));
  const link = node("a");
  link.href = url;
  link.download = "\u77E5\u5E8F-\u8FC1\u79FB\u524D\u539F\u59CB\u5907\u4EFD.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1e3);
}
function downloadAccount(data) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })), link = node("a");
  link.href = url;
  link.download = "\u77E5\u5E8F-\u5168\u90E8\u8D26\u53F7\u6570\u636E.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1e3);
}
function mountAuthDialog(host) {
  const form = node("form"), email = node("input"), password = node("input"), status = message(), controls = node("div", "", "zhixu-actions");
  const emailLabel = node("label", "\u90AE\u7BB1"), passLabel = node("label", "\u5BC6\u7801\uFF08\u81F3\u5C11 8 \u4F4D\uFF09");
  email.type = "email";
  email.autocomplete = "email";
  email.required = true;
  password.type = "password";
  password.minLength = 8;
  password.autocomplete = "current-password";
  password.required = true;
  emailLabel.append(email);
  passLabel.append(password);
  form.append(emailLabel, passLabel, controls, status);
  host.append(form);
  let disposed = false;
  const configured = multiuserConfig.auth;
  if (configured && hasEmailConfirmation()) {
    const confirm = button("\u786E\u8BA4\u90AE\u4EF6\u9A8C\u8BC1\uFF08\u4EC5\u70B9\u51FB\u540E\u9A8C\u8BC1\uFF09", async () => {
      confirm.disabled = true;
      status.textContent = "\u6B63\u5728\u9A8C\u8BC1\u2026";
      try {
        await confirmPendingEmail();
        status.textContent = "\u90AE\u7BB1\u9A8C\u8BC1\u6210\u529F\uFF1B\u91CD\u8BBE\u90AE\u4EF6\u8BF7\u586B\u5199\u65B0\u5BC6\u7801\u3002";
      } catch (error) {
        status.textContent = error.message;
      }
    });
    form.prepend(confirm);
  }
  if (!configured) status.textContent = "\u5F53\u524D\u4E3A\u672C\u673A\u5B66\u4E60\u6A21\u5F0F\u3002\u7AD9\u957F\u5C1A\u672A\u542F\u7528\u8D26\u53F7\u670D\u52A1\uFF0C\u516C\u5F00\u8BFE\u7A0B\u53EF\u6B63\u5E38\u4F7F\u7528\u3002";
  async function run(action) {
    if (!configured || !form.reportValidity()) return;
    [...controls.children].forEach((el) => el.disabled = true);
    status.textContent = "\u5904\u7406\u4E2D\u2026";
    try {
      const auth = await initAuth();
      await action(auth);
      if (!disposed) {
        password.value = "";
        status.textContent = "\u64CD\u4F5C\u5DF2\u53D7\u7406\uFF1B\u5982\u9700\u90AE\u7BB1\u9A8C\u8BC1\uFF0C\u8BF7\u67E5\u770B\u6536\u4EF6\u7BB1\uFF08\u4E5F\u8BF7\u68C0\u67E5\u5783\u573E\u90AE\u4EF6\uFF09\u3002";
      }
    } catch (error) {
      if (!disposed) status.textContent = error.message;
    } finally {
      if (!disposed) [...controls.children].forEach((el) => el.disabled = false);
    }
  }
  const login = button("\u767B\u5F55", () => run((auth) => auth.signIn(email.value, password.value)));
  controls.append(
    login,
    button("\u6CE8\u518C\u5E76\u9A8C\u8BC1\u90AE\u7BB1", () => run((auth) => auth.signUp(email.value, password.value, multiuserConfig.callbackUrl))),
    button("\u91CD\u65B0\u53D1\u9001\u9A8C\u8BC1\u90AE\u4EF6", () => {
      password.required = false;
      run((auth) => auth.resend(email.value, multiuserConfig.callbackUrl)).finally(() => password.required = true);
    }),
    button("\u5FD8\u8BB0\u5BC6\u7801", () => {
      password.required = false;
      run((auth) => auth.reset(email.value, multiuserConfig.callbackUrl)).finally(() => password.required = true);
    }),
    button("\u4FDD\u5B58\u91CD\u8BBE\u5BC6\u7801", () => run((auth) => auth.updatePassword(password.value)))
  );
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    login.click();
  });
  if (!configured) [...controls.children].forEach((el) => el.disabled = true);
  return () => {
    disposed = true;
    host.replaceChildren();
  };
}
function renderMarkdown(host, text) {
  host.replaceChildren();
  for (const line of text.split("\n")) {
    const match = line.match(/^(#{1,3})\s+(.*)$/);
    const el = node(match ? "h3" : "p");
    for (const token of (match ? match[2] : line).split(/(\*\*[^*]+\*\*|`[^`]+`)/g)) {
      if (token.startsWith("**") && token.endsWith("**")) el.append(node("strong", token.slice(2, -2)));
      else if (token.startsWith("`") && token.endsWith("`")) el.append(node("code", token.slice(1, -1)));
      else el.append(document.createTextNode(token));
    }
    host.append(el);
  }
}
function renderCitations(host, sources, base) {
  host.replaceChildren();
  for (const source of Array.isArray(sources) ? sources : []) {
    try {
      const url = new URL(source.sourceUrl, location.origin);
      if (url.origin !== location.origin || !url.pathname.startsWith(`${base}lessons/`) || url.search) continue;
      const li = node("li"), link = node("a", source.heading || "\u8BFE\u7A0B\u539F\u6587");
      link.href = url.pathname + url.hash;
      li.append(link);
      host.append(li);
    } catch {
    }
  }
}
var mathPromise;
async function renderSafeMath(host, base) {
  if (!host.textContent.includes("$")) return;
  if (!window.katex) mathPromise ??= new Promise((resolve, reject) => {
    const css = node("link");
    css.rel = "stylesheet";
    css.href = `${base}lessons/zsb-math/assets/katex/katex.min.css`;
    document.head.append(css);
    const script = node("script");
    script.src = `${base}lessons/zsb-math/assets/katex/katex.min.js`;
    script.onload = resolve;
    script.onerror = reject;
    document.head.append(script);
  });
  try {
    if (!window.katex) await mathPromise;
  } catch {
    return;
  }
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT), texts = [];
  while (walker.nextNode()) if (!walker.currentNode.parentElement.closest("code")) texts.push(walker.currentNode);
  for (const item of texts) {
    const parts = item.textContent.split(/(\$\$[\s\S]{1,500}?\$\$|\$[^$\n]{1,500}\$)/g);
    if (parts.length === 1) continue;
    const fragment = document.createDocumentFragment();
    for (const part of parts) {
      if (!part.startsWith("$")) {
        fragment.append(document.createTextNode(part));
        continue;
      }
      const span = node("span"), display = part.startsWith("$$"), tex = part.slice(display ? 2 : 1, display ? -2 : -1);
      try {
        window.katex.render(tex, span, { displayMode: display, throwOnError: false, trust: false, maxExpand: 100, strict: "error" });
      } catch {
        span.textContent = part;
      }
      fragment.append(span);
    }
    item.replaceWith(fragment);
  }
}
function mountAITutor(host, { base = "/blog/" } = {}) {
  const form = node("form"), question = node("textarea"), label = node("label", "\u8BFE\u7A0B\u95EE\u9898\uFF08\u53EF\u5148\u9009\u4E2D\u516C\u5F00\u8BFE\u6587\uFF09"), mode = node("select"), status = message(), output = node("div", "", "zhixu-ai-answer"), citations = node("ul"), history2 = node("div");
  question.maxLength = 2e3;
  question.required = true;
  question.rows = 3;
  label.append(question);
  for (const [value, text] of [["guide", "\u5F15\u5BFC\u6211\u601D\u8003"], ["explain", "\u8BE6\u7EC6\u8BB2\u89E3"]]) {
    const option = node("option", text);
    option.value = value;
    mode.append(option);
  }
  mode.setAttribute("aria-label", "\u6559\u5B66\u6A21\u5F0F");
  const disclosure = createAIDisclosure(), notice = node("p", "\u53D1\u9001\u524D\u987B\u77E5\uFF1A\u4F60\u7684\u95EE\u9898\u3001\u672C\u8BFE\u68C0\u7D22\u5230\u7684\u516C\u5F00\u6B63\u6587\uFF0C\u4EE5\u53CA\u4F60\u660E\u786E\u52A0\u5165\u7684\u9009\u6587\uFF0C\u5C06\u901A\u8FC7 Supabase \u53D1\u9001\u7ED9 DeepSeek\uFF0C\u5E76\u4FDD\u5B58\u4E3A\u4F60\u7684\u79C1\u6709\u95EE\u7B54\u4F1A\u8BDD\u3002\u4E0D\u8BFB\u53D6\u79C1\u4EBA\u7B14\u8BB0\u3001\u5B66\u4E60\u8BB0\u5F55\u6216\u526A\u8D34\u677F\u3002\u4E0D\u8981\u8F93\u5165\u8EAB\u4EFD\u4FE1\u606F\u3001\u5BC6\u7801\u6216\u5BC6\u94A5\u3002AI \u53EF\u80FD\u51FA\u9519\uFF0C\u8BF7\u6838\u5BF9\u8BFE\u7A0B\u5F15\u7528\u3002"), consent = node("input"), consentLabel = node("label", "\u6211\u5DF2\u4E86\u89E3\u5E76\u540C\u610F\u672C\u6B21 AI \u53D1\u9001\u8303\u56F4"), preview = node("pre", "", "zhixu-selection-preview");
  consent.type = "checkbox";
  consent.required = true;
  consentLabel.prepend(consent);
  const refreshDisclosure = () => {
    preview.textContent = disclosure.preview ? "\u9009\u6587\u9884\u89C8\uFF08" + (disclosure.selected ? "\u5DF2\u52A0\u5165" : "\u5C1A\u672A\u53D1\u9001") + "\uFF09\uFF1A\n" + disclosure.preview : "\u672A\u52A0\u5165\u9009\u6587\uFF1B\u53EA\u53D1\u9001\u95EE\u9898\u548C\u672C\u8BFE\u516C\u5F00\u68C0\u7D22\u7247\u6BB5\u3002";
  };
  const resetDisclosure = () => {
    disclosure.reset();
    consent.checked = false;
    refreshDisclosure();
  };
  consent.addEventListener("change", () => disclosure.allow(consent.checked));
  const selectionControls = node("div", "", "zhixu-actions");
  selectionControls.append(button("\u52A0\u5165\u4E0A\u8FF0\u9009\u6587", () => {
    disclosure.include();
    refreshDisclosure();
  }), button("\u4E0D\u53D1\u9001\u9009\u6587", () => {
    disclosure.remove();
    refreshDisclosure();
  }));
  const cancelRequest = () => {
    requestEpoch++;
    client?.cancel();
    resetDisclosure();
    submit.disabled = !multiuserConfig.ai;
    status.textContent = "\u5DF2\u53D6\u6D88\uFF0C\u672C\u8BFE\u4F5C\u7B54\u4E0D\u53D7\u5F71\u54CD\u3002";
  };
  const submit = button("\u63D0\u95EE", () => form.requestSubmit()), cancel = button("\u53D6\u6D88", cancelRequest);
  form.append(notice, consentLabel, preview, selectionControls, label, mode, submit, cancel, status);
  host.append(form, output, citations, history2);
  refreshDisclosure();
  let client, disposed = false, conversationId, context, requestEpoch = 0;
  host.addEventListener("zhixu:cancel", cancelRequest);
  host.addEventListener("zhixu:context", (event) => {
    if (context?.lessonKey !== event.detail?.lessonKey) {
      conversationId = void 0;
      consent.checked = false;
    }
    context = event.detail;
    disclosure.setContext(context);
    refreshDisclosure();
  });
  if (!multiuserConfig.ai) {
    submit.disabled = true;
    status.textContent = "AI \u5C1A\u672A\u542F\u7528\u3002\u6CA1\u6709\u95EE\u9898\u3001\u7B14\u8BB0\u6216\u5B66\u4E60\u8BB0\u5F55\u88AB\u53D1\u9001\u7ED9\u6A21\u578B\u3002";
  }
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!multiuserConfig.ai) return;
    const generation = ++requestEpoch;
    const fresh = lessonContext({ document, location, base });
    const current = context?.lessonKey === fresh?.lessonKey ? context : fresh;
    if (!current) {
      status.textContent = "\u8BF7\u8FDB\u5165\u4E00\u8282\u9AD8\u6570\u3001\u82F1\u8BED\u3001\u653F\u6CBB\u6216\u8BA1\u7B97\u673A\u8BFE\u7A0B\u540E\u63D0\u95EE\u3002";
      return;
    }
    disclosure.setContext(current);
    disclosure.allow(consent.checked);
    let confirmedContext;
    try {
      confirmedContext = disclosure.input(current);
    } catch (error) {
      status.textContent = error.message;
      return;
    }
    submit.disabled = true;
    status.textContent = "\u6B63\u5728\u67E5\u627E\u672C\u8BFE\u8BC1\u636E\u2026";
    output.replaceChildren();
    citations.replaceChildren();
    try {
      const auth = await initAuth();
      if (!auth?.session) throw new Error("\u8BF7\u5148\u767B\u5F55\u5B66\u4E60\u8D26\u53F7");
      if (disposed || generation !== requestEpoch) return;
      client ??= createAITutorClient({ endpoint: multiuserConfig.supabaseUrl + "/functions/v1/ai-tutor", auth, publishableKey: multiuserConfig.publishableKey });
      const result = await client.ask({ ...confirmedContext, question: question.value, mode: mode.value, ...conversationId ? { conversationId } : {} }, { onDelta: (text) => {
        if (!disposed && generation === requestEpoch) {
          output.textContent = text;
          status.textContent = "\u6B63\u5728\u751F\u6210\uFF08\u5C1A\u672A\u5B8C\u6210\uFF0C\u8BF7\u7B49\u5F85\u5F15\u7528\u6838\u9A8C\uFF09\u2026";
        }
      } });
      if (disposed || generation !== requestEpoch) return;
      conversationId = result.conversationId;
      renderMarkdown(output, result.answer);
      void renderSafeMath(output, base);
      citations.replaceChildren();
      renderCitations(citations, result.sources, base);
      status.textContent = result.sources.length ? "\u56DE\u7B54\u4EC5\u4F9B\u8F85\u52A9\uFF0C\u8BF7\u6838\u5BF9\u5F15\u7528\u539F\u6587\u3002" : "\u8BFE\u7A0B\u8BC1\u636E\u4E0D\u8DB3\uFF0C\u8BF7\u56DE\u539F\u8BFE\u6838\u5BF9\u3002";
    } catch (error) {
      if (!disposed && generation === requestEpoch) status.textContent = error.name === "AbortError" ? "\u5DF2\u53D6\u6D88\uFF0C\u672C\u8BFE\u4F5C\u7B54\u4E0D\u53D7\u5F71\u54CD\u3002" : error.message;
    } finally {
      if (!disposed && generation === requestEpoch) {
        consent.checked = false;
        disclosure.allow(false);
        submit.disabled = false;
      }
    }
  });
  host.append(button("\u6211\u7684\u4F1A\u8BDD", async () => {
    try {
      const auth = await initAuth();
      if (!auth?.session) throw new Error("\u8BF7\u5148\u767B\u5F55");
      client ??= createAITutorClient({ endpoint: multiuserConfig.supabaseUrl + "/functions/v1/ai-tutor", auth, publishableKey: multiuserConfig.publishableKey });
      const items = await client.conversations();
      history2.replaceChildren();
      for (const item of items) {
        const row = node("article"), messages = node("section", "", "zhixu-ai-history");
        row.append(node("p", item.title));
        row.append(button("\u67E5\u770B\u8BE5\u4F1A\u8BDD", async () => {
          try {
            const data = await client.messages(item.id);
            messages.replaceChildren();
            for (const entry of data) {
              const part = node("div"), text = node("div"), refs = node("ul");
              part.append(node("h3", entry.role === "user" ? "\u4F60" : "\u8BFE\u7A0B\u52A9\u624B"), text, refs);
              renderMarkdown(text, entry.content);
              void renderSafeMath(text, base);
              renderCitations(refs, entry.sources, base);
              messages.append(part);
            }
            if (item.lesson_key === lessonContext({ document, location, base })?.lessonKey) conversationId = item.id;
          } catch (error) {
            status.textContent = error.message;
          }
        }), button("\u5220\u9664\u8BE5\u4F1A\u8BDD", async () => {
          try {
            await client.removeConversation(item.id);
            row.remove();
            if (conversationId === item.id) conversationId = void 0;
          } catch (error) {
            status.textContent = error.message;
          }
        }), messages);
        history2.append(row);
      }
    } catch (error) {
      status.textContent = error.message;
    }
  }));
  return () => {
    disposed = true;
    client?.cancel();
    host.replaceChildren();
  };
}
function mountAccountTools(host, { base = "/blog/" } = {}) {
  const open = button("\u5B66\u4E60\u8D26\u53F7 \xB7 \u672C\u673A\u6A21\u5F0F", () => {
    capture();
    dialog.showModal();
  }), dialog = node("dialog", "", "zhixu-account-dialog"), header = node("header"), title = node("h2", "\u4E2A\u4EBA\u5B66\u4E60\u6863\u6848"), status = message(), authHost = node("div"), syncHost = node("section"), aiHost = node("section", "", "zhixu-ai-panel");
  title.id = "zhixu-account-title";
  dialog.setAttribute("aria-labelledby", title.id);
  header.append(title, button("\u5173\u95ED", () => dialog.close()));
  dialog.append(header, status, authHost, syncHost, node("h3", "AI \u8BFE\u7A0B\u52A9\u624B"), aiHost);
  host.append(open, dialog);
  const disposeAuth = mountAuthDialog(authHost), disposeAI = mountAITutor(aiHost, { base });
  const readonly = node("section", "", "zhixu-readonly-notice"), readonlyText = node("p"), retryWriter = button("\u5173\u95ED\u53E6\u4E00\u6807\u7B7E\u540E\u91CD\u65B0\u52A0\u8F7D", () => window.location.reload());
  readonly.setAttribute("role", "status");
  readonly.append(readonlyText, retryWriter);
  host.append(readonly);
  const refreshWriter = () => {
    const storage = getStudyStorage();
    readonly.hidden = !storage.owner || storage.writable;
    readonlyText.textContent = storage.writeBlockedReason;
  };
  refreshWriter();
  window.addEventListener(STORAGE_EVENT, refreshWriter);
  dialog.addEventListener("close", () => aiHost.dispatchEvent(new CustomEvent("zhixu:cancel")));
  let engine, timer, engineOwner, stopped = false, migrationPlan;
  const capture = () => {
    const context = lessonContext({ document, location, base });
    aiHost.dispatchEvent(new CustomEvent("zhixu:context", { detail: context }));
  };
  document.addEventListener("selectionchange", capture);
  capture();
  async function initialize() {
    try {
      const auth = await initAuth();
      if (stopped) return;
      if (!auth?.session) {
        status.textContent = getStudyStorage().unavailable ? "\u6D4F\u89C8\u5668\u7981\u6B62\u4FDD\u5B58\u8BB0\u5F55\uFF1A\u5F53\u524D\u4F5C\u7B54\u4E0D\u4F1A\u6301\u4E45\u5316\uFF0C\u8BF7\u590D\u5236\u4FDD\u7559\u3002" : "\u516C\u5F00\u8BFE\u7A0B\u65E0\u9700\u767B\u5F55\u3002\u8D26\u53F7\u670D\u52A1\u672A\u542F\u7528\u65F6\uFF0C\u5B66\u4E60\u5386\u53F2\u4ECD\u4FDD\u5B58\u5728\u672C\u673A\u3002";
        return;
      }
      const storage = getStudyStorage();
      open.textContent = "\u5B66\u4E60\u8D26\u53F7 \xB7 \u5DF2\u767B\u5F55";
      status.textContent = `\u5F53\u524D\u8D26\u53F7\uFF1A${auth.session.user.email || auth.session.user.id}`;
      authHost.replaceChildren(button("\u9000\u51FA\u767B\u5F55", async () => {
        try {
          const pending = storage.snapshot().pending.length;
          if (pending && !window.confirm(`\u8FD8\u6709 ${pending} \u6761\u672A\u540C\u6B65\u8BB0\u5F55\uFF1B\u9000\u51FA\u540E\u4F1A\u4FDD\u7559\u5728\u539F\u8D26\u53F7\u5206\u533A\uFF0C\u5176\u4ED6\u8D26\u53F7\u6B63\u5E38\u754C\u9762\u4E0D\u53EF\u89C1\u3002\u8BF7\u5148\u5BFC\u51FA\u5907\u4EFD\uFF0C\u786E\u5B9A\u9000\u51FA\u5417\uFF1F`)) return;
          engine?.stop();
          await auth.signOut();
        } catch (error) {
          status.textContent = error.message;
        }
      }), button("\u5BFC\u51FA\u5F53\u524D\u8D26\u53F7\u5B66\u4E60\u5907\u4EFD", () => {
        try {
          download(createStudyBackup(storage, { base }).backup, base);
        } catch (error) {
          status.textContent = error.message;
        }
      }));
      const lifecycle = createAccountLifecycle({ auth, storage, endpoint: multiuserConfig.supabaseUrl + "/functions/v1/account-lifecycle", publishableKey: multiuserConfig.publishableKey });
      authHost.append(button("\u5BFC\u51FA\u5168\u90E8\u8D26\u53F7\u6570\u636E\uFF08\u542B\u4E91\u7B14\u8BB0\u548C\u5BF9\u8BDD\uFF09", async () => {
        status.textContent = "\u6B63\u5728\u6838\u9A8C\u4E91\u8EAB\u4EFD\u5E76\u5B8C\u6574\u5206\u9875\u8BFB\u53D6\u672C\u4EBA\u6570\u636E\u2026";
        try {
          const data = await lifecycle.exportAll();
          if (stopped) return;
          downloadAccount(data);
          status.textContent = "\u5DF2\u751F\u6210\u4E2A\u4EBA\u6570\u636E\u643A\u5E26\u6587\u4EF6\uFF1A\u542B\u672C\u673A\u672A\u540C\u6B65\u8BB0\u5F55\u3001\u4E91\u5B66\u4E60\u8BB0\u5F55\u3001\u7B14\u8BB0\u3001\u5BF9\u8BDD\u548C\u672C\u4EBA\u7528\u91CF\u3002\u4E0D\u542B\u5BC6\u7801\u6216\u4EE4\u724C\uFF1B\u4E0D\u662F\u6570\u636E\u5E93\u6062\u590D\u5907\u4EFD\u3002";
        } catch (error) {
          if (!stopped) status.textContent = error.message;
        }
      }));
      const danger = node("details"), summary = node("summary", "\u6C38\u4E45\u6CE8\u9500\u6211\u7684\u8D26\u53F7"), deleteInfo = node("p", "\u4E0D\u53EF\u64A4\u9500\uFF1A\u64A4\u9500\u5168\u90E8\u4E91\u4F1A\u8BDD\u5E76\u5220\u9664\u672C\u4EBA\u4E91\u5B66\u4E60\u8BB0\u5F55\u3001\u7B14\u8BB0\u548C\u5BF9\u8BDD\uFF0C\u4E0D\u9000\u8FD8 AI \u5DF2\u9884\u7559\u9884\u7B97\u3002\u5176\u5B83\u8BBE\u5907\u7684\u79BB\u7EBF\u7F13\u5B58\u4E0D\u80FD\u8FDC\u7A0B\u64E6\u9664\uFF0C\u8BF7\u5148\u5BFC\u51FA\u6570\u636E\uFF1B\u53EA\u6709\u786E\u8BA4\u4E91\u6CE8\u9500\u6210\u529F\u540E\u624D\u6E05\u7406\u672C\u6D4F\u89C8\u5668\u5206\u533A\u3002"), password = node("input"), confirm = node("input"), passLabel = node("label", "\u518D\u6B21\u9A8C\u8BC1\u5F53\u524D\u5BC6\u7801"), confirmLabel = node("label", `\u8F93\u5165\u300C${DELETE_CONFIRMATION}\u300D`);
      password.type = "password";
      password.autocomplete = "current-password";
      password.minLength = 8;
      password.maxLength = 128;
      confirm.autocomplete = "off";
      passLabel.append(password);
      confirmLabel.append(confirm);
      danger.append(summary, deleteInfo, passLabel, confirmLabel);
      danger.append(button("\u6C38\u4E45\u6CE8\u9500\u8D26\u53F7", async () => {
        if (!window.confirm("\u786E\u5B9A\u6C38\u4E45\u6CE8\u9500\u5F53\u524D\u8D26\u53F7\u5417\uFF1F\u4E91\u6570\u636E\u5220\u9664\u4E0D\u53EF\u6062\u590D\uFF0C\u8BF7\u5148\u5BFC\u51FA\u3002")) return;
        const controls = [...authHost.querySelectorAll("button")];
        controls.forEach((el) => el.disabled = true);
        engine?.stop();
        aiHost.dispatchEvent(new CustomEvent("zhixu:cancel"));
        try {
          await lifecycle.deleteSelf({ password: password.value, confirmation: confirm.value });
          window.location.reload();
        } catch (error) {
          if (!stopped) status.textContent = error.message;
        } finally {
          password.value = "";
          if (!stopped) controls.forEach((el) => el.disabled = false);
        }
      }));
      authHost.append(danger);
      syncHost.append(node("p", "\u9996\u6B21\u767B\u5F55\u4E0D\u4F1A\u81EA\u52A8\u8BA4\u9886\u65E7\u8BB0\u5F55\uFF1B\u8BF7\u4E0B\u8F7D\u5907\u4EFD\u5E76\u786E\u8BA4\u5F52\u5C5E\u3002"));
      const migrationStatus = message(), migrationActions = node("div", "", "zhixu-actions");
      migrationActions.append(
        button("\u4E0B\u8F7D\u65E7\u8BB0\u5F55\u5907\u4EFD", () => {
          try {
            download(createStudyBackup(window.localStorage, { base }).backup, base);
          } catch (error) {
            migrationStatus.textContent = error.message;
          }
        }),
        button("\u9884\u89C8\u5BFC\u5165\u65E7\u8BB0\u5F55", () => {
          try {
            migrationPlan = previewLegacyMigration(window.localStorage, storage, { base });
            migrationStatus.textContent = `\u5F52\u5C5E\u8D26\u53F7 ${auth.session.user.email || storage.owner}\uFF1B${migrationPlan.source.includedKeys.length} \u7EC4\u6709\u6548\u8BB0\u5F55\uFF1B${migrationPlan.source.skipped.length} \u7EC4\u5F02\u5E38\uFF1B${migrationPlan.preview.conflicts.length} \u5904\u51B2\u7A81\u3002\u539F\u8BB0\u5F55\u4E0D\u4F1A\u5220\u9664\u3002`;
          } catch (error) {
            migrationStatus.textContent = error.message;
          }
        }),
        button("\u786E\u8BA4\u8FD9\u4E9B\u65E7\u8BB0\u5F55\u5C5E\u4E8E\u6211\uFF0C\u5BFC\u5165", () => {
          try {
            if (!migrationPlan) throw new Error("\u8BF7\u5148\u9884\u89C8\u5BFC\u5165\u8303\u56F4");
            const result = confirmLegacyMigration(migrationPlan, storage, { base, confirmedOwner: storage.owner });
            if (!result.applied) throw new Error("\u5B58\u5728\u9700\u8981\u660E\u786E\u9009\u62E9\u7684\u51B2\u7A81\uFF1B\u8BF7\u901A\u8FC7\u539F\u624B\u52A8\u5907\u4EFD\u754C\u9762\u9010\u9879\u5904\u7406\uFF0C\u4E0D\u4F1A\u81EA\u52A8\u8986\u76D6");
            migrationStatus.textContent = "\u5BFC\u5165\u5DF2\u4FDD\u5B58\u5230\u5F53\u524D\u8D26\u53F7\u5206\u533A\uFF1B\u65E7\u8BB0\u5F55\u672A\u5220\u9664\u3002\u91CD\u590D\u5BFC\u5165\u4E0D\u4F1A\u91CD\u590D\u8BA1\u6570\u3002";
            schedule();
          } catch (error) {
            migrationStatus.textContent = error.message;
          }
        })
      );
      syncHost.append(migrationActions, migrationStatus);
      if (!multiuserConfig.sync) {
        syncHost.append(node("p", "\u4E91\u540C\u6B65\u5C1A\u672A\u542F\u7528\uFF0C\u8D26\u53F7\u5206\u533A\u548C\u624B\u52A8\u5907\u4EFD\u4ECD\u53EF\u4F7F\u7528\u3002"));
        return;
      }
      const progress = message(), conflicts = node("div");
      const refresh = (info) => {
        if (stopped) return;
        const state = storage.snapshot(), last = info.lastSyncedAt ? `\uFF1B\u6700\u540E\u6210\u529F ${new Date(info.lastSyncedAt).toLocaleTimeString()}` : "";
        progress.textContent = info.error || `${state.pending.length ? "\u5F85\u540C\u6B65 " + state.pending.length + " \u6761" : "\u5DF2\u540C\u6B65"}\uFF1B\u51B2\u7A81 ${Object.keys(state.conflicts).length} \u6761${last}`;
        open.textContent = info.error ? "\u5B66\u4E60\u8D26\u53F7 \xB7 \u540C\u6B65\u5931\u8D25" : state.pending.length ? `\u5B66\u4E60\u8D26\u53F7 \xB7 \u5F85\u540C\u6B65 ${state.pending.length}` : "\u5B66\u4E60\u8D26\u53F7 \xB7 \u5DF2\u540C\u6B65";
        conflicts.replaceChildren();
        for (const [id, record] of Object.entries(state.conflicts)) {
          const row = node("p", `\u540C\u4E00\u8BB0\u5F55\u51B2\u7A81\uFF1A${record.bucket} / ${record.record_id}\u3002\u4E0D\u4F1A\u81EA\u52A8\u53D6\u8F83\u65B0\u65F6\u95F4\u3002`);
          for (const [choice, label] of [["local", "\u4FDD\u7559\u672C\u673A"], ["remote", "\u91C7\u7528\u4E91\u7AEF"]]) row.append(button(label, () => {
            engine.resolve(id, choice);
            schedule();
          }));
          conflicts.append(row);
        }
      };
      engine = createSyncEngine({ storage, transport: createSupabaseTransport(auth.client), notify: refresh });
      engineOwner = storage.owner;
      syncHost.append(progress, button("\u7ACB\u5373\u91CD\u8BD5\u540C\u6B65", () => engine.flush({ force: true }).catch(() => {
      })), conflicts);
      refresh({});
      timer = setInterval(() => engine.flush().catch(() => {
      }), 15e3);
      schedule();
    } catch (error) {
      if (!stopped) status.textContent = "\u8D26\u53F7\u6682\u4E0D\u53EF\u7528\uFF1A" + error.message;
    }
  }
  function schedule() {
    if (!stopped && engine && getStudyStorage().owner === engineOwner) void engine.flush().catch(() => {
    });
  }
  window.addEventListener("online", schedule);
  const onStorage = () => {
    if (!engine) return;
    if (getStudyStorage().owner !== engineOwner) {
      engine.stop();
      engine = void 0;
      clearInterval(timer);
      open.textContent = "\u5B66\u4E60\u8D26\u53F7 \xB7 \u672C\u673A\u6A21\u5F0F";
      return;
    }
    try {
      const info = engine.status();
      open.textContent = `\u5B66\u4E60\u8D26\u53F7 \xB7 \u5F85\u540C\u6B65 ${info.pending}`;
    } catch {
      status.textContent = "\u5B66\u4E60\u7F13\u5B58\u6682\u4E0D\u53EF\u7528\uFF0C\u8BF7\u4FDD\u7559\u5907\u4EFD\u540E\u91CD\u8BD5\u3002";
    }
  };
  window.addEventListener(STORAGE_EVENT, onStorage);
  void initialize();
  return () => {
    stopped = true;
    clearInterval(timer);
    engine?.stop();
    disposeAuth();
    disposeAI();
    document.removeEventListener("selectionchange", capture);
    window.removeEventListener("online", schedule);
    window.removeEventListener(STORAGE_EVENT, onStorage);
    window.removeEventListener(STORAGE_EVENT, refreshWriter);
    host.replaceChildren();
  };
}
export {
  mountAITutor,
  mountAccountTools,
  mountAuthDialog
};
