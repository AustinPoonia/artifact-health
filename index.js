/**
 * What this device can see of the network's replication, reported as an artifact.
 *
 * `ROADMAP.md` §6b: logging and metrics are the second thing that must not be
 * kernel code, and the kernel keeps only `journal.js` and gains nothing. So this
 * is an artifact, in a realm, holding nothing but declared ports, and the
 * interesting question is not how to write it — it is **what is actually reachable
 * from in here**, because a monitor that answers a question it cannot measure is
 * worse than no monitor.
 *
 * ## The four things §6b names, and which of them exist from inside a realm
 *
 * §6b asks for "replication health, refusals, fetch failures and zone deaths". One
 * of those four is fully reachable, one is reachable in a single degenerate form,
 * and two are not reachable at all. That is not a shortfall in this file; it is a
 * fact about the port surface, and `limits()` returns it as data so that no
 * dashboard bound to this contract ever shows a zero nobody measured.
 *
 * **1. Replication health — reachable, and genuinely.** `platform:feed`'s own
 * declaration is what makes it so: `entries()` "merges the feeds of the members
 * this device can currently reach, so a member who is offline is absent rather
 * than empty", and `own()` "needs no network and is complete". Set that against
 * `platform:network-view`'s `members()`, which is the *signed* roster and does not
 * depend on reachability at all, and the difference between the two is exactly a
 * replication deficit. A numerator that needs the network and a denominator that
 * does not is the whole mechanism, and it is first-person and exact — `local()`.
 *
 * `fleet()` is the second half and it is the one §6b actually asks for. Every
 * device beats its own census into the feed, so an operator reading the feed sees
 * each member's *own* account of how much of the network it can reach. "With no
 * central log, how would the team learn replication is failing for 10% of
 * consumers" is answered by 10% of the beats saying `reach: 2, roster: 20` while
 * the rest say 20 of 20. That is a real answer with a real limit, stated in
 * `limits()` and worth stating here too: **a member that reaches nobody reports to
 * nobody.** Total partition is indistinguishable from a switched-off machine, and
 * no artifact-side design can fix that, because the report and the failure travel
 * on the same wire. Partial failure — which is what "10% of consumers" describes —
 * is fully visible. Total failure shows up as silence, which is a weaker signal
 * than a number and is still a signal.
 *
 * **2. Refusals — not reachable, and structurally so.** `Assembly.refusals`,
 * `device.networks[].refused` and `device.update.fellBack` are the kernel's
 * surfaces and no `platform:*` declaration exposes any of them;
 * `platform:network-view` answers members, groups and permission grants out of
 * folded signed state and says nothing about what was refused. But the missing
 * port is the smaller half of the argument. **A refusal is by definition the thing
 * that stopped an artifact from being built, so the artifact that would report it
 * is the one that may not exist** — and in the worst case the refused artifact is
 * this one. A monitor cannot be the reporter of the event that prevents monitors
 * from running. `journal.js`'s own header makes the same point one level up about
 * a failed `boot()`: "every one of those surfaces evaporates", which is why the
 * journal is an object the *caller* owns.
 *
 * What this artifact does report is refusals **of its own calls** — a store that
 * refuses a write, an append that is refused — and it labels them first-person
 * rather than letting them read as the device's. That distinction is the whole
 * value; a fault count that mixed "my store is full" with "this device refused an
 * artifact at boot" would be a number with two meanings.
 *
 * **3. Fetch failures — not reachable in the sense §6b means.** The failure §6b
 * has in mind is `bootNetwork`'s `source.fetch` throwing `Unavailable` — a release
 * that could not be found — and `journal.js` exists partly to record which
 * artifact a fetch last failed on. That happens before any artifact code runs, on
 * the path where `boot()` throws and takes every surface with it. Unreachable for
 * the same structural reason as refusals.
 *
 * `platform:blobs` would surface a *content* fetch failure — `get()` answering
 * null means no member is holding the bytes — and that port is deliberately **not
 * declared here**. A blob store is scoped `@blobs:<artifact>`, so this artifact's
 * blobs are its own and it puts nothing in them; the only fetch failures it could
 * observe would be of content it never fetched. Declaring a port to report an
 * empty category is how a monitor comes to look more capable than it is, so the
 * port is absent and `limits()` says why.
 *
 * **4. Zone deaths — not reachable, with one degenerate exception that is worth
 * having.** `Zones.deaths` is an instance whose thread died after `build`, and
 * `journal.js` records that nothing in `lib/` has ever subscribed: "a zone death
 * is invisible on every surface this device has". There is no port for it, and
 * again the structure is the deeper objection — an observer of a death must
 * outlive it, which is the kernel and not a peer artifact in another zone. If
 * *this* artifact's zone dies it cannot report its own death.
 *
 * The exception: a device whose health zone died stops beating, so the fleet sees
 * it go silent at the beat interval. That is exactly one zone's death — this one's
 * — observed from outside, by absence, indistinguishable from the machine being
 * off. It is reported as `partial` rather than as coverage, because calling it
 * coverage would be the dishonesty this whole header is arranged against.
 *
 * **The kernel change that would close 2, 3 and 4** is one port, and it is not
 * this artifact's to build: a `platform:diagnostics@1` that reads back the
 * kernel's own `Journal` — which already exists, is already bounded, and already
 * redacts. It would be read-only, it would need scoping in `chain.js`'s `NATIVE`
 * table, and it carries a real risk this artifact deliberately does not: the
 * journal holds free text, so a port onto it would hand an artifact strings the
 * device's owner did not write, and this file's whole redaction argument
 * (`lib/codes.js`) says why that must not be forwarded to a feed. So it is a
 * kernel change with a design question inside it rather than something to
 * half-build here, and until it exists the honest report is three names in
 * `limits()`.
 *
 * `ponytail:` **three of the four things §6b asks for are not observed, and this is
 * the ceiling that says so in one place.** The upgrade path is the read-only
 * `platform:diagnostics@1` above — a port onto the kernel's existing `Journal`,
 * scoped in `chain.js`'s `NATIVE` table — and the design question that comes with it
 * is that the journal holds free text, so the port would hand an artifact strings the
 * device's owner did not write and `lib/codes.js` forbids forwarding those to a feed.
 * A first cut that resolves both: the port answers *counts per `kind`* rather than
 * entries, which is a shape this artifact could publish under its existing vocabulary
 * without carrying one character of the journal's text. The trigger is the first fleet
 * deployment where a refusal or a fetch failure had to be diagnosed by someone walking
 * to a machine. Not registered in `ROADMAP.md`'s debt ledger, and that is the scope
 * rule rather than an omission: the ledger covers the kernel, `artifact-net`,
 * `artifact-protocol` and the `platform-*` repos, and for an `artifact-*` repo the
 * comments are the register.
 *
 * ## Why this is not a side channel, decided rather than hoped
 *
 * `ROADMAP.md` 4f and `THREAT-MODEL.md` §2: one instance per kind means a provider
 * bound by two consumers is one object serving both, and any state it keeps
 * between calls is a two-way channel between artifacts the realm boundary
 * otherwise keeps strangers. An observability artifact is the exact shape that
 * becomes that by accident, and this one is bindable by two consumers for real —
 * it provides `view@1.1.0`, and both `artifact-app`'s `app` kind and
 * `artifact-ui`'s `shell` kind port `view` at cardinality `many`.
 *
 * Four decisions close it, and the first is the one that matters:
 *
 *   1. **No consumer input is ever remembered.** Every operation but `beat()` is a
 *      pure read, `beat()` takes no argument, and `handle()` refuses every action
 *      rather than dispatching any. §2.1's channel requires the provider to
 *      remember something a consumer *put there*; there is no operation here that
 *      accepts a value to remember. This is why the contract has no `note`, no
 *      `silence` and no `clear` — each of those would be the channel.
 *
 *   2. **The state that is kept is a function of inputs both consumers already
 *      have.** The store holds one digest of this device's last census. A census
 *      is computed from the feed and the roster, and every member running this
 *      artifact can read both. So a second consumer reading anything this instance
 *      remembers learns nothing it could not have computed itself — which is the
 *      test §2.4 asks for ("if you cannot enumerate what a provider remembers
 *      between calls, assume it remembers something"). It is enumerable: one
 *      digest, and the fault counters below.
 *
 *   3. **Refusing to accept reports is what costs the coverage.** This is the
 *      honest statement of the trade. The obvious design for §6b is a `diagnostic`
 *      contract other artifacts bind and report into, which would reach faults
 *      this artifact cannot otherwise see — and it is precisely §2.1's channel,
 *      with every artifact on the device wired to one stateful provider. So the
 *      coverage gap in `limits()` is not an oversight that a bit more work would
 *      close; **it is the price of not being a channel**, and the way to buy the
 *      coverage back is the kernel port named above, not a mailbox in here.
 *
 *   4. **`instances: "explicit"`.** The kind runs only where a signed
 *      `instance.create` names it, which is §2.4's "one lever on this residual
 *      that does not cost a binding per consumer" and is also what makes this
 *      opt-in per network rather than something a device runs because the code is
 *      on disk. A monitor that appeared wherever it was installed would be a
 *      device deciding to report on itself, and that decision is the network's.
 *
 * The residual, because there is one. The fault counters are per-instance state,
 * and two consumers share them: consumer A can make `store-refused` appear by
 * filling the store, and consumer B can see the count. That is a low-bandwidth
 * channel and it is §2.1 rather than something new — every stateful provider has
 * it. It is bounded by what the codes can express (six counters), it carries no
 * value A chose, and the closure is the one §2.3 names: sign two instances. Worth
 * knowing rather than worth hiding.
 *
 * ## Redaction, and the one asymmetry with the kernel's journal
 *
 * `lib/codes.js` holds the argument in full. The short form: `journal.js` may
 * carry free text filtered by a regex because it "lives in memory and dies with
 * the process", and a feed is append-only, replicating and permanent, so the same
 * arrangement would make an accident unfixable and fleet-wide. Therefore **no free
 * text reaches a beat at all** — a fault is a code from a closed list, a census is
 * integers and device keys, and there is no field on the record an unbounded
 * string can enter. The regex is still here as a second line over the one string
 * that is legitimately carried (a device key, which every feed entry already
 * carries authenticated), which is where `journal.js` says such a filter belongs.
 *
 * A consequence worth stating: user ids are reachable — `whoami()` answers one —
 * and are not reported. Replication is a fact about devices, a user id would add
 * nothing to the diagnosis, and a field that buys no diagnosis does not go into a
 * permanent broadcast.
 *
 * ## What a beat costs, and the bound on it
 *
 * A feed is append-only, so a monitor that beats on a timer grows the network's
 * storage forever whether or not anything is wrong. So a beat is **suppressed when
 * the census has not changed**: a healthy fleet writes one beat per device and
 * then stops, and growth is driven by change rather than by time. The digest that
 * makes that possible is the one thing in the store, and the store is what carries
 * it across a restart of the resident process.
 */
