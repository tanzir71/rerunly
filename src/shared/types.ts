export type ProviderKind = 'openrouter' | 'lmstudio';

export interface ModelCapabilities {
  vision: boolean;
  tools: boolean;
  contextLength?: number;
}

export interface AvailableModel {
  id: string;
  name: string;
  capabilities: ModelCapabilities;
  pricingHint?: string;
}

export interface ProviderProfile {
  id: string;
  name: string;
  kind: ProviderKind;
  baseUrl: string;
  modelId: string;
  capabilities: ModelCapabilities;
  apiKeySecretId?: string;
  createdAt: number;
  updatedAt: number;
}

export type TaskStartMode = 'current_tab' | 'fixed_url';

export interface SecretBinding {
  alias: string;
  secretId: string;
  allowedOrigins: string[];
  fieldHints: string[];
}

export interface TaskGrant {
  origin: string;
  capabilities: Array<'navigate' | 'input' | 'secret_input' | 'tabs'>;
}

export interface SavedTask {
  id: string;
  name: string;
  instruction: string;
  successCriteria: string;
  startMode: TaskStartMode;
  startUrl?: string;
  providerProfileId: string;
  modelId: string;
  allowedOrigins: string[];
  ordinaryVariables: Record<string, string>;
  secretBindings: SecretBinding[];
  storedGrants: TaskGrant[];
  maxActions: number;
  maxDurationMinutes: number;
  createdAt: number;
  updatedAt: number;
}

export type SecretPurpose = 'provider_api_key' | 'task_variable';

export interface SecretMetadata {
  id: string;
  label: string;
  purpose: SecretPurpose;
  allowedOrigins: string[];
  fieldHints: string[];
  createdAt: number;
  updatedAt: number;
}

export interface SecretRecord extends SecretMetadata {
  ciphertext: ArrayBuffer;
  iv: Uint8Array<ArrayBuffer>;
  aad: string;
}

export type RunStatus =
  | 'starting'
  | 'observing'
  | 'planning'
  | 'awaiting_approval'
  | 'acting'
  | 'stabilizing'
  | 'verifying'
  | 'recovering'
  | 'completed'
  | 'failed'
  | 'stopped'
  | 'blocked'
  | 'interrupted';

export interface RunRecord {
  id: string;
  taskId?: string;
  taskName: string;
  objective: string;
  status: RunStatus;
  startedAt: number;
  endedAt?: number;
  sanitizedOutcome: string;
  actionCount: number;
  recoveryCount: number;
  blockedReason?: string;
}

export interface RunCheckpoint {
  runId: string;
  taskId?: string;
  taskName: string;
  objective: string;
  startedAt: number;
  actionCount: number;
  recoveryCount: number;
  lastStatus: RunStatus;
}

export interface PageTabSummary {
  id: number;
  title: string;
  url: string;
  active: boolean;
}

export interface PageEvidence {
  url: string;
  title: string;
  viewport: { width: number; height: number; deviceScaleFactor: number };
  screenshotSize: { width: number; height: number };
  focusedElement: string;
  accessibilityTree: string;
  domSummary: string;
  consoleErrors: string[];
  failedRequests: string[];
  downloads: string[];
  navigationState: 'loading' | 'stable' | 'unknown';
  tabs: PageTabSummary[];
}

export interface RedactionRect {
  x: number;
  y: number;
  width: number;
  height: number;
  reason: 'password' | 'payment' | 'secret_target';
}

export interface VisualObservation {
  tabId: number;
  screenshotDataUrl: string;
  screenshotHash: string;
  evidence: PageEvidence;
  redactions: RedactionRect[];
  stability: 'stable' | 'unstable' | 'timed_out';
  capturedAt: number;
}

export type BrowserToolName =
  | 'browser_open'
  | 'browser_click'
  | 'browser_type'
  | 'browser_type_secret'
  | 'browser_select'
  | 'browser_scroll'
  | 'browser_wait'
  | 'browser_back'
  | 'browser_refresh'
  | 'browser_new_tab'
  | 'browser_switch_tab'
  | 'browser_close_tab'
  | 'browser_file_select'
  | 'browser_observe'
  | 'browser_finish';

export interface ActionProposal {
  tool: BrowserToolName;
  args: Record<string, unknown>;
  expectedOutcome: string;
  risk: 'low' | 'sensitive' | 'prohibited';
  targetOrigin?: string;
  rationale: string;
}

export type VerificationStatus =
  | 'succeeded'
  | 'uncertain'
  | 'recoverable_failure'
  | 'blocked'
  | 'complete';

export interface VerificationResult {
  status: VerificationStatus;
  evidence: string;
  detectedProblem: string;
  recommendedRecovery: string;
}

export interface ActiveRunView {
  id: string;
  taskId?: string;
  objective: string;
  taskName: string;
  status: RunStatus;
  currentAction?: string;
  expectedOutcome?: string;
  verificationStatus?: VerificationStatus;
  origin?: string;
  startedAt: number;
  actionCount: number;
  recoveryCount: number;
  screenshotActive: boolean;
  approval?: ApprovalRequest;
  timeline: RunTimelineItem[];
}

export interface RunTimelineItem {
  id: string;
  at: number;
  kind: 'observe' | 'plan' | 'act' | 'verify' | 'recover' | 'system';
  title: string;
  detail: string;
  tone: 'neutral' | 'success' | 'warning' | 'danger';
}

export interface ApprovalRequest {
  id: string;
  title: string;
  reason: string;
  origin: string;
  action: ActionProposal;
}

export interface AppSettings {
  activeProviderId?: string;
  visualDisclosureAccepted: Record<string, boolean>;
}

export interface AppState {
  providers: ProviderProfile[];
  tasks: SavedTask[];
  runs: RunRecord[];
  secrets: SecretMetadata[];
  settings: AppSettings;
  activeRun?: ActiveRunView;
}

export type BackgroundCommand =
  | { type: 'GET_STATE' }
  | { type: 'KEEP_ALIVE' }
  | {
      type: 'GET_MODELS';
      kind: ProviderKind;
      baseUrl: string;
      apiKey?: string;
      providerId?: string;
    }
  | {
      type: 'SAVE_PROVIDER';
      provider: Omit<ProviderProfile, 'id' | 'createdAt' | 'updatedAt' | 'apiKeySecretId'> & {
        id?: string;
        apiKey?: string;
      };
    }
  | { type: 'DELETE_PROVIDER'; providerId: string }
  | { type: 'SET_ACTIVE_PROVIDER'; providerId: string }
  | { type: 'ACCEPT_VISUAL_DISCLOSURE'; providerId: string }
  | { type: 'SAVE_TASK'; task: Partial<SavedTask> & Pick<SavedTask, 'name' | 'instruction' | 'successCriteria'> }
  | { type: 'DELETE_TASK'; taskId: string }
  | {
      type: 'SAVE_SECRET';
      secret: Omit<SecretMetadata, 'id' | 'createdAt' | 'updatedAt'> & { id?: string; value: string };
    }
  | { type: 'DELETE_SECRET'; secretId: string }
  | { type: 'START_TASK'; taskId: string }
  | { type: 'START_CHAT'; objective: string; successCriteria: string }
  | { type: 'STOP_RUN' }
  | { type: 'RESOLVE_APPROVAL'; approvalId: string; approved: boolean };

export type BackgroundResponse<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export interface PanelEvent {
  type: 'STATE_CHANGED' | 'RUN_CHANGED';
  state: AppState;
}
