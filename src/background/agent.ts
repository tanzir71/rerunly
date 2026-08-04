import { browser } from 'wxt/browser';
import { DEFAULT_LIMITS } from '../shared/constants';
import type {
  ActionProposal,
  ActiveRunView,
  ApprovalRequest,
  ProviderProfile,
  RunRecord,
  RunStatus,
  RunTimelineItem,
  SavedTask,
  VerificationResult,
  VisualObservation
} from '../shared/types';
import {
  errorMessage,
  interpolateVariables,
  normalizeOrigin,
  nowId,
  sanitizeText,
  sleep
} from '../shared/utils';
import { CdpController } from './cdp';
import { compareScreenshots } from './image';
import { evaluatePolicy } from './policy';
import { VisionModelClient } from './providers';
import { appStorage, saveRun } from './storage';
import { decryptSecret } from './vault';

interface PendingApproval {
  request: ApprovalRequest;
  resolve: (approved: boolean) => void;
}

export class AgentRunner {
  private active?: ActiveRunView;
  private abortController?: AbortController;
  private pendingApproval?: PendingApproval;
  private cdp?: CdpController;

  constructor(private readonly onChanged: () => Promise<void>) {}

  get activeRun(): ActiveRunView | undefined {
    return this.active;
  }

  async startTask(
    task: SavedTask,
    provider: ProviderProfile,
    persistTaskReference = true
  ): Promise<void> {
    if (this.active) throw new Error('Another Rerunly task is already active.');
    const instruction = interpolateVariables(task.instruction, task.ordinaryVariables);
    const runtimeTask: SavedTask = {
      ...task,
      instruction,
      allowedOrigins: [...task.allowedOrigins],
      secretBindings: task.secretBindings.map((binding) => ({
        ...binding,
        allowedOrigins: [...binding.allowedOrigins],
        fieldHints: [...binding.fieldHints]
      })),
      storedGrants: task.storedGrants.map((grant) => ({
        ...grant,
        capabilities: [...grant.capabilities]
      }))
    };
    void this.run(runtimeTask, provider, persistTaskReference);
  }

  stop(): void {
    this.pendingApproval?.resolve(false);
    this.pendingApproval = undefined;
    this.abortController?.abort();
  }

  resolveApproval(id: string, approved: boolean): void {
    if (!this.pendingApproval || this.pendingApproval.request.id !== id) {
      throw new Error('That approval request is no longer active.');
    }
    const pending = this.pendingApproval;
    this.pendingApproval = undefined;
    pending.resolve(approved);
  }

  private async setStatus(status: RunStatus, patch: Partial<ActiveRunView> = {}): Promise<void> {
    if (!this.active) return;
    this.active = { ...this.active, ...patch, status };
    await this.checkpoint();
    await this.onChanged();
  }

  private async addTimeline(
    kind: RunTimelineItem['kind'],
    title: string,
    detail: string,
    tone: RunTimelineItem['tone'] = 'neutral'
  ): Promise<void> {
    if (!this.active) return;
    const item: RunTimelineItem = {
      id: nowId('event'),
      at: Date.now(),
      kind,
      title: sanitizeText(title),
      detail: sanitizeText(detail),
      tone
    };
    this.active = {
      ...this.active,
      timeline: [...this.active.timeline, item].slice(-50)
    };
    await this.onChanged();
  }

  private async checkpoint(): Promise<void> {
    if (!this.active) return;
    await appStorage.setCheckpoint({
      runId: this.active.id,
      ...(this.active.taskId ? { taskId: this.active.taskId } : {}),
      taskName: this.active.taskName,
      objective: this.active.objective,
      startedAt: this.active.startedAt,
      actionCount: this.active.actionCount,
      recoveryCount: this.active.recoveryCount,
      lastStatus: this.active.status
    });
  }

  private recentTimeline(): string {
    return (
      this.active?.timeline
        .slice(-10)
        .map((item) => `${item.kind}: ${item.title} — ${item.detail}`)
        .join('\n') ?? ''
    );
  }

