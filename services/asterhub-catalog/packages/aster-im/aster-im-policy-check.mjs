import assert from 'node:assert/strict';
import test from 'node:test';

import { createTokenBotRpcHandler } from '../plugin-src/host/channels/shared/rpc.mjs';
import { harnessConnection } from '../plugin-src/host/harness-connection.mjs';
import { isModelCommand, runModelCommand } from '../src/channels/shared/model-command.mjs';

test('model and reasoning commands are handled without querying or changing Host configuration', async () => {
  for (const command of ['/models', '/model openai/gpt-x', '/reasoninglist', '/reasoning high']) {
    assert.equal(isModelCommand(command), true);
    const result = await runModelCommand(command, null, null, 'conversation');
    assert.equal(result.message, '模型由工作台统一管理。');
  }
});

test('the channel RPC rejects direct per-bot model changes', async () => {
  let changed = false;
  const handler = createTokenBotRpcHandler({
    status: async () => ({ bots: [] }),
    bindCredentials: async () => ({}),
    reconnectBot: async () => ({}),
    deleteBot: async () => ({}),
    updateModel: async () => { changed = true; },
  }, { channel: 'Test' });
  const result = await handler('bot.model.set', {
    botId: 'bot_1', model: { provider: 'openai', model: 'gpt-x' },
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'bad-request');
  assert.equal(changed, false);
});

test('legacy remote Harness URLs cannot replace the current authenticated Host', () => {
  const apiProxy = { request() {} };
  const root = {};
  const connection = harnessConnection({ apiProxy, root }, {
    harnessBaseUrl: 'https://other-host.example/api',
  });
  assert.equal(connection.apiProxy, apiProxy);
  assert.equal(connection.interactionScope, root);
  assert.equal(Object.hasOwn(connection, 'baseUrl'), false);
});
