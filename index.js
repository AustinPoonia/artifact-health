/**
 * What this device can see of the network's replication, reported as an artifact.
 *
 * Logging and metrics are the second thing that must not be
 * kernel code, and the kernel keeps only `journal.js` and gains nothing. So this
 * is an artifact, in a realm, holding nothing but declared ports, and the
 * interesting question is not how to write it — it is **what is actually reachable
 * from in here**, because a monitor that answers a question it cannot measure is
 * worse than no monitor.
 *
 * ## The four categories, and which of them exist from inside a realm
 *
 * `ROADMAP.md` §5 asks for replication health, refusals, fetch failures and zone deaths. When this
 * artifact was first written one of the four was fully reachable, one was reachable in a
 * single degenerate form, and two were not reachable at all. `platform:diagnostics@1`
 * landed and moved exactly one of them — fewer than was predicted, and the sections below
 * kept the arithmetic because it is the kind of prediction a roadmap gets wrong cheaply.
 * **A second change has now moved a second**, and it is the one that took a kernel edit
 * rather than a port: `journal.js`'s vocabulary was widened at the call sites, so a
 * refusal is its own kind, `platform:diagnostics@2` names it, and this release reports it.
 *
 * Three of four, and the fourth is not a fourth port away. The sections below say which,
 * and the reasons in `limits()` have now been *rewritten twice* — which is the thing the
 * original design did not anticipate: a port can make a category reachable while leaving
 * the sentence about a neighbouring category wrong in a new way, and so can a vocabulary.
 *
 * None of this is a shortfall in this file; it is a fact about the port surface, and
 * `limits()` returns it as data so that no dashboard bound to this contract ever shows a
 * zero nobody measured.
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
 * `fleet()` is the second half and it is the one an operator actually asks for. Every
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
 * **2. Refusals — reachable now, and this is the category the second change closed.**
 * The row has been in `limits()` twice with two different reasons, and both are gone.
 *
 * The first reason was that no `platform:*` declaration exposed the kernel's refusal
 * surfaces at all. `platform:diagnostics@1` made that false: `boot.js` copies every
 * `Assembly.refusals` entry, every undeliverable instance, every unreachable network and
 * every not-yet-admitted network into the journal, so the events were in the ring and the
 * port counted them.
 *
 * The second reason was that **they were counted under `network`, together with things
 * that are not refusals at all** — a moved platform pin, a replication settle that
 * expired, a network that resolved to no key. That was a fact about the kernel's own
 * vocabulary and not about this port, and it was not this artifact's to fix: the kind each
 * `journal.note` call site passes is also what a person reads out of `artifact run`. So
 * this file said what it could not report and waited, which is the whole of what
 * `limits()` is for.
 *
 * It has been fixed at the source, in the order `ROADMAP.md` §5 said it had to be. The
 * kernel's vocabulary now splits on **who decided**: `refused` is this device declining
 * something it could have used — a contract no instance satisfies, an instance nothing
 * could deliver, a platform pin this runtime cannot meet, a network retired mid-session,
 * a version below the anti-rollback floor — and `network` is what happened to a joined
 * network where this device decided nothing. One meaning per count. So `diagnostics()`
 * carries a `refused` count that is a refusal count in the way `zone` is a death count,
 * and the row leaves `limits()` when the port is bound.
 *
 * The deeper objection is untouched by any of it and is why this is worth stating rather
 * than celebrating. **A refusal is by definition the thing that stopped an artifact from
 * being built, so the artifact that would report it is the one that may not exist** — in
 * the worst case the refused artifact is this one. A monitor cannot be the reporter of the
 * event that prevents monitors from running. `journal.js`'s own header makes the same
 * point one level up about a failed `boot()`: "every one of those surfaces evaporates",
 * which is why the journal is an object the *caller* owns — and why a count read *after* a
 * successful boot can never include the boot that did not happen. That is the same shape
 * as `zone deaths`' surviving caveat, it lands in `total partition`'s row, and it is why
 * the row leaves rather than staying at `partial`: a device that cannot report is a device
 * that is silent, which the fleet already sees.
 *
 * What this artifact does report is refusals **of its own calls** — a store that
 * refuses a write, an append that is refused — and it labels them first-person
 * rather than letting them read as the device's. That distinction is the whole
 * value; a fault count that mixed "my store is full" with "this device refused an
 * artifact at boot" would be a number with two meanings.
 *
 * **3. Fetch failures — still none, and the *dangerous* half of the reason is now
 * closed.** The failure in question is `bootNetwork`'s `source.fetch` throwing
 * `Unavailable` — a release that could not be found — and `journal.js` exists partly to
 * record which artifact a fetch last failed on. It does record it. Nobody in a realm is
 * left to read it: `source.fetch` has exactly one call site in the kernel, it is inside
 * `bootNetwork`, and the throw is not caught there — it unwinds through `boot`'s teardown
 * and takes the whole device with it. So the note is written to a ring that dies four
 * lines later, and no vocabulary and no port can change that.
 *
 * What used to make this the row to be most careful about was what the `fetch` count
 * *did* contain on a device that is running. Two of `source.js`'s three journal notes were
 * on the **success** path — a release refused as a rollback below the anti-rollback floor,
 * and a release that came from a member rather than from its author — so a live device's
 * `fetch` count was in practice a count of fetches that worked, the first of them a
 * defence engaging, and a dashboard rendering it as "fetch failures" would have reported a
 * security control doing its job as a fault.
 *
 * That is fixed and it is the half worth having fixed. The rollback is a `refused` and the
 * member-served release is a `served`, so `fetch` is failures and nothing else — which is
 * a promise `platform:diagnostics@2` makes in its own declaration rather than a fact a
 * reader has to look up here. The row stays at `none` for the structural reason alone: the
 * number is now the right number and it is zero on every device that is alive to be asked,
 * so what it reports is "this device came up" and not "nothing failed". A row saying
 * `partial` on the strength of a count that is structurally zero would be worse than the
 * one it replaced.
 *
 * `platform:blobs` would surface a *content* fetch failure — `get()` answering
 * null means no member is holding the bytes — and that port is deliberately **not
 * declared here**. A blob store is scoped `@blobs:<artifact>`, so this artifact's
 * blobs are its own and it puts nothing in them; the only fetch failures it could
 * observe would be of content it never fetched. Declaring a port to report an
 * empty category is how a monitor comes to look more capable than it is, so the
 * port is absent and `limits()` says why.
 *
 * **4. Zone deaths — reachable, and this is the one the port actually closes.** It is
 * also the one where this file's original text was wrong about the kernel, which is worth
 * stating plainly rather than quietly editing. The claim was that "nothing in `lib/` has
 * ever subscribed" to `Zones.deaths`, quoting `journal.js`'s header — and `journal.js`'s
 * header is describing the state of affairs *the journal was written to fix*. `boot.js`
 * does subscribe, in one line, and it has since the journal existed: every death becomes a
 * note of kind `zone`. That kind has exactly one writer, so `diagnostics().kinds`'s `zone`
 * count is the zone-death count, with no conflation to warn about. It was the only row of
 * the seven for which that was true; `refused` is now the second, and `served` and
 * `fetch` are the third and fourth — which is what "one meaning per count" bought.
 *
 * The structural objection survives in a much narrower form and is why the `zone deaths`
 * row leaves `limits()` rather than staying at `partial`: an observer of a death must
 * outlive it, and this artifact outlives every zone but its own. A device whose *health*
 * zone died stops beating and goes silent to the fleet, which is `total partition`'s row
 * and not a separate blind spot.
 *
 * Two qualifications belong with the number rather than in a footnote, and both are in the
 * declaration a caller reads. `zone: 0` on a device with containment switched off means
 * there are no zones rather than no deaths — `ROADMAP.md` §2 records that resource
 * isolation is detection rather than enforcement, and off by default — and the count is device-wide, so a death in another network this device has
 * joined is in it. Neither is a reason to withhold the number; both are reasons it travels
 * with `observed` and with the scope sentence.
 *
 * **The port closed one of the three it was said to close; the vocabulary closed the
 * second; the third was never a port's to close.** The arithmetic is worth keeping,
 * because it is the kind of prediction a roadmap gets wrong cheaply and the record of
 * getting it wrong is what made the second change land in the right order.
 *
 * `platform:diagnostics@1` was read-only, answered counts per kind, and carried none of
 * the journal's free text — every design constraint named for it held. What was not
 * checked is whether a *kind* is a *category*. It was not: the kernel's six kinds were
 * chosen for a terminal, so the port could answer zone deaths exactly, could answer
 * refusals only mixed with four other things, and could not answer fetch failures at all
 * because the failure kills the reader. **A port onto a journal cannot expose what the
 * journal does not separate**, which is why the fix had to be at the call sites and why it
 * could not be attempted from here. It has been: the kernel splits on who decided, the
 * port names the split at `2.0.0`, and this contract reports it at `1.2.0` — three
 * repositories, in that order, because each one can only separate what the one below it
 * already separated.
 *
 * `ponytail:` **one of `ROADMAP.md` §5's four categories is still not observed from inside
 * a realm, and this is the ceiling that says so in one place.** It was three, then two.
 * What is left is fetch failures, and unlike the other two it is **not** a vocabulary
 * problem and no further kernel kind fixes it: `source.fetch` has one call site, its throw
 * is uncaught in `bootNetwork`, and it tears the device down before any artifact runs — so
 * the count is correct, is structurally zero wherever it can be read, and the event is
 * only ever seen by whoever is standing at the machine reading `artifact run`. The upgrade
 * path is therefore not a port and not a kind: it is a *durable* record of the last failed
 * boot that the next successful one can read, which `journal.js` refuses by design ("it is
 * not a file", and the argument there is about an unbounded resource, a permissions
 * question and a support bundle that gets mailed somewhere). Reopening that is a decision
 * about the journal's lifetime and not an addition to this artifact. The trigger is a fleet
 * where a device that failed to boot has to be diagnosed without touching it — which is
 * also §9's trigger, and is the same fact twice. Not registered in `ROADMAP.md`'s debt
 * ledger, and that is the scope rule rather than an omission: the ledger covers the kernel,
 * `artifact-net`, `artifact-protocol` and the `platform-*` repos, and for an `artifact-*`
 * repo the comments are the register.
 *
 * ## Why this is not a side channel, decided rather than hoped
 *
 * `ROADMAP.md` §8 and `THREAT-MODEL.md` §2: one instance per kind means a provider
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
 *      honest statement of the trade. The obvious design for observability is a `diagnostic`
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
 * **The one port whose binding is a disclosure, said here rather than buried.**
 * `platform:diagnostics` is device-wide: one journal per process, shared by every network
 * this device has joined, and the platform contract states that scoping is unavailable
 * rather than declined. So this artifact, bound to it, can see *how many* diagnostic events
 * of each kind occurred on this device including ones belonging to another network and to
 * artifacts it cannot otherwise reach. It cannot see which, whose, when, or in what words.
 *
 * Three things keep that from widening. The binding is signed — an admin names the port in
 * a graph, and this kind is `instances: "explicit"`, so nothing acquires it by being on
 * disk. Nothing read through it is ever put into a **beat**: a beat replicates to one
 * network's members, and exporting a device-wide count into one network's log would hand
 * that network's members another network's event volume. And the counts leave this artifact
 * only through `diagnostics()`, whose own `observed` field forces a caller to distinguish
 * "not measured" from "zero".
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
 * the census has not changed**. The digest that makes that possible is the one thing
 * in the store, and the store is what carries it across a restart of the resident
 * process.
 *
 * That used to be the whole of it — "a healthy fleet writes one beat per device and
 * then stops, and growth is driven by change rather than by time" — and the sentence
 * was true and the design was wrong, in a way nothing here could see until somebody
 * asked how far behind a member is. **A feed that only grows on change cannot answer
 * a question about currency, in principle.** If a healthy member writes nothing, then
 * "nothing new has arrived from that member" is produced identically by a member that
 * is fine and by one this device stopped replicating with an hour ago. There is no
 * reading over such a feed that separates them, because the two situations put the
 * same bytes on the disk. Silence has to be falsifiable before staleness can be
 * measured, and only a write makes it so.
 *
 * The obvious repair is the wrong one and is worth naming because it is the first
 * thing anybody tries: put a timestamp in the census. The digest is taken over the
 * census, so a clock inside it changes the digest on every tick, and the suppression
 * never engages again — an entry per member per tick, forever. That is not a
 * different bound, it is the removal of the bound.
 *
 * So the clock and the content are separated. The census stays integers and codes and
 * carries no clock, and the *suppression* expires instead: `settings.beatFloor`, five
 * minutes by default. A device with nothing new to say writes one beat per floor
 * rather than one per tick or none ever, which is a bound in entries per member per
 * day, and it makes a member's silence mean something an operator can act on. The
 * cost is real and is stated rather than absorbed — a quiet fleet's feed now grows on
 * time as well as on change — and a network that cannot pay it sets the floor to zero
 * and gets the old behaviour back, with `limits()` on that device saying what it gave
 * up.
 *
 * The reading built on it never compares two devices' clocks. `entry.at` is the
 * writer's own and `platform:feed` says never to trust it; `age` is this device's
 * clock since this device watched that member's log get longer. See `advanced`.
 *
 * `ponytail:` **the bound on the feed is now a rate rather than a total, and nothing
 * here collects.** One entry per member per floor per day is a number that grows for as
 * long as the network exists, and a log that only ever grows will eventually be the
 * largest thing on a small device. Content-addressed suppression had the same property
 * whenever anything was actually changing; what the floor does is put a lower bound under
 * it on a quiet network, which is the price of the reading and is not a new *kind* of
 * problem. It becomes one at a fleet size and an uptime nothing here has measured. The
 * upgrade path is not in this artifact — a beat is an entry in `platform:feed`, and
 * whether an artifact's log can be truncated behind a horizon is that capability's
 * question and the network's, not a monitor's. A `history` operation in here would be the
 * wrong answer to it twice over, which is why there still is not one.
 */
