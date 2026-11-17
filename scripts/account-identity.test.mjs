import test from 'node:test';
import assert from 'node:assert/strict';
import {
  accountNameFromStorageState,
  cleanAccountName,
  findAccountName,
  isUserInfoUrl,
  maskEmail,
  resolveAccountName,
} from './account-identity.mjs';

test('prefers a nickname over contact details', () => {
  const payload = { base_resp: { status_code: 0 }, data: { user: { user_id: 1, email: 'leo@example.com', nickname: 'Leo' } } };
  assert.equal(findAccountName(payload), 'Leo');
});

test('masks e-mail addresses and phone numbers', () => {
  assert.equal(maskEmail('leo.wang@example.com'), 'le***@example.com');
  assert.equal(findAccountName({ data: { uid: 7, email: 'abc@x.io' } }), 'ab***@x.io');
  assert.equal(findAccountName({ data: { uid: 7, phone: '+86 138 0013 8000' } }), '861****8000');
  assert.equal(cleanAccountName('someone@mail.com'), 'so***@mail.com');
});

test('a bare name only counts on a user-like object', () => {
  assert.equal(findAccountName({ plan: { name: 'Pro' } }), null);
  assert.equal(findAccountName({ profile: { user_id: 3, name: 'Hissor' } }), 'Hissor');
});

test('reads the name out of localStorage in a storage state', () => {
  const state = {
    cookies: [],
    origins: [{
      origin: 'https://agent.minimax.io',
      localStorage: [
        { name: 'theme', value: 'dark' },
        { name: 'user_info', value: JSON.stringify({ state: JSON.stringify({ userInfo: { nickName: 'hissor' } }) }) },
      ],
    }],
  };
  assert.equal(accountNameFromStorageState(state), 'hissor');
  assert.equal(accountNameFromStorageState({ cookies: [], origins: [] }), null);
});

test('recognises user-info endpoints', () => {
  assert.equal(isUserInfoUrl('https://agent.minimax.io/v1/api/user/info'), true);
  assert.equal(isUserInfoUrl('https://agent.minimax.io/matrix/api/v1/user_info'), true);
  assert.equal(isUserInfoUrl('https://agent.minimax.io/minimax-cloud/api/v1/signin/status'), false);
});

test('explicit alias wins, then detected name, then account-N', () => {
  assert.equal(resolveAccountName({ explicit: ' mine ', detected: 'x', accountNumber: 2 }), 'mine');
  assert.equal(resolveAccountName({ explicit: '', detected: 'x', accountNumber: 2 }), 'x');
  assert.equal(resolveAccountName({ accountNumber: 2 }), 'account-2');
  assert.equal(resolveAccountName({}), 'default');
});
