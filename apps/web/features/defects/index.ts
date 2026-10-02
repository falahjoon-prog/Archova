// Public surface of the defects feature (frontend 01 §3).
export { DefectListScreen } from './screens/DefectListScreen';
export { DefectNewScreen } from './screens/DefectNewScreen';
export { DefectDetailScreen } from './screens/DefectDetailScreen';
/** Preview only: read access for Ask Nova's sample answers until the ai module answers from the API. */
export { defectsSource as defectsPreviewSource } from './data/source';
export { formatDefectNumber } from './lib/types';
