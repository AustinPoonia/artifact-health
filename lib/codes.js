/**
 * The closed vocabulary a fault is reported in, and the reason it is closed.
 *
 * `ArtifactPatform/lib/journal.js` is the kernel's device-local diagnostic ring
 * and it is the right model for two of three decisions here. It takes three
 * strings rather than an options object so there is no way to call it that runs an
 * arbitrary value through `String()`; it redacts anything that looks like key
 * material as a **second** line of defence, stating plainly that the first line is
 * that "`note()` takes reasons rather than values"; and it bounds twice, on count
 * and on width, because a bounded count of unbounded strings is not a bound.
 *
 * ## The one place this artifact must be stricter than the kernel's journal, and why
 *
 * The journal "lives in memory and dies with the process". This artifact's reports
 * go into a `platform:feed`, and the difference is the whole design:
 *
 *   - A feed is **append-only**. There is no operation that removes an entry. A
 *     secret written here is written for the lifetime of the network.
 *   - A feed **replicates**. `platform:feed`'s own declaration says every member
 *     running the artifact replicates it and that addressing an entry to somebody
 *     is a filter they apply, not a route. So a leak is not a leak onto one disk,
 *     it is a leak onto every member's disk, and it arrives there by design rather
 *     than by anybody being compromised.
 *   - A feed is **not confidential**. The same declaration: what the platform
 *     gives is authenticity and never confidentiality.
 *
 * So the journal's arrangement — free text, filtered — is not available here. A
 * regex that catches the accident is exactly right for a ring buffer that dies in
 * 400ms and is exactly wrong for a permanent broadcast, because the failure mode
 * it admits (the journal's own header lists three: a secret split across two
 * calls, a base64 form with `+` or `/` early in it, a 40-byte secret from some
 * future scheme) is a failure mode that would be unfixable rather than transient.
 *
 * **Therefore: no free text reaches the feed at all.** A fault is one of the
 * strings below. There is no field on a beat that an unbounded string can enter,
 * which is a structural property rather than a filtered one — `classify` maps an
 * arbitrary thrown value to a member of `CODES` and cannot return anything else,
 * so the failure mode "somebody added a `message` field in a hurry" fails
 * `test/redaction.test.js` rather than shipping.
 *
 * Rejected: reporting the message and relying on a `KEYISH` filter, on the grounds
 * that the kernel does it. The kernel does it to a buffer that dies with the
 * process, and it says in as many words that the filter "is the second line of
 * defence and must never be the first". Here there is no process to die and the
 * filter would be the first line.
 *
 * Also rejected: a code plus a bounded 40-character "hint" carved out of the
 * message. Forty characters is enough for a bearer token from several schemes in
 * use, the truncation would be applied to a string this artifact did not write,
 * and "bounded" is a claim about length rather than about content. A short secret
 * is still a secret.
 *
 * ## The price, said in the same breath
 *
 * A code is coarser than a message. An operator reading `store-refused` learns
 * that this instance's store refused a write and does not learn which key, how
 * large the value was, or what the store's wording was. That is a real loss of
 * diagnostic precision and it is paid deliberately: the fuller reason exists on
 * the device, in the kernel's journal, for whoever is standing at the machine —
 * which is the party that is allowed to see it. Observability that travels is
 * coarse; observability that is precise stays put. Conflating the two is how a
 * fleet dashboard becomes the place every device's secrets are collected.
 *
 * `ponytail:` the vocabulary is a literal list, so a fault this artifact has not
 * anticipated arrives as `unknown` and an operator sees a count with no name on
 * it. Widening it is a version of this contract rather than a patch, because every
 * member reads these strings out of beats written by members running other
 * releases. The upgrade path is the ordinary one — a second entry in the
 * declaration list, not an edit to the first — and the trigger is the first real
 * deployment that reports a material number of `unknown`.
 */

