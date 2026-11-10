import type { webApi } from '@slack/bolt';

// The parts of the Slack client the sweep uses, so tests can pass a fake.
export type ChannelClient = {
  conversations: {
    list: (args: {
      types: string;
      exclude_archived: boolean;
      limit: number;
      cursor?: string;
    }) => Promise<Pick<webApi.ConversationsListResponse, 'channels' | 'response_metadata'>>;
    join: (args: { channel: string }) => Promise<unknown>;
  };
};

type Logger = { info: (msg: string) => void; warn: (msg: string) => void };

/**
 * Joins every unarchived public channel the bot isn't in yet, so new channels
 * are covered without an /invite. Skips channels shared with other
 * organizations, so reposts don't reach people outside the workspace. Needs the
 * channels:read and channels:join scopes. Returns the names of the channels it
 * joined.
 */
export async function joinPublicChannels(client: ChannelClient, logger: Logger): Promise<string[]> {
  const joined: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await client.conversations.list({
      types: 'public_channel',
      exclude_archived: true,
      limit: 200,
      cursor,
    });
    for (const ch of page.channels ?? []) {
      if (ch.is_member || ch.is_ext_shared || !ch.id) continue;
      try {
        await client.conversations.join({ channel: ch.id });
        joined.push(ch.name ?? ch.id);
      } catch (err) {
        // A missing scope fails every join the same way, so stop and let the
        // caller log it once.
        if (slackError(err) === 'missing_scope') throw err;
        logger.warn(`Could not join #${ch.name ?? ch.id}: ${slackError(err)}`);
      }
    }
    cursor = page.response_metadata?.next_cursor || undefined;
  } while (cursor);
  if (joined.length > 0) logger.info(`Joined ${joined.map((n) => `#${n}`).join(', ')}`);
  return joined;
}

export function slackError(err: unknown): string {
  const code = (err as { data?: { error?: string } } | null | undefined)?.data?.error;
  if (code) return code;
  return err instanceof Error ? err.message : String(err);
}

/** True unless the value is a common way of saying "off". */
export function isEnabled(value: string | undefined): boolean {
  return !['false', '0', 'no', 'off'].includes((value ?? '').trim().toLowerCase());
}