const shape = require('./lib/shape')
const { CODES, classify, safe } = require('./lib/codes')

/**
 * What a kind name may look like, checked by **shape** and deliberately not against a
 * list.
 *
 * `platform:diagnostics` projects the kernel's journal onto its own frozen nine-name
 * vocabulary and buckets everything else, and its return object is closed, so
 * `contract.validate` refuses an undeclared key on the way past. That is the guarantee,
 * it is the port's, and it is proved in that repo's conformance suite. This is the
 * layer that stops this artifact making it *worse*, and it takes the one form that does
 * not create a second problem:
 *
 *   - **Not a copy of the vocabulary.** A list in here would go stale against the
 *     kernel's, and the failure would be a kind from a newer runtime rendering as
 *     nothing at all — invisible, which is the one outcome this whole artifact is
 *     arranged against. So a name this release has never seen is reported.
 *   - **A shape, so what cannot be a kind cannot cross.** Lowercase, hyphens and
 *     digits, thirty-two characters. Every form `lib/codes.js` names — 128 hex
 *     characters, a `Bearer …` header, base64 with `+` and `/` — fails it, and so does
 *     anything long enough to be a payload. That is strictly stronger than `safe()`
 *     here, which is why a kind name does not go through it: `safe` bounds length and
 *     catches key-shaped runs, and this bounds length *and* alphabet.
 *
 * **The limit, in the same breath, because it is the honest half.** A short lowercase
 * word is indistinguishable from a kind name — `hunter2` passes this, and would if the
 * port ever handed one over. Nothing in an artifact can tell those apart, and nothing
 * needs to: the port is the layer that guarantees the declared names, and the reason it can
 * is that its answer is a closed object the kernel validates. This is the second line,
 * and `journal.js`'s rule about a second line never being the first applies unchanged.
 */
