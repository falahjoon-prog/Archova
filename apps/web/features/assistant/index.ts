// Public surface of the assistant feature (Ask Nova panel; code name stays neutral, X29).
export { AssistantPanel } from './components/AssistantPanel';
export {
  AssistantScopeProvider,
  useAskNova,
  useAssistantPanelState,
  useAssistantScope,
  usePublishAssistantScope,
  type AssistantScope,
} from './components/AssistantScope';
