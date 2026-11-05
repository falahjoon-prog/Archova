// The inspection rules are shared with the phone app (it validates answers offline), so they live in @archova/domain.
export {
  RESPONSE_TYPES,
  INSPECTION_STATUSES,
  failedItems,
  inspectionLabel,
  isAnswered,
  isEditable,
  missingRequired,
  responseProblem,
  type InspectionStatus,
  type ItemResult,
  type ItemSpec,
  type ResponseInput,
  type ResponseState,
  type ResponseType,
} from '@archova/domain';
