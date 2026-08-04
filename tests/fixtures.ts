import type { ProviderProfile, SavedTask, VisualObservation } from '../src/shared/types';

export const taskFixture: SavedTask = {
  id: 'task_1',
  name: 'Fixture task',
  instruction: 'Open the fixture and reveal the result.',
  successCriteria: 'A green confirmation reads Done.',
  startMode: 'current_tab',
  providerProfileId: 'provider_1',
  modelId: 'vision-model',
  allowedOrigins: ['https://example.com'],
  ordinaryVariables: {},
  secretBindings: [],
  storedGrants: [],
  maxActions: 10,
  maxDurationMinutes: 5,
  createdAt: 1,
  updatedAt: 1
};

export const providerFixture: ProviderProfile = {
  id: 'provider_1',
  name: 'Test provider',
  kind: 'openrouter',
  baseUrl: 'https://openrouter.ai/api/v1',
  modelId: 'vision-model',
  capabilities: { vision: true, tools: true },
  createdAt: 1,
  updatedAt: 1
};

export const observationFixture: VisualObservation = {
  tabId: 1,
  screenshotDataUrl: 'data:image/png;base64,AA==',
  screenshotHash: 'aabbccdd',
  evidence: {
    url: 'https://example.com/',
    title: 'Fixture',
    viewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
    screenshotSize: { width: 1280, height: 720 },
    focusedElement: '',
    accessibilityTree: 'button "Continue"',
    domSummary: '{"nodeCount":4}',
    consoleErrors: [],
    failedRequests: [],
    downloads: [],
    navigationState: 'stable',
    tabs: [{ id: 1, title: 'Fixture', url: 'https://example.com/', active: true }]
  },
  redactions: [],
  stability: 'stable',
  capturedAt: 1
};
