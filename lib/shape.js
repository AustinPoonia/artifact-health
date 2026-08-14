/**
 * What `health@1.1.0` promises, written once, as data.
 *
 * The same arrangement `artifact-send/lib/shape.js` argues for and for the same
 * two reasons: the kernel reads manifests and never evaluates artifact code, and
 * an artifact runs in a realm with no filesystem and no `require` past its own
 * bundle. So the shape has to exist in `manifest.json` and in a module, and only
 * one of the two may be authored by a person. This is the one.
 * `test/contract.test.js` compares them as canonical JSON; `npm run shape` is the
 * remedy when they differ, and the direction is always module → manifest.
 *
 * ## Why `limits` is an operation and not a paragraph in a README
 *
 * This is the decision that shapes the whole contract. `ROADMAP.md` §5 names four
 * things a device should report — replication health, refusals, fetch failures and
 * zone deaths — and only the first is reachable from inside a realm. An artifact
 * that answered the other three with zeroes would be worse than one that did not
 * answer them at all: a fleet dashboard showing "0 zone deaths" across 400 devices
 * reads as health and is actually a measurement nobody took.
 *
 * So the blind spots are **part of the promise**, declared, versioned, and
 * returned by a call. A caller holding a `health` binding can render "not
 * observed" next to "0" and an operator can tell the difference. `index.js`'s
 * header has the full account of which is which and why; this file is where a
 * consumer learns the list exists without reading our source.
 *
 * The alternative — leaving it to documentation — was rejected because the four
 * items are not a fixed list. The day a kernel change makes zone deaths reachable,
 * `limits` shrinks and every dashboard bound to this contract stops drawing an
 * asterisk it no longer needs, without anybody editing a dashboard. A README
 * cannot do that.
 *
 * **That day arrived, and it is the reason this contract is at `1.1.0`.**
 * `platform:diagnostics` is bound, `zone deaths` is out of `limits`, and the count is on
 * `diagnostics` below. The prediction held exactly: no dashboard changed, and a shell
 * rendering `limits()` stopped drawing one asterisk and started drawing a number. Two of
 * the original four rows stayed with *rewritten reasons* rather than the same reason, and
 * that is the part the design did not anticipate — a port can make a category reachable
 * while leaving the sentence about it wrong in a new way. `index.js` has each one.
 *
 * ## Why `diagnostics` is an operation of its own and not a field on `local`
 *
 * `local()` is *this device's replication health*, computed from the roster and the feed,
 * and every number on it is about this network. What `diagnostics()` answers comes off the
 * kernel's device-wide journal, which spans every network this device has joined. Folding
 * the two into one record would produce an object half of whose fields are scoped to the
 * caller's network and half of which are not, with nothing in the shape saying which —
 * and the whole argument of this artifact is that a number nobody qualified is worse than
 * no number. So it is a separate call, with the scope in its own description.
 *
 * It is also why nothing from it reaches a **beat**. A beat is an entry in one network's
 * feed and replicates to that network's members; the journal counts include events
 * belonging to other networks this device is in, so broadcasting them would export one
 * network's event volume to members of another. A device may tell an artifact running on
 * it about itself; that artifact may not tell a network about a network it is not in.
 * That asymmetry is the same one `lib/codes.js` draws between a ring that dies with the
 * process and a log that replicates forever, one boundary further out — and the price is
 * in `limits` under its own row, because it means a zone death is visible to whoever is
 * looking at the device and not to the fleet.
 *
 * ## `beat` is the only write, and the contract says so out loud
 *
 * Every other operation here is a pure read of the feed and the roster.
 * `THREAT-MODEL.md` §2 is why: this artifact provides `view@1.1.0`, and both
 * `artifact-app`'s `app` kind and `artifact-ui`'s `shell` kind port `view` at
 * cardinality `many`, so one instance of this artifact really can be bound by two
 * consumers — which is §2.1's shape exactly. The closure is that nothing a
 * consumer passes is ever remembered, and a reader of the contract should be able
 * to establish that from the declaration rather than by trusting the
 * implementation. Hence a write operation that is named, singular, and takes no
 * argument.
 *
 * `beat()` taking no parameters is load-bearing rather than tidy. A `beat(note)`
 * would put a caller's string into an append-only log that replicates to every
 * member and is never deletable, which is the redaction failure `index.js` is
 * arranged to make unreachable. There is no argument to this call because there is
 * no argument this artifact would be willing to write down.
 *
 * ## What is deliberately not here
 *
 * No `history`. A per-beat time series over the whole fleet is the thing an
 * operator will ask for next, and it is a query over the feed that any consumer of
 * `platform:feed` can run for itself. Answering it here would mean holding a
 * window in the store, which is state, which is the one thing §2 says to count.
 *
 * No `clear` and no `silence`. An acknowledgement surface is a second kind of
 * write, and a write whose whole purpose is to stop a fault being reported is the
 * one operation an observability artifact should not have.
 */

