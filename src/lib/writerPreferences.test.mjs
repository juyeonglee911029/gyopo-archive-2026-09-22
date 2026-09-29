import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_AI_WRITING_PROMPT_LENGTH, normalizeAiWritingPrompt, writerModeInstructions } from './writerPreferences.ts';

test('writer preferences are bounded strings and empty values clear cleanly', () => {
  assert.equal(normalizeAiWritingPrompt(null), '');
  assert.equal(normalizeAiWritingPrompt('   '), '');
  assert.equal(normalizeAiWritingPrompt('  concise and warm  '), 'concise and warm');
  assert.equal(normalizeAiWritingPrompt('x'.repeat(2_000)).length, MAX_AI_WRITING_PROMPT_LENGTH);
});

test('writer mode treats the saved preference as style-only input', () => {
  const prompt = writerModeInstructions('Friendly tone');
  assert.match(prompt, /문체·어조·구성에만 반영/);
  assert.match(prompt, /사실의 정확성·안전 지침/);
  assert.match(prompt, /"Friendly tone"/);
});