const shape = require('./lib/shape')
const { CODES, classify, safe } = require('./lib/codes')

module.exports = {
  /**
   * @param {Record<string, any>} deps    one entry per bound port, and nothing else
   * @param {Record<string, any>} [config]
   */
  build (deps, config) {
    for (const required of ['feed', 'store', 'roster']) {
      if (!deps[required]) throw new Error(`health requires the ${required} capability`)
    }

    /**
     * The key the last census digest is written under.
     *
     * One key, and the store's declared bound is 512 bytes for a key and 64 KiB
     * for a value, so this instance uses a rounding error of its 8 MiB. That is
     * deliberate: a monitor that could fill its own store would be a monitor whose
     * failure mode is the fault it exists to report.
     */
    const DIGEST = 'health:last-census'

    const settings = {
      /**
       * Members whose beats are read per call.
       *
       * A bound rather than a preference. `entries()` is every member's entries
       * for this artifact and this artifact is on every device in the network, so
       * the fold below is O(entries) on a log that only grows — and the one thing
       * a monitor must not do is become the reason a device is slow. Only the
       * latest beat per member is ever used, so the fold keeps one record per
       * device and the cost is bounded by the roster rather than by the log.
       */
      maxMembers: (config && config.maxMembers) || 4096
    }

    /**
     * Faults this instance has seen, by code.
     *
     * In-memory and per-instance, which means they reset when the zone restarts.
     * That is the right lifetime and not a shortcut: a fault count that survived a
     * restart would have to live in the store, and a monotonic counter in a
     * durable store is the one write pattern that grows without bound while
     * holding no live data. The count that matters to an operator is "is this
     * happening now", and the beat carries it to the feed, which is the durable
     * record.
     *
     * @type {Map<string, { count: number, at: number }>}
     */
    const faults = new Map()

    /**
     * Record a fault, first-person, as a code.
     *
     * Takes a code and never a thrown value. `classify` is what makes that a
     * property rather than a convention — a call site that passed a caught
     * `err.message` would get `unknown`, so the failure mode is a visibly
     * unnamed fault rather than an error message on its way to a replicated log.
     *
     * @param {unknown} code  expected to be a member of `CODES`
     */
    function fault (code) {
      const key = classify(code)
      const seen = faults.get(key)
      if (seen) {
        seen.count++
        seen.at = Date.now()
      } else {
        faults.set(key, { count: 1, at: Date.now() })
      }
    }

    /**
     * Run one port call, converting a refusal into a counted fault.
     *
     * The fallback is returned rather than thrown on, because a monitor whose
     * reads throw is a monitor that reports nothing on exactly the call where
     * something was wrong. `local()` answering "the feed is unreachable and here
     * is what I know without it" is strictly better than `local()` propagating the
     * refusal to a shell that prints one line and exits.
     *
     * The limit, in the same breath: this means a caller cannot tell a degraded
     * reading from a clean one by whether the call threw. That is why every
     * reading is accompanied by `faults()` and why `feed-unreachable` is first in
     * the vocabulary — it is the fault that invalidates the rest of the report
     * rather than adding to it, and a caller that ignores `faults()` will read a
     * thin answer as a healthy one.
     *
     * @template T
     * @param {() => Promise<T>} call
     * @param {string} code    the vocabulary entry for this call failing
     * @param {T} fallback
     * @returns {Promise<T>}
     */
    async function attempt (call, code, fallback) {
      try {
        return await call()
      } catch {
        // The thrown value is deliberately not looked at. Reading `err.message`
        // here is how a port's wording — or an argument interpolated into it —
        // starts travelling towards the feed, and `lib/codes.js` is the argument
        // for why nothing in this file is allowed to want it.
        fault(code)
        return fallback
      }
    }

    /**
     * The signed roster, as device keys.
     *
     * `platform:network-view`'s `members()` is folded signed state, so it needs no
     * peer to be reachable and is the denominator every reading here divides by.
     * When it is unreachable there is no denominator, and the readings below
     * report an empty roster rather than substituting the devices they happened to
     * hear from — which would turn "I can reach nobody" into "everybody I can
     * reach is fine", the exact inversion this artifact exists to prevent.
     *
     * @returns {Promise<string[]>}
     */
    async function roster () {
      const members = await attempt(() => deps.roster.members(), 'roster-unreachable', /** @type {any[]} */ ([]))
      if (!Array.isArray(members)) return []
      /** @type {string[]} */
      const out = []
      for (const m of members) {
        // A member record's device field, defensively: this crosses a port and
        // `members()` is declared to return objects, but a monitor that throws on
        // a malformed row is a monitor that stops monitoring.
        const device = m && typeof m === 'object' ? m.device : m
        if (typeof device === 'string' && device.length > 0) out.push(safe(device))
      }
      return out.sort()
    }

    /**
     * What this device holds from each member, and each member's latest beat.
     *
     * One pass over `entries()`, keeping one record per device. Every entry in
     * this artifact's feed is a beat this artifact wrote, so "the latest entry
     * from a device" and "the latest beat from a device" are the same thing —
     * which is what keeps this fold to one record per member rather than a window.
     *
     * A malformed value is counted as reach and ignored as a beat. That is the
     * right way round: the entry's `device` is authenticated by the platform, so
     * its arrival is evidence of replication whatever its payload says, while its
     * payload is written by whatever release that member is running and may be a
     * shape this one does not know.
     */
    async function held () {
      const entries = await attempt(() => deps.feed.entries(), 'feed-unreachable', /** @type {any[]} */ ([]))

      /** @type {Map<string, { seq: number, beats: number, beat: any }>} */
      const byDevice = new Map()
      if (!Array.isArray(entries)) return byDevice

      for (const entry of entries) {
        if (!entry || typeof entry !== 'object') continue
        if (typeof entry.device !== 'string' || entry.device.length === 0) continue
        const device = safe(entry.device)

        let row = byDevice.get(device)
        if (!row) {
          if (byDevice.size >= settings.maxMembers) continue
          row = { seq: -1, beats: 0, beat: null }
          byDevice.set(device, row)
        }

        const seq = Number(entry.seq)
        if (Number.isFinite(seq) && seq > row.seq) row.seq = seq

        const v = entry.value
        if (!v || typeof v !== 'object' || v.type !== 'beat') continue
        row.beats++
        // Last one wins. `entries()` is declared to arrive in (seq, device)
        // order, and within one device that is its own log order, so the last
        // beat seen from a device is that device's newest. Not sorted on `at`,
        // which is the writer's clock and which the feed's declaration says
        // never to sort on.
        row.beat = v
      }

      return byDevice
    }

    /**
     * Everything a reading here is computed from, fetched once.
     *
     * Three port calls, in parallel, shared by `census`, `local` and `fleet` so
     * that one call to any of them cannot report a roster from one instant against
     * a log from another.
     */
    async function snapshot () {
      const [members, byDevice, me] = await Promise.all([
        roster(),
        held(),
        attempt(() => deps.feed.who(), 'feed-unreachable', '')
      ])
      return { members, byDevice, me: safe(me) }
    }

    /**
     * Whether this device holds anything from one member.
     *
     * **This device always reaches itself, whether or not it has ever appended**,
     * and that is a correction rather than a convenience. Reaching yourself is not
     * a replication fact — no bytes cross a wire — so making it conditional on
     * having written something measures the wrong thing twice over.
     *
     * It was conditional, and a suppression case caught it. A device's first beat
     * was computed before that beat existed, so it counted itself unreached and
     * wrote `reach: 0`; its second beat then saw the first one on its own log and
     * wrote `reach: 1`. Two different censuses from an unchanged network, which
     * meant **the duplicate-suppression never engaged on the first duplicate** and
     * every device in a healthy fleet appended twice before settling. On an
     * append-only log that is not a cosmetic error.
     *
     * It also fixes the reading an operator sees. With self always counted, `reach`
     * is at least 1 for a live device, so `reach: 1` reads as "I can see nobody but
     * myself" — the unambiguous shape of total partition — and `reach: 0` is
     * reserved for the genuinely different case where the roster could not be read
     * at all and there is no denominator.
     *
     * @param {string} me
     * @param {string} device
     * @param {{ seq: number } | undefined} row
     */
    function reaches (me, device, row) {
      return device === me || (row !== undefined && row.seq >= 0)
    }

    /**
     * One roster member per row, with what this device holds from it.
     *
     * **Shared by `census` and `local` on purpose, and it was not to begin with.**
     * Each computed its own reach from the same two inputs, in two loops, which
     * meant a device could broadcast a `reach` its own `local()` disagreed with —
     * an operator comparing a dashboard against the machine in front of them would
     * see two numbers for one fact and have no way to tell which was wrong. A
     * mutation to one loop left the other passing, which is how the divergence was
     * found. One function, so the beat and the first-person reading cannot differ.
     *
     * @param {string[]} members
     * @param {Map<string, { seq: number, beats: number, beat: any }>} byDevice
     * @param {string} me
     */
    function reading (members, byDevice, me) {
      const peers = members.map((device) => {
        const row = byDevice.get(device)
        return {
          device,
          seq: row ? row.seq : -1,
          beats: row ? row.beats : 0,
          // Not `!row`: this device is never silent to itself, and `reaches` holds
          // the argument for why that is a correction and not a special case.
          // `seq` is still reported as it stands, so a device that has never
          // beaten shows -1 here while counting as reached — the two fields answer
          // different questions and must not be collapsed.
          silent: !reaches(me, device, row)
        }
      })
      const silent = peers.filter((p) => p.silent).map((p) => p.device)
      return { peers, silent, reached: peers.length - silent.length }
    }

    /**
     * This device's census, as the numbers a beat carries.
     *
     * Integers and nothing else, which is the redaction argument as code: there is
     * no field on this object a string can enter, so there is nothing for a
     * message to leak through. The fault list is pairs of (code, count) drawn from
     * a six-member vocabulary, so it is bounded in length as well as in content.
     */
    async function census () {
      const { members, byDevice, me } = await snapshot()
      const reach = reading(members, byDevice, me).reached

      return {
        type: 'beat',
        reach,
        roster: members.length,
        // Sorted by code so that two censuses with the same content produce the
        // same digest regardless of the order faults happened to be recorded in.
        // Without this a beat would be "changed" every time two faults arrived in
        // a different order, which is a feed growing on noise.
        faults: [...faults.entries()]
          .map(([code, seen]) => [code, seen.count])
          .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
      }
    }

    /**
     * A census as one comparable string.
     *
     * Hand-rolled rather than `JSON.stringify` of the object: `stringify` would
     * include `type` and would depend on key insertion order, and this string is
     * compared against one written by a possibly older release of this artifact.
     * A digest whose stability depends on a field nobody meant to include is a
     * digest that changes on an unrelated edit and starts a fleet beating.
     *
     * @param {{ reach: number, roster: number, faults: any[][] }} c
     */
    function digest (c) {
      return `${c.reach}/${c.roster}/${c.faults.map((f) => `${f[0]}:${f[1]}`).join(',')}`
    }

    return {
      /**
       * Append one census, unless it is the one already written.
       *
       * The suppression is the bound on an append-only log, and the store is what
       * makes it survive a restart of the resident process. A store that cannot be
       * read degrades to beating — `store-unreachable` is counted and the beat goes
       * ahead — because the failure a monitor must not have is silence.
       */
      async beat () {
        const c = await census()
        const now = digest(c)

        const last = await attempt(() => deps.store.get(DIGEST), 'store-unreachable', null)
        if (last === now) {
          return { wrote: false, seq: null, reach: c.reach, roster: c.roster }
        }

        let seq = null
        try {
          seq = await deps.feed.append(c)
        } catch {
          // Counted, and then returned rather than thrown. A device that cannot
          // append cannot report, and the one thing it can still do is answer
          // this call honestly to whoever is standing at it.
          fault('append-refused')
          return { wrote: false, seq: null, reach: c.reach, roster: c.roster }
        }

        // After the append, never before. The other order would record a census
        // as written on a call where the append was refused, and the next call
        // would suppress the retry — a device that stopped reporting and believed
        // it had.
        await attempt(() => deps.store.put(DIGEST, now), 'store-refused', false)

        return {
          wrote: true,
          seq: typeof seq === 'number' ? seq : null,
          reach: c.reach,
          roster: c.roster
        }
      },

      /**
       * This device's own replication health.
       *
       * The reading that does not depend on any peer: the roster is folded signed
       * state and what has arrived is local. It is therefore the one to trust when
       * `fleet()` is thin, and the two disagreeing is itself information — a thin
       * fleet view with a healthy `local()` means other members are not beating,
       * while a thin `local()` means this device is not replicating.
       */
      async local () {
        const { members, byDevice, me } = await snapshot()
        const { peers, silent, reached } = reading(members, byDevice, me)

        return {
          device: me,
          roster: members.length,
          reached,
          silent,
          peers,
          degraded: silent.length > 0
        }
      },

      /**
       * Every member's own account of what it can reach.
       *
       * This is §6b's question answered. A member reporting `reach: 2, roster: 20`
       * is telling the network about its own partial failure, and that report
       * arrives as long as it can reach anybody at all. `worst` is the one number
       * to alert on.
       *
       * `rosterDiffers` is the reading that is not about replication and is worth
       * having anyway: two members folding the same signed log count the same
       * number of members, so a disagreement means one of them is acting on state
       * it has not re-read. `ROADMAP.md` Phase 5 registers exactly that as a
       * property of the resident process — "a resident device stops re-reading its
       * logs" for up to five minutes, so an expulsion or a raised pin arrives only
       * at the next boot — and calls it a security property rather than a
       * performance one. A stale device cannot see its own staleness; a peer can.
       */
      async fleet () {
        const { members, byDevice } = await snapshot()
        const mine = members.length

        const reporting = []
        for (const [device, row] of byDevice) {
          if (!row.beat) continue
          const reach = Number(row.beat.reach)
          const theirRoster = Number(row.beat.roster)
          reporting.push({
            device,
            reach: Number.isFinite(reach) ? reach : 0,
            roster: Number.isFinite(theirRoster) ? theirRoster : 0,
            faults: Array.isArray(row.beat.faults) ? row.beat.faults.length : 0,
            at: Number.isFinite(Number(row.beat.at)) ? Number(row.beat.at) : 0,
            // Only meaningful when this device has a roster of its own. With no
            // denominator every member would "differ", which is a fleet of false
            // positives caused by this device's own fault.
            rosterDiffers: mine > 0 && Number.isFinite(theirRoster) && theirRoster !== mine
          })
        }

        // Worst first, because the reason to open this is to find the member in
        // trouble, and a reader should not have to scan for it.
        reporting.sort((a, b) => a.reach - b.reach || a.device.localeCompare(b.device))

        const heard = new Set(reporting.map((r) => r.device))

        return {
          reporting: reporting.length,
          roster: mine,
          worst: reporting.length > 0 ? reporting[0].reach : null,
          members: reporting,
          silent: members.filter((d) => !heard.has(d))
        }
      },

      /**
       * Faults this instance saw about its own calls.
       *
       * Most recent first. Codes and counts, never wording — `lib/codes.js` is the
       * argument, and the short form is that the wording would be a string this
       * artifact did not write, on its way into an append-only log that replicates
       * to every member.
       */
      faults () {
        return [...faults.entries()]
          .map(([code, seen]) => ({ code, count: seen.count, at: seen.at }))
          .sort((a, b) => b.at - a.at || a.code.localeCompare(b.code))
      },

      /**
       * What this artifact cannot observe.
       *
       * Returned by a call rather than written in a README, because a caller can
       * render it and a README cannot be rendered next to the number it qualifies.
       * The header has the full argument for each row; these sentences are what an
       * operator needs at the moment they are looking at a dashboard.
       *
       * Static today. It is a method rather than a constant so that the day a
       * `platform:diagnostics` port exists, a row can be dropped when the port is
       * bound and kept when it is not — which is the same shape `capabilities()`
       * has in `artifact-send` and the reason this is not a frozen literal.
       */
      limits () {
        return [
          {
            subject: 'refusals',
            observed: 'partial',
            because:
              'no platform capability exposes the assembly\'s refusals, and a refusal is what stopped an ' +
              'artifact from being built — so the artifact that would report it may be the one that was refused',
            covered: 'the device\'s own journal, and the refusal surfaces on the assembly it evaporated with'
          },
          {
            subject: 'fetch failures',
            observed: 'none',
            because:
              'a release that cannot be fetched fails during boot, before any artifact runs, on the path where ' +
              'the whole device is torn down',
            covered: 'the device\'s own journal, for whoever is standing at the machine'
          },
          {
            subject: 'zone deaths',
            observed: 'partial',
            because:
              'nothing exposes a dead zone to a peer artifact, and an observer of a death has to outlive it — ' +
              'this instance cannot report its own',
            covered: 'this device going silent in fleet(), which is indistinguishable from it being switched off'
          },
          {
            subject: 'total partition',
            observed: 'none',
            because:
              'a member that reaches nobody reports to nobody; the report and the failure travel on the same wire',
            covered: 'that member appearing in fleet().silent, which a switched-off machine also does'
          }
        ]
      },

      /**
       * Describe this instance for a shell to render.
       *
       * Data, never markup. The one decision worth naming is that `limits()` is
       * rendered rather than left to a caller that might not ask: this panel is
       * the surface an operator actually reads, and the whole argument of this
       * artifact is that a number nobody qualified is worse than no number.
       *
       * A `warning` tone on the limits, not `muted`. Muted is what the vocabulary
       * uses for the absence of content, and this is the opposite — it is content
       * about an absence, and it is the part of the panel a reader must not skim.
       */
      async view () {
        const [l, f] = await Promise.all([this.local(), this.fleet()])

        /** @type {any[]} */
        const nodes = [
          {
            type: 'rows',
            label: 'This device',
            children: [
              { type: 'field', label: 'members reached', value: `${l.reached} of ${l.roster}` },
              { type: 'field', label: 'reporting', value: `${f.reporting} of ${f.roster}` }
            ]
          }
        ]

        if (f.members.length === 0) {
          nodes.push({ type: 'text', text: 'No member has reported a beat here yet.', tone: 'muted' })
        } else {
          nodes.push({
            type: 'rows',
            label: 'Worst reach reported',
            // The same shape `artifact-send`'s `offersList` settled on, for the
            // same reason and after the same mistake was made there: a describing
            // label, and the identifier as a `code` node underneath. A device key
            // is 52 characters, it is the one string on the line a person copies
            // into another command, and `code` is the only node a renderer
            // promises never to ellipsize. A `field` would put it in `value`,
            // which clips — so it would look right at 120 columns and be
            // unusable at 80, which is the width the OS adapters actually pass.
            //
            // `ponytail:` the cost is height, exactly as it is there — ten
            // members is twenty lines rather than ten. The cap of ten is what
            // bounds it, and the cap is the ceiling: a fleet with eleven
            // struggling members shows ten, and the eleventh is only in
            // `fleet()`. The upgrade path is a panel that can paginate, which is
            // a `view` vocabulary question and not this artifact's to answer.
            children: f.members.slice(0, 10).flatMap((m) => [
              {
                type: 'text',
                text: `${m.reach} of ${m.roster} reached${m.rosterDiffers ? ', and its roster count differs from this device\'s' : ''}`,
                tone: m.reach < m.roster ? 'warning' : undefined
              },
              { type: 'code', text: m.device }
            ])
          })
        }

        const own = this.faults()
        if (own.length > 0) {
          nodes.push({
            type: 'rows',
            label: 'Faults on this device',
            children: own.map((x) => ({ type: 'field', label: x.code, value: String(x.count) }))
          })
        }

        nodes.push({ type: 'divider' })
        nodes.push({
          type: 'rows',
          label: 'Not observed',
          children: this.limits().map((x) => ({
            type: 'text',
            text: `${x.subject} (${x.observed}): ${x.because}`,
            tone: 'warning'
          }))
        })

        return { title: 'Health', nodes }
      },

      /**
       * Refuse every action, and that is the whole implementation.
       *
       * `view@1.1.0` declares `handle`, so it has to exist; what it must not do is
       * anything. `THREAT-MODEL.md` §2.1's channel is a provider remembering
       * something a consumer put there, and `handle` is the one operation on this
       * artifact's surfaces through which a consumer could push a value at all —
       * `artifact-app`'s `app` and `artifact-ui`'s `shell` both port `view` at
       * cardinality `many`, so two consumers really can hold this one object.
       *
       * So the panel offers no buttons and this dispatches nothing. A refresh
       * action was considered and rejected: it would be a read, and a read that a
       * consumer can trigger is a read whose *timing* the other consumer observes.
       * A `beat` action was rejected harder — it writes, and letting a shell decide
       * when this device broadcasts is letting one consumer signal every member of
       * the network.
       *
       * The cost, stated rather than hidden: a shell cannot make this panel do
       * anything, including refresh it. Re-rendering is the shell calling `view()`
       * again on its own schedule, which it does anyway, and beating is `beat()` on
       * the `health` contract — a different binding, which the network grants
       * separately.
       *
       * @param {string} action
       * @param {unknown[]} _args
       */
      async handle (action, _args) {
        throw new Error(
          `health has no action ${JSON.stringify(String(action))}; this panel offers no controls, deliberately`
        )
      },

      /**
       * The vocabulary and the contract, for a suite and for a reader.
       *
       * Not on the declared shape: it is a fact about this build rather than a
       * promise, and `artifact-send`'s `capabilities` is the counter-example that
       * settles which is which — that one is declared because a caller holding the
       * binding has no other way to learn that `code` will answer null forever.
       * Nothing a caller decides turns on this.
       */
      codes () {
        return [...CODES]
      }
    }
  },

  /**
   * The shape, re-exported so a suite can reach it through the artifact.
   *
   * `build` is what the kernel calls and this is not part of that surface. It is
   * here because `test/contract.test.js` compares the module against
   * `manifest.json` and requiring `../lib/shape` directly from a suite would be
   * the suite asserting that two files it chose agree, rather than that the thing
   * the artifact actually carries agrees with the document the kernel reads.
   */
  shape
}
