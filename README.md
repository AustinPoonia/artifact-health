# artifact-health

What a device can see of its network's replication, reported through the network's
own feed. `ROADMAP.md` §6b: observability is an artifact, not kernel code.

There is no endpoint and nothing phones home. A beat is an entry in this artifact's
`platform:feed`, so it reaches an operator the way every other entry does — by their
being a member of the network. The kernel keeps only `lib/journal.js` and gains
nothing from this repo existing.

## What it observes, and what it cannot

§6b names four things. **One is fully reachable from inside a realm, one only in a
degenerate form, and two are not reachable at all** — so `limits()` returns the blind
spots as data. A dashboard that renders a zero nobody measured is worse than one that
renders nothing, which is the whole reason that operation is part of the contract
rather than a paragraph here.

| §6b asks for | Observed | How, or why not |
|---|---|---|
| replication health | **fully** | the signed roster is a denominator that needs no peer; `entries()` is a numerator that does. Their difference is a replication deficit |
| refusals | partial | only refusals of *this instance's own* calls. A refusal is what stopped an artifact being built, so the artifact that would report it may be the one refused |
| fetch failures | none | a release that cannot be fetched fails during boot, before any artifact runs, on the path where the whole device is torn down |
| zone deaths | partial | only this instance's own, seen from outside as silence — indistinguishable from the machine being off |

Closing the last three is **one kernel change**, not more work here: a read-only
`platform:diagnostics` port onto the `Journal` the kernel already keeps. `index.js`'s
header has the design and the risk that comes with it.

## The two things worth reading the source for

**It is not a side channel.** `THREAT-MODEL.md` §2 — a provider bound by two
consumers is one object serving both, and an observability artifact is the exact
shape that becomes a channel by accident. This one is bindable twice for real
(`artifact-app` and `artifact-ui` both port `view` at `many`). Every operation but
`beat()` is a pure read, `beat()` takes no argument, `handle()` refuses every action,
and the one thing kept in the store is a digest of a census computed from inputs both
consumers can already read. **Refusing to accept reports from other artifacts is what
costs the coverage above** — the obvious design for §6b is a mailbox every artifact
writes into, and that is the channel.

**No free text reaches the feed.** A feed is append-only, replicates to every member,
and is not confidential, so a secret that lands in one is on every member's disk
permanently. `lib/journal.js` may filter free text with a regex because it dies with
the process; here the filter would be the first line of defence instead of the second.
So a fault is a code from a closed six-member vocabulary, a census is integers and
device keys, and there is no field on a beat an unbounded string can enter.
`lib/codes.js` has the argument and `test/redaction.test.js` fires real secrets down
every failing path to measure it.

It runs only where a signed `instance.create` names it (`instances: "explicit"`).

## Layout

    index.js          the artifact: build(deps) → the health and view contracts
    lib/shape.js      health@1.0.0's shape, the source manifest.json is generated from
    lib/codes.js      the closed fault vocabulary, and why it is closed
    manifest.json     the document the kernel reads; regenerate with `npm run shape`

    npm test          # 51 assertions under the Bare runtime
    npm run typecheck # plain JS + JSDoc, via tsc --noEmit
