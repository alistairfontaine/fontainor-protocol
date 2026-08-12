export const Capacitor = { isNativePlatform: () => true }
// Late-bound proxy so tests can swap globalThis.__mwaPlugin between scenarios.
export const registerPlugin = (_name) =>
  new Proxy({}, { get: (_t, method) => (...args) => globalThis.__mwaPlugin[method](...args) })
