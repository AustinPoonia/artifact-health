/**
 * Nothing this artifact did not author reaches the feed.
 *
 * This is the suite that matters most, because the failure it guards is the one
 * failure here that cannot be fixed afterwards. A `platform:feed` is append-only, it
 * replicates to every member running the artifact, and its own declaration says the
 * platform gives authenticity and never confidentiality. So a secret that reaches a
 * beat is on every member's disk, permanently, by design rather than by anybody being
 * compromised. There is no delete.
 *
 * `ArtifactPatform/lib/journal.js` can afford to carry free text behind a regex
 * because it "lives in memory and dies with the process", and it says in as many words
 * that the regex "is the second line of defence and must never be the first". Here
 * there is no process to die, so the first line has to be structural: **there is no
 * field on a beat an unbounded string can enter.** These cases are what make that a
 * measured property rather than an intention.
 *
 * ## Every case pushes a real secret through a real path
 *
 * Not "does `safe` redact a string" — that would test the filter and miss the point.
 * Each case below hands the artifact a port that behaves the way a real port behaves
 * when it fails, with a plausible secret in the place a real one would be: a bearer
 * token in a refusal message, a 64-byte key in a thrown error, a device secret in a
 * member record. Then it reads the entire feed back and asserts the secret is not in
 * it. The assertion is over the *whole* serialized log rather than over a field,
 * because a field-by-field assertion cannot catch a leak through a field somebody
 * adds next year.
 */
const t = require('bare-tap')
const assert = require('bare-assert')
const health = require('..')
const { CODES, classify, safe, WIDTH } = require('../lib/codes')

/** @type {[string, () => Promise<void> | void][]} */
const cases = []
const test = (/** @type {string} */ n, /** @type {any} */ f) => cases.push([n, f])

/**
 * Strings that must never appear in a beat, each shaped like the real thing.
 *
 * Lengths matter. `SHORT_SECRET` is deliberately *below* the 80-character threshold
 * `KEYISH` uses, because the whole argument of `lib/codes.js` is that this artifact
 * must not depend on that filter — a design that only passed with long secrets would
 * be one that leaked every short one. `journal.js`'s own header lists exactly this as
 * a limit of the regex approach.
 */
const SECRETS = {
  /** 128 hex characters: a 64-byte secret key, the form `KEYISH` is calibrated to catch. */
  keyMaterial: 'a'.repeat(128),
  /** A bearer token as an authorization header carries one. Below the threshold. */
  bearer: 'Bearer sk-live-4f9c2e1d8a7b',
  /** Short enough that no length-based filter would ever see it. */
  shortSecret: 'hunter2',
  /** Base64 with `+` and `/`, which journal.js names as a form its regex misses. */
  base64ish: 'aGVsbG8+d29ybGQvc2VjcmV0Kzoo=='
}

/**
 * A device whose ports fail while carrying a secret, and the log it wrote.
 *
 * @param {{ storePut?: boolean, storeGet?: boolean, append?: boolean, entries?: boolean, roster?: boolean, diagnostics?: 'poisoned' | 'refusing' }} breaks
 */
