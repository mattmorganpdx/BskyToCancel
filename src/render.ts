import type { types } from '@slack/bolt';
import {
  type Author,
  type EmbedView,
  type ExternalView,
  type FacetFeature,
  type Label,
  type MediaView,
  type PostRecord,
  type PostView,
  type RecordView,
  type ThreadViewPost,
  isThreadViewPost,
  isViewRecord,
  postUrlFromUri,
  profileUrl,
} from './bluesky.ts';

type Block = types.KnownBlock;
type ContextElement = types.ContextBlockElement;
type RichTextElement = types.RichTextElement;

export interface SlackMessage {
  text: string;
  blocks: Block[];
}

// Media on posts carrying these labels is replaced with a notice rather than
// inlined into the channel.
const SENSITIVE_LABELS = new Set(['porn', 'sexual', 'nudity', 'graphic-media', 'gore']);

export function renderPost(thread: ThreadViewPost, url: string): SlackMessage {
  const { post } = thread;
  const blocks: Block[] = [];
  if (isThreadViewPost(thread.parent)) blocks.push(replyContext(thread.parent.post));
  blocks.push(authorContext(post.author));
  const body = richText(post.record);
  if (body.length) {
    blocks.push({ type: 'rich_text', elements: [{ type: 'rich_text_section', elements: body }] });
  }
  if (post.embed) {
    blocks.push(...embedBlocks(post.embed, sensitiveLabels(post.author, post.record, post.labels)));
  }
  blocks.push(footer(post, url));
  return { text: fallbackText(post.author, post.record.text), blocks };
}

/** Converts facets (which index UTF-8 bytes, not JS string offsets) into Slack links. */
export function richText({ text, facets }: PostRecord): RichTextElement[] {
  const bytes = encoder.encode(text);
  const elements: RichTextElement[] = [];
  let cursor = 0;
  const slice = (start: number, end: number) => decoder.decode(bytes.subarray(start, end));

  const sorted = [...(facets ?? [])].sort((a, b) => a.index.byteStart - b.index.byteStart);
  for (const { index, features } of sorted) {
    const { byteStart, byteEnd } = index;
    const url = features.map(featureUrl).find(Boolean);
    if (!url || byteStart < cursor || byteEnd <= byteStart || byteEnd > bytes.length) continue;
    if (byteStart > cursor) elements.push({ type: 'text', text: slice(cursor, byteStart) });
    elements.push({ type: 'link', url, text: slice(byteStart, byteEnd) });
    cursor = byteEnd;
  }
  if (cursor < bytes.length) elements.push({ type: 'text', text: slice(cursor, bytes.length) });
  return elements;
}

