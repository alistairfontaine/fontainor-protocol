const store = (globalThis.__prefStore ??= new Map()) // shared across bundle copies
export const Preferences = {
  get({ key }) { return Promise.resolve({ value: store.has(key) ? store.get(key) : null }) },
  set({ key, value }) { store.set(key, value); return Promise.resolve() },
  remove({ key }) { store.delete(key); return Promise.resolve() },
}
export const __prefStore = store