function leaky (breaks = {}) {
  /** @type {any[]} */
  const log = []
  /** @type {Map<string, string>} */
  const kv = new Map()

  // Every refusal below carries a secret, the way a real refusal that interpolated
  // its argument would. This is the accident journal.js says has actually happened
  // here: "an error message that interpolated a keypair, a JSON.stringify of the
  // wrong object".
  const boom = (/** @type {string} */ what) => {
    throw new Error(`${what} refused with token ${SECRETS.bearer} key ${SECRETS.keyMaterial} pw ${SECRETS.shortSecret} b64 ${SECRETS.base64ish}`)
  }

  const feed = {
    who: async () => 'dev-a',
    append: async (/** @type {any} */ value) => {
      if (breaks.append) boom('append')
      log.push({ device: 'dev-a', seq: log.length, at: 5000 + log.length, value })
      return log.length - 1
    },
    entries: async () => {
      if (breaks.entries) boom('entries')
      return log.map((e) => ({ ...e }))
    },
    own: async () => log.map((e) => ({ ...e }))
  }

  const store = {
    get: async (/** @type {string} */ k) => {
      if (breaks.storeGet) boom('get')
      return kv.has(k) ? String(kv.get(k)) : null
    },
    put: async (/** @type {string} */ k, /** @type {string} */ v) => {
      if (breaks.storePut) boom('put')
      kv.set(k, v)
      return true
    },
    delete: async () => false,
    keys: async () => [...kv.keys()]
  }

  const roster = {
    members: async () => {
      if (breaks.roster) boom('members')
      // A member record carrying more than the artifact should report. The real
      // `platform:network-view` returns objects, and a future field on one is
      // exactly how a value nobody meant to publish becomes reachable.
      return [
        { device: 'dev-a', user: `user-${SECRETS.shortSecret}`, secret: SECRETS.keyMaterial },
        { device: 'dev-b', user: 'user-b', token: SECRETS.bearer }
      ]
    },
    whoami: async () => ({ device: 'dev-a', member: true, user: `user-${SECRETS.shortSecret}` })
  }

  /**
   * A `platform:diagnostics` port behaving worse than the real one is able to.
   *
   * The real port projects onto a closed vocabulary and answers a closed object, so a
   * journal string cannot become a key in its answer and `contract.validate` would
   * refuse one if it did — `platform-diagnostics/test/conformance.test.js` is where that
   * is proved. This fixture supplies the answer anyway, with secrets in the *kind names*
   * and in the values, because the substrate on the other side of that port is a ring of
   * sentences written by authors this device's owner did not choose, and this artifact
   * must not be the only thing standing between them and a feed.
   *
   * `SECRETS.shortSecret` is deliberately **not** one of the poisoned kind names, and
   * that absence is a finding rather than an oversight. `hunter2` is shaped exactly like
   * a kind — lowercase, short — so no check an artifact can perform distinguishes it from
   * a name a newer kernel invented, and the only honest guarantee is the port's closed
   * vocabulary. Putting it here and asserting it never appears would be asserting a
   * property this layer does not have; `index.js`'s `KIND` states the limit in the same
   * breath as the guard.
   *
   * `refusing` is the other half: a port whose error carries the secret, which is the
   * accident `journal.js` names as having actually happened in this tree.
   */
  const diagnostics = breaks.diagnostics === 'refusing'
    ? { tally: () => boom('tally') }
    : {
        tally: () => ({
          kinds: {
            fetch: 0,
            served: 0,
            refused: 1,
            network: 1,
            platform: 0,
            zone: 2,
            discovery: 0,
            command: 0,
            other: 0,
            [`leaked-${SECRETS.keyMaterial}`]: 3,
            [SECRETS.bearer]: 4,
            [SECRETS.base64ish]: 6
          },
          dropped: 0
        })
      }

  return {
    instance: health.build({
      feed,
      store,
      roster,
      diagnostics: breaks.diagnostics === undefined ? undefined : diagnostics
    }),
    log,
    kv
  }
}

/** Every secret, checked against one blob of text. @param {string} text @param {string} where */
function assertClean (text, where) {
  for (const [name, secret] of Object.entries(SECRETS)) {
    assert.ok(!text.includes(secret), `${where} leaked ${name}`)
  }
}

/* ─────────── the whole feed, after every path that can fail, is clean ────────── */

test('a store refusal carrying a bearer token does not reach the feed', async () => {
  const { instance, log, kv } = leaky({ storePut: true })
  await instance.beat()

  assert.ok(log.length > 0, 'a beat was written, or this case proves nothing')
  assertClean(JSON.stringify(log), 'the feed')
  assertClean(JSON.stringify([...kv]), 'the store')

  // And the fault is still reported — redaction that worked by dropping the fault
  // would be silence dressed as safety.
  const f = instance.faults()
  assert.ok(f.some((x) => x.code === 'store-refused'), 'the fault is reported, as a code')
  assertClean(JSON.stringify(f), 'the fault report')
})

test('a refused append carrying key material does not reach the feed or the store', async () => {
  const { instance, log, kv } = leaky({ append: true })
  await instance.beat()

  assert.equal(log.length, 0, 'nothing was appended, because the append was refused')
  assertClean(JSON.stringify([...kv]), 'the store')
  assertClean(JSON.stringify(instance.faults()), 'the fault report')
  assert.ok(instance.faults().some((x) => x.code === 'append-refused'), 'and the refusal is named')
})

test('an unreadable feed carrying a secret in its error does not put it into the next beat', async () => {
  const { instance } = leaky({ entries: true })
  await instance.beat()
  await instance.local()
  await instance.fleet()

  assertClean(JSON.stringify(instance.faults()), 'the fault report')
  assertClean(JSON.stringify(await instance.local()), 'local()')
  assertClean(JSON.stringify(await instance.fleet()), 'fleet()')
})

test('an unreadable roster carrying a secret in its error stays out of every surface', async () => {
  const { instance, log } = leaky({ roster: true })
  await instance.beat()

  assertClean(JSON.stringify(log), 'the feed')
  assertClean(JSON.stringify(instance.faults()), 'the fault report')
  assertClean(JSON.stringify(await instance.view()), 'the panel')
})

