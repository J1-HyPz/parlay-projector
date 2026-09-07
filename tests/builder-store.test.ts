/** Real persistence behavior in an isolated temporary directory; no real drafts. */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { it } from 'node:test';
import { emptyLine } from '../lib/builder/types.ts';

const dataDir = await mkdtemp(path.join(tmpdir(), 'parlay-builder-test-'));
process.env.DATA_DIR = dataDir;
const { readDrafts, saveDraft } = await import('../lib/builder/store.ts');

it('serializes concurrent draft writes and refuses to erase a corrupted store', async () => {
  assert.deepEqual(await readDrafts(), []);
  await Promise.all([
    saveDraft({ ...emptyLine(), name: 'First test draft' }),
    saveDraft({ ...emptyLine(), name: 'Second test draft' }),
  ]);
  const drafts = await readDrafts();
  assert.equal(drafts.length, 2);
  assert.deepEqual(
    new Set(drafts.map((d) => d.line.name)),
    new Set(['First test draft', 'Second test draft']),
  );
  assert.equal(new Set(drafts.map((d) => d.id)).size, 2);
  const file = path.join(dataDir, 'builder-drafts.v1.json');
  const raw = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(raw.version, 1);
  await writeFile(file, '{damaged', 'utf8');
  await assert.rejects(readDrafts());
  await assert.rejects(
    saveDraft({ ...emptyLine(), name: 'Must not overwrite' }),
  );
  assert.equal(await readFile(file, 'utf8'), '{damaged');
});
