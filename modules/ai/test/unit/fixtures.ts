import { CitationSchema, definePrompt, z } from '@archova/ai-prompts';
import { FAKE_MODELS, buildRoutingTable } from '../../src';

/** A small citing task used to exercise the gateway, adapters and eval harness. */
export const answerPrompt = definePrompt({
  id: 'qa.answer',
  version: 1,
  feature: 'ask',
  kind: 'interactive',
  tier: 'standard',
  system: 'Answer from the passages only and cite them.',
  input: z.object({ question: z.string().min(1) }),
  output: z.object({
    answer: z.string(),
    found: z.boolean(),
    citations: z.array(CitationSchema),
  }),
  render: (i) => ({ text: `<input>${i.question}</input>` }),
  maxOutputTokens: 800,
  citations: (o) => o.citations,
});

export const routing = buildRoutingTable(FAKE_MODELS);

export const passages = [
  {
    id: 'p1',
    source: { type: 'spec_section', id: 'spec-0431', title: 'Spec 0431 Waterproofing', page: 3 },
    text: 'Wet area membranes shall comply with AS 3740 and extend 150 mm up walls.',
  },
];
