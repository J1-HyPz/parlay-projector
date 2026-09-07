import { json } from '@/lib/home/api';
import { restoreLine } from '@/lib/builder/drafts';
import { readDrafts, saveDraft } from '@/lib/builder/store';
export const dynamic = 'force-dynamic';
export async function GET(): Promise<Response> {
  try {
    return json({ drafts: await readDrafts(), storage: 'server' });
  } catch {
    return json(
      {
        error: 'drafts_unavailable',
        message:
          'Saved drafts could not be read. Check the server data volume.',
      },
      503,
    );
  }
}
export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    const raw = await request.text();
    if (raw.length > 100_000) return json({ error: 'draft_too_large' }, 413);
    body = JSON.parse(raw);
  } catch {
    return json({ error: 'invalid_body' }, 400);
  }
  const line = restoreLine(body);
  if (!line || !line.legs.length || !line.name.trim())
    return json({ error: 'invalid_draft' }, 400);
  try {
    return json({ drafts: await saveDraft(line), storage: 'server' });
  } catch {
    return json(
      {
        error: 'draft_save_failed',
        message:
          'Could not save draft. Check DATA_DIR permissions or the 50-draft limit. Your current line is retained.',
      },
      503,
    );
  }
}
