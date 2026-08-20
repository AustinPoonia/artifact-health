/**
 * A monitor is only a monitor if something has watched it notice.
 *
 * So the cases below are not "does it build" and "does it return an object". Every
 * one of them **makes something fail** and then asserts the failure arrives in the
 * report: a member that replicates to nobody, a member that replicates to some, a
 * store that refuses a write, an append that is refused, a feed that cannot be read
 * at all. A suite that only proved this artifact starts up would be evidence that
 * the code runs, and no evidence at all that it observes.
 *
 * ## The stub is a partitionable network, and that is the whole apparatus
 *
 * `platform:feed`'s declaration is explicit that `entries()` "merges the feeds of
 * the members this device can currently reach, so a member who is offline is absent
 * rather than empty". That sentence is the mechanism this artifact is built on, so
 * the stub has to be able to *be* partitioned — a shared array of entries, as
 * `artifact-send`'s suite uses, models a network where replication always works and
 * could not fail a single case here.
 *
 * So `network()` below keeps one log per device and each device's `entries()`
 * returns only the logs that device can currently reach. `partition(a, b)` cuts one
 * direction. That is the difference between a suite about this artifact and a suite
 * about JSON.
 *
 * Order is `(seq, device)`, as the declaration promises and as `artifact-send`'s
 * suite learned to do the hard way: a stub returning push order quietly means
 * "first" is chronological, which is a guarantee the real transport cannot make.
 */
const t = require('bare-tap')
const assert = require('bare-assert')
const fs = require('bare-fs')
const path = require('bare-path')
const health = require('..')
// The vocabulary, so the one case below that asserts a fault code is a declared one
// compares against the register rather than against a string it remembered.
const { CODES } = require('../lib/codes')

/** @type {[string, () => Promise<void> | void][]} */
const cases = []
const test = (/** @type {string} */ n, /** @type {any} */ f) => cases.push([n, f])

/**
 * What a device writes into the feed.
 *
 * A typedef rather than `any`, because three cases below push an entry directly to
 * stage a member running a different release — and with `any` a misspelled `type`
 * produces an entry the fold silently skips, giving a test that proves the artifact
 * ignores junk while claiming to prove it reads a peer's beat.
 *
 * @typedef {{ type: string, reach?: number, roster?: number, faults?: any[], at?: number }} Written
 * @typedef {{ device: string, seq: number, at: number, value: Written }} Entry
 */

/**
 * One network, with replication that can be broken.
 *
 * @param {string[]} devices
 */
function network (devices) {
  /** @type {Map<string, Entry[]>} */
  const logs = new Map(devices.map((d) => [d, []]))
  /**
   * How much of each device's log each device can currently read.
   *
   * A *frontier* per pair and not a set of reachable peers, and the difference is
   * the whole of what this suite was unable to fail before. A `Set` that
   * `partition` deleted from made a cut retroactive: everything the cut device had
   * already replicated vanished from the other's `entries()`, so a partition looked
   * exactly like a member that had never existed. Replication does not work that
   * way. A block that has arrived is on disk and stays there — `platform:feed`
   * merges "the feeds of the members this device can currently reach", and what it
   * already holds from a member it holds whether or not that member is reachable
   * now.
   *
   * So a cut freezes a frontier at the log length it had reached, and the entries
   * behind it stay visible forever. That is what lets a case stage the deficit that
   * opens *after* first contact, which is the one this artifact could not see and
   * this suite could not stage: with a `Set`, `reached` fell to zero on the cut and
   * every assertion about a monotone `reached` passed for the wrong reason.
   *
   * `Infinity` is "everything this device ever writes", which is every pair until a
   * case cuts one.
   *
   * @type {Map<string, Map<string, number>>}
   */
  const reach = new Map(devices.map((d) => [d, new Map(devices.map((o) => [o, Infinity]))]))
  /** The roster every device folds. Signed state, so it needs no reachability. */
  let roster = devices.slice()
  let clock = 1000
  /**
    * One instance per device, because one machine has one store. See `device`.
    *
    * Typed, and that is what keeps the whole suite checked: an untyped `Map` here
    * made `device()` return `any`, which propagated to every reading it hands back
    * and left every callback below with an implicit `any` parameter. A suite whose
    * subject is typed `any` is a suite the checker cannot help.
    *
    * @type {Map<string, ReturnType<typeof health.build>>}
    */
  const instances = new Map()

  return {
    logs,
    /**
     * Stop `a` from seeing anything `b` writes *from now on*. One direction,
     * because real partitions are, and not retroactive, because real ones are not.
     *
     * `a` keeps every block of `b`'s it had already replicated. A case that wants
     * `b` to have been never heard from cuts before `b` writes anything, which
     * freezes the frontier at zero and is the genuinely-unreachable member.
     */
    partition (/** @type {string} */ a, /** @type {string} */ b) {
      const s = reach.get(a)
      if (s) s.set(b, (logs.get(b) || []).length)
    },
    /** Replace the signed roster, for the case where two devices fold different logs. */
    setRoster (/** @type {string[]} */ next) { roster = next.slice() },
    /** Push an entry as a device, bypassing the artifact. Stages a peer's beat. */
    push (/** @type {string} */ device, /** @type {Written} */ value) {
      const log = logs.get(device)
      if (!log) throw new Error(`no such device ${device}`)
      log.push({ device, seq: log.length, at: clock++, value })
    },

    /**
     * One device's view of the network, as ports.
     *
     * **Memoized per device key, and that is not an optimisation.** A device is one
     * machine with one store, so two calls naming the same key must hand back the
     * same instance — building a fresh one each time gave every call a fresh store,
     * which silently disabled the duplicate-beat suppression this artifact's whole
     * feed bound rests on. A case that beat twice through two instances proved
     * nothing about the bound, and passed.
     *
     * Not memoized when a port is overridden: those cases are staging a *broken*
     * device and each wants its own.
     *
     * @param {string} me
     * @param {{ store?: any, roster?: any, feed?: any, diagnostics?: any }} [override]
     *   swaps one port for a refusing one. Named rather than a flag, because each
     *   case below refuses a *different* call and a boolean would not say which.
     *
     *   `diagnostics` is the odd one and is *additive* rather than a swap: the fixture
     *   builds with the port **absent** by default, because absent is the state every
     *   device was in before the port existed and is the state `limits()` has to keep being
     *   honest in. A case that wants the port supplies one.
     * @param {{ maxMembers?: number, beatFloor?: number }} [config]
     *   the kind's own config, as a network would sign it. Not memoized either: a case
     *   that wires a device differently wants its own device, and a shared instance
     *   built under one floor answering for another is a fixture that reports a
     *   configuration nobody set.
     */
    device (me, override = {}, config = undefined) {
      const fresh = override.store || override.roster || override.feed || override.diagnostics || config
      if (!fresh) {
        const cached = instances.get(me)
        if (cached) return cached
      }

      /** @type {Map<string, string>} */
      const kv = new Map()

      const feed = {
        who: async () => me,
        append: async (/** @type {Written} */ value) => {
          const log = logs.get(me)
          if (!log) throw new Error(`no such device ${me}`)
          const seq = log.length
          // `at` on the **entry** and never inside the value, because that is where
          // `platform:feed` puts it: `append` writes `{ at: peer.now(), value }` and
          // `merge` hands back `{ device, seq, at, value }`. This line used to spread
          // `at` into the value as well, which no substrate does, and it is why
          // `fleet().members[].at` was structurally zero for a whole release without a
          // case noticing — the fixture manufactured the one field the bug ate.
          log.push({ device: me, seq, at: clock++, value: { ...value } })
          return seq
        },
        entries: async () => {
          const visible = reach.get(me) || new Map()
          /** @type {Entry[]} */
          const out = []
          for (const [device, log] of logs) {
            // A device this network never named is not reachable at all; one that is
            // named is readable up to its frontier, which is every block until a case
            // cuts the pair and everything it had already replicated afterwards.
            const frontier = visible.has(device) ? Number(visible.get(device)) : 0
            for (const e of log) {
              if (e.seq >= frontier) break
              out.push({ ...e })
            }
          }
          return out.sort((a, b) => a.seq - b.seq || a.device.localeCompare(b.device))
        },
        own: async () => (logs.get(me) || []).map((e) => ({ ...e }))
      }

      const store = {
        get: async (/** @type {string} */ k) => (kv.has(k) ? String(kv.get(k)) : null),
        put: async (/** @type {string} */ k, /** @type {string} */ v) => { kv.set(k, v); return true },
        delete: async (/** @type {string} */ k) => kv.delete(k),
        keys: async () => [...kv.keys()].sort()
      }

      const view = {
        // The roster is folded signed state, so it is the same for every device
        // and does not go through `reach`. That is the property the artifact
        // divides by, and modelling it as reachable would delete the denominator.
        members: async () => roster.map((d) => ({ device: d, user: `user-${d}` })),
        whoami: async () => ({ device: me, member: true, user: `user-${me}` })
      }

      const built = health.build({
        feed: override.feed || feed,
        store: override.store || store,
        roster: override.roster || view,
        // Absent unless a case asks, and `undefined` rather than a stub that answers
        // zeroes: a stub answering zeroes is the reading this whole artifact argues
        // against, and putting one in the default fixture would make every case below
        // pass against a device claiming it measured something.
        diagnostics: override.diagnostics
      }, config)
      if (!fresh) instances.set(me, built)
      return built
    }
  }
}

