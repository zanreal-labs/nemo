---
name: nemo-migrate
description: Migrate to @zanreal/nemo from a single Next.js middleware.ts or proxy.ts, from the old @rescale/nemo package (with the nemo-codemod), or from the deprecated createMiddleware API. Use when the user mentions @rescale/nemo, the NEMO codemod, a Next.js 16 middleware-to-proxy rename, wants to split one large middleware into per-route functions, or sees a createMiddleware deprecation warning.
license: MIT
metadata:
  author: zanreal-labs
  version: "1.0"
  library: "@zanreal/nemo@3"
---

# Migrate to NEMO

Pick the path that matches the project.

| Situation | Go to |
| --- | --- |
| Imports from `@rescale/nemo` | `references/from-rescale.md` |
| One big `middleware.ts` / `proxy.ts` with `if (pathname...)` branches | `references/from-next-middleware.md` |
| Next.js 15 to 16 (file and export rename) | `references/next16-proxy.md` |
| Uses `createMiddleware` from NEMO | replace with `createNEMO`, same arguments |

## Quick path: from @rescale/nemo

The API did not change in 3.0.0, only the package name.

```bash
npx @zanreal/nemo-codemod --dry      # preview
npx @zanreal/nemo-codemod            # apply to the current directory
```

Then reinstall with the project's package manager so the lockfile picks up `@zanreal/nemo` (`npm install`, `pnpm install`, `yarn`, `bun install`). The codemod does not touch lockfiles. Details and flags: `references/from-rescale.md`.

## Quick path: from a single middleware

1. Read the existing file and list every branch by path, plus anything that runs for all requests.
2. Move each branch into a key of the NEMO config. Shared preamble goes to `globalMiddleware.before`.
3. Keep the existing `config.matcher` unchanged at first.
4. Replace `export function middleware` (or `proxy`) by `export const middleware = createNEMO(...)` (or `proxy`).
5. Test the old and new behavior on the same set of URLs.

Full mapping rules with before/after code: `references/from-next-middleware.md`.

## Rules to keep behavior identical

- Old code usually returned early. In NEMO, "return nothing" continues the chain, `NextResponse.redirect/rewrite/json` or `new Response(...)` stop it. A `new NextResponse(body, { status })` does NOT stop it, convert to `new Response(...)`.
- `startsWith` checks become prefix patterns (`"/dashboard/:path*"` or a nested object). A bare `"/dashboard"` matches only that exact path.
- A `pathname === "/"` branch becomes the `"/"` key, which also matches only the exact root.
- Logic that must run for every request goes to `before` (or `after`), not to `"/"`.
- Do not copy `req.params`, `new NEMO(...)` without `.middleware`, or `NextResponse.redirect("/relative")` from older blog posts.
