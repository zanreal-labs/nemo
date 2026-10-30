---
name: nemo-setup
description: Set up @zanreal/nemo in a Next.js app - install it, create proxy.ts (Next.js 16+) or middleware.ts (older) with createNEMO, add the matcher config and define the first routes. Use when the user wants multiple middlewares in Next.js, wants to split or compose middleware by path, or mentions NEMO, @zanreal/nemo, createNEMO or proxy.ts.
license: MIT
metadata:
  author: zanreal-labs
  version: "1.0"
  library: "@zanreal/nemo@3"
---

# Set up NEMO in a Next.js app

NEMO (`@zanreal/nemo`) composes many Next.js middlewares into one `proxy.ts` / `middleware.ts`. You describe routes as an object, NEMO runs the matching functions in a defined order and stops the chain when one returns a redirect, rewrite or other final response.

## 1. Detect the Next.js version and file name

Read `next` in `package.json`.

| Next.js | File | Export name |
| --- | --- | --- |
| 16 or newer | `proxy.ts` | `export const proxy` |
| 15 or older | `middleware.ts` | `export const middleware` |

Put the file next to `app/` (or inside `src/` when the project uses `src/`). If the project already has one of these files, do not overwrite it: read it and follow the `nemo-migrate` skill.

## 2. Install

Use the project's package manager (check the lockfile):

```bash
npm install @zanreal/nemo
pnpm add @zanreal/nemo
yarn add @zanreal/nemo
bun add @zanreal/nemo
```

Peer dependency is `next >=13`. The package is ESM and CJS compatible.

## 3. Minimal file

Next.js 16+ (`proxy.ts`):

```ts
import { createNEMO, type MiddlewareConfig } from "@zanreal/nemo";
import { NextResponse } from "next/server";

const middlewares = {
  "/dashboard/:path*": async (request, event) => {
    request.headers.set("x-section", "dashboard");
    return NextResponse.next();
  },
} satisfies MiddlewareConfig;

export const proxy = createNEMO(middlewares);

export const config = {
  matcher: ["/((?!_next/|_static|_vercel|[\\w-]+\\.\\w+).*)"],
};
```

Older Next.js (`middleware.ts`): same code, but `export const middleware = createNEMO(middlewares);`.

Rules that matter:

- `createNEMO(middlewares, globalMiddleware?, config?)` returns the handler directly. Do not write `new NEMO(...)` unless you also use `.middleware` (`export const proxy = new NEMO({...}).middleware`).
- Do not use `createMiddleware`. It is deprecated and prints a console warning.
- Import `NextResponse` and `NextRequest` from `next/server`. `StorageAdapter` and `MemoryStorageAdapter` come from `@zanreal/nemo/storage`, not from the main entry.
- `config.matcher` must be a static literal in the same file (a Next.js rule). Next.js only calls the file for paths the matcher accepts, NEMO routes are applied after that.

## 4. Routes

The first argument maps path patterns to a function, an array of functions, or a nested object.

```ts
import { createNEMO } from "@zanreal/nemo";
import { NextResponse } from "next/server";

export const proxy = createNEMO(
  {
    // exact path only: runs for "/pricing", not for "/pricing/anything"
    "/pricing": (request) => {
      request.headers.set("x-page", "pricing");
    },

    // prefix with parameters: runs for "/blog", "/blog/a", "/blog/a/b"
    "/blog/:path*": [
      (request) => {
        request.headers.set("x-section", "blog");
      },
      (request) => {
        request.headers.set("x-blog", "1");
      },
    ],

    // nested: parent runs for the whole subtree, children add on top
    "/app": {
      middleware: (request) => {
        request.headers.set("x-app", "1");
      },
      "/settings": (request) => {
        request.headers.set("x-settings", "1");
      },
    },
  },
  {
    // global chains run on every request that reaches NEMO
    before: (request) => {
      request.headers.set("x-request-start", String(Date.now()));
    },
    after: () => NextResponse.next(),
  },
  { debug: false, silent: false },
);
```

Key facts:

- A top-level key whose value is a function or array matches that exact path only. `"/foo"` does NOT run for `/foo/bar`. Use `"/foo/:path*"` or a nested object for prefix matching.
- A key whose value is an object with child keys matches as a prefix and children are joined to the parent path.
- `"/"` runs only for the exact root path `/`. It is not a catch-all. For "every request" use `globalMiddleware.before`.
- Pattern syntax is path-to-regexp v6 (`:param`, `:param*`, `:param+`, `:param?`, `(regex)`), case insensitive. An invalid pattern is logged and silently never matches.
- Order: global `before`, then matched routes (parents before children), then global `after`.
- A middleware returning `undefined` or `NextResponse.next()` lets the chain continue. `NextResponse.redirect`, `NextResponse.rewrite`, `NextResponse.json` or a plain `new Response(...)` end it. See the `nemo-middleware-patterns` skill for all rules.

## 5. Verify

1. Start `next dev` and request a matched and an unmatched path. Set `debug: true` in the third argument for NEMO's internal logs (`event.log` itself prints nothing in 3.0.0, use `event.warn`).
2. Run the type checker. `satisfies MiddlewareConfig` gives contextual types to `request` and `event`.
3. For unit tests see the `nemo-debugging` skill.

## Checklist

- [ ] File name and export name match the Next.js version (`proxy` vs `middleware`).
- [ ] `export const config = { matcher: [...] }` present and excludes `_next`, static files and assets.
- [ ] No `createMiddleware`, no `req.params` (use `event.params`), no `new NEMO` without `.middleware`.
- [ ] Prefix routes use `/:path*` or nesting, not a bare path.
- [ ] Redirect targets are absolute URLs: `new URL("/login", request.url)`.
- [ ] Blocking responses use `new Response(...)` or `NextResponse.json(...)`, not `new NextResponse(body, { status })`.
