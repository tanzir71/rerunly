import type { ActiveRunView, AppState, ProviderProfile, SavedTask } from '../../src/shared/types';

export type PreviewMode = 'run' | 'recovery' | 'tasks' | 'vault' | 'settings';

const provider: ProviderProfile = {
  id: 'preview-provider',
  name: 'Local vision model',
  kind: 'lmstudio',
  baseUrl: 'http://localhost:1234/v1',
  modelId: 'qwen/qwen3.5-9b',
  capabilities: { vision: true, tools: true, contextLength: 262144 },
  createdAt: Date.now() - 86_400_000,
  updatedAt: Date.now()
};

const tasks: SavedTask[] = [
  {
    id: 'task-price', name: 'Compare supplier prices', instruction: 'Compare the open supplier tabs and copy the lowest verified price into the quote form.', successCriteria: 'The quote form shows a green confirmation containing the lowest price.', startMode: 'current_tab', providerProfileId: provider.id, modelId: provider.modelId, allowedOrigins: ['https://supplier.example', 'https://quotes.example'], ordinaryVariables: { region: 'Dhaka' }, secretBindings: [], storedGrants: [], maxActions: 30, maxDurationMinutes: 10, createdAt: Date.now() - 70_000, updatedAt: Date.now() - 20_000
  },
  {
    id: 'task-inventory', name: 'Check inventory status', instruction: 'Review the inventory dashboard and capture the current low-stock items.', successCriteria: 'A filtered list of low-stock items is visible.', startMode: 'fixed_url', startUrl: 'https://inventory.example', providerProfileId: provider.id, modelId: provider.modelId, allowedOrigins: ['https://inventory.example'], ordinaryVariables: {}, secretBindings: [], storedGrants: [], maxActions: 20, maxDurationMinutes: 8, createdAt: Date.now() - 50_000, updatedAt: Date.now() - 15_000
  },
  {
    id: 'task-form', name: 'Prepare weekly form', instruction: 'Fill the weekly operational form using saved task variables, then stop before submission.', successCriteria: 'Every required field is visibly complete and valid.', startMode: 'current_tab', providerProfileId: provider.id, modelId: provider.modelId, allowedOrigins: ['https://forms.example'], ordinaryVariables: {}, secretBindings: [{ alias: 'work_email', secretId: 'secret-email', allowedOrigins: ['https://forms.example'], fieldHints: ['email'] }], storedGrants: [], maxActions: 25, maxDurationMinutes: 10, createdAt: Date.now() - 40_000, updatedAt: Date.now() - 10_000
  }
];

function activeRun(recovery: boolean): ActiveRunView {
  const now = Date.now();
  return {
    id: 'preview-run', taskId: 'task-price', objective: tasks[0]!.instruction, taskName: tasks[0]!.name,
    status: recovery ? 'recovering' : 'verifying', currentAction: recovery ? 'browser_click' : 'browser_type',
    expectedOutcome: recovery ? 'The covered Continue button becomes reachable after dismissing the dialog.' : 'The quote form displays the selected price and a green valid state.',
    verificationStatus: recovery ? 'recoverable_failure' : 'succeeded', origin: 'https://quotes.example', startedAt: now - 43_000,
    actionCount: recovery ? 7 : 9, recoveryCount: recovery ? 1 : 0, screenshotActive: true,
    timeline: recovery ? [
      { id: 'r1', at: now - 12_000, kind: 'verify', title: 'recoverable failure', detail: 'An unexpected dialog covered the intended Continue button.', tone: 'warning' },
      { id: 'r2', at: now - 8_000, kind: 'recover', title: 'Replanning from visual evidence', detail: 'Dismiss the overlay, recapture, and use the newly visible control.', tone: 'warning' },
      { id: 'r3', at: now - 3_000, kind: 'act', title: 'browser click', detail: 'Clicked the visible Dismiss control instead of repeating the failed action.', tone: 'neutral' }
    ] : [
      { id: 'v1', at: now - 17_000, kind: 'observe', title: 'Visual checkpoint', detail: 'The quote form is visible and stable.', tone: 'neutral' },
      { id: 'v2', at: now - 9_000, kind: 'act', title: 'browser type', detail: 'Entered the lowest verified price into the quote field.', tone: 'neutral' },
      { id: 'v3', at: now - 2_000, kind: 'verify', title: 'succeeded', detail: 'The field contains the expected value and shows a green valid state.', tone: 'success' }
    ]
  };
}

export function previewConfiguration(): {
  state: AppState;
  section: 'chat' | 'tasks' | 'vault' | 'history' | 'settings';
  objective: string;
  criteria: string;
} | null {
  const mode = new URLSearchParams(location.search).get('preview') as PreviewMode | null;
  if (!mode || !['run', 'recovery', 'tasks', 'vault', 'settings'].includes(mode)) return null;
  const state: AppState = {
    providers: [provider], tasks, settings: { activeProviderId: provider.id, visualDisclosureAccepted: { [provider.id]: true } },
    secrets: [{ id: 'secret-email', label: 'Work email', purpose: 'task_variable', allowedOrigins: ['https://forms.example'], fieldHints: ['email'], createdAt: Date.now() - 80_000, updatedAt: Date.now() - 5_000 }],
    runs: [{ id: 'history-1', taskId: 'task-price', taskName: tasks[0]!.name, objective: tasks[0]!.instruction, status: 'completed', startedAt: Date.now() - 3_600_000, endedAt: Date.now() - 3_550_000, sanitizedOutcome: 'Verified the lowest price and prepared the quote form.', actionCount: 11, recoveryCount: 1 }],
    ...(mode === 'run' || mode === 'recovery' ? { activeRun: activeRun(mode === 'recovery') } : {})
  };
  return {
    state,
    section: mode === 'tasks' ? 'tasks' : mode === 'vault' ? 'vault' : mode === 'settings' ? 'settings' : 'chat',
    objective: tasks[0]!.instruction,
    criteria: tasks[0]!.successCriteria
  };
}
