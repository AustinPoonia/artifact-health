/**
 * Types for the things under `test/` and `scripts/` that ship none.
 *
 * Everything in here is for a suite or for the generator. `index.js`,
 * `lib/shape.js` and `lib/codes.js` require nothing but each other — an artifact
 * cannot reach outside its own bundle — so the shipping code needs none of this
 * and, unlike some siblings, needs no runtime global either: there is no `Buffer`
 * here, because this artifact carries no payload. A census is integers and device
 * keys, which is `lib/codes.js`'s whole argument, and base64 never enters it.
 *
 * `bare-fs` and `bare-path`, which the suites and `scripts/shape.js` use to read
 * `manifest.json` and `index.js` back off disk, ship their own `index.d.ts` and are
 * deliberately absent. Declaring them here would shadow real types with worse ones.
 */

/**
 * The test runner. `bare-tap` ships no types and `@types/bare-tap` does not exist,
 * so it is declared here — narrow, on purpose.
 *
 * Only `plan`/`pass`/`fail`, because that is the whole surface the suites use: each
 * drives its own `cases` array and reports through `t.pass`/`t.fail`, and every
 * actual assertion is `bare-assert`'s. Declaring `ok`/`equal` too would invent a
 * contract nothing here relies on and would invite a suite to assert through the
 * runner instead, which reports a plan count but not a diff.
 */
declare module 'bare-tap' {
  class TAP {
    plan (n: number): void
    pass (message?: string): void
    fail (message?: string): void
  }
  const t: TAP
  export = t
}

/**
 * `bare-assert` ships an `index.d.ts`, but an incomplete one: its runtime exports
 * `fail` and `notOk` and its declaration file lists neither. The suites here call
 * `assert.fail` in every refusal case and every one of those calls works — the gap
 * is in the types, not the code.
 *
 * An ambient module declaration shadows a package's own types wholesale, which is a
 * bigger hammer than a module augmentation; augmenting an `export =` namespace needs
 * a second module-scoped `.d.ts`, and one vendor file is worth more than a merely
 * narrower fix. To keep the shadow from being a lie it mirrors the whole runtime
 * surface rather than only the members these suites reach for.
 *
 * `fail` returns `never`, which is the truth — it always throws — and which is what
 * makes `if (!(err instanceof Error)) assert.fail(...)` narrow `err` for the rest of
 * the block. `test/artifact.test.js` reads the wording of two refusals, and a cast
 * would read `.message` off a thrown non-Error as `undefined`, turning a regression
 * into a failure that names nothing.
 */
declare module 'bare-assert' {
  function assert (value: any, message?: string | Error): void
  namespace assert {
    class AssertionError extends Error {
      constructor (opts?: { message?: string, actual?: any, expected?: any, operator?: string })
      actual?: any
      expected?: any
      operator?: string
    }
    function ok (value: any, message?: string | Error): void
    function notOk (value: any, message?: string | Error): void
    function fail (message?: string | Error): never
    function equal (actual: any, expected: any, message?: string | Error): void
    function notEqual (actual: any, expected: any, message?: string | Error): void
    function strictEqual (actual: any, expected: any, message?: string | Error): void
    function notStrictEqual (actual: any, expected: any, message?: string | Error): void
  }
  export = assert
}

/**
 * Bare's CommonJS module wrapper supplies these, the same way Node's does. They
 * turn up in `test/` and in `scripts/`: two suites read `manifest.json` to compare
 * it against `lib/shape.js` and to read `index.js` back, and the generator writes
 * it. All of them have to name a path relative to themselves, and a CJS file has no
 * `import.meta.url` to derive one from.
 */
declare const __dirname: string
declare const __filename: string

/**
 * `console`, for `scripts/shape.js`'s one line of output.
 *
 * A Bare global (bare-console) that the ES2022 lib with `"types": []` knows nothing
 * about. Only `log` is here: the script narrates what it wrote and nothing else, and
 * a declaration offering `error`, `warn` and `table` would describe a surface no
 * call site in this repo depends on.
 *
 * It is needed because `scripts/` is on the include path, which is the point —
 * `scripts/shape.js` writes `lib/shape.js` into `manifest.json`, and `manifest.json`
 * is a signed document's input that a release pins the hash of. The generator of a
 * signed artifact's bytes is a poor place for the checker to have never looked.
 */
declare const console: { log (...args: any[]): void }

/**
 * The runtime's timer, for the suite alone.
 *
 * `index.js` uses no timer and must not: an artifact that scheduled work would be
 * doing something on a device between calls, and every reading here is computed on
 * the call that asks for it. The three cases that need this are about the beat floor
 * and about an age that grows, and neither can be staged without letting real time
 * pass — a fake clock would be the suite deciding what `Date.now()` says, which is
 * the shape of crutch this suite has already been caught on once.
 *
 * The same declaration six siblings carry, and `unknown` rather than a handle type
 * for the same reason: nothing here ever cancels one.
 */
declare function setTimeout (cb: (...args: any[]) => void, ms?: number): unknown
