import { browser } from 'wxt/browser';
import { DEFAULT_LIMITS } from '../shared/constants';
import type {
  ActionProposal,
  PageEvidence,
  PageTabSummary,
  RedactionRect,
  VisualObservation
} from '../shared/types';
import { clamp, sanitizeText, sleep } from '../shared/utils';
import { processScreenshot } from './image';

type ProtocolObject = Record<string, unknown>;

interface AxNode extends ProtocolObject {
  nodeId?: string;
  parentId?: string;
  ignored?: boolean;
  role?: { value?: unknown };
  name?: { value?: unknown };
  value?: { value?: unknown };
  properties?: Array<{ name?: string; value?: { value?: unknown } }>;
}

interface DebugSessionState {
  consoleErrors: string[];
  failedRequests: string[];
  downloads: string[];
  loading: boolean;
  secretTargetBackendNodeIds: number[];
  secretScrubValues: string[];
  requestUrls: Map<string, string>;
}

function asObject(value: unknown): ProtocolObject {
  return typeof value === 'object' && value !== null ? (value as ProtocolObject) : {};
}

function numeric(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function stringValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function quickHash(value: string): string {
  let hash = 0x811c9dc5;
  const stride = Math.max(1, Math.floor(value.length / 8192));
  for (let index = 0; index < value.length; index += stride) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

function compactAccessibilityTree(nodes: AxNode[]): { tree: string; focused: string } {
  const lines: string[] = [];
  let focused = '';
  for (const node of nodes) {
    if (node.ignored) continue;
    const role = stringValue(node.role?.value);
    const name = stringValue(node.name?.value).replace(/\s+/g, ' ').trim();
    const value = stringValue(node.value?.value).replace(/\s+/g, ' ').trim();
    const isFocused = node.properties?.some(
      (property) => property.name === 'focused' && property.value?.value === true
    );
    if (!role && !name && !value) continue;
    const editableRoles = new Set(['textbox', 'searchbox', 'combobox', 'spinbutton']);
    const line = `${role || 'node'}${name ? ` "${name.slice(0, 180)}"` : ''}${
      value && !editableRoles.has(role) ? ` value="${value.slice(0, 120)}"` : ''
    }${node.nodeId ? ` #${node.nodeId}` : ''}`;
    lines.push(line);
    if (isFocused) focused = line;
    if (lines.length >= 260) break;
  }
  return { tree: lines.join('\n').slice(0, 20_000), focused };
}

function summarizeDomSnapshot(result: ProtocolObject): string {
  const strings = Array.isArray(result.strings) ? (result.strings as unknown[]) : [];
  const documents = Array.isArray(result.documents) ? (result.documents as ProtocolObject[]) : [];
  const snippets: string[] = [];
  let nodeCount = 0;
  let layoutCount = 0;
  for (const document of documents) {
    const nodes = asObject(document.nodes);
    const nodeValues = Array.isArray(nodes.nodeValue) ? (nodes.nodeValue as unknown[]) : [];
    nodeCount += Array.isArray(nodes.nodeName) ? nodes.nodeName.length : 0;
    const layout = asObject(document.layout);
    layoutCount += Array.isArray(layout.nodeIndex) ? layout.nodeIndex.length : 0;
    for (const index of nodeValues.slice(0, 500)) {
      const text = strings[numeric(index, -1)];
      if (typeof text !== 'string') continue;
      const compact = text.replace(/\s+/g, ' ').trim();
      if (compact.length >= 3) snippets.push(compact.slice(0, 160));
      if (snippets.length >= 80) break;
    }
  }
  return JSON.stringify({
    documentCount: documents.length,
    nodeCount,
    renderedNodeCount: layoutCount,
    visibleTextSamples: snippets
  }).slice(0, 12_000);
}

function quadToRect(quadValue: unknown, reason: RedactionRect['reason']): RedactionRect | null {
  if (!Array.isArray(quadValue) || quadValue.length < 8) return null;
  const points = quadValue.map((value) => numeric(value));
  const xs = [points[0]!, points[2]!, points[4]!, points[6]!];
  const ys = [points[1]!, points[3]!, points[5]!, points[7]!];
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  const width = Math.max(...xs) - x;
  const height = Math.max(...ys) - y;
  return width > 0 && height > 0 ? { x, y, width, height, reason } : null;
}

export class CdpController {
  private tabId: number;
  private attached = false;
  private groupId?: number;
  private readonly state: DebugSessionState = {
    consoleErrors: [],
    failedRequests: [],
    downloads: [],
    loading: false,
    secretTargetBackendNodeIds: [],
    secretScrubValues: [],
    requestUrls: new Map()
  };

  constructor(tabId: number) {
    this.tabId = tabId;
  }

  get currentTabId(): number {
    return this.tabId;
  }

  private readonly onEvent = (
    source: chrome.debugger.Debuggee,
    method: string,
    params?: object
  ): void => {
    if (source.tabId !== this.tabId) return;
    const payload = asObject(params);
    if (method === 'Log.entryAdded') {
      const entry = asObject(payload.entry);
      const level = stringValue(entry.level);
      if (level === 'error' || level === 'warning') {
        this.state.consoleErrors.push(
          `${stringValue(entry.source) || 'page'}: ${stringValue(entry.text)}`.slice(0, 500)
        );
        this.state.consoleErrors = this.state.consoleErrors.slice(-50);
      }
    } else if (method === 'Runtime.exceptionThrown') {
      const details = asObject(payload.exceptionDetails);
      const exception = asObject(details.exception);
      this.state.consoleErrors.push(
        `exception: ${stringValue(exception.description) || stringValue(details.text)}`.slice(0, 500)
      );
      this.state.consoleErrors = this.state.consoleErrors.slice(-50);
    } else if (method === 'Runtime.consoleAPICalled') {
      const type = stringValue(payload.type);
      if (type === 'error' || type === 'warning' || type === 'assert') {
        const args = Array.isArray(payload.args) ? (payload.args as ProtocolObject[]) : [];
        const detail = args
          .map((argument) => stringValue(argument.value) || stringValue(argument.description))
          .join(' ');
        this.state.consoleErrors.push(`${type}: ${detail}`.slice(0, 500));
        this.state.consoleErrors = this.state.consoleErrors.slice(-50);
      }
    } else if (method === 'Network.requestWillBeSent') {
      const requestId = stringValue(payload.requestId);
      const url = stringValue(asObject(payload.request).url);
      if (requestId && url) this.state.requestUrls.set(requestId, url);
      if (this.state.requestUrls.size > 200) {
        const oldest = this.state.requestUrls.keys().next().value as string | undefined;
        if (oldest) this.state.requestUrls.delete(oldest);
      }
    } else if (method === 'Network.loadingFailed') {
      const requestId = stringValue(payload.requestId);
      const requestUrl = this.state.requestUrls.get(requestId);
      this.state.failedRequests.push(
        `${stringValue(payload.type) || 'request'} ${requestUrl ?? ''}: ${stringValue(payload.errorText)}`.slice(0, 500)
      );
      if (requestId) this.state.requestUrls.delete(requestId);
      this.state.failedRequests = this.state.failedRequests.slice(-50);
    } else if (method === 'Network.responseReceived') {
      const response = asObject(payload.response);
      const status = numeric(response.status);
      if (status >= 400) {
        this.state.failedRequests.push(
          `HTTP ${status} ${stringValue(response.url)} ${stringValue(response.statusText)}`.slice(0, 500)
        );
        this.state.failedRequests = this.state.failedRequests.slice(-50);
      }
    } else if (method === 'Network.loadingFinished') {
      this.state.requestUrls.delete(stringValue(payload.requestId));
    } else if (method === 'Page.frameStartedLoading') {
      this.state.loading = true;
    } else if (method === 'Page.frameStoppedLoading' || method === 'Page.loadEventFired') {
      this.state.loading = false;
    } else if (method === 'Page.downloadWillBegin') {
      this.state.downloads.push(
        `${stringValue(payload.suggestedFilename)} ${stringValue(payload.url)}`.trim().slice(0, 500)
      );
      this.state.downloads = this.state.downloads.slice(-20);
    }
  };

  async attach(): Promise<void> {
    if (this.attached) return;
    await this.ensureManagedGroup();
    await browser.debugger.attach({ tabId: this.tabId }, '1.3');
    this.attached = true;
    browser.debugger.onEvent.addListener(this.onEvent);
    await Promise.all([
      this.send('Page.enable'),
      this.send('DOM.enable'),
      this.send('Network.enable', { maxTotalBufferSize: 1_000_000 }),
      this.send('Log.enable'),
      this.send('Runtime.enable')
    ]);
    await this.send('Page.setDownloadBehavior', { behavior: 'deny' }).catch(() => ({}));
  }

  private async ensureManagedGroup(): Promise<void> {
    const tab = await browser.tabs.get(this.tabId);
    if (this.groupId === undefined) {
      this.groupId = await browser.tabs.group({ tabIds: [this.tabId] });
      await browser.tabGroups.update(this.groupId, {
        title: 'Rerunly',
        color: 'blue',
        collapsed: false
      });
    } else if (tab.groupId !== this.groupId) {
      await browser.tabs.group({ groupId: this.groupId, tabIds: [this.tabId] });
    }
  }

  private async assertManagedTab(tabId: number): Promise<void> {
    const tab = await browser.tabs.get(tabId);
    if (tab.groupId !== this.groupId) {
      throw new Error('Rerunly can switch or close only tabs in its managed tab group.');
    }
  }

  async detach(): Promise<void> {
    browser.debugger.onEvent.removeListener(this.onEvent);
    if (!this.attached) return;
    try {
      await browser.debugger.detach({ tabId: this.tabId });
    } catch {
      // Chrome may already have detached after a tab closed or DevTools opened.
    } finally {
      this.attached = false;
      this.state.secretTargetBackendNodeIds = [];
      this.state.secretScrubValues = [];
      this.state.requestUrls.clear();
      this.state.downloads = [];
    }
  }

  private async send(method: string, params?: Record<string, unknown>): Promise<ProtocolObject> {
    if (!this.attached) throw new Error('Browser debugger is not attached.');
    const result = await browser.debugger.sendCommand({ tabId: this.tabId }, method, params);
    return asObject(result);
  }

  private async switchAttachedTab(nextTabId: number): Promise<void> {
    if (nextTabId === this.tabId) return;
    await this.detach();
    this.tabId = nextTabId;
    await browser.tabs.update(nextTabId, { active: true });
    await this.attach();
  }

  private async viewport(): Promise<PageEvidence['viewport']> {
    const metrics = await this.send('Page.getLayoutMetrics');
    const visual = asObject(metrics.cssVisualViewport ?? metrics.visualViewport);
    const ratio = await this.send('Runtime.evaluate', {
      expression: 'window.devicePixelRatio',
      returnByValue: true,
      silent: true
    });
    const result = asObject(ratio.result);
    return {
      width: Math.max(1, numeric(visual.clientWidth, 1280)),
      height: Math.max(1, numeric(visual.clientHeight, 720)),
      deviceScaleFactor: Math.max(1, numeric(result.value, 1))
    };
  }

  private async sensitiveRects(): Promise<RedactionRect[]> {
    const selectors: Array<[string, RedactionRect['reason']]> = [
      ['input[type="password"]', 'password'],
      ['input[autocomplete="current-password"]', 'password'],
      ['input[autocomplete="new-password"]', 'password'],
      ['input[autocomplete="cc-number"]', 'payment'],
      ['input[autocomplete="cc-csc"]', 'payment'],
      ['input[autocomplete="cc-exp"]', 'payment']
    ];
    const root = await this.send('DOM.getDocument', { depth: 0, pierce: true });
    const rootNodeId = numeric(asObject(root.root).nodeId);
    if (!rootNodeId) return [];
    const rectangles: RedactionRect[] = [];
    for (const backendNodeId of this.state.secretTargetBackendNodeIds) {
      try {
        const model = await this.send('DOM.getBoxModel', { backendNodeId });
        const rect = quadToRect(asObject(model.model).border, 'secret_target');
        if (rect) rectangles.push(rect);
      } catch {
        // Detached secret targets no longer need a redaction rectangle.
      }
    }
    for (const [selector, reason] of selectors) {
      try {
        const result = await this.send('DOM.querySelectorAll', { nodeId: rootNodeId, selector });
        const nodeIds = Array.isArray(result.nodeIds) ? (result.nodeIds as unknown[]) : [];
        for (const nodeId of nodeIds.slice(0, 30)) {
          const model = await this.send('DOM.getBoxModel', { nodeId: numeric(nodeId) });
          const rect = quadToRect(asObject(model.model).border, reason);
          if (rect) rectangles.push(rect);
        }
      } catch {
        // Detached or hidden nodes do not expose a box model and can be ignored.
      }
    }
    for (const secret of this.state.secretScrubValues) {
      let searchId = '';
      try {
        const search = await this.send('DOM.performSearch', {
          query: secret,
          includeUserAgentShadowDOM: true
        });
        searchId = stringValue(search.searchId);
        const resultCount = Math.min(30, numeric(search.resultCount));
        if (!searchId || !resultCount) continue;
        const results = await this.send('DOM.getSearchResults', {
          searchId,
          fromIndex: 0,
          toIndex: resultCount
        });
        const nodeIds = Array.isArray(results.nodeIds) ? (results.nodeIds as unknown[]) : [];
        for (const nodeId of nodeIds) {
          try {
            const model = await this.send('DOM.getBoxModel', { nodeId: numeric(nodeId) });
            const rect = quadToRect(asObject(model.model).border, 'secret_target');
            if (rect) rectangles.push(rect);
          } catch {
            // Non-rendered matches have no screenshot region to redact.
          }
        }
      } catch {
        // Evidence strings are still scrubbed if DOM search is unavailable.
      } finally {
        if (searchId) {
          await this.send('DOM.discardSearchResults', { searchId }).catch(() => ({}));
        }
      }
    }
    return rectangles;
  }

  registerSecretForScrubbing(secret: string): void {
    if (secret && !this.state.secretScrubValues.includes(secret)) {
      this.state.secretScrubValues.push(secret);
    }
  }

  async validateSecretTarget(x: number, y: number, fieldHints: string[]): Promise<void> {
    try {
      const node = await this.send('DOM.getNodeForLocation', {
        x: Math.round(x),
        y: Math.round(y),
        includeUserAgentShadowDOM: true,
        ignorePointerEventsNone: true
      });
      const backendNodeId = numeric(node.backendNodeId);
      if (!backendNodeId) throw new Error('The protected-value target could not be identified.');
      const described = await this.send('DOM.describeNode', {
        backendNodeId,
        depth: 0,
        pierce: true
      });
      const describedNode = asObject(described.node);
      const nodeName = stringValue(describedNode.nodeName).toLowerCase();
      if (nodeName !== 'input' && nodeName !== 'textarea') {
        throw new Error('Protected values can be inserted only into visible input or textarea fields.');
      }
      const flatAttributes = Array.isArray(describedNode.attributes)
        ? (describedNode.attributes as unknown[]).map(stringValue)
        : [];
      const attributes: Record<string, string> = {};
      for (let index = 0; index < flatAttributes.length; index += 2) {
        attributes[flatAttributes[index] ?? ''] = flatAttributes[index + 1] ?? '';
      }
      const type = (attributes.type ?? 'text').toLowerCase();
      const autocomplete = (attributes.autocomplete ?? '').toLowerCase();
      const allowedTypes = new Set(['text', 'email', 'tel', 'url', 'search']);
      if (nodeName === 'input' && !allowedTypes.has(type)) {
        throw new Error(`Protected task variables cannot be inserted into an input[type=${type}] field.`);
      }
      if (/password|one-time-code|^cc-/.test(autocomplete)) {
        throw new Error('Passwords, one-time codes, and payment fields are not supported.');
      }
      const signature = `${nodeName} ${Object.entries(attributes)
        .map(([name, value]) => `${name}=${value}`)
        .join(' ')}`.toLowerCase();
      if (
        fieldHints.length > 0 &&
        !fieldHints.some((hint) => signature.includes(hint.trim().toLowerCase()))
      ) {
        throw new Error('The selected field does not match this protected value’s field hints.');
      }
      if (!this.state.secretTargetBackendNodeIds.includes(backendNodeId)) {
        this.state.secretTargetBackendNodeIds.push(backendNodeId);
      }
    } catch (error) {
      if (error instanceof Error) throw error;
      throw new Error('The protected-value target could not be validated.');
    }
  }

  async observe(stability: VisualObservation['stability'] = 'stable'): Promise<VisualObservation> {
    const tab = await browser.tabs.get(this.tabId);
    const [viewport, axResult, domResult, tabs, redactions] = await Promise.all([
      this.viewport(),
      this.send('Accessibility.getFullAXTree', { depth: 20 }),
      this.send('DOMSnapshot.captureSnapshot', {
        computedStyles: ['display', 'visibility'],
        includePaintOrder: true,
        includeDOMRects: true
      }),
      this.groupId === undefined
        ? browser.tabs.query({ active: true, currentWindow: true })
        : browser.tabs.query({ groupId: this.groupId }),
      this.sensitiveRects()
    ]);
    const screenshot = await this.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: false
    });
    const raw = `data:image/png;base64,${stringValue(screenshot.data)}`;
    const processed = await processScreenshot(raw, redactions, viewport);
    const axNodes = Array.isArray(axResult.nodes) ? (axResult.nodes as AxNode[]) : [];
    const accessibility = compactAccessibilityTree(axNodes);
    const scrubValues = this.state.secretScrubValues;
    const tabSummaries: PageTabSummary[] = tabs
      .filter((item): item is typeof item & { id: number } => typeof item.id === 'number')
      .map((item) => ({
        id: item.id,
        title: sanitizeText(item.title ?? '', scrubValues),
        url: sanitizeText(item.url ?? '', scrubValues),
        active: Boolean(item.active)
      }));
    const consoleErrors = this.state.consoleErrors.splice(0, this.state.consoleErrors.length);
    const failedRequests = this.state.failedRequests.splice(0, this.state.failedRequests.length);
    const downloads = this.state.downloads.splice(0, this.state.downloads.length);

    return {
      tabId: this.tabId,
      screenshotDataUrl: processed.dataUrl,
      screenshotHash: processed.hash,
      evidence: {
        url: sanitizeText(tab.url ?? '', scrubValues),
        title: sanitizeText(tab.title ?? '', scrubValues),
        viewport,
        screenshotSize: { width: processed.width, height: processed.height },
        focusedElement: sanitizeText(accessibility.focused, scrubValues),
        accessibilityTree: sanitizeText(accessibility.tree, scrubValues),
        domSummary: sanitizeText(summarizeDomSnapshot(domResult), scrubValues),
        consoleErrors: consoleErrors.map((value) => sanitizeText(value, scrubValues)),
        failedRequests: failedRequests.map((value) => sanitizeText(value, scrubValues)),
        downloads: downloads.map((value) => sanitizeText(value, scrubValues)),
        navigationState: this.state.loading ? 'loading' : 'stable',
        tabs: tabSummaries
      },
      redactions: processed.redactions,
      stability,
      capturedAt: Date.now()
    };
  }

  async waitForStability(signal?: AbortSignal): Promise<VisualObservation['stability']> {
    const startedAt = Date.now();
    let lastSignature = '';
    let consecutiveMatches = 0;
    while (Date.now() - startedAt < DEFAULT_LIMITS.stabilityCeilingMs) {
      await sleep(400, signal);
      const [metrics, snapshot, visual] = await Promise.all([
        this.send('Page.getLayoutMetrics'),
        this.send('DOMSnapshot.captureSnapshot', {
          computedStyles: [],
          includePaintOrder: false,
          includeDOMRects: false
        }),
        this.send('Page.captureScreenshot', {
          format: 'jpeg',
          quality: 40,
          fromSurface: true,
          captureBeyondViewport: false
        })
      ]);
      const signature = `${JSON.stringify(metrics.cssVisualViewport ?? metrics.visualViewport)}:${
        JSON.stringify(snapshot.documents).length
      }:${quickHash(stringValue(visual.data))}`;
      if (!this.state.loading && signature === lastSignature) consecutiveMatches += 1;
      else consecutiveMatches = 0;
      if (consecutiveMatches >= 1) return 'stable';
      lastSignature = signature;
    }
    return this.state.loading ? 'timed_out' : 'unstable';
  }

  private async click(x: number, y: number): Promise<void> {
    const viewport = await this.viewport();
    const safeX = clamp(x, 0, viewport.width - 1);
    const safeY = clamp(y, 0, viewport.height - 1);
    await this.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: safeX,
      y: safeY,
      button: 'left',
      clickCount: 1
    });
    await this.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: safeX,
      y: safeY,
      button: 'left',
      clickCount: 1
    });
  }

  private async key(key: string, modifiers = 0): Promise<void> {
    await this.send('Input.dispatchKeyEvent', { type: 'keyDown', key, modifiers });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key, modifiers });
  }

  async execute(action: ActionProposal, secretValue?: string, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const x = numeric(action.args.x);
    const y = numeric(action.args.y);
    switch (action.tool) {
      case 'browser_open':
        await this.send('Page.navigate', { url: stringValue(action.args.url) });
        break;
      case 'browser_click':
        await this.click(x, y);
        break;
      case 'browser_type':
        await this.click(x, y);
        if (action.args.replace === true) await this.key('a', 2);
        await this.send('Input.insertText', { text: stringValue(action.args.text) });
        break;
      case 'browser_type_secret':
        if (typeof secretValue !== 'string') throw new Error('Protected value was not supplied.');
        await this.click(x, y);
        if (action.args.replace === true) await this.key('a', 2);
        await this.send('Input.insertText', { text: secretValue });
        break;
      case 'browser_select':
        await this.click(x, y);
        await this.send('Input.insertText', { text: stringValue(action.args.optionText) });
        await this.key('Enter');
        break;
      case 'browser_scroll':
        await this.send('Input.dispatchMouseEvent', {
          type: 'mouseWheel',
          x,
          y,
          deltaX: numeric(action.args.deltaX),
          deltaY: numeric(action.args.deltaY, 550)
        });
        break;
      case 'browser_wait':
        await sleep(clamp(numeric(action.args.ms, 1_000), 100, 10_000), signal);
        break;
      case 'browser_back': {
        const history = await this.send('Page.getNavigationHistory');
        const entries = Array.isArray(history.entries) ? (history.entries as ProtocolObject[]) : [];
        const currentIndex = numeric(history.currentIndex);
        const previous = entries[currentIndex - 1];
        if (!previous) throw new Error('There is no previous history entry.');
        await this.send('Page.navigateToHistoryEntry', { entryId: numeric(previous.id) });
        break;
      }
      case 'browser_refresh':
        await this.send('Page.reload', { ignoreCache: false });
        break;
      case 'browser_new_tab': {
        const created = await browser.tabs.create({
          url: stringValue(action.args.url) || 'about:blank',
          active: true
        });
        if (typeof created.id !== 'number') throw new Error('Chrome did not return the new tab ID.');
        if (this.groupId !== undefined) {
          await browser.tabs.group({ groupId: this.groupId, tabIds: [created.id] });
        }
        await this.switchAttachedTab(created.id);
        break;
      }
      case 'browser_switch_tab': {
        const nextTabId = numeric(action.args.tabId);
        if (!nextTabId) throw new Error('A tab ID is required.');
        await this.assertManagedTab(nextTabId);
        await this.switchAttachedTab(nextTabId);
        break;
      }
      case 'browser_close_tab': {
        const closeTabId = numeric(action.args.tabId, this.tabId);
        await this.assertManagedTab(closeTabId);
        if (closeTabId === this.tabId) {
          const tabs =
            this.groupId === undefined
              ? await browser.tabs.query({ currentWindow: true })
              : await browser.tabs.query({ groupId: this.groupId });
          const fallback = tabs.find((item) => item.id !== closeTabId && typeof item.id === 'number');
          if (!fallback?.id) throw new Error('Rerunly cannot close the only available tab.');
          await this.detach();
          await browser.tabs.remove(closeTabId);
          this.tabId = fallback.id;
          await browser.tabs.update(fallback.id, { active: true });
          await this.attach();
        } else {
          await browser.tabs.remove(closeTabId);
        }
        break;
      }
      case 'browser_file_select':
        await this.click(x, y);
        break;
      case 'browser_observe':
      case 'browser_finish':
        break;
      default: {
        const exhaustive: never = action.tool;
        throw new Error(`Unsupported browser tool: ${String(exhaustive)}`);
      }
    }
  }
}
