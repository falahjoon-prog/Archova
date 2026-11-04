import { Alert } from '@archova/ui';

/** The fixed Nova review disclaimer (design/09 §1): always visible, never dismissible, worded by the API. */
export function DisclaimerBanner({ text }: { text: string }) {
  return (
    <Alert tone="info" title="Nova review">
      <p className="u-m-0">{text}</p>
    </Alert>
  );
}