/** @typedef {'string' | 'number' | 'boolean' | 'bytes' | 'object' | 'array' | 'any'} SchemaType */

/**
 * @typedef {object} Schema
 * @property {SchemaType} type
 * @property {string} description
 * @property {boolean} [optional]
 * @property {boolean} [nullable]
 * @property {Schema} [of]
 * @property {Record<string, Schema>} [fields]
 */

/** @typedef {Schema & { name: string }} Param */

/**
 * @typedef {object} Operation
 * @property {string} name
 * @property {string} description
 * @property {Param[]} params
 * @property {Schema} [returns]
 */

/**
 * @typedef {object} Shape
 * @property {string} description
 * @property {Operation[]} operations
 */

/**
 * One member of the network as this device currently sees it.
 *
 * `device` and never `user`. Both are reachable — `platform:network-view`'s
 * `whoami` answers a user id — and the choice is the redaction argument in
 * miniature: replication is a fact about devices, a user id would add nothing to
 * the diagnosis, and this record is written into an append-only log that
 * replicates to every member and cannot be edited afterwards. A field that buys
 * no diagnosis does not go into a permanent broadcast.
 *
 * `device` is also the one string here that is safe by construction: every entry
 * `platform:feed` returns already carries it, authenticated, so naming it tells a
 * reader nothing they did not receive with the entry.
 *
 * @type {Schema}
 */
const PEER = {
  type: 'object',
  description: 'One member of the network, and what this device currently holds from it',
  fields: {
    device: { type: 'string', description: 'The member\'s device key, z-base32, as feed entries carry it' },
    seq: { type: 'number', description: 'The highest sequence number this device holds from that member, or -1 when nothing from it has ever arrived' },
    beats: { type: 'number', description: 'How many of that member\'s health beats have reached this device' },
    silent: { type: 'boolean', description: 'Whether that member is in the signed roster and has sent this device nothing at all. Silence is not the same as failure — see limits' }
  }
}

/**
 * One fault this device recorded about itself.
 *
 * `code` and not `message`, and this is the sharpest line in the file. A message
 * would be a string this artifact did not write — a port refusal's wording, an
 * error thrown across a realm boundary by an author this device's owner did not
 * choose — put into a log that replicates to every member and is append-only. A
 * closed vocabulary cannot carry a secret because there is nowhere in it for an
 * unbounded string to sit.
 *
 * `lib/codes.js` is the vocabulary and its header is the argument. The cost is
 * stated in the same breath: a code is coarser than a message, so an operator
 * seeing `store-refused` learns that the store refused and not which key, and the
 * device-local `journal.js` in the kernel is where the fuller reason lives for
 * whoever is standing at the machine.
 *
 * @type {Schema}
 */
const FAULT = {
  type: 'object',
  description: 'A fault this device observed first-person, as a code from a closed vocabulary',
  fields: {
    code: { type: 'string', description: 'What went wrong, from a fixed list — never a message, because a message is a string this artifact did not write' },
    count: { type: 'number', description: 'How many times this device has seen it since the counters were last written' },
    at: { type: 'number', description: 'When this device last saw it, by its own clock. A display hint, never a sort key across devices' }
  }
}

