/**
 * The contract is written once, and this is what makes that true rather than
 * claimed.
 *
 * `lib/shape.js` and `manifest.json` both carry `health@1.0.0`'s shape because they
 * have to: the kernel reads manifests and never evaluates artifact code, and an
 * artifact cannot read its own manifest — no filesystem, and `require` past its own
 * bundle throws. Two copies of one description is exactly the drift this arrangement
 * exists to delete, so the first case compares them byte for byte as canonical JSON.
 * Without it, "one source of truth" is a story about two files.
 *
 * ## Two things this repo cannot check, and where they are checked instead
 *
 * `artifact-protocol` is not a dependency of an artifact and must not become one —
 * an artifact depending on the kernel's protocol library is the coupling the whole
 * platform is arranged to avoid. So `canonical` is reimplemented below in six lines
 * and `parseShape` is not reimplemented at all: what runs here is the subset of its
 * rules that catch a typo, and the authoritative parse happens in the kernel, where
 * `bundle.load` puts every manifest through `Manifest.parse` before an artifact is
 * allowed to assemble. A malformed shape does not reach production; it takes the
 * kernel suite down.
 *
 * ## The manifest claims this artifact does not default itself on, and that is a case
 *
 * `instances: "explicit"` is not decoration here. A monitor has to be opt-in per
 * network by a signed `instance.create`, and `THREAT-MODEL.md` §2.4
 * names the field as the one lever on the shared-provider residual that does not cost
 * a binding per consumer. A commit that dropped it would turn a monitor an admin
 * chose into a monitor every network with this artifact installed silently runs, and
 * nothing else in this repo would notice. So it is asserted, with the reason attached.
 */
const t = require('bare-tap')
const assert = require('bare-assert')
const fs = require('bare-fs')
const path = require('bare-path')
const health = require('..')
const shape = require('../lib/shape')

/** @type {[string, () => Promise<void> | void][]} */
const cases = []
const test = (/** @type {string} */ n, /** @type {any} */ f) => cases.push([n, f])

/**
 * JSON with object keys sorted, so key order cannot fail a comparison that is about
 * content. The same encoding `artifact-protocol/lib/hash.js` uses to decide whether
 * two nodes agree, minus the rejections — nothing here can be a Date or a bigint,
 * because one side of every comparison came out of a JSON file.
 *
 * @param {unknown} value
 * @returns {string}
 */
function canonical (value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  const fields = /** @type {Record<string, unknown>} */ (value)
  return '{' + Object.keys(fields).sort().map((k) => `${JSON.stringify(k)}:${canonical(fields[k])}`).join(',') + '}'
}

const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.json')).toString())

/** A `health` wired with the least it will build on. */
const instance = () => health.build({
  feed: { who: async () => 'dev-a', append: async () => 0, entries: async () => [], own: async () => [] },
  store: { get: async () => null, put: async () => true, delete: async () => false, keys: async () => [] },
  roster: { members: async () => [], whoami: async () => ({ device: 'dev-a', member: true, user: 'alice' }) }
})

/* ─────────────────── one description, in two files, identical ───────────────── */

test('the manifest declares exactly the shape the artifact carries', () => {
  // Found by id and not by `id && version === '1.0.0'`, which is what it was. Binding
  // `platform:diagnostics` took this contract to `1.1.0` and the version-pinned lookup then found nothing,
  // so the case failed on "the health contract is still declared here" — a true message
  // about the wrong thing. A suite comparing two copies of one document has no business
  // pinning the version of the document; `the manifest version and the package version
  // agree` is the case that owns the number, and it owns it once.
  const declared = manifest.contracts.filter((/** @type {any} */ c) => c.id === 'health')
  assert.equal(declared.length, 1, 'exactly one health contract is declared here')
  assert.ok(declared[0].shape, 'and it carries a shape, or the kernel checks nothing')

  // Byte for byte. A description reworded in one file and not the other is the
  // whole failure mode, and it is invisible to every other test in this repo.
  assert.equal(canonical(declared[0].shape), canonical(shape),
    'manifest.json and lib/shape.js have drifted; run `npm run shape` — the module is the source')
})

test('the artifact re-exports the same shape a suite would read off disk', () => {
  assert.equal(canonical(health.shape), canonical(shape),
    'index.js re-exports lib/shape.js, so a consumer reaching through the artifact sees the same promise')
})

