# BskyToCancel

A Slack bot that watches for Bluesky post links and reposts the post in a thread reply, so nobody has to open bsky.app.

It also works for posts from accounts that hide themselves from logged-out visitors. bsky.app shows those visitors a "sign in to view" wall, but Bluesky's public API still returns the posts without auth. The bot needs no Bluesky account.

Each repost includes:

- the author's name, handle, and avatar
- the post text, with links, mentions, and hashtags kept clickable
- images, and GIFs posted from Bluesky's GIF picker
- quote posts, drawn as a quote block with the quoted post's media
- link preview cards
- for a reply, the post it replies to
- the post date and reply, repost, and like counts

Videos appear as their thumbnail, because Slack can't play Bluesky's video streams. If a post is labeled as nudity, sexual content, porn, or graphic media, the bot replaces its images with a notice.

## Setup

### 1. Create the Slack app

1. Go to <https://api.slack.com/apps> and choose **Create New App**, then **From a manifest**.
2. Pick your workspace and paste in [`slack-manifest.yml`](slack-manifest.yml).
3. In the sidebar, open **Install App** and choose **Install to Workspace**. Afterward that page shows the **Bot User OAuth Token** (`xoxb-…`). (The Client Secret and Signing Secret under App Credentials aren't needed.)
4. Back on **Basic Information**, scroll down to **App-Level Tokens** and choose **Generate Token and Scopes**. Add the `connections:write` scope, then copy the token (`xapp-…`).

### 2. Run it

The bot uses Socket Mode, so it needs no public URL or open port. Anything with outbound internet can run it: a laptop, a Raspberry Pi, a small VPS, Fly.io, or Railway.

```sh
cp .env.example .env   # paste in the two tokens
npm install
npm start
```

Or run it with Docker:

```sh
docker compose up -d --build
docker compose logs -f
```

To deploy to a server over SSH, run this from your checkout. The bot gets its own compose project, so it won't touch other containers on the host. Put `.env` on the server once; the rsync leaves it alone.

```sh
rsync -a --delete --exclude node_modules --exclude .env ./ your-server:bskytocancel/
ssh your-server 'cd bskytocancel && docker compose up -d --build'
```

The bot needs Node 22.18 or later, which runs the TypeScript directly with no build step.

### 3. Invite it

The bot only sees channels it belongs to. Run `/invite @BskyToCancel` in each channel where it should work.

## Development

```sh
npm test            # unit tests against sample API responses
npm run typecheck
npm run preview -- https://bsky.app/profile/bsky.app/post/3my43eyfzs225
```

`preview` prints the Slack blocks the bot would post, along with a Block Kit Builder link that renders them. You can check how a post will look without a Slack token.

## Behavior notes

- The bot ignores messages from other bots, including itself, so it can't get into a loop with another link-expanding bot.
- It reposts up to 4 Bluesky links per message.
- It replies in the thread the link was posted in. A top-level message gets a new thread.
- It turns off Slack's own link unfurling on its replies, so the links inside a repost don't add more previews.
- If a post was deleted or can't be found, the bot posts nothing and logs it.
- If Slack can't fetch one of the images, the bot posts again with links in place of the images.

## License

[MIT](LICENSE)
