// Uint8Array.fromBase64 — esbuild-ის `with { type: 'bytes' }` იმპორტისთვის (ძველ ბრაუზერებში არ არის).
if (typeof Uint8Array.fromBase64 !== 'function') {
  Object.defineProperty(Uint8Array, 'fromBase64', {
    configurable: true, writable: true,
    value(b64) { const s = atob(String(b64)); const out = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i); return out; },
  });
}
