// Lambda calls `handler(event, context)`. Every handler here takes `(event, provided)` so unit tests
// can inject fakes, and then did `provided ?? realDeps()` -- which in Lambda is never the real deps,
// because `provided` is the runtime's context object. Found on the first live call, 2026-11-20: every
// allowed read 500ed with "Cannot read properties of undefined (reading 'classes')", while all 802
// offline tests passed, since every one of them injects. This is the one place that tells them apart.

/** `provided` if a caller injected deps; `undefined` if it is the Lambda context (or absent). */
export const fromCaller = (provided) =>
  typeof provided?.getRemainingTimeInMillis === 'function' ? undefined : provided;
