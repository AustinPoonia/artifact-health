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
  /** Who each device can currently read from. Everybody, until a case cuts it. */
  const reach = new Map(devices.map((d) => [d, new Set(devices)]))
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
    /** Stop `a` from seeing `b`'s log. One direction, because real partitions are. */
    partition (/** @type {string} */ a, /** @type {string} */ b) {
      const s = reach.get(a)
      if (s) s.delete(b)
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
     * @param {{ store?: any, roster?: any, feed?: any }} [override]
     *   swaps one port for a refusing one. Named rather than a flag, because each
     *   case below refuses a *different* call and a boolean would not say which.
     */
    device (me, override = {}) {
      const fresh = override.store || override.roster || override.feed
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
          log.push({ device: me, seq, at: clock++, value: { ...value, at: clock } })
          return seq
        },
        entries: async () => {
          const visible = reach.get(me) || new Set()
          /** @type {Entry[]} */
          const out = []
          for (const [device, log] of logs) {
            if (!visible.has(device)) continue
            for (const e of log) out.push({ ...e })
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
        roster: override.roster || view
      })
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
  await settle(net, ['dev-a', 'dev-b', 'dev-c'])

  // The fault. `dev-a` can no longer read `dev-c`'s log, which is exactly what a
  // replication failure looks like through this port: absent, not empty.
  net.partition('dev-a', 'dev-c')

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
  await settle(net, ['dev-a', 'dev-b'])
  net.partition('dev-a', 'dev-b')

  const l = await net.device('dev-a').local()
  // The failure this guards: computing the roster from whoever answered would
  // report 1 of 1 reached and call a broken device healthy. That inversion is
  // the single worst thing this artifact could do.
  assert.equal(l.roster, 2, 'the roster still names two')
  assert.equal(l.reached, 1, 'and only this device is reachable')
  assert.equal(l.degraded, true, 'reported as degraded rather than as 1 of 1')
  assert.equal(l.silent[0], 'dev-b', 'and the member that vanished is named')
})

/* ──────────────── the §6b question: 10% of consumers, from their own beats ───── */

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
  await settle(net, ['dev-op', 'dev-1', 'dev-lost'])

  // Total partition, both directions. This is the limit `limits()` declares.
  net.partition('dev-op', 'dev-lost')
  net.partition('dev-1', 'dev-lost')

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

test('a peer folding a different roster is reported, which is Phase 5 staleness seen from outside', async () => {
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

  // The change: dev-b stops replicating to dev-a. The census now differs, so the
  // suppression must not apply — this is the case that would turn the bound into
  // a device that went quiet exactly when it had something to say.
  net.partition('dev-a', 'dev-b')
  const next = await a.beat()
  assert.equal(next.wrote, true, 'a changed census is written')
  assert.equal(log.length, wasAt + 1, 'and the feed grew by exactly one')
  assert.equal(next.reach, 1, 'reporting the reduced reach')
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
  // The stronger claim: the digest is integers and vocabulary codes, so there is
  // no room in it for anything a consumer chose.
  assert.ok(/^[0-9]+\/[0-9]+\/[a-z:,0-9-]*$/.test(value),
    `the digest is counts and codes only, got ${JSON.stringify(value)}`)
})

test('the operations a consumer can call twice do not change what the next caller sees', async () => {
  const net = network(['dev-a', 'dev-b'])
  await net.device('dev-b').beat()
  const a = net.device('dev-a')
  await a.beat()

  // Two consumers, one instance. Consumer A reads everything it can; consumer B
  // must see exactly what it would have seen had A never called.
  const before = JSON.stringify(await a.local())
  for (let i = 0; i < 5; i++) {
    await a.local()
    await a.fleet()
    await a.view()
    a.faults()
  }
  const after = JSON.stringify(await a.local())
  assert.equal(after, before, 'every read is pure, so reads cannot signal between two consumers')
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