test('a member record carrying fields this artifact must not report is stripped to the device key', async () => {
  const { instance, log } = leaky()
  await instance.beat()
  await instance.beat()

  // The roster hands back `user`, `secret` and `token` on its member records. Only
  // `device` is read, so none of the rest can travel — and the assertion is over
  // the whole feed rather than over the fields this version happens to write.
  assertClean(JSON.stringify(log), 'the feed')

  const l = await instance.local()
  assertClean(JSON.stringify(l), 'local()')
  for (const p of l.peers) {
    assert.equal(Object.keys(p).sort().join(' '), 'age beats device seq silent',
      'a peer record carries five fields and none of them is a user id')
  }
})

test('no user id reaches any surface, though one is reachable through whoami', async () => {
  const { instance, log } = leaky()
  await instance.beat()

  const everything = JSON.stringify([
    log, await instance.local(), await instance.fleet(), instance.faults(), await instance.view()
  ])
  // Replication is a fact about devices. A user id would add nothing to the
  // diagnosis, and a field that buys no diagnosis does not go into a permanent
  // broadcast. `whoami` is bound and deliberately unread.
  assert.ok(!everything.includes('user-'), 'no user id anywhere, on any surface')
})

/* ────────────────── the beat's shape is what makes the above hold ───────────── */

test('a beat carries only integers, a type tag, and vocabulary codes', async () => {
  const { instance, log } = leaky({ storeGet: true })
  await instance.beat()
  assert.ok(log.length > 0, 'something was written')

  for (const entry of log) {
    const v = entry.value
    assert.equal(v.type, 'beat', 'the one string field is a fixed tag')
    assert.equal(typeof v.reach, 'number')
    assert.equal(typeof v.roster, 'number')
    assert.ok(Array.isArray(v.faults), 'faults is a list')

    // The only strings on a beat besides the tag are fault codes, and every one
    // has to be a member of the vocabulary. This is the assertion that fails if
    // somebody ever adds a `message` field in a hurry.
    for (const [code, count] of v.faults) {
      assert.ok(CODES.includes(code), `${JSON.stringify(code)} is in the vocabulary`)
      assert.equal(typeof count, 'number', 'and is paired with a count')
    }

    const strings = JSON.stringify(v).match(/"[^"]*"/g) || []
    for (const s of strings) {
      const bare = s.slice(1, -1)
      assert.ok(
        bare === 'beat' || bare === 'type' || bare === 'reach' || bare === 'roster' ||
        bare === 'faults' || bare === 'at' || CODES.includes(bare),
        `a beat carries no string outside the vocabulary, found ${s}`
      )
    }
  }
})

test('the census digest in the store is counts and codes, with nowhere for a string to sit', async () => {
  const { instance, kv } = leaky({ storeGet: false })
  await instance.beat()

  assert.equal(kv.size, 1, 'one key')
  const value = String([...kv.values()][0])
  // `<clock>|<digest>`. The clock is this device's own `Date.now()` at the beat, which is
  // not a value any caller supplied — `beat()` takes no argument, which is the reason it
  // cannot be — and the digest is unchanged: counts and codes, with nowhere for a string
  // to sit. Both halves are asserted, because the store is the one thing this instance
  // remembers between calls and §2.4 asks for it to be enumerable.
  assert.ok(/^[0-9]+\|[0-9]+\/[0-9]+\/[a-z:,0-9-]*$/.test(value),
    `the stored value matches a local clock and a digest of counts and codes only, got ${JSON.stringify(value)}`)
})

/* ──── the journal's free text, which is the one substrate this feed must not meet ──── */

test('nothing a diagnostics port answers reaches the feed, however it is shaped', async () => {
  // The case that would be a security bug rather than a gap. A beat is append-only,
  // replicates to every member and is never deletable, and on the other side of this
  // port is a ring of sentences the device's owner did not write. So what is asserted is
  // not that the port is careful — it is that a beat carries nothing from it at all,
  // even when the port hands over the worst answer it could.
  const { instance, log, kv } = leaky({ diagnostics: 'poisoned' })

  const d = await instance.diagnostics()
  assert.equal(d.observed, true, 'the fixture is not answering, so this case would prove nothing')

  await instance.beat()
  assert.ok(log.length > 0, 'something was written')

  assertClean(JSON.stringify(log), 'the feed')
  assertClean(JSON.stringify([...kv.entries()]), 'the store')

  // Not only the secrets: no *count* and no kind name either, because the leak worth
  // catching is the well-intentioned one — somebody folding the numbers into a census to
  // make them visible to the fleet. They are device-wide and a beat is one network's.
  const written = JSON.stringify(log)
  assert.equal(written.includes('zone'), false, 'a journal kind reached the feed')
  assert.equal(written.includes('dropped'), false, 'the ring\'s bound reached the feed')
  assert.equal(written.includes('leaked-'), false, 'a journal-shaped key reached the feed')
})

