import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const rules = read('./firestore.rules');
const firebase = read('./src/lib/firebase.ts');
const assistant = read('./src/app/api/assistant/route.ts');
const tronBalance = read('./src/app/api/tron/balance/route.ts');
const tronDeposits = read('./src/app/api/tron/deposits/route.ts');
const tronWallet = read('./src/app/api/tron/wallet/route.ts');
const crawler = read('./src/app/api/content/preview/route.ts');
const paddle = read('./src/lib/paddle.ts');
const jobWriter = read('./src/components/posts/JobPostWriter.tsx');
const newsPage = read('./src/app/news/page.tsx');

assert.match(rules, /match \/tetrisScores\/\{scoreId\}/);
assert.match(rules, /request\.resource\.data\.userId == request\.auth\.uid[\s\S]*hasValidTetrisScore/);
assert.match(rules, /match \/gamePayouts\/\{payoutId\}[\s\S]*allow create, update, delete: if false;/);
assert.match(rules, /match \/walletLedger\/\{entryId\}[\s\S]*allow create, update, delete: if false;/);
assert.match(rules, /match \/escrowOrders\/\{orderId\}[\s\S]*allow create, update, delete: if false;/);
assert.match(rules, /preservesTetrisSettlement[\s\S]*stakeHeldA[\s\S]*payoutStatus/);
assert.match(rules, /function hasValidTetrisBet[\s\S]*data\.betAmount is int[\s\S]*data\.betAmount >= 0[\s\S]*data\.betAmount <= 100/);
assert.match(firebase, /const freeMatch = room\.betAmount === 0[\s\S]*!freeMatch && \(!room\.stakeHeldA \|\| !room\.stakeHeldB\)/);
assert.match(rules, /match \/profiles\/\{userId\}[\s\S]*hasNoServerManagedProfileChange/);
assert.match(rules, /match \/walletVault\/\{userId\}[\s\S]*request\.auth\.uid == userId/);

for (const collection of ['gameStakes', 'gamePayouts', 'genderMatchStakes', 'premiumSubscriptions', 'transferRequests']) {
  assert.match(firebase, new RegExp(`'${collection}'`), `${collection} must be client-blocked`);
}
assert.match(firebase, /'escrowOrders'/);
assert.match(firebase, /function deleteDocument\([\s\S]*?assertClientWriteAllowed\(collection\)/);
for (const functionName of ['approveDepositRequest', 'approveTransferRequest', 'reviewTransferRequest', 'sendUserTransfer', 'reserveGameStake', 'settleTetrisMatch']) {
  assert.match(firebase, new RegExp(`export async function ${functionName}[\\s\\S]*?throw new Error\\(serverOnlyFinancialError\\)`), `${functionName} must fail closed`);
}
assert.match(firebase, /throw new Error\(serverOnlyFinancialError\)/);
assert.match(assistant, /requireAuthenticatedUser/);
assert.match(assistant, /consumeRateLimit/);
assert.match(assistant, /candidate\.content\.length <= 4_000/);
assert.match(assistant, /body\?\.mode === 'writerDraft'[\s\S]*readProfileAiWritingPrompt/);
assert.match(assistant, /request\.text\(\)[\s\S]*rawBody\.length > 32_000/);
assert.match(rules, /defaultAiWritingPrompt is string && data\.defaultAiWritingPrompt\.size\(\) <= 1200/);
assert.match(newsPage, /post\.type === 'news' && isPublicArticle\(post\)/);
assert.match(jobWriter, /if \(savingRef\.current && !afterSave\) return/);
assert.match(jobWriter, /savingRef\.current = true[\s\S]*close\(true\)/);
assert.match(read('./src/lib/apiSecurity.ts'), /readProfileAiWritingPrompt/);
assert.match(read('./src/lib/apiSecurity.ts'), /tokenExpiry[\s\S]*payload\.exp[\s\S]*Math\.min\(expiresAt/);
assert.match(tronBalance, /requireAuthenticatedUser/);
assert.match(tronBalance, /readProfileWalletAddress/);
assert.match(tronDeposits, /requireMasterUser/);
assert.match(tronDeposits, /MASTER_DEPOSIT_ADDRESS/);
assert.match(tronWallet, /userId !== user\.uid/);
assert.match(tronWallet, /consumeRateLimit/);
assert.match(crawler, /consumeRateLimit/);
assert.match(crawler, /sourceParam\.length > 80/);
assert.doesNotMatch(paddle, /custom_data\?\.amountUsd/);

console.log('security hardening static checks passed');
