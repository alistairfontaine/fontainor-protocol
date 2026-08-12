export const Browser = {
  open(opts) { globalThis.__openedUrls.push(opts.url); return Promise.resolve() },
  close() { globalThis.__browserCloses++; return Promise.resolve() },
}
