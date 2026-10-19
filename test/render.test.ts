import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { types } from '@slack/bolt';
import type { ThreadViewPost } from '../src/bluesky.ts';
import { renderPost, richText, withoutImages } from '../src/render.ts';

// Fixtures follow the shape of public.api.bsky.app getPostThread responses;
// the people and posts in them are made up.
function fixture(name: string): ThreadViewPost {
  const json = readFileSync(new URL(`fixtures/${name}.json`, import.meta.url), 'utf8');
  return JSON.parse(json).thread;
}

function render(thread: ThreadViewPost) {
  return renderPost(thread, 'https://bsky.app/profile/x/post/y');
}

function ofType<T extends types.KnownBlock['type']>(blocks: types.KnownBlock[], type: T) {
  return blocks.filter((b): b is Extract<types.KnownBlock, { type: T }> => b.type === type);
}

test('richText maps facets by UTF-8 byte offset, not string index', () => {
  const { record } = fixture('facets-images').post;
  const elements = richText(record);

  // The mention sits after multi-byte characters (‘’ and 📸), so a string-index
  // slice would cut it in the wrong place.
  assert.ok(
    elements.some(
      (e) =>
        e.type === 'link' &&
        e.text === '@bob.example.com' &&
        e.url === 'https://bsky.app/profile/did:plc:bobxxxxxxxxxxxxxxxxxxxxx',
    ),
  );
  assert.ok(
    elements.some(
      (e) => e.type === 'link' && e.text === '#BirdOfTheDay' && e.url === 'https://bsky.app/hashtag/BirdOfTheDay',
    ),
  );
  const roundTrip = elements.map((e) => ('text' in e ? e.text : '')).join('');
  assert.equal(roundTrip, record.text);
});

test('richText skips overlapping and out-of-range facets instead of mangling text', () => {
  const link = (byteStart: number, byteEnd: number) => ({
    index: { byteStart, byteEnd },
    features: [{ $type: 'app.bsky.richtext.facet#link' as const, uri: 'https://example.com' }],
  });
  const elements = richText({ text: 'hello world', createdAt: '', facets: [link(0, 5), link(3, 8), link(6, 99)] });
  assert.deepEqual(elements, [
    { type: 'link', url: 'https://example.com', text: 'hello' },
    { type: 'text', text: ' world' },
  ]);
});

test('images are requested as JPEG because Slack cannot show the CDN default WebP', () => {
  const images = ofType(render(fixture('facets-images')).blocks, 'image');
  assert.equal(images.length, 1);
  assert.match('image_url' in images[0] ? images[0].image_url : '', /@jpeg$/);
});

test('quote posts render the quoted author and text in a quote block', () => {
  const thread = fixture('quote');
  const [quote] = ofType(render(thread).blocks, 'rich_text').flatMap((b) =>
    b.elements.filter((e) => e.type === 'rich_text_quote'),
  );
  assert.ok(quote, 'expected a rich_text_quote');
  const embed = thread.post.embed;
  assert.equal(embed?.$type, 'app.bsky.embed.record#view');
  const quoted = embed.record as { author: { handle: string } };
  const text = quote.elements.map((e) => ('text' in e ? e.text : '')).join('');
  assert.ok(text.includes(`@${quoted.author.handle}`));
});

test('quote with media shows the outer images, then the quote, then the quoted video thumbnail', () => {
  const types = render(fixture('quote-with-media')).blocks.map((b) => b.type);
  assert.deepEqual(types, ['context', 'image', 'rich_text', 'image', 'context']);
});

test('replies show who and what they are replying to', () => {
  const thread = fixture('reply');
  const [first] = render(thread).blocks;
  assert.equal(first.type, 'context');
  const text = first.elements.map((e) => ('text' in e ? e.text : '')).join(' ');
  assert.match(text, /Replying to/);
  assert.ok(isParentText(thread, text));
});

test('videos show their thumbnail', () => {
  const [video] = ofType(render(fixture('video')).blocks, 'image');
  assert.match(video.title?.text ?? '', /Video/);
});

test('link cards show title and thumbnail', () => {
  const [card] = ofType(render(fixture('external-link')).blocks, 'section');
  assert.match(card.text?.text ?? '', /^\*<https:\/\//);
  assert.equal(card.accessory?.type, 'image');
});

test('media on labeled posts is replaced with a notice', () => {
  const thread = fixture('facets-images');
  thread.post.labels = [{ val: 'nudity' }];
  const { blocks } = render(thread);
  assert.equal(ofType(blocks, 'image').length, 0);
  assert.ok(JSON.stringify(blocks).includes('Media hidden (labeled nudity)'));
});

test('display names cannot inject mrkdwn like @channel pings', () => {
  const thread = fixture('login-required');
  thread.post.author.displayName = '<!channel> & <https://evil.example|friends>';
  const json = JSON.stringify(render(thread));
  assert.ok(!json.includes('<!channel>'));
  assert.ok(json.includes('&lt;!channel&gt; &amp; &lt;https://evil.example|friends&gt;'));
});

test('withoutImages leaves no image URLs behind', () => {
  const message = render(fixture('quote-with-media'));
  const stripped = withoutImages(message);
  assert.ok(!JSON.stringify(stripped.blocks).includes('"image_url"'));
  assert.equal(stripped.blocks.length, message.blocks.length);
});

function isParentText(thread: ThreadViewPost, text: string): boolean {
  const parent = thread.parent as ThreadViewPost;
  return text.includes(parent.post.record.text.slice(0, 50));
}
