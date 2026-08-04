import { browser } from 'wxt/browser';
import { AgentRunner } from '../src/background/agent';
import { discoverModels, providerError, validateProviderBaseUrl } from '../src/background/providers';
import { appStorage, saveRun } from '../src/background/storage';
import { decryptSecret, deleteSecret, listSecretMetadata, saveSecret } from '../src/background/vault';
import { DEFAULT_LIMITS } from '../src/shared/constants';
import type {
  AppState,
  BackgroundCommand,
  BackgroundResponse,
  PanelEvent,
  ProviderProfile,
  SavedTask
} from '../src/shared/types';
import { errorMessage, normalizeOrigin, nowId, sanitizeText } from '../src/shared/utils';

export default defineBackground(() => {
  const ports = new Set<chrome.runtime.Port>();
  let runner: AgentRunner;

  async function getState(): Promise<AppState> {
    const [providers, tasks, runs, secrets, settings] = await Promise.all([
      appStorage.getProviders(),
      appStorage.getTasks(),
      appStorage.getRuns(),
      listSecretMetadata(),
      appStorage.getSettings()
    ]);
    return {
      providers,
      tasks,
      runs,
      secrets,
      settings,
      ...(runner.activeRun ? { activeRun: runner.activeRun } : {})
    };
  }

  async function broadcast(): Promise<void> {
    const event: PanelEvent = { type: 'STATE_CHANGED', state: await getState() };
    for (const port of ports) {
      try {
        port.postMessage(event);
      } catch {
        ports.delete(port);
      }
    }
  }

  runner = new AgentRunner(broadcast);

  async function recoverInterruptedRun(): Promise<void> {
    const checkpoint = await appStorage.getCheckpoint();
    if (!checkpoint) return;
    const existing = (await appStorage.getRuns()).some((run) => run.id === checkpoint.runId);
    if (!existing) {
      await saveRun({
        id: checkpoint.runId,
        ...(checkpoint.taskId ? { taskId: checkpoint.taskId } : {}),
        taskName: checkpoint.taskName,
        objective: checkpoint.objective,
        status: 'interrupted',
        startedAt: checkpoint.startedAt,
        endedAt: Date.now(),
        sanitizedOutcome:
          'Chrome stopped the extension service worker during this run. No visual state or secret plaintext was retained; press Play to start a fresh run.',
        actionCount: checkpoint.actionCount,
        recoveryCount: checkpoint.recoveryCount
      });
    }
    await appStorage.setCheckpoint(null);
  }

  const initialized = (async () => {
    await browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    await recoverInterruptedRun();
  })();

  function permissionOrigin(kind: ProviderProfile['kind'], rawBaseUrl: string): string {
    const baseUrl = validateProviderBaseUrl(kind, rawBaseUrl);
    const url = new URL(baseUrl);
    return `${url.protocol}//${url.host}/*`;
  }

  async function ensureProviderPermission(kind: ProviderProfile['kind'], baseUrl: string) {
    const origin = permissionOrigin(kind, baseUrl);
    const contains = await browser.permissions.contains({ origins: [origin] });
    if (contains) return;
    const granted = await browser.permissions.request({ origins: [origin] });
    if (!granted) throw new Error(`Chrome permission for ${new URL(origin).origin} was not granted.`);
  }

  async function saveProvider(
    command: BackgroundCommand & { type: 'SAVE_PROVIDER' }
  ): Promise<ProviderProfile> {
    if (!command.provider.name.trim() || !command.provider.modelId) {
      throw new Error('Provider name and model are required.');
    }
    if (!command.provider.capabilities.vision || !command.provider.capabilities.tools) {
      throw new Error('Rerunly requires a model with both image input and tool calling.');
    }
    await ensureProviderPermission(command.provider.kind, command.provider.baseUrl);
    const providers = await appStorage.getProviders();
    const existing = command.provider.id
      ? providers.find((item) => item.id === command.provider.id)
      : undefined;
    const now = Date.now();
    let apiKeySecretId = existing?.apiKeySecretId;
    if (command.provider.apiKey) {
      const metadata = await saveSecret({
        ...(apiKeySecretId ? { id: apiKeySecretId } : {}),
        label: `${command.provider.name} API key`,
        value: command.provider.apiKey,
        purpose: 'provider_api_key',
        allowedOrigins: [new URL(command.provider.baseUrl).origin],
        fieldHints: []
      });
      apiKeySecretId = metadata.id;
    }
    if (command.provider.kind === 'openrouter' && !apiKeySecretId) {
      throw new Error('OpenRouter requires an API key.');
    }
    const profile: ProviderProfile = {
      id: existing?.id ?? nowId('provider'),
      name: command.provider.name.trim(),
      kind: command.provider.kind,
      baseUrl: validateProviderBaseUrl(command.provider.kind, command.provider.baseUrl),
      modelId: command.provider.modelId,
      capabilities: command.provider.capabilities,
      ...(apiKeySecretId ? { apiKeySecretId } : {}),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };
    await appStorage.setProviders([profile, ...providers.filter((item) => item.id !== profile.id)]);
    const settings = await appStorage.getSettings();
    await appStorage.setSettings({ ...settings, activeProviderId: profile.id });
    return profile;
  }

  async function saveTask(
    command: BackgroundCommand & { type: 'SAVE_TASK' }
  ): Promise<SavedTask> {
    const tasks = await appStorage.getTasks();
    const existing = command.task.id
      ? tasks.find((item) => item.id === command.task.id)
      : undefined;
    const settings = await appStorage.getSettings();
    const providerId = command.task.providerProfileId ?? settings.activeProviderId;
    if (!providerId) throw new Error('Configure a model provider before saving a task.');
    const provider = (await appStorage.getProviders()).find((item) => item.id === providerId);
    if (!provider) throw new Error('The selected provider no longer exists.');
    const now = Date.now();
    const task: SavedTask = {
      id: existing?.id ?? nowId('task'),
      name: command.task.name.trim(),
      instruction: command.task.instruction.trim(),
      successCriteria: command.task.successCriteria.trim(),
      startMode: command.task.startMode ?? existing?.startMode ?? 'current_tab',
      ...(command.task.startUrl || existing?.startUrl
        ? { startUrl: command.task.startUrl ?? existing?.startUrl }
        : {}),
      providerProfileId: provider.id,
      modelId: command.task.modelId ?? provider.modelId,
      allowedOrigins: [
        ...new Set(
          (command.task.allowedOrigins ?? existing?.allowedOrigins ?? [])
            .map((value) => normalizeOrigin(value))
            .filter((value): value is string => Boolean(value))
        )
      ],
      ordinaryVariables: command.task.ordinaryVariables ?? existing?.ordinaryVariables ?? {},
      secretBindings: (command.task.secretBindings ?? existing?.secretBindings ?? []).map(
        (binding) => ({
          ...binding,
          allowedOrigins: [
            ...new Set(
              binding.allowedOrigins
                .map((value) => normalizeOrigin(value))
                .filter((value): value is string => Boolean(value))
            )
          ]
        })
      ),
      storedGrants: command.task.storedGrants ?? existing?.storedGrants ?? [],
      maxActions: command.task.maxActions ?? existing?.maxActions ?? DEFAULT_LIMITS.maxActions,
      maxDurationMinutes:
        command.task.maxDurationMinutes ??
        existing?.maxDurationMinutes ??
        DEFAULT_LIMITS.maxDurationMinutes,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };
    if (!task.name || !task.instruction || !task.successCriteria) {
      throw new Error('Task name, instruction, and success criteria are required.');
    }
    if (task.startMode === 'fixed_url') {
      const startOrigin = normalizeOrigin(task.startUrl ?? '');
      if (!startOrigin) throw new Error('A fixed task must start on a valid HTTP or HTTPS URL.');
      if (!task.allowedOrigins.includes(startOrigin)) task.allowedOrigins.push(startOrigin);
    }
    await appStorage.setTasks([task, ...tasks.filter((item) => item.id !== task.id)]);
    return task;
  }

  async function handle(command: BackgroundCommand): Promise<unknown> {
    await initialized;
    switch (command.type) {
      case 'GET_STATE':
        return getState();
      case 'KEEP_ALIVE':
        await browser.runtime.getPlatformInfo();
        return null;
      case 'GET_MODELS': {
        await ensureProviderPermission(command.kind, command.baseUrl);
        let apiKey = command.apiKey;
        if (!apiKey && command.providerId) {
          const provider = (await appStorage.getProviders()).find(
            (item) => item.id === command.providerId
          );
          if (provider?.apiKeySecretId) apiKey = await decryptSecret(provider.apiKeySecretId);
        }
        return discoverModels(command.kind, command.baseUrl, apiKey);
      }
      case 'SAVE_PROVIDER':
        return saveProvider(command);
      case 'DELETE_PROVIDER': {
        const referencingTask = (await appStorage.getTasks()).find(
          (task) => task.providerProfileId === command.providerId
        );
        if (referencingTask) {
          throw new Error(`Provider is still used by “${referencingTask.name}”. Reassign or delete that task first.`);
        }
        const providers = await appStorage.getProviders();
        const provider = providers.find((item) => item.id === command.providerId);
        if (provider?.apiKeySecretId) await deleteSecret(provider.apiKeySecretId);
        await appStorage.setProviders(providers.filter((item) => item.id !== command.providerId));
        const settings = await appStorage.getSettings();
        const { [command.providerId]: _disclosure, ...remainingDisclosures } =
          settings.visualDisclosureAccepted;
        if (settings.activeProviderId === command.providerId) {
          const { activeProviderId: _removed, ...rest } = settings;
          await appStorage.setSettings({
            ...rest,
            visualDisclosureAccepted: remainingDisclosures
          });
        } else {
          await appStorage.setSettings({
            ...settings,
            visualDisclosureAccepted: remainingDisclosures
          });
        }
        return null;
      }
      case 'SET_ACTIVE_PROVIDER': {
        const settings = await appStorage.getSettings();
        await appStorage.setSettings({ ...settings, activeProviderId: command.providerId });
        return null;
      }
      case 'ACCEPT_VISUAL_DISCLOSURE': {
        const settings = await appStorage.getSettings();
        await appStorage.setSettings({
          ...settings,
          visualDisclosureAccepted: {
            ...settings.visualDisclosureAccepted,
            [command.providerId]: true
          }
        });
        return null;
      }
      case 'SAVE_TASK':
        return saveTask(command);
      case 'DELETE_TASK': {
        const tasks = await appStorage.getTasks();
        await appStorage.setTasks(tasks.filter((item) => item.id !== command.taskId));
        return null;
      }
      case 'SAVE_SECRET':
        return saveSecret({
          ...command.secret,
          allowedOrigins: [
            ...new Set(
              command.secret.allowedOrigins
                .map((value) => normalizeOrigin(value))
                .filter((value): value is string => Boolean(value))
            )
          ]
        });
      case 'DELETE_SECRET':
        {
          const referencingTask = (await appStorage.getTasks()).find((task) =>
            task.secretBindings.some((binding) => binding.secretId === command.secretId)
          );
          if (referencingTask) {
            throw new Error(`Protected value is still bound to “${referencingTask.name}”. Remove that binding first.`);
          }
        }
        await deleteSecret(command.secretId);
        return null;
      case 'START_TASK': {
        const task = (await appStorage.getTasks()).find((item) => item.id === command.taskId);
        if (!task) throw new Error('Saved task not found.');
        const provider = (await appStorage.getProviders()).find(
          (item) => item.id === task.providerProfileId
        );
        if (!provider) throw new Error('The task provider no longer exists.');
        await runner.startTask(task, provider);
        return null;
      }
      case 'START_CHAT': {
        const settings = await appStorage.getSettings();
        const provider = (await appStorage.getProviders()).find(
          (item) => item.id === settings.activeProviderId
        );
        if (!provider) throw new Error('Configure and select a model provider first.');
        const tabs = await browser.tabs.query({ active: true, currentWindow: true });
        const origin = normalizeOrigin(tabs[0]?.url ?? '');
        if (!origin) throw new Error('Open an HTTP or HTTPS page first.');
        const now = Date.now();
        const task: SavedTask = {
          id: nowId('adhoc'),
          name: 'One-off task',
          instruction: command.objective.trim(),
          successCriteria:
            command.successCriteria.trim() || 'The requested browser outcome is visibly complete.',
          startMode: 'current_tab',
          providerProfileId: provider.id,
          modelId: provider.modelId,
          allowedOrigins: [origin],
          ordinaryVariables: {},
          secretBindings: [],
          storedGrants: [],
          maxActions: DEFAULT_LIMITS.maxActions,
          maxDurationMinutes: DEFAULT_LIMITS.maxDurationMinutes,
          createdAt: now,
          updatedAt: now
        };
        await runner.startTask(task, provider, false);
        return null;
      }
      case 'STOP_RUN':
        runner.stop();
        return null;
      case 'RESOLVE_APPROVAL':
        runner.resolveApproval(command.approvalId, command.approved);
        return null;
      default: {
        const exhaustive: never = command;
        throw new Error(`Unsupported command: ${String(exhaustive)}`);
      }
    }
  }

  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== 'rerunly-panel') return;
    ports.add(port);
    port.onDisconnect.addListener(() => ports.delete(port));
    void initialized.then(broadcast);
  });

  browser.runtime.onMessage.addListener(
    async (command: BackgroundCommand): Promise<BackgroundResponse> => {
      try {
        const data = await handle(command);
        await broadcast();
        return { ok: true, data };
      } catch (error) {
        const knownValues =
          command.type === 'GET_MODELS' && command.apiKey
            ? [command.apiKey]
            : command.type === 'SAVE_PROVIDER' && command.provider.apiKey
              ? [command.provider.apiKey]
              : command.type === 'SAVE_SECRET'
                ? [command.secret.value]
                : [];
        return {
          ok: false,
          error: sanitizeText(
            command.type === 'GET_MODELS' ? providerError(error) : errorMessage(error),
            knownValues
          )
        };
      }
    }
  );
});
