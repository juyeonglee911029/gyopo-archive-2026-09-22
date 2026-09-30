import assert from 'node:assert/strict';
import test from 'node:test';
import { areDatingProfilesCompatible, datingInterestDocumentId, validateDatingProfileDraft } from './dating.ts';

const account = { age: 29, gender: 'female', country: 'USA' };
const draft = { displayName: 'Mina', city: 'Los Angeles', bio: '한국 음식을 좋아해요.', preferredGender: 'male', minAge: 25, maxAge: 38, isActive: true };

test('dating profiles require an adult account and bounded public fields', () => {
  assert.equal(validateDatingProfileDraft(draft, account), null);
  assert.match(validateDatingProfileDraft(draft, { ...account, age: 17 }) || '', /18세/);
  assert.match(validateDatingProfileDraft(draft, { ...account, age: 131 }) || '', /18세/);
  assert.match(validateDatingProfileDraft(draft, { ...account, country: 'Global' }) || '', /국가/);
  assert.match(validateDatingProfileDraft({ ...draft, bio: '연락은 https://example.com' }, account) || '', /연락처/);
  assert.match(validateDatingProfileDraft({ ...draft, city: 'min@example.com' }, account) || '', /주소/);
  assert.match(validateDatingProfileDraft({ ...draft, minAge: 15 }, account) || '', /연령/);
  assert.match(validateDatingProfileDraft({ ...draft, displayName: 'x'.repeat(81) }, account) || '', /표시 이름/);
});

test('dating discovery requires mutual age and gender preference compatibility', () => {
  const viewer = { id: 'a', age: 29, gender: 'female', preferredGender: 'male', minAge: 25, maxAge: 38, isActive: true };
  const candidate = { id: 'b', age: 31, gender: 'male', preferredGender: 'female', minAge: 27, maxAge: 35, isActive: true };
  assert.equal(areDatingProfilesCompatible(viewer, candidate), true);
  assert.equal(areDatingProfilesCompatible(viewer, { ...candidate, minAge: 35 }), false);
  assert.equal(areDatingProfilesCompatible(viewer, { ...candidate, preferredGender: 'male' }), false);
});

test('interest ids are directional and reject invalid targets', () => {
  assert.equal(datingInterestDocumentId('alice', 'bob'), '5_alice_bob');
  assert.notEqual(datingInterestDocumentId('a', 'b_c'), datingInterestDocumentId('a_b', 'c'));
  assert.throws(() => datingInterestDocumentId('alice', 'alice'));
  assert.throws(() => datingInterestDocumentId('alice/other', 'bob'));
});