/**
 * Beat every device twice, and the second round is the point.
 *
 * One round is not a settled fleet: the first device to beat does so before any
 * other has written anything, so its census records a reach of one for a reason
 * that has nothing to do with whatever the case is testing. A case that read those
 * numbers would be measuring the order of a `for` loop.
 *
 * Two rounds settle it — after every device has written once, the next census each
 * of them takes sees whatever it can actually reach. Real fleets are never settled,
 * which is exactly why a suite has to be deliberate about when it looks.
 *
 * @param {{ device: (k: string) => any }} net
 * @param {string[]} devices
 */
async function settle (net, devices) {
  for (const d of devices) await net.device(d).beat()
  for (const d of devices) await net.device(d).beat()
}

/* ───────────────────────── it will not build half-wired ─────────────────────── */

test('a missing port is refused by name rather than failing later', () => {
  for (const missing of ['feed', 'store', 'roster']) {
    const deps = {
      feed: { who: async () => 'a', append: async () => 0, entries: async () => [] },
      store: { get: async () => null, put: async () => true },
      roster: { members: async () => [] }
    }
    delete (/** @type {any} */ (deps))[missing]
    try {
      health.build(deps)
      assert.fail(`build without ${missing} should refuse`)
    } catch (err) {
      if (!(err instanceof Error)) assert.fail('a refusal should be an Error')
      assert.ok(err.message.includes(missing), `the refusal names ${missing}, not just "a capability"`)
    }
  }
})

/* ──────────────────── replication health: the fault really happened ─────────── */

test('a healthy network reports full reach and is not degraded', async () => {
  const net = network(['dev-a', 'dev-b', 'dev-c'])
  const a = net.device('dev-a')

  // Every member beats, so every member has written something for the others to
  // hold. Without this the roster is 3 and reach is 1 — this device and nobody
  // else — which is the *unhealthy* baseline, and is why the next case is not
  // vacuous.
  await settle(net, ['dev-a', 'dev-b', 'dev-c'])

  const l = await a.local()
  assert.equal(l.roster, 3, 'the signed roster names three')
  assert.equal(l.reached, 3, 'and this device holds something from all three')
  assert.equal(l.silent.length, 0, 'nobody is silent')
  assert.equal(l.degraded, false, 'so it is not degraded')
})

test('a member this device cannot replicate with is named, not merely counted', async () => {
  const net = network(['dev-a', 'dev-b', 'dev-c'])

  // The fault, and it is cut **before** anything replicates rather than after. This
  // case is about the member `silent` is for — one this device has never held a byte
  // from — and cutting after a settle stages a different fault entirely, the one
  // `limits()` now has a row for and `age` answers. Cutting after used to produce
  // these numbers only because the fixture's partition was retroactive.
  net.partition('dev-a', 'dev-c')
  await settle(net, ['dev-a', 'dev-b', 'dev-c'])

  const l = await net.device('dev-a').local()
  assert.equal(l.roster, 3, 'the roster is signed state and did not shrink')
  assert.equal(l.reached, 2, 'but only two members are reachable')
  assert.equal(l.degraded, true, 'which is a degraded device')
  assert.equal(l.silent.length, 1, 'exactly one member is silent')
  assert.equal(l.silent[0], 'dev-c', 'and it is named')

  const peer = l.peers.find((p) => p.device === 'dev-c')
  if (peer === undefined) assert.fail('dev-c is in the roster so it must be in peers')
  assert.equal(peer.silent, true, 'dev-c is flagged silent')
  assert.equal(peer.seq, -1, 'and holds -1 rather than 0, which would read as "one entry"')
})

test('the roster is the denominator, so an unreplicated member cannot vanish from it', async () => {
  const net = network(['dev-a', 'dev-b'])
  // Cut first, so dev-b is a member dev-a has genuinely never held anything from.
  net.partition('dev-a', 'dev-b')
  await settle(net, ['dev-a', 'dev-b'])

  const l = await net.device('dev-a').local()
  // The failure this guards: computing the roster from whoever answered would
  // report 1 of 1 reached and call a broken device healthy. That inversion is
  // the single worst thing this artifact could do.
  assert.equal(l.roster, 2, 'the roster still names two')
  assert.equal(l.reached, 1, 'and only this device is reachable')
  assert.equal(l.degraded, true, 'reported as degraded rather than as 1 of 1')
  assert.equal(l.silent[0], 'dev-b', 'and the member that vanished is named')
})

/* ───────── the operator's question: 10% of consumers, from their own beats ───── */

test('a member reporting partial reach is visible to an operator who can still hear it', async () => {
  const net = network(['dev-op', 'dev-1', 'dev-2', 'dev-3'])

  // dev-3 can reach nobody but the operator: a real partial failure, reported by
  // the device that is suffering it.
  net.partition('dev-3', 'dev-1')
  net.partition('dev-3', 'dev-2')

  await settle(net, ['dev-op', 'dev-1', 'dev-2', 'dev-3'])

  const f = await net.device('dev-op').fleet()
  assert.equal(f.roster, 4, 'four members')
  assert.equal(f.reporting, 4, 'and all four have reported a beat here')

  const worst = f.members[0]
  assert.equal(worst.device, 'dev-3', 'the worst-off member sorts first, so nobody has to scan')
  assert.equal(worst.reach, 2, 'and it reports reaching only itself and the operator')
  assert.equal(worst.roster, 4, 'out of a roster of four')
  assert.equal(f.worst, 2, 'worst is the one number to alert on')

  // The healthy members are not dragged down with it.
  const op = f.members.find((m) => m.device === 'dev-op')
  if (op === undefined) assert.fail('the operator reported a beat of its own')
  assert.equal(op.reach, 4, 'the operator itself reaches everybody')
})

test('a member that reaches nobody is silent, and is reported as silent rather than as healthy', async () => {
  const net = network(['dev-op', 'dev-1', 'dev-lost'])

  // Total partition, both directions, and from the start. `fleet().silent` is the
  // list of members that have *never* reported here, so the member it describes is
  // one that was unreachable before it ever wrote. A member cut after it had beaten
  // once stays in `members` forever with a beat that stops advancing — which is a
  // different reading, and is `age`'s.
  net.partition('dev-op', 'dev-lost')
  net.partition('dev-1', 'dev-lost')
  await settle(net, ['dev-op', 'dev-1', 'dev-lost'])

  const f = await net.device('dev-op').fleet()
  assert.equal(f.silent.length, 1, 'one member has reported nothing')
  assert.equal(f.silent[0], 'dev-lost', 'and it is named rather than dropped from the denominator')
  assert.equal(f.roster, 3, 'the roster is still three')
  assert.ok(!f.members.some((m) => m.device === 'dev-lost'), 'it is not in members, because nothing arrived')

  // And the artifact says out loud that it cannot tell this from a switched-off
  // machine, which is the honesty the whole design turns on.
  const limits = net.device('dev-op').limits()
  const partition = limits.find((x) => x.subject === 'total partition')
  if (partition === undefined) assert.fail('total partition is a declared limit')
  assert.equal(partition.observed, 'none')
})

test('a fleet row carries the writer\'s own clock, which the substrate puts on the entry', async () => {
  // The field was declared for a whole release and was structurally 0 on every row of
  // every device, because it was read off the census and no census has ever had one.
  // The suite could not see it: the fixture's `append` spread an `at` into the value,
  // which `platform:feed` does not do, so the bug was fed the field it eats.
  //
  // Nothing here injects anything. The clock comes off the entry, where `merge` puts
  // it, and the only thing asserted about its *value* is that it is a real writer's
  // clock — this device never compares it against its own, and neither should a caller.
  const net = network(['dev-a', 'dev-b'])
  await settle(net, ['dev-a', 'dev-b'])

  const f = await net.device('dev-a').fleet()
  assert.strictEqual(f.members.length, 2, 'both members reported')
  for (const m of f.members) {
    assert.ok(Number.isFinite(m.at), `${m.device} reported a non-finite clock`)
    assert.ok(m.at > 0, `${m.device} reported at: ${m.at}, which is the structural zero this fixes`)
  }

  // And it is the clock of the entry that carried that member's newest beat, rather
  // than any other entry's. Read straight out of the fixture's logs, so the assertion
  // compares the reading against the substrate and not against itself.
  for (const m of f.members) {
    const log = net.logs.get(m.device)
    if (log === undefined) assert.fail(`${m.device} has a log`)
    const last = log[log.length - 1]
    assert.strictEqual(m.at, last.at, `${m.device}'s row is not its newest entry's clock`)
  }
})

