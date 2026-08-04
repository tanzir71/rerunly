import { browser } from 'wxt/browser';
import { DEFAULT_LIMITS, STORAGE_KEYS } from '../shared/constants';
import type {
  AppSettings,
  ProviderProfile,
  RunCheckpoint,
  RunRecord,
  SavedTask
} from '../shared/types';

const DEFAULT_SETTINGS: AppSettings = {
  visualDisclosureAccepted: {}
};

async function getValue<T>(key: string, fallback: T): Promise<T> {
  const result = await browser.storage.local.get(key);
  return (result[key] as T | undefined) ?? fallback;
}

async function setValue<T>(key: string, value: T): Promise<void> {
  await browser.storage.local.set({ [key]: value });
}

export const appStorage = {
  getProviders: () => getValue<ProviderProfile[]>(STORAGE_KEYS.providers, []),
  setProviders: (value: ProviderProfile[]) => setValue(STORAGE_KEYS.providers, value),
  getTasks: () => getValue<SavedTask[]>(STORAGE_KEYS.tasks, []),
  setTasks: (value: SavedTask[]) => setValue(STORAGE_KEYS.tasks, value),
  getRuns: () => getValue<RunRecord[]>(STORAGE_KEYS.runs, []),
  setRuns: (value: RunRecord[]) =>
    setValue(STORAGE_KEYS.runs, value.slice(0, DEFAULT_LIMITS.maxRunHistory)),
  getSettings: () => getValue<AppSettings>(STORAGE_KEYS.settings, DEFAULT_SETTINGS),
  setSettings: (value: AppSettings) => setValue(STORAGE_KEYS.settings, value),
  getCheckpoint: () => getValue<RunCheckpoint | null>(STORAGE_KEYS.activeCheckpoint, null),
  setCheckpoint: (value: RunCheckpoint | null) => setValue(STORAGE_KEYS.activeCheckpoint, value)
};

export async function saveRun(run: RunRecord): Promise<void> {
  const runs = await appStorage.getRuns();
  await appStorage.setRuns([run, ...runs.filter((item) => item.id !== run.id)]);
}
