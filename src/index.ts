import { App, LogLevel, type webApi } from '@slack/bolt';
import { fetchThread, findPostRefs } from './bluesky.ts';
import { isEnabled, joinPublicChannels, slackError } from './channels.ts';
import { type SlackMessage, renderPost, withoutImages } from './render.ts';

// One message full of links shouldn't turn into a wall of reposts.
const MAX_POSTS_PER_MESSAGE = 4;

// How often to look for public channels the bot hasn't joined yet.
const CHANNEL_SWEEP_MS = 24 * 60 * 60 * 1000;

const app = new App({
  token: requireEnv('SLACK_BOT_TOKEN'),
  appToken: requireEnv('SLACK_APP_TOKEN'),
  socketMode: true,
  logLevel: process.env.LOG_LEVEL === 'debug' ? LogLevel.DEBUG : LogLevel.INFO,
});

// Slack redelivers events it thinks went unacknowledged, so remember recent
// messages to avoid posting the same repost twice.
const handled = new Set<string>();

app.message(async ({ message, client, logger }) => {
  if (message.subtype !== undefined && message.subtype !== 'thread_broadcast') return;
  if (('bot_id' in message && message.bot_id) || !message.text) return;

  const refs = findPostRefs(message.text).slice(0, MAX_POSTS_PER_MESSAGE);
  if (refs.length === 0) return;

  const key = `${message.channel}:${message.ts}`;
  if (handled.has(key)) return;
  handled.add(key);
  if (handled.size > 1000) handled.delete(handled.values().next().value!);

  const threadTs = message.thread_ts ?? message.ts;
  for (const ref of refs) {
    try {
      const thread = await fetchThread(ref);
      if (!thread) {
        logger.info(`Skipping ${ref.url}: not found, deleted, or blocked`);
        continue;
      }
      await reply(client, message.channel, threadTs, renderPost(thread, ref.url));
      logger.info(`Reposted ${ref.url} in ${message.channel}`);
    } catch (err) {
      logger.error(`Failed to repost ${ref.url}`, err);
    }
  }
});

async function reply(client: webApi.WebClient, channel: string, threadTs: string, msg: SlackMessage) {
  const args = { channel, thread_ts: threadTs, unfurl_links: false, unfurl_media: false };
  try {
    await client.chat.postMessage({ ...args, ...msg });
  } catch (err) {
    // Slack rejects the whole message when it can't fetch any one image.
    if (slackError(err) !== 'invalid_blocks') throw err;
    await client.chat.postMessage({ ...args, ...withoutImages(msg) });
  }
}

async function sweepChannels() {
  try {
    await joinPublicChannels(app.client, app.logger);
  } catch (err) {
    const error = slackError(err);
    const hint =
      error === 'missing_scope'
        ? ' Add the channels:read and channels:join scopes and reinstall the app (see README.md).'
        : '';
    app.logger.warn(`Channel sweep failed: ${error}.${hint}`);
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing ${name}. Copy .env.example to .env and fill it in (see README.md).`);
    process.exit(1);
  }
  return value;
}

let sweepTimer: NodeJS.Timeout | undefined;

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    clearInterval(sweepTimer);
    void app.stop().finally(() => process.exit(0));
  });
}

await app.start();
app.logger.info('BskyToCancel is watching for Bluesky links');

if (isEnabled(process.env.AUTO_JOIN_CHANNELS)) {
  await sweepChannels();
  sweepTimer = setInterval(() => void sweepChannels(), CHANNEL_SWEEP_MS);
}