test('the shape is well-formed the way the kernel will parse it', () => {
  const TYPES = ['string', 'number', 'boolean', 'bytes', 'object', 'array', 'any']
  const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/

  /**
   * @param {any} s
   * @param {string} at
   */
  const walk = (s, at) => {
    assert.ok(s && typeof s === 'object', `${at} is an object`)
    assert.ok(TYPES.includes(s.type), `${at}.type is one of the vocabulary, got ${JSON.stringify(s.type)}`)
    assert.equal(typeof s.description, 'string', `${at} has a description`)
    assert.ok(s.description.length > 0, `${at}'s description is not empty`)
    // `optional` and `nullable` are different claims and both are booleans when
    // present. A string `"true"` here would be truthy and would parse, which is
    // exactly the typo worth catching before a device does.
    for (const flag of ['optional', 'nullable']) {
      if (s[flag] !== undefined) assert.equal(typeof s[flag], 'boolean', `${at}.${flag} is a boolean`)
    }
    if (s.type === 'array') {
      assert.ok(s.of, `${at} is an array and declares what it holds`)
      walk(s.of, `${at}.of`)
    }
    if (s.fields) {
      for (const [k, v] of Object.entries(s.fields)) {
        assert.ok(IDENT.test(k), `${at}.fields has a usable name ${JSON.stringify(k)}`)
        walk(v, `${at}.fields.${k}`)
      }
    }
  }

  assert.equal(typeof shape.description, 'string')
  assert.ok(shape.description.length > 0, 'the contract describes itself')
  assert.ok(Array.isArray(shape.operations) && shape.operations.length > 0,
    'and declares operations; a shape with none would pass every other case here')

  const seen = new Set()
  for (const op of shape.operations) {
    assert.ok(IDENT.test(op.name), `${op.name} is a usable identifier`)
    assert.ok(!seen.has(op.name), `${op.name} is declared once`)
    seen.add(op.name)
    assert.equal(typeof op.description, 'string')
    assert.ok(op.description.length > 0, `${op.name} says what it does`)
    assert.ok(Array.isArray(op.params), `${op.name}.params is an array`)
    for (const p of op.params) {
      assert.ok(IDENT.test(p.name), `${op.name}(${p.name}) is a usable identifier`)
      walk(p, `${op.name}(${p.name})`)
    }
    if (op.returns) walk(op.returns, `${op.name} returns`)
  }
})

/* ─────────────── every declared operation exists, and nothing extra writes ──── */

test('the artifact implements every operation it declares', () => {
  const built = instance()
  for (const op of shape.operations) {
    assert.equal(typeof (/** @type {any} */ (built))[op.name], 'function',
      `${op.name} is declared and must exist, or a port refuses a call the contract promised`)
  }
})

test('beat is the only declared operation that takes a parameter, and it takes none', () => {
  // The claim from lib/shape.js's header, asserted rather than left as prose: a
  // beat carrying a caller's string would put text this artifact did not author
  // into an append-only log that replicates to every member. There is nothing to
  // redact because there is no argument.
  const beat = shape.operations.find((o) => o.name === 'beat')
  if (beat === undefined) assert.fail('beat is declared')
  assert.equal(beat.params.length, 0, 'beat takes no argument, deliberately')

  for (const op of shape.operations) {
    assert.equal(op.params.length, 0,
      `${op.name} takes no argument; every operation on this contract is a read except beat, which writes nothing it was told`)
  }
})

test('the contract declares no operation that accepts a value to remember', () => {
  // THREAT-MODEL.md §2.1's channel needs the provider to remember something a
  // consumer put there. This is the declaration-side half of that closure: there
  // is no operation here through which a value could arrive. The runtime half is
  // in test/artifact.test.js, which enumerates what actually reaches the store.
  const writes = ['note', 'record', 'report', 'log', 'clear', 'silence', 'ack', 'set', 'put']
  for (const op of shape.operations) {
    assert.ok(!writes.includes(op.name),
      `${op.name} is a mailbox-shaped operation; see index.js on why this artifact accepts no reports`)
  }
})

/* ──────────────────── the manifest's wiring claims ──────────────────────────── */

test('the kind does not default itself on, so a network has to sign for it', () => {
  const kind = manifest.kinds.find((/** @type {any} */ k) => k.key === 'health')
  assert.ok(kind, 'the health kind is declared')
  assert.equal(kind.instances, 'explicit',
    'without this a monitor runs wherever the artifact is installed, which is a device deciding to report on itself')
})