/* ─────────── the deficit that opens after first contact, which is the point ───── */

/** @param {number} ms */
const passes = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * One device's store, fresh.
 *
 * A case that wants several devices under different configs needs each to have its own,
 * because the memoized instance is bypassed by an override and a shared store would
 * carry one device's suppression into another's first beat.
 */
function memory () {
  /** @type {Map<string, string>} */
  const kv = new Map()
  return {
    get: async (/** @type {string} */ k) => (kv.has(k) ? String(kv.get(k)) : null),
    put: async (/** @type {string} */ k, /** @type {string} */ v) => { kv.set(k, v); return true },
    delete: async (/** @type {string} */ k) => kv.delete(k),
    keys: async () => [...kv.keys()].sort()
  }
}

/** @param {any} reading @param {string} device */
const peer = (reading, device) => {
  const found = reading.peers.find((/** @type {any} */ p) => p.device === device)
  if (found === undefined) assert.fail(`${device} is in the roster so it must be in peers`)
  return found
}

test('a member cut after first contact keeps a clean reach and grows an age', async () => {
  // The case the whole release exists for, and the one the suite could not stage
  // until `partition` stopped being retroactive. Nothing about `reached`, `silent` or
  // `degraded` moves — they are honest and they answer a different question — and the
  // reading an operator wanted is the one that does move.
  const net = network(['dev-a', 'dev-b', 'dev-c'])
  // A floor of 1ms, so this case's beats are about observation rather than about
  // suppression. The floor has cases of its own below.
  const a = net.device('dev-a', {}, { beatFloor: 1 })

  await net.device('dev-b').beat()
  await net.device('dev-c').beat()
  await a.beat()

  // Both peers advance and dev-a watches them do it. This is what turns a sighting
  // into an observation; before it, an age would be an invented number.
  net.push('dev-b', { type: 'beat', reach: 3, roster: 3, faults: [] })
  net.push('dev-c', { type: 'beat', reach: 3, roster: 3, faults: [] })
  await passes(4)
  await a.beat()

  // The fault: dev-b stops replicating to dev-a, having already been heard from.
  net.partition('dev-a', 'dev-b')
  net.push('dev-b', { type: 'beat', reach: 1, roster: 3, faults: [] })

  const first = await a.local()
  assert.strictEqual(first.degraded, false, 'the old reading says nothing is wrong, and is not lying')
  assert.strictEqual(first.silent.length, 0, 'nobody is silent, because dev-b was heard from')
  assert.strictEqual(peer(first, 'dev-b').silent, false, 'and dev-b in particular is not silent')

  const wasB = peer(first, 'dev-b').age
  assert.ok(typeof wasB === 'number', `dev-b has an age, got ${JSON.stringify(wasB)}`)

  // Time passes, dev-c keeps replicating, dev-b cannot.
  await passes(25)
  net.push('dev-c', { type: 'beat', reach: 3, roster: 3, faults: [] })
  await a.beat()

  const later = await a.local()
  const nowB = peer(later, 'dev-b').age
  const nowC = peer(later, 'dev-c').age
  assert.ok(typeof nowB === 'number' && typeof nowC === 'number', 'both have ages')
  assert.ok(nowB > wasB, `dev-b's age did not grow: ${wasB} then ${nowB}`)
  assert.ok(nowC < nowB,
    `the reading cannot separate a member that is replicating from one that is not: dev-c ${nowC}, dev-b ${nowB}`)

  // And the same field is on the fleet reading, which is the one an operator opens.
  const f = await a.fleet()
  const rowB = f.members.find((/** @type {any} */ m) => m.device === 'dev-b')
  if (rowB === undefined) assert.fail('dev-b is still reporting, because its old beats are still held')
  assert.ok(typeof rowB.age === 'number' && rowB.age > 0, `the fleet row has no age: ${JSON.stringify(rowB.age)}`)
})

test('the panel carries the age beside the reach, and says nothing at all when there is none', async () => {
  // The surface an operator actually reads. A member with no observed advance must not
  // get a placeholder: a dash or a zero on the line is read as a small age by everybody
  // who does not scroll to the limits block, which is the exact substitution this
  // artifact exists to refuse.
  const net = network(['dev-a', 'dev-b'])
  const a = net.device('dev-a', {}, { beatFloor: 1 })
  await net.device('dev-b').beat()
  await a.beat()

  const cold = await a.view()
  const coldText = JSON.stringify(cold.nodes)
  assert.strictEqual(/last moved/.test(coldText), false,
    'the panel claimed an age for a member this instance has never watched move')

  net.push('dev-b', { type: 'beat', reach: 2, roster: 2, faults: [] })
  await passes(4)
  await a.beat()

  const warm = await a.view()
  const rows = JSON.stringify(warm.nodes)
  assert.ok(/last moved .* ago/.test(rows), `the panel dropped the age: ${rows.slice(0, 400)}`)
  // Rounded down and worded, not a raw millisecond count on a line a person reads.
  assert.strictEqual(/last moved [0-9]+ ago/.test(rows), false, 'a bare millisecond count reached the panel')
})

test('a first sighting is not a freshness claim, so an age this instance never watched is null', async () => {
  // The trap the `moved` flag exists for. dev-b wrote long before this instance
  // started; recording "seen now" and reporting an age from it would make a member
  // nobody has heard from in a week read as perfectly fresh, which is a worse answer
  // than no answer and is the thing this artifact refuses to do.
  const net = network(['dev-a', 'dev-b'])
  net.push('dev-b', { type: 'beat', reach: 2, roster: 2, faults: [] })
  const a = net.device('dev-a', {}, { beatFloor: 1 })

  const cold = await a.local()
  assert.strictEqual(peer(cold, 'dev-b').age, null, 'nothing has been watched, so nothing has an age')
  assert.strictEqual(peer(cold, 'dev-a').age, null, 'including this device itself')

  await a.beat()
  await passes(5)
  const sighted = await a.local()
  assert.strictEqual(peer(sighted, 'dev-b').age, null,
    'one sighting is not an advance; an age here would be a number nobody measured')

  // Watched moving, and only then does it have one.
  net.push('dev-b', { type: 'beat', reach: 2, roster: 2, faults: [] })
  await a.beat()
  assert.ok(typeof peer(await a.local(), 'dev-b').age === 'number',
    'after this device watched the log move, the age is a measurement it made')
})

/* ───────────── the floor, which is what makes silence mean anything ──────────── */

test('an unchanged census is suppressed inside the floor and written once past it', async () => {
  const net = network(['dev-a'])
  const a = net.device('dev-a', {}, { beatFloor: 40 })
  const log = net.logs.get('dev-a')
  if (log === undefined) assert.fail('dev-a has a log')

  const first = await a.beat()
  assert.strictEqual(first.wrote, true, 'the first census is always new')
  const after = log.length

  const inside = await a.beat()
  assert.strictEqual(inside.wrote, false, 'nothing changed and no time passed, so nothing is written')
  assert.strictEqual(log.length, after, 'and the feed did not grow')

  await passes(60)
  const past = await a.beat()
  assert.strictEqual(past.wrote, true, 'past the floor an unchanged census is written anyway')
  assert.strictEqual(log.length, after + 1, 'exactly once')

  // And it is the *same* census, deliberately. The point of the floor is not that the
  // content changed — it did not — it is that silence has to be falsifiable, so a
  // device with nothing new to say still says it, on a bound.
  assert.strictEqual(JSON.stringify(log[after].value), JSON.stringify(log[after - 1].value),
    'the floor wrote a different census, which would mean the suppression was never the reason')
})