  private async requestApproval(
    action: ActionProposal,
    title: string,
    reason: string,
    origin: string
  ): Promise<boolean> {
    if (!this.active) return false;
    const request: ApprovalRequest = {
      id: nowId('approval'),
      title,
      reason,
      origin,
      action
    };
    this.active = { ...this.active, status: 'awaiting_approval', approval: request };
    await this.addTimeline('system', title, reason, 'warning');
    await this.onChanged();
    return new Promise<boolean>((resolve) => {
      this.pendingApproval = {
        request,
        resolve: (approved) => {
          if (this.active) {
            const { approval: _approval, ...rest } = this.active;
            this.active = { ...rest, status: approved ? 'planning' : 'blocked' };
          }
          resolve(approved);
        }
      };
    });
  }

  private async activeTab(): Promise<chrome.tabs.Tab> {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    if (!tab || typeof tab.id !== 'number') throw new Error('Open an HTTP or HTTPS tab first.');
    const origin = normalizeOrigin(tab.url ?? '');
    if (!origin) throw new Error('Rerunly can run only on an HTTP or HTTPS page.');
    return tab;
  }

  private async providerKey(provider: ProviderProfile): Promise<string | undefined> {
    if (!provider.apiKeySecretId) return undefined;
    return decryptSecret(provider.apiKeySecretId);
  }

  private async secretForAction(action: ActionProposal, task: SavedTask): Promise<string | undefined> {
    if (action.tool !== 'browser_type_secret') return undefined;
    const alias = typeof action.args.secretAlias === 'string' ? action.args.secretAlias : '';
    const binding = task.secretBindings.find((item) => item.alias === alias);
    if (!binding) throw new Error(`Protected value ${alias} is not bound to this task.`);
    const x = typeof action.args.x === 'number' ? action.args.x : Number.NaN;
    const y = typeof action.args.y === 'number' ? action.args.y : Number.NaN;
    await this.cdp!.validateSecretTarget(x, y, binding.fieldHints);
    const value = await decryptSecret(binding.secretId);
    this.cdp!.registerSecretForScrubbing(value);
    return value;
  }

  private async verifyWithRecapture(
    client: VisionModelClient,
    task: SavedTask,
    action: ActionProposal,
    before: VisualObservation,
    after: VisualObservation,
    signal: AbortSignal
  ): Promise<{ verification: VerificationResult; observation: VisualObservation }> {
    let diff = await compareScreenshots(before.screenshotDataUrl, after.screenshotDataUrl);
    let verification = await client.verify(task, action, before, after, diff, signal);
    if (verification.status !== 'uncertain') return { verification, observation: after };

    await this.addTimeline(
      'verify',
      'Evidence uncertain',
      'Waiting one second for another visual checkpoint.',
      'warning'
    );
    await sleep(DEFAULT_LIMITS.uncertainRecaptureDelayMs, signal);
    const recaptured = await this.cdp!.observe('stable');
    diff = await compareScreenshots(after.screenshotDataUrl, recaptured.screenshotDataUrl);
    verification = await client.verify(task, action, after, recaptured, diff, signal);
    return { verification, observation: recaptured };
  }

