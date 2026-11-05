# Does Astro fit, and how does it deploy to Coolify?

Research for [issue #4](https://github.com/Kevin-RB/rage-board/issues/4), checked on 2026-11-05. Words like Board, Task, Estimate, Shift, Overload and Meltdown follow [GLOSSARY.md](https://github.com/Kevin-RB/rage-board/blob/main/GLOSSARY.md).

## Recommendation

**Use Vite with plain TypeScript and no UI framework, instead of Astro.** Astro would work, and nothing rules it out. It just adds almost nothing for the Board, and Vite is the part of Astro you would actually be using.

| Question | Answer |
|---|---|
| Build tool | Vite 8 with the `vanilla-ts` template |
| Interactive code | Plain TypeScript modules, no React, Preact or similar |
| Saving state | One versioned JSON value in `localStorage` |
| Coolify build | **Dockerfile** build pack: Node builds the site, Nginx serves it |
| Large media | Served at `/media/...`, kept out of Git, stored in a Coolify **Directory Mount** |

If you want to learn Astro for its own sake, that is a fine reason to choose it, and the costs are small (see [If you choose Astro anyway](#if-you-choose-astro-anyway)). The Board just doesn't need it.

## Why Astro adds little here

Astro's main idea is to do as much work as possible *before* the visitor arrives: it renders HTML at build time and sends little or no JavaScript. Its docs describe it as a framework for "[content-driven websites](https://docs.astro.build/en/concepts/why-astro/)" like blogs and marketing sites, and name "todo lists" among the application-like experiences that other frameworks are designed for. They also say Astro can scale up to dynamic applications, so this is about fit, not capability.

The Board is the opposite case. Its Tasks live in the browser, so none of them exist at build time. Almost everything on screen is JavaScript reacting to Overload.

| What Astro offers | Use on the Board |
|---|---|
| Rendering HTML at build time | Only an empty shell, because Tasks come from `localStorage` |
| Sending no JavaScript by default | The Board *is* its JavaScript |
| Islands (interactive parts in a static page) | There would be one island covering everything |
| Image optimisation | Mostly bypassed: the [docs say to use a plain `<img>`](https://docs.astro.build/en/guides/images/#choosing-image--vs-img) when changing `src` client-side, and files in `public/` are never optimised |
| Video | "[No native video support](https://docs.astro.build/en/guides/images/)"; the docs recommend a hosted video service |
| Routing, content collections, server rendering | Unused: one screen, no content, no backend |
| TypeScript, bundling, instant reload while editing | Useful, but this comes from Vite: [Astro 7.4.5 depends on `vite ^8.3.5`](https://www.npmjs.com/package/astro?activeTab=dependencies) |

What it costs, compared with Vite on its own:

| | Vite 8.3.5 | Astro 7.4.5 |
|---|---|---|
| Packages installed (`npm install --dry-run`) | 15 | 185 |
| Minimum Node | `^20.19.0 \|\| >=22.12.0` | `>=22.23.4`, enforced by the CLI |
| New concepts to learn | `index.html` plus modules | Also `.astro` files, frontmatter, directives, script processing rules |
| Last major releases | 8.0 in March 2026 | 6.0 in March 2026, 7.0 in June 2026 |

Since learning how the effects work is a main goal, I'd spend that attention on the effects rather than on a framework whose main features go unused.

**Even simpler, and rejected:** a plain `index.html` with JavaScript modules and no build step. Coolify's [Static build pack](https://coolify.io/docs/applications/builds/static) would serve it directly. But you would lose TypeScript, simple npm imports (likely useful for #2 and #3), and [instant reload](https://vite.dev/guide/), which matters a lot when tuning how a visual effect feels. Vite is worth its small cost.

## Plain TypeScript or a UI framework?

**Plain TypeScript.** A UI framework earns its place when a lot of on-screen structure has to stay in sync with changing data. The Board has very little of that: a form, some buttons and one list of Tasks.

Most of the work is effects, which directly drive canvas, animations and audio. A framework doesn't help with those, and it can get in the way: frameworks expect to own the page structure they render, while a Meltdown wants to shake, scatter and wreck it. Astro's own docs note that [scripts can add interactivity without a UI framework](https://docs.astro.build/en/guides/client-side-scripts/).

A structure that keeps this manageable, with one-way flow:

```
user action → store (Tasks, Shift) → saved to localStorage
                  │
                  ▼
        Overload = total Estimates / Shift
                  │
                  ▼
        stage (Calm … Meltdown)
          ├─ Task list re-renders
          ├─ <html data-stage="unhinged"> drives CSS
          └─ effects and sound layers start or stop
```

```
src/
  main.ts          wires everything together
  board.ts         pure logic: Overload and stage, no browser APIs
  store.ts         holds state, saves and loads it, notifies listeners
  task-list.ts     renders the Task list and form
  effects/         contract to be defined by #2
  sound/           contract to be defined by #3
```

Keeping `board.ts` pure means stage calculations can be tested and tuned without opening a browser. When rendering Task titles, set `textContent` and never `innerHTML`, so a title like `<img onerror=...>` stays plain text.

**When to revisit:** if Task rendering grows into lots of nested editable state that you keep syncing by hand, add Preact or Svelte through a Vite plugin. The rest of the code would not need to change.

## Saving state in the browser

**Use `localStorage`, holding one JSON value.** It survives closing the browser, is [simple to read and write](https://developer.mozilla.org/en-US/docs/Web/API/Web_Storage_API/Using_the_Web_Storage_API), and its [5 MiB limit](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria) is far more than a day of Tasks needs. IndexedDB is built for large structured data and would be extra work for no benefit.

```ts
// localStorage key: "rage-board"
{
  version: 1,                // lets later versions migrate old data
  shiftMinutes: 480,
  tasks: [{ id, title, estimateMinutes, doneAt }],
  sound: { muted: false, volume: 0.6 }
}
```

- **Save inputs, never results.** Don't store Overload or the stage. Calculate them from Tasks and Shift, so they can't drift out of sync when thresholds get tuned.
- **Store Estimates as whole minutes**, which avoids decimal rounding errors like `0.1 + 0.2`.
- **`doneAt` is an assumption.** The spec doesn't yet say whether completed Tasks stay visible. If they vanish, removing them from the array is enough.
- **Wrap reads and writes in `try`/`catch`.** [MDN warns](https://developer.mozilla.org/en-US/docs/Web/API/Web_Storage_API/Using_the_Web_Storage_API#feature-detecting_localstorage) that storage can be unavailable even when it appears to exist, and writes can throw `QuotaExceededError`. If saved data is missing or corrupt, start with an empty Board instead of crashing.
- **"New day"** removes this key, after the confirmation already in the spec.

Three limits to know about:

- **Storage belongs to the domain.** [Data is kept per origin](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria#how_do_browsers_separate_data_from_different_websites), so moving to a new domain starts every Board empty.
- **Safari can delete it.** With tracking prevention on, [Safari deletes script-written data](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria#proactive_eviction) for a site with no interaction in seven days of browser use. That's acceptable for a daily Board.
- **Private browsing** data is [usually deleted](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria#private_browsing) when the session ends.

## Deploying to Coolify

Coolify turns every deployment into a Docker image and runs it as a container, with its [proxy](https://coolify.io/docs/core/networking-in-coolify) handling the domain and HTTPS in front. So the real question is how that image gets built.

| Build pack | Fit for the Board |
|---|---|
| [Static](https://coolify.io/docs/applications/builds/static) | **Doesn't fit.** It serves files already in the repo and runs no build, so `dist/` would have to be committed |
| [Nixpacks](https://coolify.io/docs/applications/builds/nixpacks/overview) | Works, and is [Coolify's documented Vite route](https://coolify.io/docs/applications/framework-examples/javascript/vite). But it's in maintenance mode and needs Node set by hand (see below) |
| [Railpack](https://coolify.io/docs/applications/builds/railpack) | The Nixpacks successor, still labelled Beta in Coolify |
| [Dockerfile](https://coolify.io/docs/applications/builds/dockerfile) | **Recommended.** You choose the exact Node version, and the Nginx config lives in the repo |

**Why not the automatic Nixpacks route?** It's tempting because there's nothing to write, but the Node version trips it up. In the [current Nixpacks source](https://github.com/railwayapp/nixpacks/blob/main/src/providers/node/mod.rs) (v1.41.0, October 2025):

| Node requested | Node you get | Vite 8 | Astro 7 |
|---|---|---|---|
| Nothing (default) | 18 | ❌ Crashed when tested on 18.20.8 | ❌ Below minimum |
| `22` | [22.14.0](https://github.com/NixOS/nixpkgs/blob/e6f23dc08d3624daab7094b701aa3954923c6bbb/pkgs/development/web/nodejs/v22.nix) | ✅ Above its minimum | ❌ Refuses to run |
| `24` | [24.10.0](https://github.com/NixOS/nixpkgs/blob/23f9169c4ccce521379e602cc82ed873a1f1b52b/pkgs/development/web/nodejs/v24.nix) | ✅ Above its minimum | ✅ Allowed |

If you ever take that route, set `"engines": { "node": "24" }` in `package.json`. I couldn't confirm which Nixpacks version Coolify 4.6.0 bundles, so check the deployment log.

### The recipe

This was tested locally against the blank `vanilla-ts` template: it built and served the expected headers, as listed in [What was tested](#what-was-tested).

`Dockerfile`: build with Node, then keep only the output and serve it with Nginx.

```dockerfile
FROM node:26-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
```

`nginx.conf`: tells browsers how long to keep each kind of file.

```nginx
server {
    listen 80;
    root /usr/share/nginx/html;
    index index.html;

    # The Board's HTML: always check for a new version.
    location = /index.html {
        add_header Cache-Control "no-cache";
    }

    # Vite's bundles: the filename contains a content hash, so they never change.
    location /assets/ {
        add_header Cache-Control "public, max-age=31536000, immutable";
    }

    # Meme files: stable names, kept for a week. Rename a file to replace it.
    location /media/ {
        add_header Cache-Control "public, max-age=604800";
    }

    location / {
        try_files $uri $uri/ =404;
    }
}
```

`.dockerignore`: keeps local files out of the build.

```
node_modules
dist
.git
assets-inbox
```

Coolify's [default Nginx config](https://github.com/coollabsio/coolify/blob/v4.6.0/bootstrap/helpers/shared.php) sets no caching headers, which is the other reason to own this file. [`add_header` is not inherited](https://nginx.org/en/docs/http/ngx_http_headers_module.html#add_header) into a block that sets its own, so keep each block's headers complete if you add more.

### Setting it up in Coolify

These steps come from the docs and haven't been run on your server.

1. **+ New → Public Repository**, paste the repo's HTTPS URL, then **Check repository** ([docs](https://coolify.io/docs/applications/sources/public-repositories)).
2. Choose **Dockerfile** as the build pack, with base directory `/` ([docs](https://coolify.io/docs/applications/builds/dockerfile)).
3. Set **Ports Exposes** to `80` and add the domain. Choose it carefully, since saved Boards belong to it.
4. Under **Advanced**, confirm **Gzip compression** is **Enabled**, so the proxy can [compress supported responses](https://coolify.io/docs/applications/configuration/advanced#gzip-compression).
5. Add the media mount (next section), then **Deploy**.
6. **For deploy on push:** connecting by public URL [doesn't set this up](https://coolify.io/docs/applications/sources/public-repositories#enable-automatic-deployments). Add a [manual GitHub webhook](https://coolify.io/docs/applications/deployments/manual-webhooks) or use a [GitHub App](https://coolify.io/docs/applications/sources/github/app).

### Large media files

The stack above already handles the hard part. Browsers fetch video and long audio in pieces using *range requests*, and Nginx answers those for static files with no extra setup: a test against a mounted file returned `206 Partial Content`. No media server or streaming service is needed for a few meme clips, despite Astro's hosted-video suggestion.

The real decision is where the files live. The site always asks for `/media/<kind>/<file>`, and that URL stays the same whichever you choose.

| Option | Good | Bad |
|---|---|---|
| **Directory Mount on the server (recommended for now)** | Files stay out of the public repo. Deploys stay fast and images small | One manual upload step. Not versioned, and [rollbacks don't restore it](https://coolify.io/docs/applications/deployments/rollbacks) |
| Commit to `public/media/` | Simplest: push and it's live. Rollbacks include media | Publishes every file in a public repo's history, and [removing them means rewriting history](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github#removing-files-from-a-repositorys-history). GitHub warns at 50 MiB and blocks at 100 MiB per file |
| [Git LFS](https://coolify.io/docs/applications/configuration/advanced#lfs) | Handles bigger files; Coolify supports it | Still public, and adds another tool |
| Object storage or a CDN | Scales well | Far more than a joke shared with friends needs |

I recommend the mount because the asset rights question is still open, and a public Git history is the hardest of these to undo. Starting out of Git keeps every option available: moving files to `public/media/` later needs no code changes.

**Note that no option here makes the files private.** Anyone with the link can still download them from the site. A mount only avoids *also* republishing them in a public repo, so the asset rights question stays open.

Setting it up:

1. In Coolify: **Persistent Storage → Add → [Directory Mount](https://coolify.io/docs/core/persistent-storage/storage-mounts/bind-mounts)**. Source `/srv/rage-board/media`, destination `/usr/share/nginx/html/media`. Then redeploy.
2. Upload files with `rsync` or `scp`, or use Coolify's [file browser](https://coolify.io/docs/core/container-file-browser) (Beta, 250 MiB limit per upload by default).
3. Make them readable by Nginx inside the container: `chmod -R a+rX /srv/rage-board/media`.
4. For local development, symlink `public/media` to your files and gitignore that link, so `/media/...` works the same in both places.

Watch out for these:

- **Deleting the mount in Coolify [can delete the files](https://coolify.io/docs/core/persistent-storage/storage-mounts/bind-mounts)** on the server. Read the confirmation options carefully.
- **It isn't a backup.** The server and the gitignored `assets-inbox/` would be the only copies, so back the files up somewhere.
- **A missing file shouldn't break the Board.** Files can now be absent or out of step with the code, so an effect should skip a file that fails to load.

## Worth knowing before building

**Tabs that stay open for days can break after a deploy.** A Board left on a monitor keeps running old code, while each deploy replaces the container and removes the old hashed files. If the code loads effects on demand with `import()`, the first Meltdown after a deploy could fail to fetch its code. [Vite documents this exact case](https://vite.dev/guide/build#load-error-handling). The simplest fix is to not split the code: bundle all effects into one file and load only media on demand, which also means the Meltdown's code can't fail at the worst moment. If splitting becomes necessary, handle `vite:preloadError`.

## If you choose Astro anyway

Everything above still applies, with these differences:

- Use one `src/pages/index.astro` holding the HTML and a `<script>` importing `main.ts`. [Scripts are bundled and support TypeScript](https://docs.astro.build/en/guides/client-side-scripts/#script-processing) by default.
- Don't add an adapter. [Adapters are for on-demand rendering](https://docs.astro.build/en/guides/deploy/#adding-an-adapter-for-on-demand-rendering), and the Board has none.
- The Dockerfile and Nginx config stay the same, since [Astro also outputs to `dist/`](https://docs.astro.build/en/guides/deploy/#building-your-site-locally). Node 26 meets its minimum.
- Add Astro's hashed-output folder to the caching rules: use `/_astro/` in place of `/assets/`.

Because the logic sits in plain TypeScript modules, moving between the two later is a small job.

## What was tested

Everything ran locally in throwaway Docker containers, against a blank template and not Rage Board code. All of it was removed afterwards.

| Check | Result |
|---|---|
| `vanilla-ts` template builds with the Dockerfile above | ✅ Image of 93.7 MB, Nginx 1.31.8 |
| `/` headers | ✅ `Cache-Control: no-cache` |
| `/assets/*.js` headers | ✅ `public, max-age=31536000, immutable` |
| Range request on a file in a read-only mount | ✅ `206`, `video/mp4`, correct `Content-Range` |
| Missing media file | ✅ `404` |
| Astro 7.4.5 on Node 22.21.1 | ❌ "Node.js v22.21.1 is not supported by Astro!" |
| Astro 7.4.5 on Node 24.22.2 and 26.13.0 | ✅ `astro --version` runs |
| Vite 8.3.5 build on Node 18.20.8 | ❌ Crashes with a stack trace |

**Not tested:**

- A real Coolify deployment. As instructed, I used public docs only and didn't touch your infrastructure.
- Anything through Coolify's proxy. The range test hit Nginx directly.
- Vite and Astro inside Nixpacks itself. The table above is derived from its source and from Node version checks. Vite 8 on Nixpacks' 22.14.0 and 24.10.0 is judged from its stated Node requirement, not from running it.

**After the first real deploy,** run this. It should return `206`, which confirms range requests survive the proxy even when the client accepts compression:

```sh
curl -sI -H 'Range: bytes=0-1023' -H 'Accept-Encoding: gzip' https://<domain>/media/<file>
```

[Traefik's compression](https://doc.traefik.io/traefik/reference/routing-configuration/http/middlewares/compress/) can apply to any response over 1 KB that accepts it, so if this returns `200`, check the proxy's compression settings first.

## Versions checked

From npm and official release pages on 2026-11-05:

- Astro 7.4.5, Vite 8.3.5, create-vite 9.3.3, TypeScript 7.0.2
- Node 26.13.0 (LTS "Lithium"), 24.22.2 (LTS "Krypton"), 22.23.4 (LTS "Jod", released 2026-10-20)
- Coolify 4.6.0 (released 2026-11-02), Nixpacks 1.41.0

## Questions for the map

1. **The map says "on Astro unless research rules it out".** Research doesn't rule Astro out, it recommends against it. Switching to Vite is the owner's call.
2. **What should happen when the Board reloads above 100% Overload?** State comes back straight away, so the code must choose between replaying the one-off Meltdown moment and going straight to wreckage. Replaying would also fire on every refresh. Sound complicates this: [browsers generally block audio until the user interacts with the site](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay), so a reloaded Board may stay silent until the first click. This touches #3 and the "Wreckage details" gap.
3. **Asset rights now connects to deployment.** The mount recommendation keeps that decision open but doesn't settle it. Once #6 shows what's in the pile and how big it is, the storage choice can be confirmed.
