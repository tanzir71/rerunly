export const BRAND = {
  name: 'Rerunly',
  tagline: 'Save it. Play it. Rerun it.'
} as const;

export const DEFAULT_OPENROUTER_URL = 'https://openrouter.ai/api/v1';
export const DEFAULT_LM_STUDIO_URL = 'http://localhost:1234/v1';

export const DEFAULT_LIMITS = {
  maxActions: 50,
  maxDurationMinutes: 15,
  maxCorrectiveAttempts: 2,
  maxNoProgressActions: 3,
  stabilityCeilingMs: 5_000,
  uncertainRecaptureDelayMs: 1_000,
  maxRunHistory: 20
} as const;

export const STORAGE_KEYS = {
  providers: 'rerunly.providers',
  tasks: 'rerunly.tasks',
  runs: 'rerunly.runs',
  settings: 'rerunly.settings',
  activeCheckpoint: 'rerunly.activeCheckpoint'
} as const;

export const BLOCKED_SCHEMES = [
  'chrome:',
  'chrome-extension:',
  'file:',
  'javascript:',
  'data:',
  'view-source:',
  'devtools:'
] as const;