/** Fallback for when Slack refuses the message because it couldn't download an image. */
export function withoutImages({ text, blocks }: SlackMessage): SlackMessage {
  return {
    text,
    blocks: blocks.flatMap((block): Block[] => {
      switch (block.type) {
        case 'image':
          return 'image_url' in block
            ? [context(mrkdwn(`<${safeUrl(block.image_url)}|${escape(block.title?.text ?? 'Image')}>`))]
            : [];
        case 'context':
          return [{ ...block, elements: block.elements.filter((e) => e.type !== 'image') }];
        case 'section': {
          const { accessory: _, ...rest } = block;
          return [rest];
        }
        default:
          return [block];
      }
    }),
  };
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function featureUrl(feature: FacetFeature): string | undefined {
  switch (feature.$type) {
    case 'app.bsky.richtext.facet#link':
      return /^https?:\/\//i.test(feature.uri) ? feature.uri : undefined;
    case 'app.bsky.richtext.facet#mention':
      return profileUrl(feature.did);
    case 'app.bsky.richtext.facet#tag':
      return `https://bsky.app/hashtag/${encodeURIComponent(feature.tag)}`;
  }
}

function embedBlocks(embed: EmbedView, hidden: string[], nested = false): Block[] {
  switch (embed.$type) {
    case 'app.bsky.embed.recordWithMedia#view':
      return [...mediaBlocks(embed.media, hidden), ...quoteBlocks(embed.record.record, nested)];
    case 'app.bsky.embed.record#view':
      return quoteBlocks(embed.record, nested);
    default:
      return mediaBlocks(embed, hidden);
  }
}

function mediaBlocks(media: MediaView, hidden: string[]): Block[] {
  const isLinkCard = media.$type === 'app.bsky.embed.external#view' && !isGif(media.external.uri);
  if (hidden.length && !isLinkCard) {
    return [context(mrkdwn(`:warning: Media hidden (labeled ${hidden.join(', ')}). Open the post on Bluesky to see it.`))];
  }
  switch (media.$type) {
    case 'app.bsky.embed.images#view':
      return media.images.map((img) => image(img.fullsize, img.alt));
    case 'app.bsky.embed.video#view':
      return media.thumbnail
        ? [image(media.thumbnail, media.alt || 'Video thumbnail', '▶️ Video (play it on Bluesky)')]
        : [];
    case 'app.bsky.embed.external#view':
      return isGif(media.external.uri)
        ? [image(media.external.uri, media.external.title)]
        : [linkCard(media.external, hidden.length === 0)];
    default:
      return [];
  }
}

// Only one level of quote is drawn in full; a quote inside a quote becomes a link.
function quoteBlocks(record: RecordView['record'], nested: boolean): Block[] {
  if (!isViewRecord(record)) {
    return record.$type.startsWith('app.bsky.embed.record#view')
      ? [context(mrkdwn('_Quoted post is unavailable._'))]
      : [];
  }
  const { author, value } = record;
  const url = postUrlFromUri(record.uri, author.handle);
  if (nested) return [context(mrkdwn(`Quoting <${url}|${escape(displayName(author))} @${author.handle}>`))];

  const header: RichTextElement[] = [
    { type: 'link', url, text: displayName(author), style: { bold: true } },
    { type: 'text', text: ` @${author.handle}` },
  ];
  const body = richText(value);
  const quote: Block = {
    type: 'rich_text',
    elements: [
      {
        type: 'rich_text_quote',
        elements: body.length ? [...header, { type: 'text', text: '\n' }, ...body] : header,
      },
    ],
  };
  const hidden = sensitiveLabels(author, value, record.labels);
  return [quote, ...(record.embeds ?? []).flatMap((e) => embedBlocks(e, hidden, true))];
}

function replyContext(parent: PostView): Block {
  const { author, record } = parent;
  const url = postUrlFromUri(parent.uri, author.handle);
  const elements: ContextElement[] = [
    mrkdwn(`↩️ Replying to *${escape(displayName(author))}* <${url}|@${author.handle}>`),
  ];
  if (record.text) elements.push({ type: 'plain_text', text: truncate(record.text, 280), emoji: false });
  return context(...elements);
}

function authorContext(author: Author): Block {
  const name = mrkdwn(`*${escape(displayName(author))}* <${profileUrl(author.handle)}|@${author.handle}>`);
  return author.avatar
    ? context({ type: 'image', image_url: jpeg(author.avatar), alt_text: author.handle }, name)
    : context(name);
}

function footer(post: PostView, url: string): Block {
  const { createdAt } = post.record;
  const seconds = Math.floor(Date.parse(createdAt) / 1000);
  const date = Number.isFinite(seconds)
    ? `<!date^${seconds}^{date_short_pretty} at {time}^${safeUrl(url)}|${createdAt}>`
    : `<${safeUrl(url)}|View on Bluesky>`;
  const count = (n = 0) => n.toLocaleString('en-US');
  const reposts = (post.repostCount ?? 0) + (post.quoteCount ?? 0);
  return context(
    mrkdwn(
      `${date}  ·  :speech_balloon: ${count(post.replyCount)}  :repeat: ${count(reposts)}  :heart: ${count(post.likeCount)}`,
    ),
  );
}

function linkCard({ uri, title, description, thumb }: ExternalView['external'], showThumb: boolean): Block {
  const lines = [`*<${safeUrl(uri)}|${escape(title || hostname(uri))}>*`];
  if (description) lines.push(escape(truncate(description, 300)));
  const card: types.SectionBlock = { type: 'section', text: mrkdwn(lines.join('\n')) };
  if (thumb && showThumb) {
    card.accessory = { type: 'image', image_url: jpeg(thumb), alt_text: title || 'Link preview' };
  }
  return card;
}

function image(url: string, alt: string | undefined, title?: string): types.ImageBlock {
  const block: types.ImageBlock = {
    type: 'image',
    image_url: jpeg(url),
    alt_text: truncate(alt?.trim() || 'Image', 2000),
  };
  if (title) block.title = { type: 'plain_text', text: title };
  return block;
}

function sensitiveLabels(author: Author, record: PostRecord, labels: Label[] = []): string[] {
  const all = [...labels, ...(record.labels?.values ?? []), ...(author.labels ?? [])];
  return [...new Set(all.map((l) => l.val).filter((v) => SENSITIVE_LABELS.has(v)))];
}

function fallbackText(author: Author, text: string): string {
  return escape(`${displayName(author)} (@${author.handle}): ${truncate(text, 200)}`);
}

function context(...elements: ContextElement[]): types.ContextBlock {
  return { type: 'context', elements };
}

function mrkdwn(text: string): types.MrkdwnElement {
  return { type: 'mrkdwn', text };
}

function displayName(author: Author): string {
  return author.displayName?.trim() || author.handle;
}

// cdn.bsky.app serves WebP unless asked otherwise, and Slack can't display WebP.
function jpeg(url: string): string {
  return url.startsWith('https://cdn.bsky.app/img/') && !/@\w+$/.test(url) ? `${url}@jpeg` : url;
}

// Bluesky's GIF picker posts Tenor links as link cards; show them as images.
function isGif(uri: string): boolean {
  return /^https:\/\/media\.tenor\.com\/.+\.gif(\?|$)/.test(uri);
}

function hostname(uri: string): string {
  try {
    return new URL(uri).hostname;
  } catch {
    return uri;
  }
}

// Every string interpolated into mrkdwn goes through here, so post text can't
// smuggle in <!channel> pings or fake links.
function escape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function safeUrl(url: string): string {
  return url.replace(/\|/g, '%7C').replace(/</g, '%3C').replace(/>/g, '%3E');
}

function truncate(text: string, max: number): string {
  const chars = [...text];
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join('')}…`;
}
