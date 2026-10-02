// Web design system (frontend 01 §4): primitives and patterns, no data fetching and no business words.
// Styled only with design-token CSS variables: render <ThemeStyle /> once and import '@archova/ui/styles.css'
// in the app's root layout. Icons come from '@archova/ui/icons'.
export { Alert, FormError, type AlertProps, type AlertTone } from './primitives/Alert';
export {
  Button,
  buttonClassName,
  type ButtonProps,
  type ButtonSize,
  type ButtonVariant,
} from './primitives/Button';
export { Card, type CardProps } from './primitives/Card';
export { Checkbox, Switch, type CheckboxProps, type SwitchProps } from './primitives/Checkbox';
export { Dialog, type DialogProps } from './primitives/Dialog';
export { Skeleton, SkeletonRows, Spinner, VisuallyHidden } from './primitives/Feedback';
export { PageHeader, type PageHeaderProps } from './primitives/PageHeader';
export { Select, type SelectOption, type SelectProps } from './primitives/Select';
export { Badge, StatusPill, type StatusPillProps, type StatusTone } from './primitives/StatusPill';
export { Tabs, type TabItem, type TabsProps } from './primitives/Tabs';
export { Textarea, type TextareaProps } from './primitives/Textarea';
export { TextField, type TextFieldProps } from './primitives/TextField';
export { ThemeStyle } from './primitives/ThemeStyle';

export { ActivityTimeline, type ActivityEntry } from './patterns/ActivityTimeline';
export {
  DataTable,
  type DataTableColumn,
  type DataTableProps,
  type SortState,
} from './patterns/DataTable';
export {
  DrawingCanvas,
  toOverlay,
  type CanvasPoint,
  type CanvasPointerEvent,
  type DrawingCanvasHandle,
  type DrawingCanvasProps,
} from './patterns/DrawingCanvas';
export { DescriptionList, type DescriptionItem } from './patterns/DescriptionList';
export { EmptyState, type EmptyStateProps } from './patterns/EmptyState';
export { FilterBar } from './patterns/FilterBar';
export { ItemHeader, type ItemHeaderProps } from './patterns/ItemHeader';
export {
  CitationChip,
  NovaFeedback,
  NovaSuggestion,
  type Citation,
  type LinkComponent,
  type NovaSuggestionProps,
} from './patterns/Nova';
export { ToggleGroup, type ToggleGroupProps, type ToggleOption } from './patterns/ToggleGroup';

export { cx } from './lib/cx';
