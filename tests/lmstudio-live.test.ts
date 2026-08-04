import { expect, it } from 'vitest';
import { discoverModels } from '../src/background/providers';

const liveIt = process.env.RUN_LMSTUDIO_LIVE === '1' ? it : it.skip;

liveIt('discovers a real local LM Studio vision + tool model', async () => {
  const models = await discoverModels('lmstudio', 'http://localhost:1234/v1');
  expect(models.length).toBeGreaterThan(0);
  expect(models.every((model) => model.capabilities.vision && model.capabilities.tools)).toBe(true);
});
