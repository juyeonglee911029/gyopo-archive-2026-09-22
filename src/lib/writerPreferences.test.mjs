import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_AI_WRITING_PROMPT,
  MAX_AI_WRITING_PROMPT_LENGTH,
  MAX_AI_WRITING_SUMMARY_LENGTH,
  createWriterDraftRequest,
  normalizeAiWritingPrompt,
  normalizeWriterDraftSummary,
  writerModeInstructions,
} from './writerPreferences.ts';

test('writer preferences are bounded strings and empty values clear cleanly', () => {
  assert.equal(normalizeAiWritingPrompt(null), '');
  assert.equal(normalizeAiWritingPrompt('   '), '');
  assert.equal(normalizeAiWritingPrompt('  concise and warm  '), 'concise and warm');
  assert.equal(normalizeAiWritingPrompt('x'.repeat(2_000)).length, MAX_AI_WRITING_PROMPT_LENGTH);
});

test('writer mode uses the default preference and honors a saved override', () => {
  const defaultPrompt = writerModeInstructions('');
  assert.ok(defaultPrompt.includes(JSON.stringify(DEFAULT_AI_WRITING_PROMPT)));

  const prompt = writerModeInstructions('Friendly tone');
  assert.match(prompt, /문체·어조·구성에만 반영/);
  assert.match(prompt, /사실의 정확성·안전 지침/);
  assert.match(prompt, /"Friendly tone"/);
  assert.ok(!prompt.includes(JSON.stringify(DEFAULT_AI_WRITING_PROMPT)));
});

test('writer requests keep the short summary separate from the draft message', () => {
  const request = createWriterDraftRequest('news', '  지역 축제 일정과 교통 안내  ', '제목: 주말 지역 소식');
  assert.equal(request.mode, 'writerDraft');
  assert.equal(request.category, 'news');
  assert.equal(request.summary, '지역 축제 일정과 교통 안내');
  assert.equal(request.messages[0].content, '제목: 주말 지역 소식');
  assert.ok(!request.messages[0].content.includes(request.summary));

  assert.equal(normalizeWriterDraftSummary('요약'.repeat(400)).length, MAX_AI_WRITING_SUMMARY_LENGTH);
  assert.equal(normalizeWriterDraftSummary(null), '');
});