test('a floor of zero is the old pure-content behaviour, and is a thing a network can ask for', async () => {
  const net = network(['dev-a'])
  const a = net.device('dev-a', {}, { beatFloor: 0 })
  const log = net.logs.get('dev-a')
  if (log === undefined) assert.fail('dev-a has a log')

  await a.beat()
  const after = log.length
  await passes(30)
  assert.strictEqual((await a.beat()).wrote, false, 'switched off, no amount of time expires the suppression')
  assert.strictEqual(log.length, after, 'so the feed is bounded by change alone, as it was before')

  // And it says so. A knob that quietly removed a reading would be the thing this whole
  // operation exists to stop — the row has to say the question is unanswerable here, not
  // merely unanswered, because a member that never writes cannot be watched to stop.
  const off = a.limits().find((/** @type {any} */ x) => /after this device first heard from it/.test(x.subject))
  if (off === undefined) assert.fail('the first-contact row is unconditional')
  assert.ok(/floor switched off|indistinguishable from one that is simply healthy/.test(off.because),
    `the floor-off reason does not name what it costs: ${JSON.stringify(off.because)}`)
  assert.ok(/nothing on this device/.test(off.covered),
    `the row claims a cover this device does not have: ${JSON.stringify(off.covered)}`)

  // The same row on a device with a floor points at the field that answers it.
  const on = network(['dev-a']).device('dev-a', {}, { beatFloor: 1000 })
    .limits().find((/** @type {any} */ x) => /after this device first heard from it/.test(x.subject))
  if (on === undefined) assert.fail('the first-contact row is unconditional')
  assert.ok(/\bage\b/.test(on.covered), `the row does not name the field that covers it: ${JSON.stringify(on.covered)}`)
})

test('a config that did not say gets the default floor rather than getting it switched off', async () => {
  // The asymmetry that matters: `0` is a network asking for no floor, and a `NaN` or a
  // missing field is a config that said nothing. Reading the second as the first would
  // switch a device's heartbeat off on a typo, silently.
  const net = network(['dev-a'])
  for (const config of [undefined, {}, { beatFloor: undefined }, { beatFloor: NaN }]) {
    const a = net.device('dev-a', { store: memory() }, /** @type {any} */ (config))
    assert.strictEqual((await a.beat()).wrote, true, 'the first census is written')
    await passes(5)
    assert.strictEqual((await a.beat()).wrote, false,
      `beatFloor ${JSON.stringify(config)} did not default; five milliseconds is not five minutes`)
  }
})

test('a store written by a release that kept no clock beats once, and is in the new shape after', async () => {
  // What an in-place upgrade meets. A `1.2.x` device wrote a bare digest, so this
  // release cannot tell how old it is — and the safe reading of "cannot tell" is to
  // beat, because a device that stayed quiet on an unreadable timestamp would be a
  // device that upgraded itself into silence.
  const net = network(['dev-a'])
  /** @type {Map<string, string>} */
  const kv = new Map([['health:last-census', '1/1/']])
  const a = net.device('dev-a', {
    store: {
      get: async (/** @type {string} */ k) => (kv.has(k) ? String(kv.get(k)) : null),
      put: async (/** @type {string} */ k, /** @type {string} */ v) => { kv.set(k, v); return true },
      delete: async () => false,
      keys: async () => [...kv.keys()]
    }
  })

  const upgraded = await a.beat()
  assert.strictEqual(upgraded.wrote, true, 'a stored digest with no clock is not evidence of a recent beat')
  const stored = String(kv.get('health:last-census'))
  assert.ok(/^[0-9]+\|1\/1\/$/.test(stored), `the store was not rewritten with a clock, got ${JSON.stringify(stored)}`)

  // And from then on the floor applies normally, which is the whole point of rewriting it.
  assert.strictEqual((await a.beat()).wrote, false, 'the second call is inside the default floor')
})

test('a peer folding a different roster is reported, which is resident staleness seen from outside', async () => {
  const net = network(['dev-a', 'dev-b'])

  // dev-b beat while the roster named two. Then the roster grows — an admin
  // added a member — and dev-a re-reads it while dev-b, being resident, has not.
  await net.device('dev-b').beat()
  net.setRoster(['dev-a', 'dev-b', 'dev-new'])
  await net.device('dev-a').beat()

  const f = await net.device('dev-a').fleet()
  const b = f.members.find((m) => m.device === 'dev-b')
  if (b === undefined) assert.fail('dev-b reported a beat')
  assert.equal(b.roster, 2, 'dev-b counted two members when it beat')
  assert.equal(b.rosterDiffers, true, 'and this device can see that it is behind')

  const a = f.members.find((m) => m.device === 'dev-a')
  if (a === undefined) assert.fail('dev-a reported a beat')
  assert.equal(a.rosterDiffers, false, 'while this device agrees with itself')
})

test('what a device broadcasts agrees with what it reports about itself', async () => {
  // The two numbers used to come from two loops over the same inputs, so a device
  // could publish a reach its own local() contradicted — and an operator holding a
  // dashboard next to the machine would have two numbers for one fact and no way
  // to tell which was wrong. Pinned here, at three different degrees of breakage,
  // because a single healthy case would agree by accident.
  const net = network(['dev-a', 'dev-b', 'dev-c'])
  await settle(net, ['dev-a', 'dev-b', 'dev-c'])
  const a = net.device('dev-a')

  for (const cut of [[], ['dev-b'], ['dev-b', 'dev-c']]) {
    for (const target of cut) net.partition('dev-a', target)
    const beat = await a.beat()
    const l = await a.local()
    assert.equal(beat.reach, l.reached, `beat.reach and local().reached agree after cutting ${cut.length}`)
    assert.equal(beat.roster, l.roster, 'and so do the two denominators')
  }
})

/* ─────────────────── faults: refusals that really happened, first-person ─────── */

test('a store that refuses a write is reported as a fault, and the beat still goes out', async () => {
  const net = network(['dev-a', 'dev-b'])
  const refusing = {
    get: async () => null,
    // The wording a real port produces at the declared 64 KiB / 8 MiB bounds. It
    // is deliberately long and deliberately carries a value, so that a version of
    // this artifact which reported messages would fail the redaction suite.
    put: async () => { throw new Error('put(value) refused: this instance is at its 8 MiB ceiling') },
    delete: async () => false,
    keys: async () => []
  }
  const a = net.device('dev-a', { store: refusing })

  const before = a.faults()
  assert.equal(before.length, 0, 'nothing has gone wrong yet')

  const beat = await a.beat()
  assert.equal(beat.wrote, true, 'the beat was still appended — a monitor must not go silent because its store is full')

  const after = a.faults()
  assert.equal(after.length, 1, 'exactly one fault was recorded')
  assert.equal(after[0].code, 'store-refused', 'named from the vocabulary')
  assert.equal(after[0].count, 1, 'and counted once')

  // The count rises rather than the list growing, which is what keeps this
  // bounded by the vocabulary rather than by how long the device has been up.
  await a.beat()
  const twice = a.faults()
  assert.equal(twice.length, 1, 'still one row')
  assert.ok(twice[0].count >= 2, 'with a higher count')
})

test('a refused append is reported, and the device does not believe it reported', async () => {
  const net = network(['dev-a', 'dev-b'])
  const a = net.device('dev-a', {
    feed: {
      who: async () => 'dev-a',
      append: async () => { throw new Error('append refused: this device is not a writer on this core') },
      entries: async () => [],
      own: async () => []
    }
  })

  const beat = await a.beat()
  assert.equal(beat.wrote, false, 'nothing was written')
  // strictEqual, not equal: the kernel's `loose-equality.test.js` scans this
  // tree and refuses `assert.equal(x, null)`, because `==` accepts undefined too
  // — so a `seq` field that silently stopped being set would pass. Here that is
  // exactly the distinction worth keeping: `null` is the declared answer for "no
  // entry was written", and `undefined` would mean the field went missing.
  assert.strictEqual(beat.seq, null, 'and no sequence number is claimed')

  const f = a.faults()
  assert.ok(f.some((x) => x.code === 'append-refused'), 'the refusal is in the report')

  // The bug this guards: writing the digest before the append would suppress the
  // retry, so a device that could not report would stop trying and believe it
  // had. A second call must still attempt it.
  const again = await a.beat()
  assert.equal(again.wrote, false, 'the second attempt was made and also failed')
  const twice = f.find((x) => x.code === 'append-refused')
  if (twice === undefined) assert.fail('append-refused was recorded')
  const now = a.faults().find((x) => x.code === 'append-refused')
  if (now === undefined) assert.fail('append-refused is still recorded')
  assert.ok(now.count >= 2, 'so the fault count rose rather than the retry being suppressed')
})

test('a feed that cannot be read is a named fault, not a report of an empty network', async () => {
  const net = network(['dev-a', 'dev-b'])
  const a = net.device('dev-a', {
    feed: {
      who: async () => 'dev-a',
      append: async () => 0,
      entries: async () => { throw new Error('entries() failed: the corestore is closed') },
      own: async () => []
    }
  })

  const l = await a.local()
  // It still answers — a monitor whose reads throw reports nothing on exactly
  // the call where something was wrong.
  assert.equal(l.roster, 2, 'the roster is still readable, because it is signed state')
  assert.equal(l.reached, 1, 'and nothing has arrived but this device, which it always reaches')
  assert.notEqual(l.reached, l.roster, 'so it cannot be mistaken for a fully replicated device')
  assert.equal(l.degraded, true)

  const f = a.faults()
  assert.ok(f.some((x) => x.code === 'feed-unreachable'),
    'the reason the reading is thin is in the report, so a caller cannot read thin as healthy')
})

