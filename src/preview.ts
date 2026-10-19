// Renders a post the way the bot would, without touching Slack:
//   npm run preview -- https://bsky.app/profile/someone.bsky.social/post/3abc...
import { fetchThread, findPostRefs } from './bluesky.ts';
import { renderPost } from './render.ts';

const [ref] = findPostRefs(process.argv[2] ?? '');
if (!ref) {
  console.error('Usage: npm run preview -- <bsky.app post URL>');
  process.exit(1);
}

const thread = await fetchThread(ref);
if (!thread) {
  console.error(`Not found, deleted, or blocked: ${ref.url}`);
  process.exit(1);
}

const { blocks } = renderPost(thread, ref.url);
console.log(JSON.stringify({ blocks }, null, 2));
console.error(
  `\nOpen in Block Kit Builder to see it rendered:\nhttps://app.slack.com/block-kit-builder#${encodeURIComponent(JSON.stringify({ blocks }))}`,
);
