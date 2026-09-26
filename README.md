# GYOPO Reconstruction

This is a **new reconstruction** using deployment `aa09fb9f` as a visual and
behavioral reference. It is not the verified original source, an exact export,
or a claim of byte-for-byte parity. Build success alone does not establish
feature parity or production readiness.

## Source of Truth

This checked-in tree is the source of truth for the reconstruction:

- `src/app/`: App Router pages, layouts, and API handlers.
- `src/components/`, `src/lib/`, `src/store/`, `src/styles/`: application code.
- `public/`: static assets; root configuration and `package-lock.json`: build inputs.

Build releases from this tree, not backup variants, release ZIP overlays, or
generated output. The destructive ZIP-to-source replacement workflow has been
removed. `Header.tsx` is the canonical header. `useeffectevent.ts` and lowercase
game/master implementations remain active code, not cleanup targets.

Production must serve the build and API handlers from this tree. Do not proxy,
rewrite, or redirect production traffic to `aa09fb9f.gyopo.pages.dev` to simulate
a restoration. The old deployment is a comparison reference, not a runtime backend.

## Local Commands

Use Node.js 22.18+ or Node.js 24 and npm. Run commands from the repository root.

```bash
npm ci
npm run dev
```

Open `http://localhost:3000`. To validate and run a production build:

```bash
npm test
npm run test:security
npm run lint
npm run build
npm start
```

Cloudflare Pages uses `npm run build:pages`, with output in
`.vercel/output/static`. The adapter and Vercel CLI are pinned. `.npmrc` retains
the peer-resolution setting required by the legacy Pages adapter; its declared
Next.js range predates the patched Next.js version used here. Validate the
complete Pages bundle after dependency updates, not just `next build`.

The reference styles in `public/styles/release-aa09/` are loaded in a tested,
fixed order. Do not add a second global Tailwind build or CSS override bundle.
Music uses the official YouTube IFrame API and visible player controls; browser
autoplay restrictions still require a user playback action.

`next.config.ts` currently skips lint during the build, so run lint separately.
External-service and emulator checks may need their own configuration; skipped
checks are not proof that those integrations work. Supply credentials through
local environment configuration or the hosting provider's secret settings.
Never commit credentials, tokens, or populated environment files.

## Release Gate

Before replacing the GitHub production source or deploying, validate the build,
desktop/mobile layout, navigation, and affected routes/API flows. Include
`/community`, `/jobs`, `/market`, games, authentication, and authorized master
access. Record failures or untested integrations explicitly. Deployment packaging
and live-domain verification are separate steps; this cleanup does not certify
or deploy a production release.
