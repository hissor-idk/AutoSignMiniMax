// Work out a readable name for the MiniMax account a login belongs to, so no
// account name has to be hard-coded in the workflow or the desktop app.
//
// Sources, best first:
//   1. MINIMAX_ACCOUNT_NAME (an explicit alias the user chose)
//   2. user info MiniMax itself returns while the page loads
//   3. user info the web app keeps in localStorage (inside the storage state)
//   4. account-N
//
// Workflow logs of a public repository are public, so e-mail addresses and
// phone numbers are always masked; nicknames are used as-is.

const NAME_KEYS = [
  'nickname', 'nick_name', 'nickName',
  'display_name', 'displayName',
  'user_name', 'userName', 'username',
  'real_name', 'realName',
];
const EMAIL_KEYS = ['email', 'user_email', 'userEmail', 'mail'];
const PHONE_KEYS = ['phone', 'mobile', 'phone_number', 'phoneNumber', 'mobile_number'];
// A bare `name` only counts inside an object that clearly describes a user.
const USER_HINT_KEYS = ['user_id', 'userId', 'uid', 'email', 'avatar', 'avatar_url', 'avatarUrl', 'phone', 'mobile'];

const USER_PATH = /(?:^|\/)(?:user|users|account|accounts|profile|userinfo|user_info|me|whoami|get_user_info|getuserinfo)(?:\/|$|_|-)/i;
const USER_STORAGE_KEY = /user|account|profile|auth|login|session|member/i;

const MAX_DEPTH = 6;
const MAX_LENGTH = 40;

function text(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const result = String(value).replace(/\s+/g, ' ').trim();
  return result ? result : null;
}

export function maskEmail(email) {
  const value = text(email);
  if (!value || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) return null;
  const [local, domain] = value.split('@');
  const visible = local.length <= 2 ? local.slice(0, 1) : local.slice(0, 2);
  return `${visible}***@${domain}`;
}

export function maskPhone(phone) {
  const digits = String(text(phone) ?? '').replace(/\D/g, '');
  if (digits.length < 6) return null;
  return `${digits.slice(0, 3)}****${digits.slice(-4)}`;
}

export function cleanAccountName(value) {
  const result = text(value);
  if (!result) return null;
  // Looks like an e-mail or a phone number: never print it in full.
  if (result.includes('@')) return maskEmail(result);
  if (/^\+?[\d\s-]{8,}$/.test(result)) return maskPhone(result);
  return result.length > MAX_LENGTH ? `${result.slice(0, MAX_LENGTH - 1)}…` : result;
}

function pick(object, keys, clean) {
  for (const key of keys) {
    if (key in object) {
      const value = clean(object[key]);
      if (value) return value;
    }
  }
  return null;
}

function scoreObject(object) {
  const nickname = pick(object, NAME_KEYS, cleanAccountName);
  if (nickname) return { name: nickname, rank: 0 };
  const looksLikeUser = USER_HINT_KEYS.some((key) => key in object);
  if (looksLikeUser) {
    const name = pick(object, ['name'], cleanAccountName);
    if (name) return { name, rank: 1 };
  }
  const email = pick(object, EMAIL_KEYS, maskEmail);
  if (email) return { name: email, rank: 2 };
  const phone = pick(object, PHONE_KEYS, maskPhone);
  if (phone) return { name: phone, rank: 3 };
  return null;
}

/**
 * Search a parsed JSON value for the best account name it carries.
 * Returns null when nothing user-like is found.
 */
export function findAccountName(value) {
  let best = null;
  const seen = new Set();
  const visit = (node, depth) => {
    if (!node || typeof node !== 'object' || depth > MAX_DEPTH || seen.has(node)) return;
    seen.add(node);
    if (!Array.isArray(node)) {
      const found = scoreObject(node);
      if (found && (!best || found.rank < best.rank)) best = found;
    }
    for (const child of Object.values(node)) {
      if (typeof child === 'string' && depth < MAX_DEPTH && /^[\[{]/.test(child.trim())) {
        try {
          visit(JSON.parse(child), depth + 1);
        } catch {
          // Not JSON after all.
        }
      } else {
        visit(child, depth + 1);
      }
    }
  };
  visit(value, 0);
  return best?.name ?? null;
}

/** Name from the localStorage entries a Playwright storage state carries. */
export function accountNameFromStorageState(state) {
  const origins = Array.isArray(state?.origins) ? state.origins : [];
  let best = null;
  for (const origin of origins) {
    const entries = Array.isArray(origin?.localStorage) ? origin.localStorage : [];
    for (const entry of entries) {
      if (!USER_STORAGE_KEY.test(String(entry?.name ?? ''))) continue;
      let parsed;
      try {
        parsed = JSON.parse(entry.value);
      } catch {
        continue;
      }
      const name = findAccountName(parsed);
      if (name && !best) best = name;
      if (name && !name.includes('*')) return name; // a real nickname beats a masked contact
    }
  }
  return best;
}

/** True for a MiniMax response that may describe the signed-in user. */
export function isUserInfoUrl(url) {
  try {
    return USER_PATH.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

export function resolveAccountName({ explicit, detected, accountNumber }) {
  return cleanAccountName(explicit) || detected || (accountNumber ? `account-${accountNumber}` : 'default');
}
