/** Named drafts reuse the existing single-container DATA_DIR persistence. */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DATA_DIR } from '../config.ts';
import { DRAFT_VERSION, restoreLine } from './drafts.ts';
import type { SavedDraft } from './drafts.ts';
import type { BuilderLine } from './types.ts';

const file = () => path.join(DATA_DIR, 'builder-drafts.v1.json');
export async function readDrafts(): Promise<SavedDraft[]> {
  let content: string;
  try {
    content = await readFile(file(), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const value = JSON.parse(content);
  if (
    !value ||
    value.version !== DRAFT_VERSION ||
    !Array.isArray(value.drafts) ||
    value.drafts.length > 50
  )
    throw new Error('Unsupported or damaged draft store');
  return value.drafts.map((draft: SavedDraft) => {
    const line = restoreLine(draft?.line);
    if (
      !line ||
      typeof draft.id !== 'string' ||
      !Number.isFinite(Date.parse(draft.savedAt))
    )
      throw new Error('Damaged draft');
    return { id: draft.id, savedAt: draft.savedAt, line };
  });
}
let queue: Promise<unknown> = Promise.resolve();
export function saveDraft(line: BuilderLine): Promise<SavedDraft[]> {
  const run = queue.then(async () => {
    const drafts = await readDrafts();
    if (drafts.length >= 50) throw new Error('Draft limit reached');
    const next = [
      { id: randomUUID(), savedAt: new Date().toISOString(), line },
      ...drafts,
    ];
    await mkdir(path.dirname(file()), { recursive: true });
    await writeFile(
      `${file()}.tmp`,
      JSON.stringify({ version: DRAFT_VERSION, drafts: next }),
      'utf8',
    );
    await rename(`${file()}.tmp`, file());
    return next;
  });
  queue = run.catch(() => undefined);
  return run;
}