/**
 * Every code a beat may carry.
 *
 * Frozen, and exported as the register rather than as a convenience: `index.js`
 * looks a code up here before it counts it, so a typo in a call site becomes
 * `unknown` — visible and counted — instead of a new vocabulary entry nobody
 * declared. `test/redaction.test.js` asserts that every code a fault can carry is
 * a member of this list, which is the assertion that makes the whole argument
 * above a property rather than an intention.
 *
 * The members, and what each one means for whoever is reading a dashboard:
 *
 *   `feed-unreachable`  — `entries()` threw. This device could not read the merged
 *                         log at all, so *every* other reading in the same call is
 *                         suspect. It is first in the list because it is the one
 *                         fault that invalidates the rest of the report rather
 *                         than adding to it.
 *   `roster-unreachable`— `platform:network-view` threw. Without the roster there
 *                         is no denominator, so `silent` cannot be computed and is
 *                         reported empty rather than guessed at.
 *   `store-refused`     — a write to `platform:store` was refused. The declared
 *                         bounds are 512-byte keys, 64 KiB values and 8 MiB per
 *                         instance, and this instance writes one small key, so in
 *                         practice this means the store is full or the substrate
 *                         is unhappy. It matters because the store is what
 *                         suppresses duplicate beats, so a refused store means the
 *                         feed starts growing again.
 *   `store-unreachable` — a read from `platform:store` threw. Degrades to beating
 *                         every call rather than to silence, which is the right
 *                         way round.
 *   `append-refused`    — `feed.append()` was refused or threw. This device cannot
 *                         report, so its own beats stop arriving anywhere and the
 *                         fleet will see it as silent. The one fault a reader of
 *                         *this* device's report can see and a reader of the fleet
 *                         cannot.
 *   `unknown`           — a thrown value this artifact could not classify. Counted
 *                         rather than dropped, because a dropped fault is the
 *                         failure this whole repo exists to stop.
 *
 * @type {readonly string[]}
 */
const CODES = Object.freeze([
  'feed-unreachable',
  'roster-unreachable',
  'store-refused',
  'store-unreachable',
  'append-refused',
  'unknown'
])

/** Membership as a set, so `classify` is a lookup rather than a scan. */
const KNOWN = new Set(CODES)

/**
 * Map a code this artifact's own call sites name to a code the vocabulary admits.
 *
 * The identity function on a correct call site, which is the point: it exists so
 * that the *only* way a string reaches a fault record is through a check against
 * `CODES`. A call site that passes anything else — a message it caught, a template
 * literal, a misspelling — gets `unknown`, and `unknown` is a fault an operator can
 * see rather than a silent pass.
 *
 * The limit, in the same breath: this cannot tell a misspelling from a genuinely
 * novel fault, so both arrive as `unknown` and the register above is the only
 * place the difference is written down. That is the accepted cost of a vocabulary
 * with no escape hatch — an escape hatch is the thing being refused.
 *
 * @param {unknown} code
 * @returns {string}  a member of `CODES`, always
 */
function classify (code) {
  return typeof code === 'string' && KNOWN.has(code) ? code : 'unknown'
}

/**
 * A run of alphanumerics too long to be anything but key material.
 *
 * Deliberately the same 80-character threshold and the same calibration argument
 * as `ArtifactPatform/lib/journal.js`: this platform's public encodings are 32
 * bytes — 64 hex characters, 52 in z-base32 — and its secret ones are 64 bytes,
 * which is 128 hex or 103 in z-base32. 80 sits above every public form and below
 * every secret one, so a device key survives (it has to; a census is a list of
 * them) and a device secret key does not.
 *
 * **Reimplemented rather than imported, and that is forced rather than chosen.**
 * An artifact runs in a realm with no filesystem and `require` of anything outside
 * its own bundle throws by construction, so `journal.js` is unreachable from here
 * and always will be. The duplication is real; the alternative is not a shared
 * module, it is an artifact with no second line of defence.
 *
 * **And here it genuinely is the second line, not the first.** In the kernel this
 * regex guards free text. Here the first line is that there is no free-text field
 * on a beat — `classify` above is the whole of what a fault carries. This exists
 * for the strings that do legitimately reach a record: device keys, which come off
 * `entry.device` and are public by construction. If one of those is ever
 * something other than a public key, this catches it. It should never fire, and
 * `test/redaction.test.js` fires it on purpose so that "should never" is measured
 * rather than assumed.
 */
const KEYISH = /[0-9a-zA-Z]{80,}/g

/** A device key, not a paragraph. z-base32 of 32 bytes is 52; this leaves room and refuses prose. */
const WIDTH = 64

/**
 * One device key, bounded and stripped of anything that looks like key material.
 *
 * Truncation happens *after* masking, for `journal.js`'s reason stated in its own
 * `_safe`: the other order would let a long string ending in a secret pass the
 * length check by being cut, right up until the day the string was short enough to
 * keep.
 *
 * @param {unknown} text
 * @returns {string}
 */
function safe (text) {
  const out = String(text).replace(KEYISH, '<redacted>')
  return out.length > WIDTH ? out.slice(0, WIDTH) : out
}

module.exports = { CODES, classify, safe, WIDTH }
