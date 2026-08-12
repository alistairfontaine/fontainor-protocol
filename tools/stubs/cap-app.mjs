export const App = {
  addListener(name, cb) {
    if (name === 'appUrlOpen') globalThis.__appUrlOpen = cb
    return Promise.resolve({ remove() {} })
  },
}