  private async run(
    task: SavedTask,
    provider: ProviderProfile,
    persistTaskReference: boolean
  ): Promise<void> {
    const runId = nowId('run');
    this.abortController = new AbortController();
    const signal = this.abortController.signal;
    this.active = {
      id: runId,
      ...(persistTaskReference ? { taskId: task.id } : {}),
      objective: task.instruction,
      taskName: task.name,
      status: 'starting',
      startedAt: Date.now(),
      actionCount: 0,
      recoveryCount: 0,
      screenshotActive: true,
      timeline: []
    };
    await this.checkpoint();
    await this.onChanged();

    let finalStatus: RunRecord['status'] = 'failed';
    let outcome = '';
    let blockedReason = '';
    try {
      const settings = await appStorage.getSettings();
      if (!settings.visualDisclosureAccepted[provider.id]) {
        throw new Error('Accept the visual-data disclosure for this provider before starting.');
      }
      if (!provider.capabilities.vision || !provider.capabilities.tools) {
        throw new Error('Play requires a model with both vision and tool calling.');
      }

      const tab = await this.activeTab();
      if (task.startMode === 'fixed_url' && task.startUrl) {
        await browser.tabs.update(tab.id!, { url: task.startUrl });
      }
      this.cdp = new CdpController(tab.id!);
      await this.cdp.attach();
      const client = new VisionModelClient(
        { ...provider, modelId: task.modelId },
        await this.providerKey(provider)
      );
      await this.setStatus('observing', { origin: normalizeOrigin(tab.url ?? '') ?? '' });
      const initialStability =
        task.startMode === 'fixed_url' ? await this.cdp.waitForStability(signal) : 'stable';
      let observation = await this.cdp.observe(initialStability);
      await this.addTimeline(
        'observe',
        'Initial visual checkpoint',
        `${observation.evidence.title || 'Untitled page'} at ${observation.evidence.url}`
      );

      let noProgressActions = 0;
      let correctiveAttempts = 0;
      while (this.active && !signal.aborted) {
        const elapsed = Date.now() - this.active.startedAt;
        if (this.active.actionCount >= task.maxActions) {
          throw new Error(`Stopped after the configured ${task.maxActions} action limit.`);
        }
        if (elapsed >= task.maxDurationMinutes * 60_000) {
          throw new Error(`Stopped after the configured ${task.maxDurationMinutes}-minute limit.`);
        }

        await this.setStatus('planning', {
          origin: normalizeOrigin(observation.evidence.url) ?? '',
          verificationStatus: undefined
        });
        const action = await client.plan(task, observation, this.recentTimeline(), signal);
        if (action.tool === 'browser_switch_tab' || action.tool === 'browser_close_tab') {
          const requestedTabId =
            typeof action.args.tabId === 'number' ? action.args.tabId : this.cdp.currentTabId;
          const targetTab = await browser.tabs.get(requestedTabId);
          action.targetOrigin = targetTab.url ?? '';
        }
        this.active = {
          ...this.active,
          currentAction: action.tool,
          expectedOutcome: action.expectedOutcome
        };
        await this.addTimeline('plan', action.tool, action.expectedOutcome);

        const policy = evaluatePolicy(action, task, observation.evidence.url);
        if (policy.decision === 'block') {
          finalStatus = 'blocked';
          blockedReason = policy.reason;
          outcome = policy.reason;
          await this.addTimeline('system', 'Action blocked', policy.reason, 'danger');
          break;
        }
        if (policy.decision === 'approval') {
          const approved = await this.requestApproval(
            action,
            'Approval required',
            policy.reason,
            policy.origin
          );
          if (!approved) {
            finalStatus = signal.aborted ? 'stopped' : 'blocked';
            blockedReason = signal.aborted ? '' : 'The user declined the requested action.';
            outcome = signal.aborted ? 'Stopped by the user.' : blockedReason;
            break;
          }
          if (!task.allowedOrigins.includes(policy.origin)) task.allowedOrigins.push(policy.origin);
          if (action.tool === 'browser_type_secret') {
            const alias = String(action.args.secretAlias ?? '');
            const binding = task.secretBindings.find((item) => item.alias === alias);
            if (binding && !binding.allowedOrigins.includes(policy.origin)) {
              binding.allowedOrigins.push(policy.origin);
            }
          }
        }

        const before = observation;
        await this.setStatus('acting');
        const secretValue = await this.secretForAction(action, task);
        try {
          await this.cdp.execute(action, secretValue, signal);
        } finally {
          // Keep the plaintext scoped to this turn and never place it in state, logs, or history.
        }
        if (!this.active) break;
        this.active = { ...this.active, actionCount: this.active.actionCount + 1 };
        await this.addTimeline('act', action.tool, action.rationale);

        await this.setStatus('stabilizing');
        const stability = await this.cdp.waitForStability(signal);
        await this.setStatus('observing');
        observation = await this.cdp.observe(stability);

        await this.setStatus('verifying');
        const verified = await this.verifyWithRecapture(
          client,
          task,
          action,
          before,
          observation,
          signal
        );
        observation = verified.observation;
        const verification = verified.verification;
        this.active = { ...this.active, verificationStatus: verification.status };
        await this.addTimeline(
          'verify',
          verification.status.replaceAll('_', ' '),
          verification.evidence || verification.detectedProblem,
          verification.status === 'succeeded' || verification.status === 'complete'
            ? 'success'
            : verification.status === 'blocked'
              ? 'danger'
              : 'warning'
        );
        await this.checkpoint();

        if (verification.status === 'complete') {
          finalStatus = 'completed';
          outcome = verification.evidence || String(action.args.summary ?? 'Task completed and verified.');
          break;
        }
        if (verification.status === 'blocked') {
          finalStatus = 'blocked';
          blockedReason = verification.detectedProblem || 'The verifier detected a blocked state.';
          outcome = blockedReason;
          break;
        }
        if (verification.status === 'succeeded') {
          noProgressActions = 0;
          correctiveAttempts = 0;
          continue;
        }

        noProgressActions += 1;
        correctiveAttempts += 1;
        if (correctiveAttempts > DEFAULT_LIMITS.maxCorrectiveAttempts) {
          await this.addTimeline(
            'recover',
            'Corrective limit reached',
            verification.detectedProblem || 'The intended step did not make progress.',
            'warning'
          );
        } else {
          this.active = { ...this.active, recoveryCount: this.active.recoveryCount + 1 };
          await this.setStatus('recovering');
          await this.addTimeline(
            'recover',
            'Replanning from visual evidence',
            verification.recommendedRecovery || 'Choose a different safe action.',
            'warning'
          );
        }

        if (noProgressActions >= DEFAULT_LIMITS.maxNoProgressActions) {
          const continueRun = await this.requestApproval(
            {
              tool: 'browser_observe',
              args: {},
              expectedOutcome: 'The user confirms that Rerunly should attempt a new plan.',
              rationale: 'Three consecutive actions made no verified progress.',
              risk: 'sensitive'
            },
            'Rerunly is stuck',
            'Three consecutive actions made no verified progress. Continue with a fresh observation?',
            normalizeOrigin(observation.evidence.url) ?? ''
          );
          if (!continueRun) {
            finalStatus = signal.aborted ? 'stopped' : 'blocked';
            outcome = signal.aborted ? 'Stopped by the user.' : 'Paused after repeated no-progress actions.';
            break;
          }
          noProgressActions = 0;
          correctiveAttempts = 0;
          observation = await this.cdp.observe('stable');
        }
      }

      if (signal.aborted && finalStatus === 'failed') {
        finalStatus = 'stopped';
        outcome = 'Stopped by the user.';
      }
    } catch (error) {
      if (signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
        finalStatus = 'stopped';
        outcome = 'Stopped by the user.';
      } else {
        finalStatus = 'failed';
        outcome = errorMessage(error);
      }
    } finally {
      await this.cdp?.detach();
      const current = this.active;
      if (current) {
        const record: RunRecord = {
          id: current.id,
          ...(current.taskId ? { taskId: current.taskId } : {}),
          taskName: current.taskName,
          objective: sanitizeText(current.objective),
          status: finalStatus,
          startedAt: current.startedAt,
          endedAt: Date.now(),
          sanitizedOutcome: sanitizeText(outcome),
          actionCount: current.actionCount,
          recoveryCount: current.recoveryCount,
          ...(blockedReason ? { blockedReason: sanitizeText(blockedReason) } : {})
        };
        await saveRun(record);
      }
      this.active = undefined;
      this.abortController = undefined;
      this.pendingApproval = undefined;
      this.cdp = undefined;
      await appStorage.setCheckpoint(null);
      await this.onChanged();
    }
  }
}