test('a roster that cannot be read reports no denominator rather than inventing one', async () => {
  const net = network(['dev-a', 'dev-b'])
  await net.device('dev-b').beat()

  const a = net.device('dev-a', {
    roster: {
      members: async () => { throw new Error('members() failed: no folded state for this network') },
      whoami: async () => ({ device: 'dev-a', member: true, user: 'user-a' })
    }
  })

  const l = await a.local()
  assert.equal(l.roster, 0, 'no roster means no denominator')
  assert.equal(l.silent.length, 0, 'so silence cannot be computed and is not guessed at')
  assert.equal(l.degraded, false, 'and the device does not claim a degradation it cannot measure')

  const f = a.faults()
  assert.ok(f.some((x) => x.code === 'roster-unreachable'),
    'the missing denominator is itself the reported fault')

  // The guard that matters: with no roster, every peer would "differ" and the
  // fleet view would be all false positives caused by this device's own fault.
  const fleet = await a.fleet()
  assert.ok(!fleet.members.some((m) => m.rosterDiffers),
    'nobody is accused of a stale roster by a device that has none')
})

/* ─────────────────────────── the beat is bounded ─────────────────────────────── */

test('an unchanged census is not appended twice, so a healthy feed stops growing', async () => {
  const net = network(['dev-a'])
  const a = net.device('dev-a')

  const first = await a.beat()
  assert.equal(first.wrote, true, 'the first beat is written')
  const log = net.logs.get('dev-a')
  if (log === undefined) assert.fail('dev-a has a log')
  assert.equal(log.length, 1)

  const second = await a.beat()
  assert.equal(second.wrote, false, 'the second is suppressed')
  assert.strictEqual(second.seq, null, 'and claims no sequence number')
  assert.equal(log.length, 1, 'the feed did not grow')

  // Still reports the numbers, because a caller asking "how am I" on a
  // suppressed beat is asking a reasonable question.
  assert.equal(second.roster, 1)
  assert.equal(second.reach, 1)
})

test('a census that changed is appended, so suppression cannot hide a new fault', async () => {
  const net = network(['dev-a', 'dev-b'])
  const a = net.device('dev-a')

  await net.device('dev-b').beat()
  await a.beat()
  const log = net.logs.get('dev-a')
  if (log === undefined) assert.fail('dev-a has a log')
  const wasAt = log.length

  // **A partition is not the trigger, and this case used to claim it was.** It cut
  // dev-b off and asserted a beat, and it passed only because the fixture's
  // partition was retroactive: dev-b's entry disappeared, `reach` fell from 2 to 1,
  // and the digest moved. Over a real link the block dev-a already holds stays on
  // disk, `reach` stays 2, and the digest does not move — so the cut writes nothing
  // at all. That is finding 4 as a case rather than as a paragraph, and asserting it
  // is how the suite stops being able to lie about it again.
  net.partition('dev-a', 'dev-b')
  const cut = await a.beat()
  assert.strictEqual(cut.wrote, false, 'a partition after first contact does not move the digest')
  assert.strictEqual(cut.reach, 2, 'because a block that has replicated is still held')
  assert.strictEqual(log.length, wasAt, 'so the feed did not grow')

  // What does move it: the roster growing under this device. The census now differs,
  // so the suppression must not apply — this is the case that would turn the bound
  // into a device that went quiet exactly when it had something to say.
  net.setRoster(['dev-a', 'dev-b', 'dev-new'])
  const next = await a.beat()
  assert.strictEqual(next.wrote, true, 'a changed census is written')
  assert.strictEqual(log.length, wasAt + 1, 'and the feed grew by exactly one')
  assert.strictEqual(next.roster, 3, 'reporting the roster it now folds')
  assert.strictEqual(next.reach, 2, 'and the reach it actually has')
})

test('a store that cannot be read degrades to beating rather than to silence', async () => {
  const net = network(['dev-a'])
  const a = net.device('dev-a', {
    store: {
      get: async () => { throw new Error('get() failed: the b-tree is closed') },
      put: async () => true,
      delete: async () => false,
      keys: async () => []
    }
  })

  await a.beat()
  await a.beat()
  const log = net.logs.get('dev-a')
  if (log === undefined) assert.fail('dev-a has a log')
  assert.equal(log.length, 2, 'it beat both times, because a silent monitor is the worse failure')
  assert.ok(a.faults().some((x) => x.code === 'store-unreachable'), 'and said why it is beating every time')
})

/* ─────────────────── it is not a channel: nothing a consumer says is kept ────── */

test('handle refuses every action, so the one operation a consumer can push through carries nothing', async () => {
  const net = network(['dev-a'])
  const a = net.device('dev-a')

  for (const action of ['beat', 'refresh', 'clear', 'silence', '__proto__', '']) {
    try {
      await a.handle(action, ['anything', { at: 'all' }])
      assert.fail(`handle should refuse ${JSON.stringify(action)}`)
    } catch (err) {
      if (!(err instanceof Error)) assert.fail('a refusal should be an Error')
      assert.ok(err.message.includes('no action'), 'refused by name')
    }
  }
})

test('nothing a consumer passes reaches the store, which is what closes the shared-instance channel', async () => {
  const net = network(['dev-a', 'dev-b'])
  /** @type {Map<string, string>} */
  const written = new Map()
  const a = net.device('dev-a', {
    store: {
      get: async (/** @type {string} */ k) => (written.has(k) ? String(written.get(k)) : null),
      put: async (/** @type {string} */ k, /** @type {string} */ v) => { written.set(k, v); return true },
      delete: async () => false,
      keys: async () => [...written.keys()]
    }
  })

  // Everything a consumer of either provided contract can do, with a payload a
  // consumer chose, followed by an enumeration of what was remembered.
  await a.beat()
  await a.local()
  await a.fleet()
  a.faults()
  a.limits()
  await a.view()
  try { await a.handle('anything', ['SECRET-consumer-chose-this']) } catch { /* refused, as it must be */ }

  // THREAT-MODEL.md §2.4: "if you cannot enumerate what a provider remembers
  // between calls, assume it remembers something". This is the enumeration.
  assert.equal(written.size, 1, 'exactly one key is remembered')
  const [key] = [...written.keys()]
  assert.equal(key, 'health:last-census', 'and it is the census digest, nothing else')

  const value = String(written.get(key))
  assert.ok(!value.includes('SECRET'), 'no consumer-supplied string reached the store')
  // The stronger claim: the value is this device's own clock and then a digest of
  // integers and vocabulary codes, so there is no room in it for anything a consumer
  // chose. The clock is this device's — `Date.now()` in `beat()` — and not a number any
  // consumer supplied; `beat()` takes no argument, which is the reason it cannot be.
  assert.ok(/^[0-9]+\|[0-9]+\/[0-9]+\/[a-z:,0-9-]*$/.test(value),
    `the stored value is a local clock and a digest of counts and codes only, got ${JSON.stringify(value)}`)
})

test('the operations a consumer can call twice do not change what the next caller sees', async () => {
  const net = network(['dev-a', 'dev-b'])
  await net.device('dev-b').beat()
  const a = net.device('dev-a')
  await a.beat()

  // Two consumers, one instance. Consumer A reads everything it can; consumer B
  // must see exactly what it would have seen had A never called.
  //
  // `age` is excluded from the comparison and *only* `age`, because it is the one
  // field derived from the wall clock rather than from the feed. Excluding it is not
  // a hole: what would make it a channel is a read *setting* the instant it is
  // measured from, and no read does — `observe()` is called from `beat()` alone,
  // which is on the `health` contract a `view` consumer does not hold. The assertion
  // below is the one that proves it, by beating between the two readings and
  // requiring the ages to have moved only then.
  /** @param {any} reading */
  const withoutAge = (reading) => JSON.stringify({
    ...reading,
    peers: reading.peers.map((/** @type {any} */ p) => ({ ...p, age: 'excluded' }))
  })

  const before = withoutAge(await a.local())
  for (let i = 0; i < 5; i++) {
    await a.local()
    await a.fleet()
    await a.view()
    a.faults()
  }
  const after = withoutAge(await a.local())
  assert.strictEqual(after, before, 'every read is pure, so reads cannot signal between two consumers')

  // And the excluded field is not a back door. The sharp form: let dev-b's log
  // actually advance, then read twice **without beating**. A read that recorded the
  // advance would stamp this instance's clock at the moment consumer A called, and
  // consumer B's next `age` would be a measurement of A's timing. Only `beat()` may
  // move it, and `beat()` is on a contract a panel does not hold.
  net.push('dev-b', { type: 'beat', reach: 2, roster: 2, faults: [] })
  await a.local()
  await a.fleet()
  await passes(5)
  const cold = (await a.local()).peers.filter((/** @type {any} */ p) => p.age !== null)
  assert.strictEqual(cold.length, 0,
    'a read recorded an observation, which would let one consumer time another\'s call')

  // The same advance, seen through the one operation that is allowed to record it.
  await a.beat()
  await a.beat()
  assert.ok(typeof peer(await a.local(), 'dev-b').age === 'number',
    'and beating does record it, or the field would never have a value at all')
})

