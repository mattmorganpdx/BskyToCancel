import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type ChannelClient, isEnabled, joinPublicChannels, slackError } from '../src/channels.ts';

type Channel = { id: string; name: string; is_member: boolean; is_ext_shared?: boolean };

function fakeClient(pages: Channel[][], failJoin: string[] = [], failWith = 'is_archived') {
  const joins: string[] = [];
  const cursors: (string | undefined)[] = [];
  const client: ChannelClient = {
    conversations: {
      async list({ cursor }) {
        cursors.push(cursor);
        const i = cursor ? Number(cursor) : 0;
        const next = i + 1 < pages.length ? String(i + 1) : '';
        return { channels: pages[i], response_metadata: { next_cursor: next } };
      },
      async join({ channel }) {
        if (failJoin.includes(channel)) {
          throw Object.assign(new Error('An API error occurred'), { data: { error: failWith } });
        }
        joins.push(channel);
        return { ok: true };
      },
    },
  };
  return { client, joins, cursors };
}

function logger() {
  const lines: string[] = [];
  return { lines, info: (m: string) => lines.push(`info ${m}`), warn: (m: string) => lines.push(`warn ${m}`) };
}

test('joins only the channels the bot is not in, across every page', async () => {
  const { client, joins, cursors } = fakeClient([
    [
      { id: 'C1', name: 'general', is_member: true },
      { id: 'C2', name: 'random', is_member: false },
    ],
    [{ id: 'C3', name: 'news', is_member: false }],
  ]);
  const log = logger();

  const joined = await joinPublicChannels(client, log);

  assert.deepEqual(joins, ['C2', 'C3']);
  assert.deepEqual(joined, ['random', 'news']);
  assert.deepEqual(cursors, [undefined, '1']);
  assert.deepEqual(log.lines, ['info Joined #random, #news']);
});

test('keeps going when one join fails, and logs Slack’s error code', async () => {
  const { client, joins } = fakeClient(
    [
      [
        { id: 'C2', name: 'random', is_member: false },
        { id: 'C3', name: 'news', is_member: false },
      ],
    ],
    ['C2'],
  );
  const log = logger();

  const joined = await joinPublicChannels(client, log);

  assert.deepEqual(joins, ['C3']);
  assert.deepEqual(joined, ['news']);
  assert.deepEqual(log.lines, ['warn Could not join #random: is_archived', 'info Joined #news']);
});

test('logs nothing when the bot is already everywhere', async () => {
  const { client, joins } = fakeClient([[{ id: 'C1', name: 'general', is_member: true }]]);
  const log = logger();

  assert.deepEqual(await joinPublicChannels(client, log), []);
  assert.deepEqual(joins, []);
  assert.deepEqual(log.lines, []);
});

test('skips channels shared with other organizations', async () => {
  const { client, joins } = fakeClient([
    [
      { id: 'C1', name: 'partners', is_member: false, is_ext_shared: true },
      { id: 'C2', name: 'random', is_member: false },
    ],
  ]);

  assert.deepEqual(await joinPublicChannels(client, logger()), ['random']);
  assert.deepEqual(joins, ['C2']);
});

test('stops at the first missing_scope instead of warning once per channel', async () => {
  const { client } = fakeClient(
    [
      [
        { id: 'C2', name: 'random', is_member: false },
        { id: 'C3', name: 'news', is_member: false },
      ],
    ],
    ['C2', 'C3'],
    'missing_scope',
  );
  const log = logger();

  await assert.rejects(joinPublicChannels(client, log), (err) => slackError(err) === 'missing_scope');
  assert.deepEqual(log.lines, []);
});

test('slackError handles Slack errors, plain errors, and non-errors', () => {
  assert.equal(slackError({ data: { error: 'ratelimited' } }), 'ratelimited');
  assert.equal(slackError(new Error('getaddrinfo ENOTFOUND slack.com')), 'getaddrinfo ENOTFOUND slack.com');
  assert.equal(slackError(undefined), 'undefined');
  assert.equal(slackError(null), 'null');
});

test('isEnabled treats the usual spellings of off as off', () => {
  for (const off of ['false', 'FALSE', 'False', ' false ', '0', 'no', 'off']) assert.equal(isEnabled(off), false, off);
  for (const on of [undefined, '', 'true', '1', 'yes']) assert.equal(isEnabled(on), true, String(on));
});