/** @type {Shape} */
const shape = {
  description:
    'What this device can see of its own health and the network\'s replication, reported through the ' +
    'network\'s own feed rather ' +
    'than to a collector. There is no endpoint and nothing phones home: a beat is an entry in this ' +
    'artifact\'s feed, so it reaches an operator the same way every other entry does — by being a member of ' +
    'the network they are a member of. Two things to write against. Every read here is eventually consistent ' +
    'for the reason platform:feed states: it merges the members this device can currently reach, so a fully ' +
    'partitioned member is absent rather than reported broken, and absence is the one fault this artifact ' +
    'cannot distinguish from a switched-off machine. And the coverage is partial by construction — call ' +
    'limits() and render what it names, because some of what an operator will ask about is not reachable ' +
    'from inside a realm and answering it with zero would be worse than not answering. What is reachable ' +
    'depends on the ports this network bound, which is why limits() is a call and not a document.',
  operations: [
    {
      name: 'beat',
      description:
        'Append one census of what this device can currently see. The only operation here that writes ' +
        'anything, and it takes no argument on purpose: a beat carrying a caller\'s string would put text ' +
        'this artifact did not author into an append-only log that replicates to every member. Suppressed ' +
        'when the census is identical to the last one this device wrote, so a healthy fleet stops growing ' +
        'its feed rather than beating forever.',
      params: [],
      returns: {
        type: 'object',
        description: 'What was written, or why nothing was',
        fields: {
          wrote: { type: 'boolean', description: 'Whether an entry was appended. False means the census had not changed, which is the healthy case' },
          seq: { type: 'number', nullable: true, description: 'The sequence number in this device\'s own log, or null when nothing was written' },
          reach: { type: 'number', description: 'How many roster members this device holds anything from, this beat' },
          roster: { type: 'number', description: 'How many members the signed roster names' }
        }
      }
    },
    {
      name: 'local',
      description:
        'This device\'s own replication health, first-person. Computed from the signed roster and from what ' +
        'has actually arrived, so it is the one reading here that does not depend on another member being ' +
        'reachable — which makes it the reading to trust when the fleet view is thin.',
      params: [],
      returns: {
        type: 'object',
        description: 'What this device holds, against what the network says exists',
        fields: {
          device: { type: 'string', description: 'This device\'s own key' },
          roster: { type: 'number', description: 'Members the signed roster names, this device included' },
          reached: { type: 'number', description: 'Members this device holds at least one entry from' },
          silent: { type: 'array', description: 'Roster members this device has received nothing from, sorted by key', of: { type: 'string', description: 'A device key' } },
          peers: { type: 'array', description: 'Every roster member and what this device holds from it, sorted by key', of: PEER },
          degraded: { type: 'boolean', description: 'Whether any roster member is silent. A one-field answer for a caller that only wants to know whether to look closer' }
        }
      }
    },
    {
      name: 'fleet',
      description:
        'Every member\'s most recent beat that has reached this device. This is the answer to "replication is ' +
        'failing for 10% of consumers": a member whose own beat says it reaches 2 of 20 is reporting its own ' +
        'partial failure, and that report arrives as long as it can reach anybody. What it cannot show is a ' +
        'member that reaches nobody, because that member\'s report reaches nobody either.',
      params: [],
      returns: {
        type: 'object',
        description: 'The fleet as the beats that got here describe it',
        fields: {
          reporting: { type: 'number', description: 'Members whose beat has reached this device' },
          roster: { type: 'number', description: 'Members the signed roster names' },
          worst: { type: 'number', nullable: true, description: 'The lowest reach any reporting member claims, as a count of members; null when nobody has reported' },
          members: {
            type: 'array',
            description: 'One row per reporting member, worst reach first, then by key',
            of: {
              type: 'object',
              description: 'One member\'s own account of what it can see',
              fields: {
                device: { type: 'string', description: 'The reporting member\'s device key' },
                reach: { type: 'number', description: 'How many members it said it holds anything from' },
                roster: { type: 'number', description: 'How many members its roster named when it wrote the beat' },
                faults: { type: 'number', description: 'How many first-person faults it reported in that beat' },
                at: { type: 'number', description: 'That member\'s own clock when it wrote the beat. A hint, never a sort key' },
                rosterDiffers: { type: 'boolean', description: 'Whether that member counted a different number of roster members than this device does. Two members folding the same signed log agree on its size, so a difference means one of them is acting on a log it has not re-read — which is a staleness this device can see from outside and the stale device cannot see from inside' }
              }
            }
          },
          silent: { type: 'array', description: 'Roster members that have never reported a beat here, sorted by key', of: { type: 'string', description: 'A device key' } }
        }
      }
    },
    {
      name: 'faults',
      description:
        'Faults this device observed about itself, as codes. First-person only: a fault is something that ' +
        'happened to this instance\'s own calls, never something inferred about somebody else. The wording of ' +
        'what went wrong is deliberately not here — see the code vocabulary, and the kernel\'s device-local ' +
        'journal for the fuller reason.',
      params: [],
      returns: {
        type: 'array',
        description: 'One row per code seen, most recent first',
        of: FAULT
      }
    },
    {
      name: 'diagnostics',
      description:
        'What the kernel wrote in this device\'s own diagnostic ring, by kind, read through ' +
        'platform:diagnostics. Two things to hold on to before using a number here, both of which the ' +
        'platform contract states at greater length. First, the scope: the ring is device-wide, not ' +
        'per-network, so these counts include events belonging to other networks this device has joined — ' +
        'which is why they are on their own call and why none of them is ever put into a beat. Second, a ' +
        'kind is not a category: "zone" is exactly the number of instances whose thread died, but "network" ' +
        'includes refusals alongside pin moves and admissions and is not a refusal count, and "fetch" is in ' +
        'practice a count of fetches that succeeded and were worth noting, because a fetch that failed took ' +
        'the boot down before this artifact could run. When the port is not bound this answers observed ' +
        'false and no counts at all, rather than zeroes.',
      params: [],
      returns: {
        type: 'object',
        description: 'The device\'s own diagnostic counts, or the fact that they were not reachable',
        fields: {
          observed: {
            type: 'boolean',
            description:
              'Whether the port answered. False means this network did not bind platform:diagnostics, or ' +
              'that the call was refused — and the two are distinguishable, because the second records a ' +
              'diagnostics-unreachable fault and the first records nothing. Read this before reading kinds: ' +
              'false with an empty list is "nobody measured", which is not the same claim as zero.'
          },
          dropped: {
            type: 'number',
            description:
              'How many events the kernel\'s ring discarded to stay inside its bound since the process ' +
              'started. Above zero, every count below is a lower bound, because the ring drops entries and ' +
              'not counters. Zero when the port is not bound, which observed already says.'
          },
          kinds: {
            type: 'array',
            description:
              'One row per kind the platform contract names, in its order, or empty when observed is false. ' +
              'Never partially filled: a caller reading a short list would be reading a vocabulary this ' +
              'release does not know rather than a device with fewer kinds of trouble.',
            of: {
              type: 'object',
              description: 'One kind of diagnostic event and how many of it the kernel\'s ring still holds',
              fields: {
                kind: {
                  type: 'string',
                  description:
                    'The kind, from the closed vocabulary platform:diagnostics declares — never a string ' +
                    'this artifact or the kernel\'s journal composed. An entry whose kind the platform ' +
                    'contract does not name is counted under "other" by the port itself. A name that is not ' +
                    'shaped like a kind at all — too long, or outside lowercase letters, digits and hyphens ' +
                    '— is collapsed into a single "unnamed" row here, counted rather than dropped. A kind ' +
                    'this release has never heard of is reported under its own name, because a filter ' +
                    'against a list held in an artifact would hide a newer runtime rather than a leak.'
                },
                count: {
                  type: 'number',
                  description: 'How many events of that kind the ring still holds. A lower bound whenever dropped is above zero'
                }
              }
            }
          }
        }
      }
    },
    {
      name: 'limits',
      description:
        'What this artifact cannot observe, as data rather than as prose. Render it. A dashboard that shows ' +
        'zero for something nobody measured is the failure this operation exists to prevent, and the list ' +
        'shrinks on its own when the platform makes one of these reachable — which it has done once, so ' +
        'this list is shorter on a device that binds platform:diagnostics than on one that does not, and a ' +
        'caller comparing two devices is comparing two honest answers rather than one stale one.',
      params: [],
      returns: {
        type: 'array',
        description: 'One row per thing an operator will ask for and this artifact cannot answer',
        of: {
          type: 'object',
          description: 'One blind spot',
          fields: {
            subject: { type: 'string', description: 'What is not observed, in the words the roadmap uses for it' },
            observed: { type: 'string', description: 'How much of it is observed: none, or partial' },
            because: { type: 'string', description: 'Why it is not reachable from inside a realm, in one sentence' },
            covered: { type: 'string', description: 'Where the fact does exist on this device, for whoever is standing at it' }
          }
        }
      }
    }
  ]
}

module.exports = shape
