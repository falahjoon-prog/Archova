// Site photo tagging: the rules around the model's suggestion. Pure, no IO. The model suggests an area, a trade and a
// few tags; code keeps them short and plain, drops judging words and lets a known area keep its project spelling.
import type { PhotoTagOutput } from '@archova/ai-prompts';

export interface ReviewedPhotoTag {
  area: string | null;
  trade: PhotoTagOutput['trade'];
  tags: string[];
  photoUnclear: boolean;
}

/** Tags describe what is visible; a tag that judges it is dropped. */
const JUDGING =
  /\b(defect\w*|unsafe|dangerous|illegal|breach\w*|non-?complian\w*|violat\w*|faulty|poor|bad)\b/i;

export function reviewPhotoTag(
  out: PhotoTagOutput,
  ctx: { knownAreas: readonly string[] },
): ReviewedPhotoTag {
  const squash = (s: string) => s.replace(/\s+/g, ' ').trim();
  let area = out.area ? squash(out.area) : null;
  if (area) {
    // A known area keeps the project's own spelling and case.
    const known = ctx.knownAreas.find((k) => k.toLowerCase() === area!.toLowerCase());
    area = known ?? area;
    if (JUDGING.test(area) || area.length === 0) area = null;
  }
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const raw of out.tags) {
    const t = squash(raw).toLowerCase();
    if (!t || t.length > 30 || JUDGING.test(t) || seen.has(t)) continue;
    seen.add(t);
    tags.push(t);
    if (tags.length === 5) break;
  }
  return { area, trade: out.trade, tags, photoUnclear: out.photoUnclear };
}
