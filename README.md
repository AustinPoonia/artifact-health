# artifact-health

What a device can see of its network's replication, reported through the network's
own feed. Observability is an artifact, not kernel code.

There is no endpoint and nothing phones home. A beat is an entry in this artifact's
`platform:feed`, so it reaches an operator the way every other entry does — by their
being a member of the network. The kernel keeps only `lib/journal.js` and gains
nothing from this repo existing.

## What it observes, and what it cannot

`ROADMAP.md` §5 names four things. **Two are reachable, and two are not** — so `limits()` returns
the blind spots as data. A dashboard that renders a zero nobody measured is worse than
one that renders nothing, which is the whole reason that operation is part of the
contract rather than a paragraph here.

| §5 asks for | Observed | How, or why not |
|---|---|---|
| replication health | **fully** | the signed roster is a denominator that needs no peer; `entries()` is a numerator that does. Their difference is a replication deficit |
| zone deaths | **fully, on this device** | `platform:diagnostics` counts them. The kernel writes a death under kind `zone`, that kind has exactly one writer, so the count is the count. Not in a beat — see below |
| refusals | **fully, on this device** | the kernel writes a refusal under kind `refused` — a contract nothing satisfies, an instance nothing could deliver, an unmeetable platform pin, a network retired mid-session, a release below the anti-rollback floor — so the count is a refusal count. A refusal that stopped *this* artifact is still unreportable by it, which is the silence row rather than a second gap |
| fetch failures | none | the one call site that fetches throws uncaught and tears the device down before any artifact runs, so the note is written to a ring nobody is left to read. The `fetch` count is now failures only — the successes are under `served` and the refused rollback under `refused` — so it is the right number and it is zero on every device alive enough to be asked |

One kernel change was said to close the last three. It closed **one**, and the
arithmetic was the interesting part: `platform:diagnostics@1` met every constraint named
for it — read-only, counts per kind, not one character of the journal's text — and it
still could not separate a refusal from a moved pin, because the kernel's six journal
*kinds* were chosen for a person reading a terminal and a kind is not a category. **A
port onto a journal cannot expose what the journal does not separate.**

So the second change was made where the separation lives. The kernel's vocabulary now
splits on who decided and whether the thing happened, which took it from six words to
eight; `platform:diagnostics@2` names them; this contract reports them at `1.2.0`. Three
repositories in that order, because each can only separate what the one below it already
did. What is left is fetch failures, and no further kind fixes it: the failure destroys
the reader. That one is read by whoever is standing at the machine.

`limits()` shrinks and grows **with the binding**, which is why it is a call rather than
a constant. A device that binds the port loses the `zone deaths` and `refusals` rows and
gains one the port creates: nothing it reports reaches the fleet, deliberately.

## How a device runs it

    artifact run health              # what this device holds, what the fleet reports, and the blind spots
    artifact run health -- beat      # append one census

For three releases there was no answer to this question. The artifact was a `file:`
dependency of the kernel's repo so two suites could reach it, and a row in an operator's
lockfile — and neither of those is a device. It provided `health` and `view`, and while
`view` really does arrive on a shell the day an instance is signed, a panel is a *read*,
and the operation every reading depends on is `beat()`, which writes. Nothing on this
platform calls it: there is no scheduler surface, and an artifact's code runs when it is
built, when a consumer calls it, when a shell renders its panel, or when somebody types a
command. So this release provides `cli@2.0.0`, which is the one of the four an artifact
can declare for itself.

Three things still have to be true and none of them is a code change. The network has to
have published this artifact; the kind is `instances: "explicit"`, so an admin has to sign
`instance create <id> health health` — a monitor that appeared wherever it was installed
would be a device deciding to report on itself, and that decision is the network's; and
something has to run `beat` on a clock, which on this platform means whatever runs
periodic commands on that machine. That last one is a real gap and it is not this repo's
to close.

## Currency, and why the beat expires

`reached` counts the members this device holds at least one entry from, which is what it
has always said and is monotone: a replicated block stays on disk, so a member counted
once is counted forever. A member that stops replicating an hour after first contact
therefore moves nothing — not `reached`, not `silent`, not `degraded`.

`age` is the field for that question: milliseconds on **this device's** clock since this
device watched that member's log get longer. Not `now - entry.at`, which subtracts
another device's unchecked clock; `platform:feed` says never to trust that field and this
does not. `null` means this instance has not watched the log move, which is not zero and
not a large number.

Making it measurable forced the beat to change. Suppressing on content alone means a
healthy member writes nothing, so a healthy member and one this device stopped
replicating with produce identical feeds and no reading can separate them. Putting a
clock *in* the census would move it and would also remove the suppression, one entry per
member per tick forever. So the census is unchanged and the suppression expires:
`beatFloor`, five minutes by default, past which an unchanged census is written again on
purpose. Set it to zero for the old behaviour, and `limits()` on that device will say
currency is unanswerable there.

## The two things worth reading the source for

**It is not a side channel.** `THREAT-MODEL.md` §2 — a provider bound by two
consumers is one object serving both, and an observability artifact is the exact
shape that becomes a channel by accident. This one is bindable twice for real
(`artifact-app` and `artifact-ui` both port `view` at `many`). Every operation but
`beat()` is a pure read, `beat()` takes no argument, `handle()` refuses every action,
and the one thing kept in the store is a digest of a census computed from inputs both
consumers can already read. **Refusing to accept reports from other artifacts is what
costs the coverage above** — the obvious design for observability is a mailbox every artifact
writes into, and that is the channel.

**No free text reaches the feed.** A feed is append-only, replicates to every member,
and is not confidential, so a secret that lands in one is on every member's disk
permanently. `lib/journal.js` may filter free text with a regex because it dies with
the process; here the filter would be the first line of defence instead of the second.
So a fault is a code from a closed seven-member vocabulary, a census is integers and
device keys, and there is no field on a beat an unbounded string can enter.
`lib/codes.js` has the argument and `test/redaction.test.js` fires real secrets down
every failing path to measure it — including down the diagnostics port, whose substrate
is the journal's free text and which is therefore the one binding this argument had to
survive.

**And nothing from the journal reaches a beat at all.** The kernel's ring is
device-wide: one per process, shared by every network this device has joined. A beat
replicates to *one* network's members, so putting those counts into one would hand that
network's members another network's event volume. A device may tell an artifact running
on it about itself; that artifact may not tell a network about a network it is not in.
That is the same asymmetry `lib/codes.js` draws between a ring that dies with the
process and a log that replicates forever, one boundary further out — and its price is a
row in `limits()`: a zone death is visible to whoever is looking at the device and not
to the fleet.

It runs only where a signed `instance.create` names it (`instances: "explicit"`).

## Layout

    index.js          the artifact: build(deps) → the health and view contracts
    lib/shape.js      health@1.3.0's shape, the source manifest.json is generated from
    lib/codes.js      the closed fault vocabulary, and why it is closed
    manifest.json     the document the kernel reads; regenerate with `npm run shape`

    npm test          # 68 assertions under the Bare runtime
    npm run typecheck # plain JS + JSDoc, via tsc --noEmit
