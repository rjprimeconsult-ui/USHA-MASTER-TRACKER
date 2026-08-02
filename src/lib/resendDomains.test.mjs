import test from 'node:test';
import assert from 'node:assert/strict';
import {
  listVerifiedDomains,
  domainStatusFor,
  __resetDomainCacheForTests,
} from './resendDomains.js';

// resendDomains.js is SERVER-ONLY pure-ish logic (fetch + env injected /
// controlled here), so it is exercised in the node lane. Spec §5: domain
// status routes mail, it never blocks — so every failure path here must
// collapse to 'unknown', never 'verified', and a failed lookup must never
// be cached.

const TTL_MS = 5 * 60 * 1000;

function okResponse(rows) {
  return { ok: true, json: async () => ({ data: rows }) };
}

function fetchReturning(rows) {
  const impl = async () => okResponse(rows);
  return impl;
}

function countingFetch(rows) {
  const calls = { n: 0 };
  const impl = async () => {
    calls.n += 1;
    return okResponse(rows);
  };
  return { impl, calls };
}

const throwingFetch = async () => {
  throw new Error('network down');
};

// Set/restore RESEND_API_KEY around a test body. `value === undefined`
// deletes the var (the missing-key case).
async function withApiKey(value, fn) {
  const prev = process.env.RESEND_API_KEY;
  if (value === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = value;
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = prev;
  }
}

// ---------- listVerifiedDomains: row filtering ----------

test('listVerifiedDomains counts only status === "verified" rows', async () => {
  __resetDomainCacheForTests();
  await withApiKey('test-key', async () => {
    const rows = [
      { name: 'verified-one.com', status: 'verified' },
      { name: 'pending.com', status: 'pending' },
      { name: 'failed.com', status: 'failed' },
      { name: 'not-started.com', status: 'not_started' },
      { name: 'Verified-Two.Com', status: 'verified' },
    ];
    const result = await listVerifiedDomains({ fetchImpl: fetchReturning(rows), now: 0 });
    assert.equal(result.ok, true);
    assert.equal(result.domains.has('verified-one.com'), true);
    assert.equal(result.domains.has('verified-two.com'), true, 'names are lowercased');
    assert.equal(result.domains.has('pending.com'), false);
    assert.equal(result.domains.has('failed.com'), false);
    assert.equal(result.domains.has('not-started.com'), false);
    assert.equal(result.domains.size, 2);
  });
});

// ---------- domainStatusFor: matching ----------

test('domainStatusFor matches exactly and case-insensitively', async () => {
  __resetDomainCacheForTests();
  await withApiKey('test-key', async () => {
    const rows = [{ name: 'healthservicespro.com', status: 'verified' }];
    const result = await listVerifiedDomains({ fetchImpl: fetchReturning(rows), now: 0 });
    assert.equal(result.ok, true);
    // Case-insensitive on the address side.
    assert.equal(domainStatusFor('Mike@HealthServicesPro.com', result), 'verified');
    // Exact match only: a subdomain is NOT covered by the apex.
    assert.equal(domainStatusFor('mike@mail.healthservicespro.com', result), 'unverified');
  });
});

test('domainStatusFor: malformed address -> unknown', async () => {
  __resetDomainCacheForTests();
  await withApiKey('test-key', async () => {
    const rows = [{ name: 'healthservicespro.com', status: 'verified' }];
    const result = await listVerifiedDomains({ fetchImpl: fetchReturning(rows), now: 0 });
    assert.equal(result.ok, true);
    assert.equal(domainStatusFor('no-at-sign', result), 'unknown');
    assert.equal(domainStatusFor('', result), 'unknown');
  });
});

// ---------- failure paths: always 'unknown', never 'verified' ----------

test('fetch throws -> { ok: false } -> domainStatusFor "unknown", never "verified"', async () => {
  __resetDomainCacheForTests();
  await withApiKey('test-key', async () => {
    const result = await listVerifiedDomains({ fetchImpl: throwingFetch, now: 0 });
    assert.equal(result.ok, false);
    const status = domainStatusFor('mike@healthservicespro.com', result);
    assert.equal(status, 'unknown');
    assert.notEqual(status, 'verified');
  });
});

test('non-200 response -> { ok: false }', async () => {
  __resetDomainCacheForTests();
  await withApiKey('test-key', async () => {
    const badFetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
    const result = await listVerifiedDomains({ fetchImpl: badFetch, now: 0 });
    assert.equal(result.ok, false);
    assert.equal(domainStatusFor('mike@healthservicespro.com', result), 'unknown');
  });
});

test('missing RESEND_API_KEY -> { ok: false } without calling fetch', async () => {
  __resetDomainCacheForTests();
  await withApiKey(undefined, async () => {
    const { impl, calls } = countingFetch([{ name: 'x.com', status: 'verified' }]);
    const result = await listVerifiedDomains({ fetchImpl: impl, now: 0 });
    assert.equal(result.ok, false);
    assert.equal(calls.n, 0, 'no key means no API call at all');
  });
});

// ---------- cache: 5-minute TTL, success only ----------

test('cache hit: second call inside 5 min returns { ok: true } even with a throwing fetch', async () => {
  __resetDomainCacheForTests();
  await withApiKey('test-key', async () => {
    const t0 = 1_000_000;
    const rows = [{ name: 'healthservicespro.com', status: 'verified' }];
    const first = await listVerifiedDomains({ fetchImpl: fetchReturning(rows), now: t0 });
    assert.equal(first.ok, true);

    const second = await listVerifiedDomains({ fetchImpl: throwingFetch, now: t0 + TTL_MS - 1 });
    assert.equal(second.ok, true, 'served from cache, fetch never ran');
    assert.equal(second.domains.has('healthservicespro.com'), true);
  });
});

test('cache expiry: call at now + TTL + 1 re-fetches', async () => {
  __resetDomainCacheForTests();
  await withApiKey('test-key', async () => {
    const t0 = 1_000_000;
    const { impl: firstFetch, calls: firstCalls } = countingFetch([
      { name: 'old-domain.com', status: 'verified' },
    ]);
    const first = await listVerifiedDomains({ fetchImpl: firstFetch, now: t0 });
    assert.equal(first.ok, true);
    assert.equal(firstCalls.n, 1);

    const { impl: secondFetch, calls: secondCalls } = countingFetch([
      { name: 'new-domain.com', status: 'verified' },
    ]);
    const second = await listVerifiedDomains({ fetchImpl: secondFetch, now: t0 + TTL_MS + 1 });
    assert.equal(secondCalls.n, 1, 'stale cache forces a re-fetch');
    assert.equal(second.ok, true);
    assert.equal(second.domains.has('new-domain.com'), true);
    assert.equal(second.domains.has('old-domain.com'), false);
  });
});

test('a failed lookup is never cached: failure then success with a working fetch -> success', async () => {
  __resetDomainCacheForTests();
  await withApiKey('test-key', async () => {
    const t0 = 1_000_000;
    const failed = await listVerifiedDomains({ fetchImpl: throwingFetch, now: t0 });
    assert.equal(failed.ok, false);

    const rows = [{ name: 'healthservicespro.com', status: 'verified' }];
    const recovered = await listVerifiedDomains({ fetchImpl: fetchReturning(rows), now: t0 });
    assert.equal(recovered.ok, true, 'the earlier failure must not have been cached');
    assert.equal(recovered.domains.has('healthservicespro.com'), true);
  });
});
