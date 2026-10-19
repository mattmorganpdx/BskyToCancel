import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findPostRefs } from '../src/bluesky.ts';

test('finds post links in Slack-formatted message text', () => {
  const text =
    'lol <https://bsky.app/profile/alice.example.com/post/3kabc123def45> and ' +
    '<https://bsky.app/profile/did%3Aplc%3Abobxxxxxxxxxxxxxxxxxxxxx/post/3kxyz987uvw65|this one>';
  assert.deepEqual(findPostRefs(text), [
    {
      actor: 'alice.example.com',
      rkey: '3kabc123def45',
      url: 'https://bsky.app/profile/alice.example.com/post/3kabc123def45',
    },
    {
      actor: 'did:plc:bobxxxxxxxxxxxxxxxxxxxxx',
      rkey: '3kxyz987uvw65',
      url: 'https://bsky.app/profile/did:plc:bobxxxxxxxxxxxxxxxxxxxxx/post/3kxyz987uvw65',
    },
  ]);
});

test('normalizes embed-fixer mirrors and drops query strings', () => {
  const refs = findPostRefs(
    '<https://fxbsky.app/profile/a.com/post/3abc> <https://bskyx.app/profile/b.com/post/3def?ref=x>',
  );
  assert.deepEqual(
    refs.map((r) => r.url),
    ['https://bsky.app/profile/a.com/post/3abc', 'https://bsky.app/profile/b.com/post/3def'],
  );
});

test('dedupes repeated links', () => {
  const url = 'https://bsky.app/profile/a.com/post/3abc';
  assert.equal(findPostRefs(`<${url}> <${url}|again>`).length, 1);
});

test('ignores profile links and other sites', () => {
  const text =
    '<https://bsky.app/profile/alice.example.com> <https://example.com/profile/a.com/post/3abc> ' +
    '<https://x.com/someone/status/123>';
  assert.deepEqual(findPostRefs(text), []);
});