/* ───────── a device can actually run this, which for three releases it could not ──── */

test('every action the command line names is a method this artifact implements', async () => {
  // The failure this catches is `artifact-linux`'s EX_SOFTWARE branch: "an app naming an
  // action it does not implement is the platform's fault to report, not the person's to
  // have typed". An adapter looks the action up by name on the instance — `deps.apps[
  // plan.action]` — so a typo here is a command that parses, resolves, and then tells a
  // person the platform is broken.
  const net = network(['dev-a'])
  const a = net.device('dev-a')
  const spec = a.cli()

  assert.strictEqual(spec.name, 'health', 'the command name is the artifact\'s')
  assert.ok(spec.commands.length > 0, 'and it offers something')
  for (const command of spec.commands) {
    assert.ok(/^[a-z][a-z-]*$/.test(command.name), `${command.name} is not a command a person can type`)
    assert.ok(command.describe.length > 0, `${command.name} has no help text`)
    assert.strictEqual(typeof (/** @type {any} */ (a)[command.action]), 'function',
      `${command.name} dispatches to ${command.action}, which this artifact does not implement`)
    // `--json` and `--help` are reserved by cli-parser@2, so nothing here may declare
    // them, and nothing here declares any option at all.
    assert.strictEqual(command.options, undefined, `${command.name} declares options; this surface takes none`)
    assert.strictEqual(command.arguments, undefined, `${command.name} takes an argument; beat() has none by design`)
  }

  // A fresh copy per call, so a caller that normalizes in place cannot poison the next.
  const once = a.cli()
  once.commands.length = 0
  assert.ok(a.cli().commands.length > 0, 'cli() handed out its own constant')
})

test('every action answers with nodes, which is the whole of what cli@2 changed', async () => {
  const net = network(['dev-a', 'dev-b'])
  await settle(net, ['dev-a', 'dev-b'])
  const a = net.device('dev-a')

  for (const command of a.cli().commands) {
    const result = await (/** @type {any} */ (a)[command.action])({}, {})
    assert.ok(Array.isArray(result && result.nodes),
      `${command.name} answered ${JSON.stringify(result)}, and cli@2 actions answer { nodes }`)
    assert.strictEqual(result.title, undefined, `${command.name} answered a title; a command line frames its own`)
    for (const node of result.nodes) {
      assert.ok(typeof node.type === 'string' && node.type.length > 0, `${command.name} emitted an untyped node`)
    }
  }
})

test('the beat command writes, tells the truth about a suppressed one, and names a refusal', async () => {
  const net = network(['dev-a'])
  const log = net.logs.get('dev-a')
  if (log === undefined) assert.fail('dev-a has a log')
  const a = net.device('dev-a', {}, { beatFloor: 300000 })

  const wrote = await a.cliBeat()
  assert.strictEqual(log.length, 1, 'the command actually appended, which is the point of having it')
  assert.ok(/Wrote a beat/.test(JSON.stringify(wrote.nodes)), `not reported as written: ${JSON.stringify(wrote.nodes)}`)
  assert.strictEqual(wrote.nodes[0].tone, 'success')

  const again = await a.cliBeat()
  assert.strictEqual(log.length, 1, 'and the second is suppressed, as the floor says')
  assert.strictEqual(again.nodes[0].tone, 'muted', 'a suppressed beat is not a failure and must not be dressed as one')
  assert.ok(/unchanged/.test(again.nodes[0].text), `it does not say why: ${JSON.stringify(again.nodes[0].text)}`)

  // A feed that refuses is `danger`, and it is the case a person typing this needs to be
  // able to tell from the quiet one.
  const broken = net.device('dev-a', {
    feed: {
      who: async () => 'dev-a',
      append: async () => { throw new Error('append() failed: the core is read-only') },
      entries: async () => [],
      own: async () => []
    }
  })
  const refused = await broken.cliBeat()
  assert.strictEqual(refused.nodes[0].tone, 'danger', 'a refused append read as an ordinary quiet beat')
  assert.ok(broken.faults().some((f) => f.code === 'append-refused'), 'and it is in the fault register')
})

test('the report command is the panel and not a second, thinner rendering of it', async () => {
  // The block a terser command-line rendering would drop to save four lines is the one
  // this artifact exists for. So `report` is `view()` with the title removed and nothing
  // else, and this is the assertion that keeps it that way.
  const net = network(['dev-a', 'dev-b'])
  await settle(net, ['dev-a', 'dev-b'])
  const a = net.device('dev-a')

  const panel = await a.view()
  const report = await a.cliReport()
  assert.strictEqual(JSON.stringify(report.nodes), JSON.stringify(panel.nodes),
    'the command line renders something the shell does not, or the other way round')
  assert.ok(/Not observed/.test(JSON.stringify(report.nodes)), 'the blind spots did not survive the command line')
})

/* ──────────────────────── the blind spots are declared ──────────────────────── */

test('limits names every one of the four things an operator will ask about', () => {
  const net = network(['dev-a'])
  const limits = net.device('dev-a').limits()

  for (const subject of ['refusals', 'fetch failures', 'zone deaths', 'total partition']) {
    const row = limits.find((x) => x.subject === subject)
    if (row === undefined) assert.fail(`${subject} is a declared blind spot and must be in limits()`)
    assert.ok(['none', 'partial'].includes(row.observed), 'observed is none or partial, never a claim of coverage')
    assert.ok(row.because.length > 0, 'and it says why')
    assert.ok(row.covered.length > 0, 'and where the fact does exist')
  }
})

test('limits declares that first contact is permanent, on a device with no port and on one with', async () => {
  // The row this artifact owes about *itself* rather than about the platform, so it must
  // be there whatever is bound. The case drives the failure rather than reading the list
  // cold: two devices settle, the link is cut, and the reading keeps saying everything is
  // fine — which is true to the declaration of `reached` and is not the question an
  // operator asked. The row is what makes the difference legible.
  const net = network(['dev-a', 'dev-b'])
  await settle(net, ['dev-a', 'dev-b'])
  net.partition('dev-a', 'dev-b')
  // dev-b keeps writing, and dev-a cannot see any of it.
  net.push('dev-b', { type: 'beat', reach: 2, roster: 2, faults: [] })
  net.push('dev-b', { type: 'beat', reach: 1, roster: 2, faults: [] })

  const a = net.device('dev-a')
  const before = await a.local()
  assert.strictEqual(before.degraded, false, 'the reading this row exists to qualify: nothing looks wrong')
  assert.strictEqual(before.silent.length, 0, 'and nobody is silent, because dev-b was heard from once')

  for (const rows of [a.limits(), net.device('dev-a', { diagnostics: journal(QUIET) }).limits()]) {
    const row = rows.find((x) => /after this device first heard from it/.test(x.subject))
    if (row === undefined) assert.fail(`no first-contact row in ${JSON.stringify(rows.map((x) => x.subject))}`)
    assert.strictEqual(row.observed, 'partial')
    assert.ok(/stays on disk|permanent/.test(row.because),
      'the reason has to name the mechanism, or a reader cannot tell it from a transient')
    assert.ok(row.covered.length > 0, 'and where the fact does exist')
  }
})

test('nothing in limits claims to be observed, which would defeat the point of the operation', () => {
  const net = network(['dev-a'])
  for (const row of net.device('dev-a').limits()) {
    assert.notEqual(row.observed, 'full', 'a limit that is fully observed is not a limit')
  }
})

/* ─────────────────────────── the panel says what it does not know ────────────── */

test('the panel renders the blind spots rather than leaving them to a caller who might not ask', async () => {
  const net = network(['dev-a', 'dev-b'])
  await net.device('dev-b').beat()
  net.partition('dev-a', 'dev-b')
  const panel = await net.device('dev-a').view()

  assert.equal(panel.title, 'Health')
  const flat = JSON.stringify(panel.nodes)
  assert.ok(flat.includes('Not observed'), 'the limits are on the panel')
  assert.ok(flat.includes('zone deaths'), 'including the one nothing can see')
  assert.ok(flat.includes('1 of 2'), 'and the reach this device actually has')

  // The tone matters: `muted` is what the vocabulary uses for the absence of
  // content, and this is content about an absence — the part a reader must not
  // skim past.
  const warnings = panel.nodes.filter((/** @type {any} */ n) =>
    n.type === 'rows' && n.label === 'Not observed')
  assert.equal(warnings.length, 1)
  for (const child of warnings[0].children) {
    assert.equal(child.tone, 'warning', 'a blind spot is a warning, not a muted aside')
  }
})

