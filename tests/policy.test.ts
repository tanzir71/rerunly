import { describe, expect, it } from 'vitest';
import type { ActionProposal } from '../src/shared/types';
import { evaluatePolicy, validateActionShape } from '../src/background/policy';
import { taskFixture } from './fixtures';

function action(partial: Partial<ActionProposal> = {}): ActionProposal {
  return {
    tool: 'browser_click',
    args: { x: 20, y: 30 },
    expectedOutcome: 'The next panel appears.',
    rationale: 'The Continue button is visible.',
    risk: 'low',
    ...partial
  };
}

describe('browser action policy', () => {
  it('allows a low-risk action on a saved origin', () => {
    expect(evaluatePolicy(action(), taskFixture, 'https://example.com/form').decision).toBe('allow');
  });

  it('requires approval for a new origin', () => {
    const decision = evaluatePolicy(
      action({ tool: 'browser_open', args: { url: 'https://other.example/page' } }),
      taskFixture,
      'https://example.com/'
    );
    expect(decision.decision).toBe('approval');
    expect(decision.origin).toBe('https://other.example');
  });

  it.each([
    'Place the order at checkout',
    'Create a new account',
    'Permanently delete the files',
    'Bypass the CAPTCHA'
  ])('blocks prohibited intent: %s', (expectedOutcome) => {
    expect(evaluatePolicy(action({ expectedOutcome }), taskFixture, 'https://example.com/').decision).toBe('block');
  });

  it('blocks internal browser schemes', () => {
    const result = evaluatePolicy(
      action({ tool: 'browser_open', args: { url: 'chrome://settings' } }),
      taskFixture,
      'https://example.com/'
    );
    expect(result.decision).toBe('block');
  });

  it('preflights a tab target origin and asks before closing', () => {
    const switchDecision = evaluatePolicy(
      action({ tool: 'browser_switch_tab', args: { tabId: 2 }, targetOrigin: 'https://private.example' }),
      taskFixture,
      'https://example.com/'
    );
    expect(switchDecision.decision).toBe('approval');
    const closeDecision = evaluatePolicy(
      action({ tool: 'browser_close_tab', args: { tabId: 1 }, targetOrigin: 'https://example.com' }),
      taskFixture,
      'https://example.com/'
    );
    expect(closeDecision.decision).toBe('approval');
  });

  it('rejects coordinate tools without finite coordinates', () => {
    expect(() => validateActionShape(action({ args: { x: Number.NaN, y: 2 } }))).toThrow(/finite/);
  });
});