const KIND = /^[a-z][a-z0-9-]{0,31}$/

/**
 * This artifact's command line, and the reason it needs one at all.
 *
 * **Nothing ran this.** For three releases `health` was a correctly shaped library that
 * no device executed: it is a `file:` dependency of the kernel's repo so two suites can
 * reach it, and a row in an operator's lockfile, and that is the whole of its presence
 * anywhere. `lib/` mentions it in comments. A monitor nobody runs is not a monitor, and
 * every argument in this file about what is and is not observable was academic until a
 * device could be asked.
 *
 * The gap was not the manifest and not a plan. It was that this artifact provided
 * `health` and `view` and nothing else, and neither of those is a way in. `view` is
 * rendered by a shell that ports `view` at cardinality `many` — real, and it arrives
 * automatically the day an instance is signed — but a panel is a *read*, and the one
 * operation here that has to happen for any of the readings to have anything to read is
 * `beat()`, which writes. Nothing on this platform calls it. There is no scheduler
 * surface: an artifact's code runs when it is built, when a consumer calls one of its
 * contract operations, when a shell renders its panel, or when somebody types a command.
 * Of those four, the last is the only one this artifact could reach on its own, and
 * `cli@2.0.0` is how an artifact reaches it — the OS adapters port `cli` at `many`, so
 * `artifact run health -- beat` exists the moment this is declared and an instance is
 * signed.
 *
 * `ponytail:` **a command line is a person or a cron, and neither is a fleet.** What this
 * declaration buys is that a beat is *possible* on a device. What it does not buy is that
 * one happens on a clock, because no surface on this platform lets an artifact schedule
 * anything — the four ways its code runs are the four above and none of them is a timer.
 * So the fleet reading is only as complete as whatever runs `artifact run health -- beat`
 * on each machine, which today is that machine's own scheduler and not the network's, and
 * every currency reading inherits it: `age` is measured against observations made at
 * beats, so a device nobody beats has ages whose resolution is however often somebody
 * typed the command. The upgrade path is a kernel-side periodic call — `lib/resident.js`
 * already ticks — and it is a decision about whether an artifact may run code nobody
 * asked for. Not this repo's to take, and worse taken by quietly adding a timer in here.
 *
 * ## Two commands, and why the grammar is written rather than derived
 *
 * `artifact-send` derives its grammar from its contract, and the reason is arithmetic: it
 * surfaces five of eight operations with positional arguments and flags, so a hand-written
 * copy would be one description in two vocabularies, free to drift. Neither half of that
 * holds here. There are two commands, neither takes an argument or a flag — `beat()` takes
 * none by design, and the redaction argument is why — and one of the two is not an
 * operation of the `health` contract at all: `report` renders the `view@1.1.0` panel,
 * which is a different contract. A derivation with two entries and an exception is a
 * mechanism with nothing to keep in step.
 *
 * There is no `local`, no `fleet` and no `limits` verb, and that is `report` doing its
 * job: the panel already renders all three, together, with the blind spots underneath
 * them, and it is the whole point of this artifact that a number arrives next to what
 * qualifies it. Three verbs that each printed one number without the others would be
 * three ways to read a fragment.
 */
const SPEC = {
  name: 'health',
  version: '1.3.0',
  describe: 'What this device can see of the network\'s replication, and what it cannot',
  commands: [
    {
      name: 'report',
      action: 'cliReport',
      describe: 'What this device holds from each member, what every member says it holds, and the blind spots in both'
    },
    {
      name: 'beat',
      action: 'cliBeat',
      // The sentence a person needs at the moment they are about to type it, which is
      // that this writes to a log every member reads and that repeating it is cheap.
      describe: 'Append one census of what this device can currently see. Suppressed when it matches the last one and that one is recent'
    }
  ]
}

/** Where a name that cannot be a kind is counted. One row, however many arrive. */
const UNNAMED = 'unnamed'

/**
 * A duration in milliseconds as a word a person reads, for the panel and nowhere else.
 *
 * Coarse on purpose and it rounds down. A panel is read at a glance, "4m" is what an
 * operator needs from it, and the exact number is on `age` for anything that wants to
 * compare or to threshold — a renderer that printed `254113ms` would be handing a reader
 * arithmetic instead of an answer. Rounding *down* rather than to nearest, because this
 * is a lower bound on how stale a member is and a value that rounded up would be the one
 * number here that overstates a fault.
 *
 * @param {number} ms
 */