test('the panel offers no buttons, because a button is an action and handle refuses all of them', async () => {
  const net = network(['dev-a'])
  await net.device('dev-a').beat()
  const panel = await net.device('dev-a').view()

  /**
   * @param {any[]} nodes
   * @returns {any[]}
   */
  const walk = (nodes) => nodes.flatMap((/** @type {any} */ n) => [n, ...walk(Array.isArray(n.children) ? n.children : [])])
  const buttons = walk(panel.nodes).filter((/** @type {any} */ n) => n.type === 'button')
  assert.equal(buttons.length, 0,
    'a panel with a button whose action is refused would be a control nobody can press')
})

test('a device key on the panel is a code node, so a narrow frame cannot clip it', async () => {
  const net = network(['dev-a', 'dev-b'])
  await net.device('dev-a').beat()
  await net.device('dev-b').beat()
  const panel = await net.device('dev-a').view()

  /**
   * @param {any[]} nodes
   * @returns {any[]}
   */
  const walk = (nodes) => nodes.flatMap((/** @type {any} */ n) => [n, ...walk(Array.isArray(n.children) ? n.children : [])])
  const codes = walk(panel.nodes).filter((/** @type {any} */ n) => n.type === 'code').map((/** @type {any} */ n) => n.text)
  assert.ok(codes.includes('dev-b'),
    'the member key is in a code node — the one node a renderer promises never to ellipsize')
})

/* ────────── the kernel's own journal, through platform:diagnostics ─────────── */

/**
 * A `platform:diagnostics` port, at the one operation the contract declares.
 *
 * Written as a stand-in for the *port* and not for the kernel's ring, deliberately.
 * What this artifact is answerable for is what it does with an answer; whether the
 * kernel's journal really records a zone death is `ArtifactPatform`'s to prove, and
 * it does — `test/diagnostics.test.js` there drives a real boot, the real
 * `platform-diagnostics` implementation and this artifact in one process, which is
 * the only place all three are visible at once.
 *
 * @param {Record<string, number>} kinds
 * @param {number} [dropped]
 */
const journal = (kinds, dropped = 0) => ({ tally: () => ({ kinds, dropped }) })

/**
 * The nine `platform:diagnostics@2` names, as a device with nothing wrong reports them.
 *
 * `tally` and not `counts` above, for the same reason this list grew by three: the port
 * publishes both operations and this artifact's manifest declares `^2.0.0`, so `tally` is
 * the one the kernel resolves and validates. A stub answering `counts` would be testing a
 * call this release does not make.
 */
const QUIET = { fetch: 0, served: 0, refused: 0, network: 0, platform: 0, zone: 0, discovery: 0, command: 0, other: 0 }

test('an unbound diagnostics port answers "not observed" rather than seven zeroes', async () => {
  // The case that decides whether this artifact is worth having. Zero and unmeasured
  // read identically on a dashboard and mean opposite things, and a device whose
  // network never granted the port has measured nothing at all.
  const net = network(['dev-a'])
  const d = await net.device('dev-a').diagnostics()

  assert.equal(d.observed, false, 'a device with no port must not claim to have observed anything')
  assert.equal(d.kinds.length, 0, 'and must not answer a vocabulary of zeroes, which reads as health')
  assert.equal(d.dropped, 0)

  // And no fault: not being granted a port is not a failure of this device.
  const codes = net.device('dev-a').faults().map((f) => f.code)
  assert.equal(codes.includes('diagnostics-unreachable'), false,
    'an unbound port recorded a fault, which sends an operator to a machine over an admin decision')
})

test('a bound port is passed through kind for kind, with nothing renamed and nothing summed', async () => {
  const net = network(['dev-a'])
  const d = await net.device('dev-a', {
    diagnostics: journal({ ...QUIET, zone: 3, network: 5, fetch: 1 }, 12)
  }).diagnostics()

  assert.equal(d.observed, true)
  assert.equal(d.dropped, 12, 'the bound is what makes every count below a lower bound')

  const by = Object.fromEntries(d.kinds.map((k) => [k.kind, k.count]))
  assert.equal(by.zone, 3, 'the one kind that means exactly what it says')
  assert.equal(by.network, 5)
  assert.equal(by.fetch, 1)
  assert.equal(d.kinds.length, Object.keys(QUIET).length,
    'every kind the port answered is a row; a filter here would hide a newer kernel')

  // Nothing is renamed and nothing is aggregated. A `refusals` field would be this
  // artifact putting a number under a heading the kernel never promised, which is the
  // failure `limits()` exists to prevent — one layer in from where it prevents it.
  assert.equal(JSON.stringify(d).includes('refusal'), false,
    'the network count must not be re-presented as refusals')
})

test('a kind from a newer kernel arrives as a row rather than being filtered away', async () => {
  // The forward-compatibility half. This artifact does not hold a copy of the
  // vocabulary to check against, on purpose: the port already guarantees the names are
  // from a closed set and buckets anything else as `other`, so a filter in here would
  // only ever hide a kernel this release has not met.
  const net = network(['dev-a'])
  const d = await net.device('dev-a', {
    diagnostics: journal({ ...QUIET, zone: 1, secrets: 4 })
  }).diagnostics()

  const by = Object.fromEntries(d.kinds.map((k) => [k.kind, k.count]))
  assert.equal(by.secrets, 4, 'a kind this release has never heard of is reported, not dropped')
  assert.equal(by.zone, 1)
})

test('a refused port is a named fault and still answers "not observed", not zero', async () => {
  // The distinction `diagnostics-unreachable` exists for. An unbound port and a broken
  // one both answer `observed: false`; only the second is a fault, and an operator
  // reading the two the same way goes to the wrong console.
  const net = network(['dev-a'])
  const dev = net.device('dev-a', {
    diagnostics: { counts: () => { throw new Error('the port is not answering') } }
  })

  const d = await dev.diagnostics()
  assert.equal(d.observed, false, 'a refused read must not be reported as a measurement')
  assert.equal(d.kinds.length, 0)

  const codes = dev.faults().map((f) => f.code)
  assert.ok(codes.includes('diagnostics-unreachable'),
    `a refused port is a fault this device saw: ${JSON.stringify(codes)}`)
})

test('a malformed answer is not observed and is not a fault, because skew is not failure', async () => {
  // A port that answered something this release cannot read did not answer. It is also
  // not this device failing — it is two releases disagreeing about a shape — so it is
  // reported as unobserved and no fault is counted. Calling it a fault would put a
  // version skew under a heading that says the kernel is broken.
  const net = network(['dev-a'])
  for (const answer of [null, 'tally', 42, {}, { kinds: 'nine' }, { kinds: null, dropped: 1 }]) {
    const dev = net.device('dev-a', { diagnostics: { tally: () => answer } })
    const d = await dev.diagnostics()
    assert.equal(d.observed, false, `a ${JSON.stringify(answer)} answer was treated as a reading`)
    assert.equal(d.kinds.length, 0)
    assert.equal(dev.faults().length, 0, `skew was counted as a fault for ${JSON.stringify(answer)}`)
  }
})

test('a count that is not a number is floored rather than published as one', async () => {
  // Defensive across a port boundary, exactly as the roster fold is. A monitor that
  // threw on a malformed row is a monitor that stopped monitoring, and a NaN reaching a
  // field the contract declares as a number is a fault on somebody's device mid-render.
  const net = network(['dev-a'])
  const d = await net.device('dev-a', {
    diagnostics: journal({ ...QUIET, zone: /** @type {any} */ ('many'), network: /** @type {any} */ (-4) })
  }).diagnostics()

  const by = Object.fromEntries(d.kinds.map((k) => [k.kind, k.count]))
  assert.equal(by.zone, 0, 'a non-numeric count is zero, not NaN')
  assert.equal(by.network, 0, 'and a negative one is zero, because a count of events cannot be below none')
  for (const row of d.kinds) assert.equal(Number.isFinite(row.count), true, `${row.kind} is not finite`)
})

test('reading diagnostics twice does not change what the next caller sees', async () => {
  // The shared-instance question, asked of the new port. It is a pure read of a ring
  // this artifact cannot write to, so two consumers of one instance cannot signal
  // through it beyond the counts the device itself produced.
  const net = network(['dev-a'])
  const dev = net.device('dev-a', { diagnostics: journal({ ...QUIET, zone: 2 }) })

  const first = await dev.diagnostics()
  first.kinds.push({ kind: 'invented', count: 99 })
  first.observed = false
  first.dropped = 99

  const second = await dev.diagnostics()
  assert.equal(second.observed, true, 'a caller edited the next caller\'s reading')
  assert.equal(second.dropped, 0)
  assert.equal(second.kinds.length, Object.keys(QUIET).length, 'a caller added a row the next caller sees')
})

