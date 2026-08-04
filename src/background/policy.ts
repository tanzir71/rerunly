import { BLOCKED_SCHEMES } from '../shared/constants';
import type { ActionProposal, BrowserToolName, SavedTask } from '../shared/types';
import { normalizeOrigin, originMatches } from '../shared/utils';

export interface PolicyDecision {
  decision: 'allow' | 'approval' | 'block';
  reason: string;
  origin: string;
}

const PROHIBITED_PATTERNS = [
  /\b(?:buy now|place order|checkout|make (?:a )?purchase|complete purchase)\b/i,
  /\b(?:credit card|debit card|bank account|wire transfer|payment credentials?)\b/i,
  /\b(?:execute|place|submit) (?:a )?(?:financial )?trade\b/i,
  /\b(?:create|register|open) (?:a new )?account\b/i,
  /\b(?:empty trash|permanently delete|delete forever)\b/i,
  /\b(?:disable|change|modify) (?:security|access|permission)s?\b/i,
  /\b(?:solve|bypass|circumvent) (?:(?:a|the) )?captcha\b/i,
  /\b(?:passport|national id|driver'?s license|social security number)\b/i
] as const;

const SENSITIVE_PATTERNS = [
  /\b(?:send|post|publish|submit|upload|download|authorize|grant access)\b/i,
  /\b(?:email|message|comment|form)\b/i
] as const;

function actionCapability(tool: BrowserToolName): 'navigate' | 'input' | 'secret_input' | 'tabs' {
  if (tool === 'browser_type_secret') return 'secret_input';
  if (
    tool === 'browser_click' ||
    tool === 'browser_type' ||
    tool === 'browser_select' ||
    tool === 'browser_file_select'
  ) {
    return 'input';
  }
  if (
    tool === 'browser_new_tab' ||
    tool === 'browser_switch_tab' ||
    tool === 'browser_close_tab'
  ) {
    return 'tabs';
  }
  return 'navigate';
}

function targetUrl(action: ActionProposal, currentUrl: string): string {
  if (action.targetOrigin) return action.targetOrigin;
  const raw = action.args.url;
  if (typeof raw !== 'string') return currentUrl;
  try {
    return new URL(raw, currentUrl).href;
  } catch {
    return raw;
  }
}

function hasStoredGrant(task: SavedTask, origin: string, tool: BrowserToolName): boolean {
  const capability = actionCapability(tool);
  return task.storedGrants.some(
    (grant) => grant.origin === origin && grant.capabilities.includes(capability)
  );
}

export function evaluatePolicy(
  action: ActionProposal,
  task: SavedTask,
  currentUrl: string
): PolicyDecision {
  const url = targetUrl(action, currentUrl);
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { decision: 'block', reason: 'The action contains an invalid URL.', origin: '' };
  }

  if (BLOCKED_SCHEMES.some((scheme) => parsed.protocol === scheme)) {
    return {
      decision: 'block',
      reason: `Rerunly cannot act on ${parsed.protocol} pages.`,
      origin: parsed.origin
    };
  }

  const description = `${action.tool} ${action.expectedOutcome} ${action.rationale} ${JSON.stringify(action.args)}`;
  if (action.risk === 'prohibited' || PROHIBITED_PATTERNS.some((pattern) => pattern.test(description))) {
    return {
      decision: 'block',
      reason: 'This action falls within a prohibited high-risk category.',
      origin: parsed.origin
    };
  }

  const origin = normalizeOrigin(parsed.href) ?? '';
  if (!origin) {
    return { decision: 'block', reason: 'Only HTTP and HTTPS pages are supported.', origin };
  }

  if (!originMatches(origin, task.allowedOrigins)) {
    return {
      decision: 'approval',
      reason: `The task has not been approved to access ${origin}.`,
      origin
    };
  }

  if (action.tool === 'browser_type_secret') {
    const alias = typeof action.args.secretAlias === 'string' ? action.args.secretAlias : '';
    const binding = task.secretBindings.find((item) => item.alias === alias);
    if (!binding) {
      return {
        decision: 'block',
        reason: `No protected value is bound to {{secret:${alias}}}.`,
        origin
      };
    }
    if (!originMatches(origin, binding.allowedOrigins)) {
      return {
        decision: 'approval',
        reason: `Protected value ${alias} is not approved for ${origin}.`,
        origin
      };
    }
  }

  if (action.tool === 'browser_file_select') {
    return {
      decision: 'approval',
      reason: 'File selection requires you to choose the file in Chrome.',
      origin
    };
  }

  if (action.tool === 'browser_close_tab') {
    return {
      decision: 'approval',
      reason: 'Closing a tab requires explicit approval.',
      origin
    };
  }

  if (
    action.risk === 'sensitive' ||
    SENSITIVE_PATTERNS.some((pattern) => pattern.test(description))
  ) {
    if (!hasStoredGrant(task, origin, action.tool)) {
      return {
        decision: 'approval',
        reason: 'This action may submit information or communicate externally.',
        origin
      };
    }
  }

  return { decision: 'allow', reason: 'Action is within the saved task scope.', origin };
}

export function validateActionShape(action: ActionProposal): void {
  if (!action.tool.startsWith('browser_')) throw new Error('Unknown browser tool.');
  if (!action.expectedOutcome.trim()) throw new Error('Every action needs an expected outcome.');
  if (!action.rationale.trim()) throw new Error('Every action needs a rationale.');
  if (typeof action.args !== 'object' || action.args === null || Array.isArray(action.args)) {
    throw new Error('Tool arguments must be an object.');
  }

  const coordinateTools: BrowserToolName[] = [
    'browser_click',
    'browser_type',
    'browser_type_secret',
    'browser_select',
    'browser_file_select'
  ];
  if (coordinateTools.includes(action.tool)) {
    const { x, y } = action.args;
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) {
      throw new Error(`${action.tool} requires finite x and y coordinates.`);
    }
  }
}
