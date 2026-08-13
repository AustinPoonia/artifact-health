/**
 * Write `lib/shape.js` into `manifest.json`, because the shape has to be in both
 * and may only be authored in one.
 *
 * The same script `artifact-send/scripts/shape.js` is, for the same reasons: the
 * kernel reads manifests and never evaluates artifact code, so the shape has to be
 * in `manifest.json` for a contract to be checkable at all; the artifact runs in a
 * realm with no filesystem and no `require` past its own bundle, so the same shape
 * has to be in `lib/shape.js` for anything in here to read it. Neither copy can be
 * dropped and neither side can read the other's.
 *
 * Only one of the two is written by a person. `test/contract.test.js` compares them
 * as canonical JSON and fails when they differ; this is what makes that failure a
 * one-command fix rather than a hand-merge, and the remedy is what keeps a hurried
 * author from editing the manifest directly and leaving the module behind.
 *
 * Not run automatically, deliberately. `manifest.json` is a signed document's input
 * — a release pins its hash — so it changes when an author decides it changes,
 * never as a side effect of a test run.
 *
 *     npm run shape
 */
const fs = require('bare-fs')
const path = require('bare-path')

const shape = require('../lib/shape')

const file = path.join(__dirname, '..', 'manifest.json')
const manifest = JSON.parse(fs.readFileSync(file, 'utf8'))

const declared = manifest.contracts.find(
  (/** @type {any} */ c) => c.id === 'health' && c.version === '1.0.0'
)
if (!declared) throw new Error('manifest.json no longer declares health@1.0.0')

// Two spaces and a trailing newline, matching the file as it is checked in.
declared.shape = shape
fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n')

console.log(`wrote health@1.0.0's shape (${shape.operations.length} operations) into manifest.json`)