test('the fault this port can raise is in the closed vocabulary like every other', async () => {
  // The vocabulary widened for this port (`diagnostics-unreachable`), and widening it is
  // what took this contract to 1.1.0 — `lib/codes.js` says a code is read out of beats
  // written by members running other releases, so a new one is a declared change rather
  // than a patch. This is the case that would notice a call site inventing a string
  // instead: `classify` would answer `unknown` and the count would appear with no name.
  const net = network(['dev-a'])
  const dev = net.device('dev-a', {
    diagnostics: { counts: () => { throw new Error('nope') } }
  })
  await dev.diagnostics()

  const codes = dev.faults().map((f) => f.code)
  assert.equal(codes.includes('unknown'), false, 'the call site passed something outside the vocabulary')
  for (const code of codes) {
    assert.ok(CODES.includes(code), `${code} is not a declared code`)
  }
})

/* ──────── the limits list moves with the binding, which is why it is a call ──── */

test('binding the port drops the zone-deaths row and keeps the two it cannot close', () => {
  const net = network(['dev-a'])
  const bound = net.device('dev-a', { diagnostics: journal(QUIET) }).limits()
  const subjects = bound.map((x) => x.subject)

  assert.equal(subjects.includes('zone deaths'), false,
    'zone is a kind with one writer, so the count is the zone-death count; the row is not a limit any more')
  // The second row to leave, and the one this release is for. `refused` is a kind with
  // its own writers now, so the count is a refusal count in the way `zone` is a death
  // count, and a row saying otherwise would be the stale claim.
  assert.equal(subjects.includes('refusals'), false,
    'the kernel counts refusals apart from pin moves now; the row is not a limit any more')
  assert.ok(subjects.includes('fetch failures'), 'a fetch failure still tears the device down before a reader exists')
  assert.ok(subjects.includes('total partition'), 'no port touches this one')
})

test('and the one that stays says something different once the port is bound', () => {
  const net = network(['dev-a'])
  const without = net.device('dev-a').limits()
  const with_ = net.device('dev-a', { diagnostics: journal(QUIET) }).limits()

  /** @param {any[]} rows @param {string} subject */
  const row = (rows, subject) => {
    const found = rows.find((x) => x.subject === subject)
    if (found === undefined) assert.fail(`${subject} is missing from limits()`)
    return found
  }

  // The reason has to move, and this is the case that says why it is not cosmetic. It
  // has moved twice. Unbound it is "a release that cannot be fetched fails during boot".
  // Bound it used to add that the number you *can* see is mostly successes, one of them
  // the anti-rollback floor engaging — the sentence that stopped a dashboard reading a
  // defence as a fault. That hazard is gone from the kernel rather than warned about
  // here: a fetch success is a `served` and a refused rollback is a `refused`, so the
  // bound reason now has to say the opposite thing, which is that the number is right
  // and is zero for a structural reason.
  assert.notEqual(row(without, 'fetch failures').because, row(with_, 'fetch failures').because,
    'the bound and unbound reasons are identical, so one of them is not saying what the port changed')
  assert.equal(row(with_, 'fetch failures').observed, 'none',
    'a fetch count that is structurally zero must not soften this row into partial')
  assert.ok(/because this device came up/.test(row(with_, 'fetch failures').because),
    'the bound reason must say why the zero is not evidence, or a dashboard reads it as health')
  assert.equal(/rollback/.test(row(with_, 'fetch failures').because), false,
    'the rollback warning is stale: a refused rollback is no longer in the fetch count at all')

  // And the row that left has to be gone from the bound list and present on the unbound
  // one, because a device with no port really cannot see refusals.
  assert.ok(without.some((r) => r.subject === 'refusals'), 'an unbound device claims to observe refusals')
  assert.equal(with_.some((r) => r.subject === 'refusals'), false,
    'the refusals row survived the change that closed it')

  // Every row, either way, is still a blind spot rather than a claim.
  for (const rows of [without, with_]) {
    for (const r of rows) {
      assert.ok(['none', 'partial'].includes(r.observed), `${r.subject} claims ${r.observed}`)
      assert.ok(r.because.length > 0 && r.covered.length > 0, `${r.subject} is missing a reason or a cover`)
    }
  }
})

test('binding the port adds the limit it creates, rather than only removing one', () => {
  // A port can create a blind spot as well as close one, and this is the honest form of
  // that: the counts are device-wide, so they are deliberately kept out of the beat, so
  // a zone death is visible to whoever is at the device and not to the fleet. A list
  // that only ever shrank would be a list that stopped describing the device.
  const net = network(['dev-a'])
  const bound = net.device('dev-a', { diagnostics: journal(QUIET) }).limits()
  const row = bound.find((x) => /to the fleet/.test(x.subject))
  if (row === undefined) assert.fail(`no fleet row in ${JSON.stringify(bound.map((x) => x.subject))}`)
  assert.equal(row.observed, 'none')
  assert.ok(/replicates to one network/.test(row.because), 'and it says why, in terms of the feed rather than of taste')

  // Absent on a device with no port, because there the fleet row would be describing a
  // number nobody has.
  const unbound = network(['dev-b']).device('dev-b').limits().map((x) => x.subject)
  assert.equal(unbound.some((s) => /to the fleet/.test(s)), false,
    'a device with no port reported the cost of a port it does not have')
})

/* ───────────── the panel is where an operator actually meets the number ─────── */

test('the panel shows the counts, and qualifies them in the same block', async () => {
  const net = network(['dev-a'])
  const panel = await net.device('dev-a', {
    diagnostics: journal({ ...QUIET, zone: 3, network: 5, refused: 4 }, 2)
  }).view()

  /** @param {any[]} nodes @returns {any[]} */
  const walk = (nodes) => nodes.flatMap((n) => [n, ...walk(Array.isArray(n.children) ? n.children : [])])
  const all = walk(panel.nodes)

  const block = all.find((n) => n.type === 'rows' && /journal/.test(String(n.label)))
  if (block === undefined) assert.fail(`no journal block on the panel: ${JSON.stringify(panel.nodes)}`)

  const fields = Object.fromEntries(block.children.map((/** @type {any} */ c) => [c.label, c.value]))
  assert.equal(fields.zone, '3', 'the count an operator came for')
  assert.equal(fields.network, '5')
  assert.equal(fields.refused, '4', 'the count this release added, on the surface an operator reads')
  assert.equal(fields['dropped by the bound'], '2',
    'in the same block as the counts, because it is what makes every one of them a lower bound')

  // The sentence that stops `network: 5` being read as five refusals, and it is a
  // warning rather than a muted aside for the same reason the blind spots are. It also
  // has to say the new thing, because `fetch: 0` on this panel is the number most likely
  // to be read as good news.
  const note = all.find((n) => n.type === 'text' && /network is still several things/.test(String(n.text)))
  if (note === undefined) assert.fail('the panel shows a network count with nothing saying what it is not')
  assert.equal(note.tone, 'warning', 'the qualification is the part a reader must not skim')
  assert.ok(/every network it has joined/.test(note.text), 'and it discloses the scope')
  assert.ok(/takes the boot down/.test(note.text),
    'a fetch count of zero on a running device is not good news and the panel has to say so')
})

test('a device with no port shows no journal block at all, and still shows the blind spot', async () => {
  // The panel half of the first case in this section. Seven zeroes under a heading
  // would be a measurement nobody took, printed on the one surface an operator reads,
  // two nodes above a limits() line saying the opposite.
  const net = network(['dev-a'])
  const panel = await net.device('dev-a').view()
  const flat = JSON.stringify(panel.nodes)

  assert.equal(/journal/.test(flat), false, 'a device with no port drew a journal block')
  assert.ok(flat.includes('zone deaths'), 'and the blind spot is still on the panel where the count is not')
})

/* ───────────────── it formats nothing, the way every artifact here must ──────── */

test('this artifact contains no alignment padding of its own', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'index.js')).toString()
  // The same claim the kernel holds `send` to: an artifact does not know how wide
  // a terminal is, so a run of spaces used to line something up is a renderer's
  // job done in the wrong place. Only string literals are examined — prose in a
  // comment legitimately contains double spaces after a full stop.
  const literals = source.match(/'[^'\n]*'|`[^`\n]*`/g) || []
  for (const lit of literals) {
    assert.ok(!/\S {2,}\S/.test(lit), `a literal aligns something: ${lit}`)
  }
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
