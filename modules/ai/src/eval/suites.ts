// Registered eval suites, one per Nova task (ai/06 §2). Each feature PR adds its suite here.
import type { EvalSuite } from './harness';
import { assistAnswerSuite, assistPlanSuite } from './suites/assist';
import { contractAskSuite } from './suites/contract-ask';
import { contractCompareSuite } from './suites/contract-compare';
import { contractReviewSuite } from './suites/contract-review';
import { defectTagSuite } from './suites/defect-tag';
import { budgetReviewSuite } from './suites/budget-review';
import { diarySummarySuite } from './suites/diary-summary';
import { diaryWeeklySuite } from './suites/diary-weekly';
import { drawingCompareSuite } from './suites/drawing-compare';
import { drawingCompareVisualSuite } from './suites/drawing-compare-visual';
import { drawingTitleBlockSuite } from './suites/drawing-titleblock';
import { captureScanSuite } from './suites/capture-scan';
import { helpExplainSuite } from './suites/help-explain';
import { hazardScanSuite } from './suites/hazard-scan';
import { insightsDiscussSuite } from './suites/insights-discuss';
import { importMappingSuite } from './suites/import-mapping';
import { inductionAskSuite } from './suites/induction-ask';
import { inductionDraftSuite } from './suites/induction-draft';
import { inductionRefreshSuite } from './suites/induction-refresh';
import { qaAnswerSuite } from './suites/qa-answer';
import { qaRerankSuite, qaRewriteSuite } from './suites/qa-retrieval';
import { laborProductivitySuite } from './suites/labor-productivity';
import { announcementDraftSuite } from './suites/announcement-draft';
import { quoteNegotiateSuite } from './suites/quote-negotiate';
import { quoteReadSuite } from './suites/quote-read';
import { meetingMinutesSuite } from './suites/meeting-minutes';
import { rfiAnswerSuite } from './suites/rfi-answer';
import { rfiDraftSuite } from './suites/rfi-draft';
import { swmsDraftSuite } from './suites/swms-draft';
import { takeoffDetectSuite } from './suites/takeoff-detect';
import { translationSuite } from './suites/translation';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- suites differ in input, output and expected types
export type AnySuite = EvalSuite<any, any, any>;

export const SUITES: readonly AnySuite[] = [
  drawingTitleBlockSuite,
  qaRewriteSuite,
  qaRerankSuite,
  qaAnswerSuite,
  inductionDraftSuite,
  inductionRefreshSuite,
  inductionAskSuite,
  translationSuite,
  budgetReviewSuite,
  diarySummarySuite,
  helpExplainSuite,
  diaryWeeklySuite,
  insightsDiscussSuite,
  meetingMinutesSuite,
  rfiDraftSuite,
  rfiAnswerSuite,
  swmsDraftSuite,
  drawingCompareSuite,
  drawingCompareVisualSuite,
  defectTagSuite,
  hazardScanSuite,
  captureScanSuite,
  importMappingSuite,
  quoteReadSuite,
  quoteNegotiateSuite,
  laborProductivitySuite,
  announcementDraftSuite,
  contractReviewSuite,
  contractAskSuite,
  contractCompareSuite,
  takeoffDetectSuite,
  assistPlanSuite,
  assistAnswerSuite,
];