function since (ms) {
  if (ms < 1000) return 'under a second'
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`
}

/**
 * How long an unchanged census suppresses a beat when a network says nothing.
 *
 * Five minutes, and the number is borrowed rather than invented: it is
 * `lib/resident.js`'s `REFOLD_INTERVAL`, the clock a resident device already re-reads
 * its logs on. See `settings.beatFloor` for what the floor is for.
 */
const FLOOR = 300000

/**
 * The floor a config asked for, or the default, with anything unusable treated as the
 * default rather than as off.
 *
 * The asymmetry is deliberate. `0` and negatives switch the floor off, because a
 * network may mean that; a string, a `NaN` or a missing field is a config that did not
 * say, and a monitor that read "did not say" as "never beat again" would go quiet on a
 * typo. Off has to be asked for.
 *
 * @param {unknown} asked
 */
function floor (asked) {
  if (asked === undefined || asked === null) return FLOOR
  const ms = Number(asked)
  if (!Number.isFinite(ms)) return FLOOR
  return ms > 0 ? ms : 0
}

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
     * The one port whose absence is survivable, so it is checked for rather than
     * demanded.
     *
     * `platform:diagnostics` is declared at cardinality `optional` and this is the
     * matching half of that decision. Refusing to build without it would make the
     * artifact unrunnable on any device whose kernel predates the capability, to buy a
     * number that `limits()` is perfectly able to report the absence of — which is the
     * whole shape of this artifact's argument applied to its own dependencies.
     *
     * `plan.js` binds every platform port a manifest declares, unconditionally, so on a
     * device running a kernel that has the capability this is always present and the
     * unbound branch is reached by an embedder calling `build` directly, by a suite, or
     * by a future kernel that dropped the row from `chain.NATIVE`. That is worth saying
     * plainly rather than implying the branch is a deployment case: it is a correctness
     * case, and `test/artifact.test.js` drives both sides of it.
     */
    const ring = deps.diagnostics ?? null

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
      maxMembers: (config && config.maxMembers) || 4096,

      /**
       * The longest an unchanged census may go on suppressing a beat.
       *
       * **This is the decision the currency reading turns on, and the two halves pull
       * opposite ways, so it is written here once rather than argued at each call
       * site.** A beat used to be suppressed on content alone: identical census,
       * nothing written, "growth is driven by change rather than by time". The price
       * of that was not visible until somebody asked how far behind a member is,
       * because it makes the question unanswerable in principle — if a healthy member
       * stops writing, then "nothing new from that member" is exactly what a healthy
       * member and a disconnected one both look like, and no reading over the feed can
       * separate them. Silence has to be falsifiable for staleness to mean anything.
       *
       * The other side is real too. A timestamp *inside* the census is the obvious way
       * to make the beat advance, and it is the wrong one: the digest is taken over the
       * census, so a clock in it writes an entry every single tick, forever, on an
       * append-only log that replicates to every member. That is not a bound, it is the
       * absence of one.
       *
       * So the two are separated. The digest stays content-addressed and carries no
       * clock — `census()` is integers and codes, exactly as before — and the
       * suppression it drives *expires*. A device with nothing new to say writes one
       * beat per floor and no more, which is a bound in entries-per-member-per-day
       * rather than in entries-per-tick, and it makes silence mean something: past a
       * floor and a bit, a member that has written nothing is a member this device is
       * not replicating with.
       *
       * Five minutes by default, which is `lib/resident.js`'s own re-derive interval
       * rather than a number chosen here — a device that re-reads its logs on that
       * clock cannot usefully be asked for freshness finer than it, and matching it
       * means the two cadences do not beat against each other.
       *
       * **Zero or less switches it off**, and that is a real option rather than a
       * degenerate one: a network that cannot afford one entry per member per five
       * minutes can have the old pure-content behaviour back, and what it gives up is
       * stated in `limits()` on that device rather than inferred. It is off, not
       * "immediate" — a floor of zero would mean beating on every call, and no caller
       * wants a monitor whose cheapest reading is a write.
       */
      beatFloor: floor(config && config.beatFloor)
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

      /** @type {Map<string, { seq: number, beats: number, beat: any, at: number }>} */
      const byDevice = new Map()
      if (!Array.isArray(entries)) return byDevice

      for (const entry of entries) {
        if (!entry || typeof entry !== 'object') continue
        if (typeof entry.device !== 'string' || entry.device.length === 0) continue
        const device = safe(entry.device)

        let row = byDevice.get(device)
        if (!row) {
          if (byDevice.size >= settings.maxMembers) continue
          row = { seq: -1, beats: 0, beat: null, at: 0 }
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
        // **Off the entry, never off the value, and that was the whole bug.** `at` was
        // read as `row.beat.at` — a field on the census — and `census()` has never put
        // one there and must not: a census is what the digest is taken over, and a
        // timestamp inside it would move on every tick and write a beat every tick. So
        // `Number(undefined)` was `NaN`, the finite-guard wrote 0, and every row of
        // `fleet().members` carried `at: 0` on every device for a whole release.
        //
        // `platform:feed` has carried the field the whole time, one level out: `append`
        // writes `{ at: peer.now(), value }` and `merge` returns it as `entry.at`. That
        // is the writer's own clock, unchecked, exactly as declared — so it is reported
        // as the hint it is and is never compared against this device's clock. The
        // currency reading below is what does not use it, for that reason.
        const at = Number(entry.at)
        row.at = Number.isFinite(at) && at >= 0 ? at : 0
      }

      return byDevice
    }

    /**
     * When this device last watched each member's log move, by **this device's own
     * clock**, and whether it has ever watched it move at all.
     *
     * ## Why the reading cannot be built out of the timestamps the feed carries
     *
     * The obvious currency reading is `now - entry.at`: every entry has the writer's
     * clock on it, so subtract. It is wrong, and `platform:feed` says so in the
     * declaration of the field — "a wall-clock hint written by the appending device.
     * Never sort on it and never trust it: it is that device's clock, and nothing checks
     * it." Subtracting another device's unchecked clock from this one's is not a
     * measurement; it is two numbers that happen to have the same units. A member with a
     * clock an hour fast would read as an hour in the future, one an hour slow as an
     * hour stale, and the artifact whose whole argument is that an unqualified number is
     * worse than none would be printing exactly that.
     *
     * So nothing here compares clocks. The only clock this reading uses is this device's
     * own, and the only event it times is one this device witnessed: *its own log got
     * longer for that member*. That is a first-person observation in the same sense
     * `faults()` is first-person, and it is the one form of freshness a realm can
     * actually establish.
     *
     * ## Why `moved` exists, and why a first sighting reads as unknown
     *
     * The trap is the first call. On it, every member is recorded at whatever sequence
     * number it happens to be at — so a member whose last block arrived a week ago and a
     * member that is replicating fine are both recorded *now*, and both would read as
     * perfectly fresh. That is inventing a number that looks like freshness, which is
     * worse than the gap it fills.
     *
     * So a device is not given an age until this instance has watched it advance once.
     * Before that, `age` is `null` — not measured — and `limits()` carries the row.
     * The cost is real and is the price of not lying: for up to one `beatFloor` after
     * this zone starts, nothing has an age. The counters are per-instance and reset with
     * the zone for the same reason `faults` does, and the alternative — a durable map of
     * per-member timestamps in the store — is the write pattern that grows without bound
     * while holding nothing live.
     *
     * ## Why only `beat()` writes here, and no read does
     *
     * `THREAT-MODEL.md` §2.1 again, and it moved this line. If a *read* recorded the
     * observation, then consumer A's `local()` would set the instant that consumer B's
     * `age` is measured from, and B would be reading the time at which A called — a
     * channel, in the one artifact that argued at length it has none. `beat()` is on the
     * `health` contract, which a network grants separately and which neither `view`
     * consumer holds, so the cadence of these observations is this device's own beat
     * cadence and not anything a panel can trigger.
     *
     * What survives is that `age` is a function of the wall clock as well as of the feed,
     * so two reads a second apart differ. That is not §2.1: the clock is not a value a
     * consumer put here, both consumers have one, and `seen.at` tracks a beat whose entry
     * is in the feed both can read. Enumerable, which is the test §2.4 asks for — one
     * sequence number, one local instant and one boolean per member.
     *
     * @type {Map<string, { seq: number, at: number, moved: boolean }>}
     */
    const advanced = new Map()

    /**
     * Record what this device now holds, against what it held at the last beat.
     *
     * Bounded by `maxMembers`, like the fold it reads, and for the same reason: a map
     * keyed by anything a peer can mint is a map a peer can grow.
     *
     * @param {Map<string, { seq: number }>} byDevice
     * @param {number} now   this device's clock, passed in so one beat times one instant
     */
    function observe (byDevice, now) {
      for (const [device, row] of byDevice) {
        const seen = advanced.get(device)
        if (seen === undefined) {
          if (advanced.size >= settings.maxMembers) continue
          // Sighted, not timed. See `moved` above: pretending a first sighting is an
          // advance is the whole failure this field exists to avoid.
          advanced.set(device, { seq: row.seq, at: now, moved: false })
        } else if (row.seq > seen.seq) {
          seen.seq = row.seq
          seen.at = now
          seen.moved = true
        }
      }
    }

    /**
     * How long since this device watched that member's log move, in milliseconds.
     *
     * `null` is "this instance has not watched it move", which is not zero and is not a
     * large number. A caller that renders it as either has undone the point.
     *
     * A backwards clock floors at zero rather than going negative. A negative age is not
     * a reading anybody can act on, and the honest alternative — reporting the jump —
     * is a fact about this device's clock rather than about the network.
     *
     * @param {string} device
     * @param {number} now
     * @returns {number | null}
     */
    function age (device, now) {
      const seen = advanced.get(device)
      if (seen === undefined || !seen.moved) return null
      return now - seen.at > 0 ? now - seen.at : 0
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
     * @param {number} now   this device's clock, so every row of one reading is one instant
     */
    function reading (members, byDevice, me, now) {
      const peers = members.map((device) => {
        const row = byDevice.get(device)
        return {
          device,
          seq: row ? row.seq : -1,
          beats: row ? row.beats : 0,
          // The field `silent` is not and cannot be. `silent` answers "has anything ever
          // arrived", which is monotone and permanent; this answers "when did anything
          // last arrive", which is the question an operator was asking all along. Both,
          // rather than one redefined into the other: a caller reading `silent` today is
          // reading a promise this contract made and gets to keep reading it.
          age: age(device, now),
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
     * a seven-member vocabulary, so it is bounded in length as well as in content.
     */
    async function census () {
      const { members, byDevice, me } = await snapshot()
      // `Date.now()` is passed and discarded: `reading` computes an age per row and a
      // census keeps none of them. That is the separation this release rests on — the
      // digest is over content only, so nothing clock-shaped can reach it by accident,
      // and the one thing that *does* expire is the suppression rather than the census.
      const reach = reading(members, byDevice, me, Date.now()).reached

      return {
        byDevice,
        value: {
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

    /**
     * What the store holds under `DIGEST`, as the two things it means.
     *
     * `<at>|<digest>` — this device's clock when it last appended, and the census it
     * appended. Two fields in one value rather than two keys, because they are written
     * together or not at all: a store that took the first `put` and refused the second
     * would leave a device believing it had beaten at a time it had not, which is the
     * failure the write ordering in `beat()` already exists to avoid.
     *
     * `|` is safe as the separator by construction: a digest is integers, `/`, `,`, `:`
     * and fault codes, and `lib/codes.js`'s vocabulary is lowercase and hyphens.
     *
     * A value with no `|` is what a `1.2.x` device wrote — a bare digest and no time.
     * It parses to a null clock, which the floor reads as "cannot tell how old", so an
     * upgraded device writes one beat and is in the new format from then on. Beating
     * once too often on an upgrade is the right direction to fail in.
     *
     * @param {unknown} stored
     * @returns {{ at: number | null, digest: string } | null}
     */
    function written (stored) {
      if (typeof stored !== 'string' || stored.length === 0) return null
      const cut = stored.indexOf('|')
      if (cut < 0) return { at: null, digest: stored }
      const at = Number(stored.slice(0, cut))
      return { at: Number.isFinite(at) ? at : null, digest: stored.slice(cut + 1) }
    }

    return {
      /**
       * Append one census, unless it is the one already written *and* it was written
       * recently enough that writing it again would say nothing.
       *
       * The suppression is the bound on an append-only log, and the store is what
       * makes it survive a restart of the resident process. A store that cannot be
       * read degrades to beating — `store-unreachable` is counted and the beat goes
       * ahead — because the failure a monitor must not have is silence.
       *
       * `settings.beatFloor` is the whole of what changed and the argument is there.
       * The short form: content-addressed suppression alone makes a healthy member and
       * a disconnected one produce identical feeds, so it makes staleness unmeasurable
       * rather than merely unmeasured.
       *
       * The two clocks read here are both this device's own, taken from one `Date.now()`
       * so that a beat is timed at one instant, and compared only against a value this
       * same device wrote. Nothing in this method looks at another device's clock, which
       * is the property that makes the floor sound where `entry.at` arithmetic would not
       * be.
       */
      async beat () {
        const { value: c, byDevice } = await census()
        const at = Date.now()
        // Before the append and against the snapshot the census was taken from, so this
        // device's own row lags by one beat. That is honest — it has not yet watched
        // the entry it is about to write arrive — and it is why a device's first two
        // beats leave its own `age` null.
        observe(byDevice, at)
        const now = digest(c)

        const last = written(await attempt(() => deps.store.get(DIGEST), 'store-unreachable', null))
        const unchanged = last !== null && last.digest === now
        // A clock that jumped backwards gives a negative elapsed, which is not inside
        // the floor: the device beats. Beating on a bad clock is recoverable and going
        // quiet on one is not.
        const elapsed = last !== null && last.at !== null ? at - last.at : null
        const recent = settings.beatFloor <= 0 ||
          (elapsed !== null && elapsed >= 0 && elapsed < settings.beatFloor)

        if (unchanged && recent) {
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
        await attempt(() => deps.store.put(DIGEST, `${at}|${now}`), 'store-refused', false)

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
        // One instant for the whole reading. Calling `Date.now()` per row would give a
        // record whose ages were measured microseconds apart, which is invisible and is
        // still two facts in one object.
        const { peers, silent, reached } = reading(members, byDevice, me, Date.now())

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
       * This is §5's question answered. A member reporting `reach: 2, roster: 20`
       * is telling the network about its own partial failure, and that report
       * arrives as long as it can reach anybody at all. `worst` is the one number
       * to alert on.
       *
       * `rosterDiffers` is the reading that is not about replication and is worth
       * having anyway: two members folding the same signed log count the same
       * number of members, so a disagreement means one of them is acting on state
       * it has not re-read. `lib/resident.js`'s own ceiling registers exactly that as a
       * property of the resident process — "a resident device stops re-reading its
       * logs" for up to five minutes, so an expulsion or a raised pin arrives only
       * at the next boot — and calls it a security property rather than a
       * performance one. A stale device cannot see its own staleness; a peer can.
       */
      async fleet () {
        const { members, byDevice } = await snapshot()
        const mine = members.length
        const now = Date.now()

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
            at: row.at,
            // The field to act on, where `at` is the field to display. `at` is that
            // member's clock and this is this device's, so only one of the two is a
            // duration anybody can compare across a fleet — and it is the one the
            // sort below deliberately does not use, because a member reaching nobody
            // is a worse thing to find than a member that is merely behind.
            age: age(device, now),
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
       * What the kernel wrote in this device's own diagnostic ring, by kind.
       *
       * The only operation here that reads something which is **not** about this
       * network, which is why it is its own call rather than a field on `local()`. A
       * record half of whose numbers are scoped to the caller's network and half of
       * which are device-wide, with nothing in the shape saying which, is the
       * unqualified number this artifact exists to refuse.
       *
       * `observed` is the field that carries the whole point. An unbound port answers
       * `false` and an **empty** list — never a row of zeroes — because zero and
       * unmeasured read identically and mean different things, and this is the artifact
       * whose entire argument is that difference. A refused port answers `false` too
       * *and* records `diagnostics-unreachable`, which is how a caller tells "this
       * network did not grant the port" from "the kernel is failing": the first sends an
       * operator to an admin, the second to a machine.
       *
       * The counts are passed through rather than interpreted. This artifact does not
       * rename `network` to "refusals", does not sum anything, and does not drop a kind
       * it does not recognise — a vocabulary entry from a newer kernel arrives as a row
       * with a name this release has never seen, which is visible, whereas a filter
       * against a list in here would make it invisible. The platform contract has
       * already guaranteed the only thing that matters about those names: they come from
       * a closed set, and an entry the kernel wrote under some other kind is counted as
       * `other` by the port, so no journal text can reach this field by any path.
       *
       * `nothing()` rather than a literal in three places, because "not observed" has to
       * be one shape: a caller comparing two devices must not find one answering
       * `kinds: []` and another `kinds: null`.
       */
      async diagnostics () {
        /** The one shape "not observed" takes. */
        const nothing = () => ({ observed: false, dropped: 0, kinds: /** @type {any[]} */ ([]) })

        if (ring === null) return nothing()

        // `attempt` and not a bare call, for the reason it exists: a monitor whose read
        // throws is a monitor that reports nothing on exactly the call where something
        // was wrong. The fallback is the unobserved shape, so a refused port degrades to
        // "nobody measured" — which is true — rather than to zeroes.
        // `tally` and not `counts`. The port publishes both — `counts` is
        // `platform:diagnostics@1`'s six coarse kinds, kept alive and folded so that
        // version's own text stays true — and this artifact's port declares `^2.0.0`,
        // so `tally` is the one the kernel will validate. Calling `counts` here would
        // ask for the conflation this release exists to stop reporting, and would be
        // an undeclared operation on the selected declaration, which `route` answers
        // *unchecked* rather than refusing.
        const answer = await attempt(
          () => ring.tally(), 'diagnostics-unreachable', /** @type {any} */ (null)
        )
        if (!answer || typeof answer !== 'object' || !answer.kinds || typeof answer.kinds !== 'object') {
          // A port that answered something this release cannot read is not a port that
          // answered. Counted through `attempt` above only when it threw, so this branch
          // records nothing: a malformed answer from a newer or older kernel is not this
          // device failing, and calling it a fault would put a version skew under a
          // heading that says the kernel is broken.
          return nothing()
        }

        /**
         * Counts by kind name, with names checked for *shape* and never against a copy
         * of the vocabulary.
         *
         * A `Map`, because two names can collapse onto one row: anything that is not
         * shaped like a kind is counted under `unnamed`, and there can be more than one
         * of those.
         *
         * @type {Map<string, number>}
         */
        const byKind = new Map()
        for (const [kind, count] of Object.entries(answer.kinds)) {
          const n = Number(count)
          const name = KIND.test(kind) ? kind : UNNAMED
          // Defensive across a port boundary, exactly as `roster()` is: the contract
          // declares these as numbers, and a monitor that threw on a malformed row would
          // be a monitor that stopped monitoring. A negative count is floored rather
          // than passed on, because a count of events cannot be below none.
          byKind.set(name, (byKind.get(name) ?? 0) + (Number.isFinite(n) && n >= 0 ? n : 0))
        }

        const kinds = [...byKind.entries()].map(([kind, count]) => ({ kind, count }))

        const dropped = Number(answer.dropped)
        return {
          observed: true,
          dropped: Number.isFinite(dropped) && dropped >= 0 ? dropped : 0,
          kinds
        }
      },

      /**
       * What this artifact cannot observe.
       *
       * Returned by a call rather than written in a README, because a caller can
       * render it and a README cannot be rendered next to the number it qualifies.
       * The header has the full argument for each row; these sentences are what an
       * operator needs at the moment they are looking at a dashboard.
       *
       * **It is a method rather than a constant so that a row can be dropped the day a
       * `platform:diagnostics` port is bound, and that day has come twice.** The first
       * time it dropped `zone deaths`. This release is the second, and it is the one the
       * roadmap's §5 ordering was written for — a kernel vocabulary change, then
       * `platform:diagnostics@2`, then this — so it is worth being exact about what moved:
       *
       *   - `zone deaths` is **gone**, and only when the port is bound. `boot.js` notes
       *     every death under kind `zone`, that kind has exactly one writer, so the count
       *     is the zone-death count. `diagnostics()` carries it.
       *   - `refusals` is **gone too, when the port is bound**, and this is what
       *     `health@1.2` bought. The kernel now writes every refusal under its own kind:
       *     a contract no instance satisfies, an instance nothing could deliver, a
       *     platform pin this runtime cannot meet, a network retired mid-session, and the
       *     anti-rollback floor turning a version down. One writer per meaning and one
       *     meaning per count, so `refused` is a refusal count in the way `zone` is a
       *     death count, and a row saying otherwise would now be the stale claim.
       *
       *     The caveat that survives is the structural one and it is the same one
       *     `zone deaths` left with: a refusal that stopped *this* artifact from being
       *     built cannot be reported by it, and a boot that threw leaves no artifact at
       *     all. Both are `total partition`'s row — the device goes silent to the fleet —
       *     rather than a separate blind spot, and repeating them here would be claiming
       *     two gaps where there is one. `diagnostics()`'s own scope sentence carries the
       *     other half, that the count is device-wide.
       *   - `fetch failures` **stays** at `none`, and the reason is now the *only* reason
       *     rather than two reasons wearing one row. The dangerous half is closed: the
       *     `fetch` count no longer contains successes, because the release a member
       *     served is `served` and the rollback the floor refused is `refused`, so nothing
       *     here can read a defence engaging as a fault. What is left is structural and no
       *     port can touch it — there is one `source.fetch` call site, its throw is not
       *     caught in `bootNetwork`, and it tears the device down before any artifact
       *     runs. So a device an artifact can ask has not had one, and the honest reading
       *     of `fetch: 0` on a running device is "not observed" rather than "none
       *     happened". That is what this row is for.
       *   - `total partition` **stays** unchanged. No port touches it.
       *   - the fleet row **stays**: nothing `diagnostics()` reports reaches the fleet,
       *     deliberately, because the counts are device-wide and a beat replicates inside
       *     one network.
       *
       * Rows a device cannot answer are not silently absent: `fetch failures` and
       * `total partition` are on both lists, and the unbound case restores `zone deaths`
       * and `refusals` and drops the fleet row, because on that device the fleet row
       * would be describing a number nobody has.
       *
       * The shape is `artifact-send`'s `capabilities()` one level up: a call whose answer
       * depends on what this instance was actually wired to, so a caller learns it from
       * the binding rather than from a README that cannot know.
       */
      limits () {
        const rows = [
          {
            subject: 'fetch failures',
            observed: 'none',
            because: ring === null
              ? 'a release that cannot be fetched fails during boot, before any artifact runs, on the path ' +
                'where the whole device is torn down'
              : 'a release that cannot be fetched throws out of the one call site that fetches, uncaught, and ' +
                'tears the device down before any artifact runs — so it is written to a ring nobody is left ' +
                'to read, and the fetch count on a device you can ask is zero because this device came up, ' +
                'not because nothing ever failed',
            covered: 'the device\'s own journal, for whoever is standing at the machine'
          },
          /**
           * The blind spot that is this reading's own and not the platform's, which is
           * why it is unconditional and why no port will ever drop it.
           *
           * `reaches()` asks whether this device holds *at least one* entry from a
           * member, and a replicated block is on disk forever. So the predicate is
           * monotone: a member counted as reached once can never be counted silent
           * again, however long ago the one entry arrived and however far behind its log
           * has since fallen. Measured over a real link held down for 95 seconds, a peer
           * stayed three, then six, then thirteen blocks behind while `reached` sat at
           * 2 of 2, `silent` stayed empty and `degraded` stayed false.
           *
           * The fields are not lying — `shape.js` declares `reached` as "members this
           * device holds at least one entry from", and that is exactly what it counts.
           * The gap is that an operator does not ask that question. They ask "am I
           * falling behind on anybody", and until this release there was no field for it
           * and no row here saying so, which is the failure mode this whole operation
           * exists to prevent: not a wrong number, an unasked question rendered as a
           * healthy one.
           *
           * `age` is the field for it now, so the row stays at `partial` rather than
           * leaving — and what it discloses has moved to the two things `age` cannot do.
           * It is null until this instance has watched that member's log move once, so a
           * freshly started zone knows nothing for up to a floor; and it is only as good
           * as the floor, because a device that never writes cannot be observed to have
           * stopped. Which is why the row says something different when the floor is off:
           * there the question is not merely unanswered, it is unanswerable, and that is
           * the disclosure the knob owes.
           */
          {
            subject: 'a member that stopped replicating after this device first heard from it',
            observed: 'partial',
            because: settings.beatFloor > 0
              ? 'reached, silent and degraded are computed from whether anything has ever arrived from a ' +
                'member, and a block that has replicated stays on disk — so first contact is permanent and ' +
                'a deficit that opens after it moves none of the three. age answers it instead, and is null ' +
                'until this instance has watched that member\'s log move once, which is up to one beat floor ' +
                'after this zone started'
              : 'reached, silent and degraded are computed from whether anything has ever arrived from a ' +
                'member, and a block that has replicated stays on disk — so first contact is permanent and ' +
                'a deficit that opens after it moves none of the three. This instance has its beat floor ' +
                'switched off, so a member with nothing new to say writes nothing at all, and a member that ' +
                'has stopped replicating is indistinguishable from one that is simply healthy and quiet',
            covered: settings.beatFloor > 0
              ? 'age, on every row of local().peers and fleet().members, in milliseconds on this device\'s ' +
                'own clock — never on the writer\'s'
              : 'nothing on this device; a network that wants currency has to sign a beat floor above zero'
          }
        ]

        if (ring === null) {
          rows.push({
            subject: 'refusals',
            observed: 'partial',
            because:
              'no platform capability is bound here that exposes the assembly\'s refusals, and a refusal is ' +
              'what stopped an artifact from being built — so the artifact that would report it may be the ' +
              'one that was refused',
            covered: 'the device\'s own journal, and the refusal surfaces on the assembly it evaporated with'
          })
          rows.push({
            subject: 'zone deaths',
            observed: 'partial',
            because:
              'no platform capability is bound here that exposes a dead zone to a peer artifact, and an ' +
              'observer of a death has to outlive it — this instance cannot report its own',
            covered: 'this device going silent in fleet(), which is indistinguishable from it being switched off'
          })
        }

        rows.push({
          subject: 'total partition',
          observed: 'none',
          because:
            'a member that reaches nobody reports to nobody; the report and the failure travel on the same wire',
          covered: 'that member appearing in fleet().silent, which a switched-off machine also does'
        })

        if (ring !== null) {
          rows.push({
            subject: 'this device\'s diagnostics, to the fleet',
            observed: 'none',
            because:
              'the kernel\'s ring is device-wide across every network this device has joined, and a beat ' +
              'replicates to one network\'s members — so putting these counts into a beat would hand one ' +
              'network\'s members another network\'s event volume, and they are deliberately kept local',
            covered: 'diagnostics() on the device itself, for a shell or an operator in front of it'
          })
        }

        return rows
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
        const [l, f, d] = await Promise.all([this.local(), this.fleet(), this.diagnostics()])

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
                // `age` on the same line rather than a row of its own, because it is the
                // second half of one sentence about one member and a reader comparing two
                // members should not have to hold two lists in their head. Rendered as
                // "last moved" rather than as a bare number, and *omitted* rather than
                // shown as a dash when it is null: this panel already carries a `limits()`
                // block that says what null means, and a placeholder on the line would be
                // read as a small age by everybody who did not scroll down to it.
                text: `${m.reach} of ${m.roster} reached` +
                  (typeof m.age === 'number' ? `, last moved ${since(m.age)} ago` : '') +
                  (m.rosterDiffers ? ', and its roster count differs from this device\'s' : ''),
                tone: m.reach < m.roster ? 'warning' : undefined
              },
              { type: 'code', text: m.device }
            ])
          })
        }

        // Only when the port answered. A panel that drew "This device's journal" as a
        // column of zeroes on a device that never bound the port would be the exact
        // reading `limits()` exists to prevent, printed by the one surface an operator
        // reads — and the row would sit two nodes above a `limits()` line saying the
        // opposite. Absent, `limits()` still carries the `zone deaths` and `refusals`
        // rows, so nothing goes unreported; it goes reported as unobserved, which is
        // the honest form.
        if (d.observed) {
          nodes.push({
            type: 'rows',
            // Named for the substrate rather than for what an operator hopes it means.
            // "Faults on this device" is the heading two nodes down and it is
            // first-person about this instance's own calls; this is the kernel's account
            // of the whole device, and giving the two similar headings would merge two
            // numbers with different scopes in a reader's head.
            label: 'This device\'s journal, by kind',
            children: [
              // Kinds first, in the order the port answered them, with no renaming and no
              // arithmetic. A `field` and not a `text`: these are label/value pairs and
              // the value is a short integer, so nothing here can clip.
              ...d.kinds.map((k) => ({ type: 'field', label: k.kind, value: String(k.count) })),
              // Last, and unconditional, because it is what qualifies every line above
              // it. Above zero the counts are lower bounds and a reader has to know
              // before reading them, which is why it is in the same block rather than in
              // `limits()`.
              { type: 'field', label: 'dropped by the bound', value: String(d.dropped) }
            ]
          })
          nodes.push({
            // The one sentence a reader needs that no count can carry, in the tone the
            // vocabulary reserves for content about an absence. Three claims now, and the
            // middle one is new because the numbers changed under it: this is the whole
            // device rather than this network, `fetch` is finally safe to read as
            // failures and is zero here for a structural reason rather than a happy one,
            // and `network` is the one name left that is still several questions.
            type: 'text',
            text: 'These are the whole device\'s counts, across every network it has joined. ' +
              'zone is instances whose thread died and refused is things this device turned ' +
              'down, both exactly; fetch is failures only, and it reads zero on a device you ' +
              'can ask because a fetch that fails takes the boot down before this runs. ' +
              'network is still several things at once and is not a count of any one of them.',
            tone: 'warning'
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
       * This artifact's command-line description.
       *
       * A fresh copy per call, for the reason `artifact-docs` gives: the spec crosses a
       * realm boundary as JSON in production, so nothing outside could mutate the
       * constant — but this is also called in-process by a suite, and a shared object a
       * caller normalizes in place is a bug that appears only there.
       */
      cli () {
        return JSON.parse(JSON.stringify(SPEC))
      },

      /**
       * The panel, as a command line answers it.
       *
       * `view()` and not a second rendering. The panel is where the numbers already
       * arrive next to what qualifies them, and an operator standing at a machine wants
       * the same reading a shell shows rather than a terser one that dropped the
       * `limits()` block — which is the block this whole artifact exists for and the
       * first thing a second rendering would leave out to save four lines.
       *
       * The title is dropped and only the title: `cli@2` actions answer `{ nodes }`, and
       * the adapter frames them under the command's own name.
       */
      async cliReport () {
        const { nodes } = await this.view()
        return { nodes }
      },

      /**
       * Write one beat, and say plainly which of the three things happened.
       *
       * The suppressed case is not a failure and must not read as one. A device that
       * beat five minutes ago with the same census has nothing to add, and a person who
       * typed this twice should be told that rather than left wondering whether it
       * worked — so it is `muted` and it says why, and the refused case is `danger`.
       *
       * No argument, because `beat()` has none. That is the redaction decision one layer
       * out arriving at a command line intact: there is no note to attach here because
       * there is no note this artifact would put in an append-only log that replicates to
       * every member and cannot be edited afterwards.
       */
      async cliBeat () {
        const result = await this.beat()

        if (result.wrote) {
          return {
            nodes: [{
              type: 'text',
              text: `Wrote a beat at sequence ${result.seq}: ${result.reach} of ${result.roster} members reached.`,
              tone: 'success'
            }]
          }
        }

        // Told apart by the fault register rather than by a second return field. A
        // refusal is counted the moment it happens, so the count is already the record,
        // and adding a `why` to `beat()`'s answer to serve one command line would put a
        // string in a contract to save a lookup in here.
        const refused = this.faults().some((f) => f.code === 'append-refused')
        return {
          nodes: [{
            type: 'text',
            text: refused
              ? 'The feed refused the append, so this device did not report. It is still reachable to whoever is standing at it.'
              : `Nothing written: ${result.reach} of ${result.roster} reached, unchanged since the last beat and recent enough that repeating it would say nothing.`,
            tone: refused ? 'danger' : 'muted'
          }]
        }
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
  shape,

  /**
   * The command line, re-exported for the same reason and with the same limit.
   *
   * `test/contract.test.js` checks the name and the version against `manifest.json`,
   * because a spec that drifted from the document the kernel verifies is two answers to
   * one question and the one a person meets is `--help`. Not on the declared shape:
   * `cli@2.0.0` names one operation, `cli()`, and this is the constant behind it rather
   * than a promise of its own.
   */
  SPEC
}
