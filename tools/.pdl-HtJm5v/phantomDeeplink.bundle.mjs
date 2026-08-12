// src/lib/phantomDeeplink.ts
import nacl from "tweetnacl";
import bs58 from "bs58";

// tools/stubs/cap-core.mjs
var Capacitor = { isNativePlatform: () => true };

// tools/stubs/cap-app.mjs
var App = {
  addListener(name, cb) {
    if (name === "appUrlOpen") globalThis.__appUrlOpen = cb;
    return Promise.resolve({ remove() {
    } });
  }
};

// tools/stubs/cap-browser.mjs
var Browser = {
  open(opts) {
    globalThis.__openedUrls.push(opts.url);
    return Promise.resolve();
  },
  close() {
    globalThis.__browserCloses++;
    return Promise.resolve();
  }
};

// tools/stubs/cap-preferences.mjs
var store = /* @__PURE__ */ new Map();
var Preferences = {
  get({ key }) {
    return Promise.resolve({ value: store.has(key) ? store.get(key) : null });
  },
  set({ key, value }) {
    store.set(key, value);
    return Promise.resolve();
  },
  remove({ key }) {
    store.delete(key);
    return Promise.resolve();
  }
};

// src/lib/phantomDeeplink.ts
var PHANTOM_BASE = "https://phantom.app/ul/v1";
var CLUSTER = "mainnet-beta";
var SCHEME = "fontainor";
var REDIRECT = (method) => `${SCHEME}://onphantom/${method}`;
var APP_URL = "https://fontainor-protocol.vercel.app";
var STORE_KEY = "fontainor_phantom_session_v1";
var state = null;
var ready = null;
var pending = /* @__PURE__ */ new Map();
function isNativeApp() {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}
var loading = null;
async function loadState() {
  if (state) return state;
  if (loading) return loading;
  loading = loadStateOnce().finally(() => {
    loading = null;
  });
  return loading;
}
async function loadStateOnce() {
  if (state) return state;
  try {
    const { value } = await Preferences.get({ key: STORE_KEY });
    if (value) {
      state = JSON.parse(value);
      return state;
    }
  } catch {
  }
  const kp = nacl.box.keyPair();
  state = { dappPub: bs58.encode(kp.publicKey), dappSec: bs58.encode(kp.secretKey) };
  await persist();
  return state;
}
async function persist() {
  if (!state) return;
  try {
    await Preferences.set({ key: STORE_KEY, value: JSON.stringify(state) });
  } catch {
  }
}
function decryptPayload(data, nonce, sharedSecret) {
  const decrypted = nacl.box.open.after(bs58.decode(data), bs58.decode(nonce), bs58.decode(sharedSecret));
  if (!decrypted) throw new Error("Could not decrypt Phantom response (shared secret mismatch).");
  return JSON.parse(new TextDecoder().decode(decrypted));
}
function encryptPayload(payload, sharedSecret) {
  const nonce = nacl.randomBytes(24);
  const encoded = new TextEncoder().encode(JSON.stringify(payload));
  const encrypted = nacl.box.after(encoded, nonce, bs58.decode(sharedSecret));
  return [bs58.encode(nonce), bs58.encode(encrypted)];
}
function openAndAwait(method, url) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (pending.has(method)) {
        pending.delete(method);
        void Browser.close().catch(() => {
        });
        reject(new Error("Phantom did not respond. Reopen the app after approving in Phantom, or try again."));
      }
    }, 18e4);
    const wrapped = {
      resolve: (params) => {
        clearTimeout(timeout);
        resolve(params);
      },
      reject: (e) => {
        clearTimeout(timeout);
        reject(e);
      }
    };
    const superseded = pending.get(method);
    if (superseded) {
      pending.delete(method);
      superseded.reject(new PhantomSessionError("Request superseded by a newer one \u2014 try again."));
    }
    pending.set(method, wrapped);
    void Browser.open({ url, presentationStyle: "popover" }).catch((e) => {
      clearTimeout(timeout);
      pending.delete(method);
      reject(e instanceof Error ? e : new Error(String(e)));
    });
  });
}
function handleRedirect(rawUrl) {
  const m = /^fontainor:\/\/onphantom\/([A-Za-z]+)/.exec(rawUrl);
  if (!m) return;
  const method = m[1];
  const qIdx = rawUrl.indexOf("?");
  const params = new URLSearchParams(qIdx === -1 ? "" : rawUrl.slice(qIdx + 1));
  const waiter = pending.get(method);
  if (!waiter) return;
  pending.delete(method);
  void Browser.close().catch(() => {
  });
  const errCode = params.get("errorCode");
  if (errCode) {
    const msg = params.get("errorMessage") || `Phantom returned error ${errCode}.`;
    waiter.reject(errCode === "4001" ? new PhantomUserError(msg) : new PhantomSessionError(msg));
    return;
  }
  waiter.resolve(params);
}
var PhantomUserError = class extends Error {
};
var PhantomSessionError = class extends Error {
};
var PhantomSupersededError = class extends PhantomUserError {
};
var listenerRegistered = false;
function ensureListener() {
  if (listenerRegistered) return;
  listenerRegistered = true;
  void App.addListener("appUrlOpen", (event) => {
    if (event?.url?.startsWith(`${SCHEME}://`)) handleRedirect(event.url);
  });
}
async function connect() {
  ensureListener();
  const s = await loadState();
  if (s.walletPubkey && s.sharedSecret && s.session) {
    return { publicKey: makePublicKey(s.walletPubkey) };
  }
  const params = new URLSearchParams({
    dapp_encryption_public_key: s.dappPub,
    cluster: CLUSTER,
    app_url: APP_URL,
    redirect_link: REDIRECT("connect")
  });
  const res = await openAndAwait("connect", `${PHANTOM_BASE}/connect?${params.toString()}`);
  const phantomPub = res.get("phantom_encryption_public_key");
  const nonce = res.get("nonce");
  const data = res.get("data");
  if (!phantomPub || !nonce || !data) throw new Error("Phantom connect response was incomplete.");
  const shared = nacl.box.before(bs58.decode(phantomPub), bs58.decode(s.dappSec));
  const sharedB58 = bs58.encode(shared);
  const decoded = decryptPayload(data, nonce, sharedB58);
  const walletPubkey = String(decoded.public_key);
  const session = String(decoded.session);
  s.sharedSecret = sharedB58;
  s.session = session;
  s.walletPubkey = walletPubkey;
  await persist();
  return { publicKey: makePublicKey(walletPubkey) };
}
async function disconnect() {
  const s = state;
  if (!s?.sharedSecret || !s.session) {
    await clearSession();
    return;
  }
  try {
    const [nonce, payload] = encryptPayload({ session: s.session }, s.sharedSecret);
    const params = new URLSearchParams({
      dapp_encryption_public_key: s.dappPub,
      nonce,
      redirect_link: REDIRECT("disconnect"),
      payload
    });
    void openAndAwait("disconnect", `${PHANTOM_BASE}/disconnect?${params.toString()}`).catch(() => {
    });
  } finally {
    await clearSession();
  }
}
async function clearSession() {
  if (state) {
    state.sharedSecret = void 0;
    state.session = void 0;
    state.walletPubkey = void 0;
    await persist();
  }
}
async function signMessage(message, _display = "utf8") {
  return withFreshSessionRetry(async () => {
    const s = await ensureConnected();
    const shared = s.sharedSecret;
    const payload = { session: s.session, message: bs58.encode(message) };
    const [nonce, data] = encryptPayload(payload, shared);
    const params = new URLSearchParams({
      dapp_encryption_public_key: s.dappPub,
      nonce,
      redirect_link: REDIRECT("signMessage"),
      payload: data
    });
    const res = await openAndAwait("signMessage", `${PHANTOM_BASE}/signMessage?${params.toString()}`);
    const decoded = decodeResponse(res, shared);
    return { signature: bs58.decode(String(decoded.signature)) };
  });
}
async function withFreshSessionRetry(op) {
  try {
    return await op();
  } catch (e) {
    if (e instanceof PhantomUserError) throw e;
    if (!(e instanceof PhantomSessionError) && !/decrypt|session/i.test(e instanceof Error ? e.message : "")) throw e;
    await clearSession();
    return op();
  }
}
async function signAndSendTransaction(tx) {
  const serialized = serializeTransaction(tx);
  return withFreshSessionRetry(async () => {
    const s = await ensureConnected();
    const shared = s.sharedSecret;
    const payload = { session: s.session, transaction: bs58.encode(serialized) };
    const [nonce, data] = encryptPayload(payload, shared);
    const params = new URLSearchParams({
      dapp_encryption_public_key: s.dappPub,
      nonce,
      redirect_link: REDIRECT("signAndSendTransaction"),
      payload: data
    });
    const res = await openAndAwait("signAndSendTransaction", `${PHANTOM_BASE}/signAndSendTransaction?${params.toString()}`);
    const decoded = decodeResponse(res, shared);
    return { signature: String(decoded.signature) };
  });
}
function decodeResponse(res, sharedSecret) {
  const nonce = res.get("nonce");
  const data = res.get("data");
  if (!nonce || !data) throw new Error("Phantom response was incomplete.");
  return decryptPayload(data, nonce, sharedSecret);
}
async function ensureConnected() {
  let s = await loadState();
  if (!s.sharedSecret || !s.session || !s.walletPubkey) {
    await connect();
    s = state;
  }
  return s;
}
function serializeTransaction(tx) {
  const t = tx;
  if (typeof t?.serialize !== "function") throw new Error("Unsupported transaction object.");
  try {
    return t.serialize({ requireAllSignatures: false, verifySignatures: false });
  } catch {
    return t.serialize();
  }
}
function makePublicKey(address) {
  return {
    toString: () => address,
    toBytes: () => bs58.decode(address)
  };
}
function buildProvider() {
  return {
    isPhantom: true,
    isFontainorNative: true,
    get publicKey() {
      return state?.walletPubkey ? makePublicKey(state.walletPubkey) : null;
    },
    connect,
    disconnect,
    signMessage,
    signAndSendTransaction
  };
}
function installNativePhantom() {
  if (!isNativeApp()) return false;
  ensureListener();
  ready = loadState().then(() => void 0);
  const provider = buildProvider();
  const w = window;
  w.solana = provider;
  w.phantom = { solana: provider };
  return true;
}
function nativeReady() {
  return ready ?? Promise.resolve();
}
export {
  PhantomSessionError,
  PhantomSupersededError,
  PhantomUserError,
  installNativePhantom,
  isNativeApp,
  nativeReady,
  serializeTransaction
};