test('it declares the four ports it builds on and no more', () => {
  const kind = manifest.kinds.find((/** @type {any} */ k) => k.key === 'health')
  const ports = kind.ports.map((/** @type {any} */ p) => `${p.name}:${p.contract}`).sort()
  assert.equal(ports.join(' '),
    'diagnostics:platform:diagnostics feed:platform:feed roster:platform:network-view store:platform:store',
    'exactly these four')

  // platform:blobs is deliberately absent. index.js has the argument: a blob store
  // is scoped per artifact, this one puts nothing in it, so the only fetch failures
  // it could observe would be of content it never fetched. A port declared to
  // report an empty category is how a monitor comes to look more capable than it is.
  const contracts = kind.ports.map((/** @type {any} */ p) => p.contract)
  assert.ok(!contracts.includes('platform:blobs'),
    'no blobs port; limits() says why rather than a port implying coverage')
  assert.ok(!contracts.includes('platform:host'),
    'and emphatically no host port — that is user-level RCE, per THREAT-MODEL.md §1')

  // Three required and one optional, and which is which is the whole of the diagnostics
  // port's arrival here. This case used to assert `one` for every port on the argument that the
  // artifact "has no optional-port behaviour to report"; it has exactly one now, and it
  // is the behaviour `limits()` was written as a method for. Spelled per port rather than
  // as a count, because the failure worth catching is a *feed* becoming optional — a
  // monitor that would build without the log it measures — and a count cannot see that.
  const cardinality = Object.fromEntries(kind.ports.map((/** @type {any} */ p) => [p.name, p.cardinality]))
  assert.equal(cardinality.feed, 'one', 'a monitor that would build without the feed it measures reports nothing')
  assert.equal(cardinality.store, 'one', 'the store is what suppresses duplicate beats; without it the feed grows forever')
  assert.equal(cardinality.roster, 'one', 'the roster is the denominator every reading divides by')
  assert.equal(cardinality.diagnostics, 'optional',
    'the one port whose absence is survivable: without it limits() keeps the zone-deaths row and ' +
    'diagnostics() answers observed false, which is the honest report rather than a refusal to run')
})

test('every contract it provides is one it or a dependency declares', () => {
  const kind = manifest.kinds.find((/** @type {any} */ k) => k.key === 'health')
  const provides = kind.provides.map((/** @type {any} */ p) => `${p.id}@${p.version}`).sort()
  assert.equal(provides.join(' '), 'health@1.1.0 view@1.1.0',
    'the contract it authors, and the panel vocabulary it renders into')

  // The version it provides is the version it declares. Two numbers for one contract in
  // one manifest is a document the kernel resolves one half of, and the `1.1.0` bump was
  // exactly the commit that could have left them apart.
  const declared = manifest.contracts.filter((/** @type {any} */ c) => c.id === 'health')
  assert.equal(declared.length, 1)
  assert.equal(
    kind.provides.find((/** @type {any} */ p) => p.id === 'health').version,
    declared[0].version,
    'the kind provides a version of health that this manifest does not declare')

  // `view` is artifact-ui's, which is why ui is in deps. Providing a contract no
  // manifest in the graph declares is a plan fault, and one this repo can catch.
  const deps = manifest.deps.map((/** @type {any} */ d) => d.name)
  assert.ok(deps.includes('ui'), 'view@1.1.0 is declared by artifact-ui, so ui is a dep')
})

test('the config schema declares only the bound, so nothing configurable can widen what is reported', () => {
  const kind = manifest.kinds.find((/** @type {any} */ k) => k.key === 'health')
  assert.ok(kind.config, 'the kind declares a config schema, or the kernel refuses config to it')
  const fields = Object.keys(kind.config.fields).sort()
  assert.equal(fields.join(' '), 'maxMembers',
    'one field, a bound. A setting that changed what a beat carries would be a redaction decision in a network document')
  for (const f of Object.values(kind.config.fields)) {
    assert.equal((/** @type {any} */ (f)).type, 'number',
      'every setting is a number; a string setting is a string on its way into a replicated log')
  }
})

/* ────────────────── the manifest is the document the kernel reads ───────────── */

test('the entry the manifest names is the file that exists', () => {
  assert.equal(manifest.entry, '/index.js', 'rooted at the bundle, not relative')
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'index.js')), 'and it is on disk')
})

test('the manifest version and the package version agree', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json')).toString())
  assert.equal(manifest.version, pkg.version,
    'a release pins the manifest hash, so two versions of one artifact is a document nobody can reason about')
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
