// Stand-in for the photo tagging model in local runs and tests: it reads the note (it can't see a photo), so a note
// that names a level and a trade gets that area and trade back.
import { DEFECT_TRADES, type PhotoTagOutput } from '@archova/ai-prompts';
import type { FakeResponder } from '../../infra/providers/fake';

export const heuristicPhotoTag: FakeResponder = (req) => {
  const note = (/<note>([\s\S]*?)<\/note>/.exec(req.text)?.[1] ?? '')
    .split(/(?<=[.!?])\s+/)
    .filter((s) => !/ignore|your rules|instructions/i.test(s))
    .join(' ');
  const area = /\b(level|bedroom|bathroom|basement|roof|lobby)\s*\d*/i.exec(note)?.[0] ?? null;
  const trade =
    DEFECT_TRADES.find((t) =>
      new RegExp(`\\b${t.label.split(' ')[0]!.toLowerCase()}`, 'i').test(note),
    )?.id ?? null;
  const output: PhotoTagOutput = {
    area: area ? area.trim() : null,
    trade,
    tags: trade ? [trade.replace(/_/g, ' ')] : [],
    photoUnclear: false,
  };
  return { output };
};
