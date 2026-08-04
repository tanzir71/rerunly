import { afterEach, describe, expect, it, vi } from 'vitest';
import { discoverModels, validateProviderBaseUrl, VisionModelClient } from '../src/background/providers';
import { observationFixture, providerFixture, taskFixture } from './fixtures';

afterEach(() => vi.unstubAllGlobals());

describe('model providers', () => {
  it('restricts provider URLs to OpenRouter and local LM Studio', () => {
    expect(validateProviderBaseUrl('openrouter', 'https://openrouter.ai/api/v1/')).toBe('https://openrouter.ai/api/v1');
    expect(validateProviderBaseUrl('lmstudio', 'http://localhost:1234/v1')).toBe('http://localhost:1234/v1');
    expect(() => validateProviderBaseUrl('openrouter', 'https://example.com/v1')).toThrow();
    expect(() => validateProviderBaseUrl('lmstudio', 'http://192.168.1.20:1234/v1')).toThrow();
  });

  it('filters OpenRouter discovery to image + tool models', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: [
      { id: 'vision-tools', name: 'Vision Tools', architecture: { input_modalities: ['text', 'image'] }, supported_parameters: ['tools'] },
      { id: 'text-tools', name: 'Text Tools', architecture: { input_modalities: ['text'] }, supported_parameters: ['tools'] }
    ] }), { status: 200 })));
    const models = await discoverModels('openrouter', 'https://openrouter.ai/api/v1', 'secret');
    expect(models.map((model) => model.id)).toEqual(['vision-tools']);
  });

  it('understands LM Studio native model metadata', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ models: [
      { key: 'qwen/qwen3.5-9b', display_name: 'Qwen3.5 9B', capabilities: { vision: true, trained_for_tool_use: true } },
      { key: 'embedding-only', display_name: 'Embedding', capabilities: null }
    ] }), { status: 200 })));
    const models = await discoverModels('lmstudio', 'http://localhost:1234/v1');
    expect(models).toHaveLength(1);
    expect(models[0]?.id).toBe('qwen/qwen3.5-9b');
  });

  it('performs separate planner and verifier calls', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { tool_calls: [{ function: { name: 'browser_click', arguments: JSON.stringify({ x: 12, y: 14, expectedOutcome: 'Done appears', rationale: 'Visible button', risk: 'low' }) } }] } }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { tool_calls: [{ function: { name: 'report_verification', arguments: JSON.stringify({ status: 'complete', evidence: 'Done is visible', detectedProblem: '', recommendedRecovery: '' }) } }] } }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new VisionModelClient(providerFixture, 'key');
    const proposal = await client.plan(taskFixture, observationFixture, '');
    const verification = await client.verify(taskFixture, proposal, observationFixture, observationFixture, { changedRatio: 0, changedRegion: null, meaningfullyChanged: false });
    expect(proposal.tool).toBe('browser_click');
    expect(verification.status).toBe('complete');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('assembles streamed tool-call arguments for slow local models', async () => {
    const stream = [
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"browser_click","arguments":"{\\"x\\":12,\\"y\\":14,"}}]}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"expectedOutcome\\":\\"Done appears\\",\\"rationale\\":\\"Visible button\\",\\"risk\\":\\"low\\"}"}}]}}]}',
      'data: [DONE]',
      ''
    ].join('\n\n');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(stream, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' }
    })));
    const client = new VisionModelClient(providerFixture, 'key');
    const proposal = await client.plan(taskFixture, observationFixture, '');
    expect(proposal).toMatchObject({ tool: 'browser_click', expectedOutcome: 'Done appears' });
  });
});
