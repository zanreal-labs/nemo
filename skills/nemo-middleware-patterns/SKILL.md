---
name: nemo-middleware-patterns
description: Write and organize @zanreal/nemo middleware - chains, nested and parameterized routes, global before/after, shared storage, redirects, rewrites, header and cookie forwarding, auth gating, i18n, event.skip. Use when adding or changing logic inside a createNEMO config, choosing how to stop or continue a chain, or working out why a NEMO middleware does or does not run.
license: MIT
metadata:
  author: zanreal-labs
  version: "1.0"
  library: "@zanreal/nemo@3"
---

# NEMO middleware patterns

Everything here describes `@zanreal/nemo` 3.0.x as the source and tests implement it. If the docs or README disagree, trust this file and the source.

Signature of every middleware:

```ts
import type { NextMiddleware } from "@zanreal/nemo";
// (request: NextRequest, event: NemoEvent) => NextResponse | Response | null | undefined | void (or a Promise of it)
```

`event` is a `NemoEvent`: a `NextFetchEvent` plus `event.storage`, `event.params`, `event.getParams()`, `event.skip()` and `event.log/warn/error`.

## Continue or stop

| Return value | Chain |
| --- | --- |
| `undefined`, `null`, nothing | continues |
| `NextResponse.next()` (with or without `{ headers }`) | continues, its headers are merged |
| `NextResponse.redirect(url)` | stops |
| `NextResponse.rewrite(url)` | stops |
| `NextResponse.json(...)` | stops |
| `new Response(...)`, `Response.redirect(...)` | stops |
| thrown error | goes to `errorHandler`, see `nemo-debugging` |

The rule in the source: a `NextResponse` continues unless it has `x-middleware-rewrite`, a `Location` header or a JSON content type. Any other kind of result stops.

Trap: `new NextResponse("Unauthorized", { status: 401 })` has none of those, so it CONTINUES and the 401 is lost. For a blocking response use `new Response("Unauthorized", { status: 401 })` or `NextResponse.json({ error: "Unauthorized" }, { status: 401 })`.

Trap: `NextResponse.redirect` and `rewrite` need absolute URLs. Use `new URL("/login", request.url)` or `request.nextUrl.clone()`.

## Route matching in short

- Function or array at top level: exact path only (`"/foo"` does not run for `/foo/bar`).
- Object with child keys: prefix match, children joined to the parent path, `middleware` key holds the parent's own function(s). Nested children are prefix matches too.
- `"/"` only runs for `/`.
- Dynamic or wildcard patterns (`:`, `*`, `(`) use path-to-regexp v6, case insensitive. Plain paths are compared exactly (case sensitive).
- Order: global `before`, matched routes (by nesting depth, parents first; at the same depth, longer patterns first), global `after`. Within an array, in array order.
- Details and syntax pitfalls: `references/matching.md`.

## Core patterns

### Gate by path, redirect when not authenticated

```ts
import { createNEMO } from "@zanreal/nemo";
import { NextResponse } from "next/server";

export const proxy = createNEMO({
  "/dashboard": {
    middleware: (request) => {
      if (!request.cookies.has("session")) {
        const url = new URL("/login", request.url);
        url.searchParams.set("next", request.nextUrl.pathname);
        return NextResponse.redirect(url);
      }
    },
    "/admin": (request) => {
      if (request.cookies.get("role")?.value !== "admin") {
        return new Response("Forbidden", { status: 403 });
      }
    },
  },
});
```

The `/dashboard` function guards `/dashboard` and everything under it. `/dashboard/admin` (and `/dashboard/admin/x`, since nested children match as prefixes) runs the parent first, then the child. If the parent redirects, the child never runs.

### Pass data to later middleware and to pages

Set request headers. NEMO diffs request headers at the end of the chain and forwards the changes to the page (readable with `headers()` from `next/headers`) and also puts them on the response.

```ts
import { createNEMO } from "@zanreal/nemo";

export const proxy = createNEMO(
  {
    "/:locale(en|pl)/:path*": (request, event) => {
      const { locale } = event.params;
      request.headers.set("x-locale", String(locale));
    },
  },
  {
    before: (request) => {
      request.headers.set("x-request-id", crypto.randomUUID());
    },
  },
);
```

`NextResponse.next({ request: { headers } })` and `NextResponse.next({ headers })` from a continuing middleware are also merged for later middleware. Details: `references/responses-and-headers.md`.

### Shared state inside one chain: `event.storage`

```ts
import { createNEMO } from "@zanreal/nemo";
import { MemoryStorageAdapter } from "@zanreal/nemo/storage";

export const proxy = createNEMO(
  {
    "/app/:path*": [
      (request, event) => {
        event.storage.set("userId", request.cookies.get("uid")?.value);
      },
      (request, event) => {
        const userId = event.storage.get<string>("userId");
        if (userId) request.headers.set("x-user-id", userId);
      },
    ],
  },
  undefined,
  { storage: () => new MemoryStorageAdapter() },
);
```

Important: with no `storage` option, or with a storage INSTANCE, the same storage is shared by every request handled by that `createNEMO`. Data written in one request is visible in the next. Pass a factory `storage: () => new MemoryStorageAdapter()` for per-request isolation. `event.storage` is synchronous (`get`, `set`, `has`, `delete`, `clear`, `keys`, `values`, `entries`, `size`). Do not use the `Storage` interface exported from types, it is async and unused. See `references/storage.md`.

### Skip the rest of a section

```ts
import { createNEMO } from "@zanreal/nemo";

export const proxy = createNEMO(
  {
    "/api/:path*": [
      (request, event) => {
        if (request.headers.get("x-internal") === "1") event.skip();
      },
      (request) => {
        request.headers.set("x-checked", "1"); // skipped for internal calls
      },
    ],
  },
  { after: () => {} },
);
```

`event.skip()` skips the remaining middlewares of the current section (before, main or after). `event.skip({ skipAfter: true })` also skips the global `after` chain.

### Global before and after

```ts
import { createNEMO } from "@zanreal/nemo";

export const proxy = createNEMO(
  { "/": () => {} },
  {
    before: [(request) => { request.headers.set("x-start", String(Date.now())); }],
    after: (request) => { request.headers.set("x-end", String(Date.now())); },
  },
);
```

`before` and `after` accept one function or an array.

### Work after the response

`event.waitUntil(promise)` hands the promise to the platform, so background work such as logging or analytics keeps running after the response is sent. Version note: this works in the first release after 3.0.2. On 3.0.2 and older the promise is not awaited and may be cut off; there, use `after()` from `next/server` (Next.js 15.1+) or move the work into the route handler.

## More

- `references/matching.md`: pattern syntax, what not to write, negative lookahead
- `references/responses-and-headers.md`: headers, cookies, rewrites
- `references/storage.md`: adapter contract, per-request isolation, custom adapter
- `references/recipes.md`: auth gate, role check, i18n rewrite, Supabase session, other auth libraries, rate limit, logging
