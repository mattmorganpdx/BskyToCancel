// Bluesky's public AppView serves posts without auth, including posts from
// accounts with the "require login" (!no-unauthenticated) setting; that label
// is only advisory to clients.
const API = 'https://public.api.bsky.app/xrpc';

export interface PostRef {
  actor: string;
  rkey: string;
  url: string;
}

// bsky.app plus its subdomains (staging, main) and the embed-fixer mirrors
// people paste to get better previews elsewhere (fxbsky.app, bskyx.app, ...).
const POST_URL =
  /https?:\/\/(?:[\w-]+\.)?(?:fx|vx)?bsky[xe]?\.app\/profile\/([^/\s|>]+)\/post\/([\w.~:-]+)/gi;

export function findPostRefs(text: string): PostRef[] {
  const refs = new Map<string, PostRef>();
  for (const [, rawActor, rkey] of text.matchAll(POST_URL)) {
    let actor: string;
    try {
      actor = decodeURIComponent(rawActor);
    } catch {
      continue;
    }
    const url = postUrl(actor, rkey);
    if (!refs.has(url)) refs.set(url, { actor, rkey, url });
  }
  return [...refs.values()];
}

export function postUrl(actor: string, rkey: string): string {
  return `https://bsky.app/profile/${actor}/post/${rkey}`;
}

export function postUrlFromUri(atUri: string, handle: string): string {
  return postUrl(handle, atUri.split('/').pop() ?? '');
}

export function profileUrl(actor: string): string {
  return `https://bsky.app/profile/${actor}`;
}

/** Returns null when the post is missing, deleted, or blocked. */
export async function fetchThread(ref: PostRef): Promise<ThreadViewPost | null> {
  const params = new URLSearchParams({
    uri: `at://${ref.actor}/app.bsky.feed.post/${ref.rkey}`,
    depth: '0',
    parentHeight: '1',
  });
  const res = await fetch(`${API}/app.bsky.feed.getPostThread?${params}`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 400) return null;
  if (!res.ok) throw new Error(`getPostThread ${ref.url}: HTTP ${res.status}`);
  const { thread } = (await res.json()) as { thread: ThreadViewPost | { $type: string } };
  return isThreadViewPost(thread) ? thread : null;
}

export function isThreadViewPost(t: { $type: string } | undefined): t is ThreadViewPost {
  return t?.$type === 'app.bsky.feed.defs#threadViewPost';
}

export function isViewRecord(r: { $type: string }): r is ViewRecord {
  return r.$type === 'app.bsky.embed.record#viewRecord';
}

// Only the slices of the app.bsky lexicon views this bot reads.

export interface Author {
  did: string;
  handle: string;
  displayName?: string;
  avatar?: string;
  labels?: Label[];
}

export interface Label {
  val: string;
}

export interface Facet {
  index: { byteStart: number; byteEnd: number };
  features: FacetFeature[];
}

export type FacetFeature =
  | { $type: 'app.bsky.richtext.facet#link'; uri: string }
  | { $type: 'app.bsky.richtext.facet#mention'; did: string }
  | { $type: 'app.bsky.richtext.facet#tag'; tag: string };

export interface PostRecord {
  text: string;
  facets?: Facet[];
  createdAt: string;
  labels?: { values: Label[] };
}

export interface PostView {
  uri: string;
  author: Author;
  record: PostRecord;
  embed?: EmbedView;
  replyCount?: number;
  repostCount?: number;
  likeCount?: number;
  quoteCount?: number;
  labels?: Label[];
}

export interface ThreadViewPost {
  $type: 'app.bsky.feed.defs#threadViewPost';
  post: PostView;
  parent?: ThreadViewPost | { $type: string };
}

export type MediaView = ImagesView | VideoView | ExternalView;
export type EmbedView = MediaView | RecordView | RecordWithMediaView;

export interface ImagesView {
  $type: 'app.bsky.embed.images#view';
  images: { fullsize: string; thumb: string; alt: string }[];
}

export interface VideoView {
  $type: 'app.bsky.embed.video#view';
  playlist: string;
  thumbnail?: string;
  alt?: string;
}

export interface ExternalView {
  $type: 'app.bsky.embed.external#view';
  external: { uri: string; title: string; description: string; thumb?: string };
}

export interface RecordView {
  $type: 'app.bsky.embed.record#view';
  // Also feed generators, lists, starter packs, and not-found/blocked/detached stubs.
  record: ViewRecord | { $type: string; uri?: string };
}

export interface RecordWithMediaView {
  $type: 'app.bsky.embed.recordWithMedia#view';
  record: RecordView;
  media: MediaView;
}

export interface ViewRecord {
  $type: 'app.bsky.embed.record#viewRecord';
  uri: string;
  author: Author;
  value: PostRecord;
  embeds?: EmbedView[];
  labels?: Label[];
}