test('a refused diagnostics port puts its wording nowhere, only its code', async () => {
  const { instance, log, kv } = leaky({ diagnostics: 'refusing' })

  const d = await instance.diagnostics()
  assert.equal(d.observed, false)

  await instance.beat()
  assertClean(JSON.stringify(log), 'the feed after a refused diagnostics read')
  assertClean(JSON.stringify([...kv.entries()]), 'the store')

  // The fault is a code, and the code is the declared one. `attempt` never looks at the
  // thrown value, which is the property that makes this hold for a message nobody
  // predicted rather than only for the four in SECRETS.
  const codes = instance.faults().map((/** @type {any} */ f) => f.code)
  assert.ok(codes.includes('diagnostics-unreachable'), JSON.stringify(codes))
  for (const code of codes) assert.ok(CODES.includes(code), `${code} is not declared`)
})

test('a name that cannot be a kind is collapsed rather than carried, however it is shaped', async () => {
  // The second line, and it is a *shape* rather than a list. A vocabulary copy in here
  // would go stale against the kernel's and hide a kind from a newer runtime, which is
  // the one outcome this artifact is arranged against; a shape refuses everything that
  // cannot be a kind while letting an unfamiliar one through. Every form `lib/codes.js`
  // names is refused by it, which is what this case measures.
  const { instance } = leaky({ diagnostics: 'poisoned' })
  const d = await instance.diagnostics()

  const names = d.kinds.map((/** @type {any} */ k) => k.kind)
  const joined = names.join(' ')
  for (const [name, secret] of Object.entries(SECRETS)) {
    if (name === 'shortSecret') continue // shaped like a kind; see `leaky`'s note and `KIND`
    assert.equal(joined.includes(secret), false, `a kind name carried ${name}: ${joined}`)
  }

  assert.ok(names.includes('unnamed'), `nothing collapsed: ${joined}`)
  assert.equal(names.filter((/** @type {string} */ n) => n === 'unnamed').length, 1,
    'three unusable names must land in one row, or the row count is attacker-chosen')

  // The three that were poisoned carried 3, 4 and 6, and the sum is what survives —
  // counted rather than dropped, for the reason a dropped fault is the failure this repo
  // exists to stop.
  const row = d.kinds.find((/** @type {any} */ k) => k.kind === 'unnamed')
  assert.equal(row.count, 13, `the collapsed counts were lost: ${JSON.stringify(d.kinds)}`)

  for (const name of names) {
    assert.ok(name.length <= WIDTH, `a kind name is ${name.length} characters, past the bound`)
  }

  // And the kinds the kernel really does write are untouched by the collapse.
  const by = Object.fromEntries(d.kinds.map((/** @type {any} */ k) => [k.kind, k.count]))
  assert.equal(by.zone, 2)
  assert.equal(by.network, 1)
})

test('the panel carries no journal wording either, which is the surface a person reads', async () => {
  const { instance } = leaky({ diagnostics: 'poisoned' })
  const panel = await instance.view()
  assertClean(JSON.stringify(panel), 'the panel')
})

/* ───────────────── the vocabulary is closed, and closes on purpose ──────────── */

test('classify admits every declared code and nothing else', () => {
  for (const code of CODES) {
    assert.equal(classify(code), code, `${code} is admitted unchanged`)
  }

  // Everything a hurried call site might pass. Each must become `unknown` — a
  // fault an operator can see — rather than a new vocabulary entry nobody declared.
  const smuggled = [
    `boom ${SECRETS.keyMaterial}`,
    SECRETS.bearer,
    SECRETS.shortSecret,
    'store-refused ' + SECRETS.bearer,
    'STORE-REFUSED',
    'store_refused',
    '',
    null,
    undefined,
    42,
    { code: 'store-refused' },
    ['store-refused'],
    new Error(SECRETS.bearer)
  ]
  for (const value of smuggled) {
    const got = classify(value)
    assert.equal(got, 'unknown', `${JSON.stringify(String(value))} is not admitted`)
    assert.ok(CODES.includes(got), 'and the answer is always in the vocabulary')
  }
})

