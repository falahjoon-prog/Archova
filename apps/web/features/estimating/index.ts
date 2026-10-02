// Public surface of the estimating feature (frontend 07 §2): the measure and count tools registered into the
// drawing viewer, and the tender package and quote comparison screens.
import type { ViewerExtension } from '@/shared/drawing-viewer/extension';
import { TakeoffPanel } from './takeoff/TakeoffPanel';

export const takeoffViewerExtension: ViewerExtension = {
  id: 'takeoff',
  label: 'Measure',
  Panel: TakeoffPanel,
};

export { PackageListScreen } from './screens/PackageListScreen';
export { PackageScreen } from './screens/PackageScreen';