test('classify can never return a string outside the vocabulary, whatever it is handed', () => {
  // The property, rather than a list of examples: this is what lets index.js pass
  // an arbitrary value to `fault()` without that being a hole.
  for (const value of [Symbol.iterator.toString(), () => 'x', Infinity, NaN, -0, true, false]) {
    assert.ok(CODES.includes(classify(value)), `classify(${String(value)}) stayed in the vocabulary`)
  }
})

test('a fault recorded from an unclassifiable value is counted rather than dropped', async () => {
  const { instance } = leaky()
  // Reached through the real path: a store that throws something that is not an
  // Error at all, which no `code` in the vocabulary describes.
  const odd = health.build({
    feed: { who: async () => 'dev-a', append: async () => 0, entries: async () => [], own: async () => [] },
    store: {
      get: async () => { throw 'a bare string, not an Error' }, // eslint-disable-line no-throw-literal
      put: async () => true,
      delete: async () => false,
      keys: async () => []
    },
    roster: { members: async () => [{ device: 'dev-a' }], whoami: async () => ({ device: 'dev-a' }) }
  })
  await odd.beat()
  const f = odd.faults()
  assert.ok(f.length > 0, 'a dropped fault is the failure this whole repo exists to stop')
  for (const x of f) assert.ok(CODES.includes(x.code), `${x.code} is in the vocabulary`)

  assert.ok(instance !== odd, 'two instances, so the counters above are not shared')
})

/* ───────────────── the second line of defence, fired on purpose ─────────────── */

test('safe redacts key material, so the one string that is carried is guarded too', () => {
  // journal.js's calibration, held here: 80 sits above every public encoding and
  // below every secret one. A device key has to survive — a census is a list of
  // them — and a secret key must not.
  assert.equal(safe('dev-a'), 'dev-a', 'a short key passes through')
  const publicKey = 'b'.repeat(52)
  assert.equal(safe(publicKey), publicKey, 'a 52-character z-base32 public key survives, as it must')
  const hexPublic = 'c'.repeat(64)
  assert.equal(safe(hexPublic), hexPublic, 'and so does a 64-character hex public key')

  assert.ok(!safe(SECRETS.keyMaterial).includes(SECRETS.keyMaterial), 'a 128-character secret does not')
  assert.equal(safe(SECRETS.keyMaterial), '<redacted>', 'it is replaced rather than truncated')
})

test('safe bounds width, because a bounded count of unbounded strings is not a bound', () => {
  // The device key field is a key, not a paragraph. A member record carrying prose
  // where a key belongs must not put prose on the feed.
  const prose = 'x y '.repeat(200)
  assert.ok(safe(prose).length <= WIDTH, `bounded to ${WIDTH}, got ${safe(prose).length}`)
})

test('masking happens before truncation, which is the order journal.js argues for', () => {
  // The other order lets a long string ending in a secret pass the length check by
  // being cut — right up until the day the string was short enough to keep. Here:
  // a secret that starts inside the width and runs past it.
  const straddling = 'k'.repeat(WIDTH + 40)
  const out = safe(straddling)
  assert.ok(!out.includes('k'.repeat(80)), 'no 80-character run survives the cut')
  assert.equal(out, '<redacted>', 'it was masked whole, then found short enough to keep')
})

test('a device key arriving as something other than a key is redacted rather than published', async () => {
  // The path: a feed entry whose `device` is not a device key. It is authenticated
  // by the platform in production, so this should never happen — which is why it is
  // fired on purpose rather than assumed.
  /** @type {any[]} */
  const log = [{ device: SECRETS.keyMaterial, seq: 0, at: 1, value: { type: 'beat', reach: 1, roster: 1, faults: [] } }]
  const instance = health.build({
    feed: { who: async () => SECRETS.keyMaterial, append: async () => 0, entries: async () => log, own: async () => log },
    store: { get: async () => null, put: async () => true, delete: async () => false, keys: async () => [] },
    roster: { members: async () => [{ device: SECRETS.keyMaterial }], whoami: async () => ({ device: 'dev-a' }) }
  })

  const l = await instance.local()
  assertClean(JSON.stringify(l), 'local()')
  assert.equal(l.device, '<redacted>', 'this device\'s own key was masked')
  assertClean(JSON.stringify(await instance.fleet()), 'fleet()')
  assertClean(JSON.stringify(await instance.view()), 'the panel')
})

t.plan(cases.length)
;(async () => {
  for (const [name, fn] of cases) {
    try {
      await fn()
      t.pass(name)
    } catch (err) {
      t.fail(`${name}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
})()
