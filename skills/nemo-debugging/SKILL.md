---
name: nemo-debugging
description: Debug and test @zanreal/nemo middleware - a middleware not running, a response ignored, a 401 or redirect lost, headers or cookies missing, storage leaking between requests, NemoMiddlewareError, event.log printing nothing, and unit tests with NextRequest. Use when NEMO behavior is unexpected or when writing tests for a createNEMO config.
license: MIT
metadata:
  author: zanreal-labs
  version: "1.0"
  library: "@zanreal/nemo@3"
---

# Debug and test NEMO

Work from the symptom table first, then use the debug options, then write a test that reproduces it.

## Symptom to cause

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Route for `/foo` does not run on `/foo/bar` | A top-level function or array key matches the exact path only | Use `"/foo/:path*"` or a nested object |
| Nested child runs on deeper paths than expected | Nested keys match as prefixes (`"/a": { "/b": fn }` runs on `/a/b/c`) | Check `request.nextUrl.pathname` in the child, or use a top-level key for the exact path |
| `"/Pricing"` does not run on `/pricing` | Plain paths are compared case sensitively | Use the exact case, or a pattern (patterns are case insensitive) |
| `"/"` route does not run on other pages | `"/"` is exact root only | Use `globalMiddleware.before` for every request |
| Route never runs, no exception | Invalid pattern: NEMO prints `Error creating regexp for pattern` with `console.error` and the route never matches. Common: `/api{/*path}` (v8 syntax), `(!api)` | Use path-to-regexp v6 syntax, see `nemo-middleware-patterns/references/matching.md` |
| Route never runs for assets or an API path | `config.matcher` excludes the path so Next.js never calls the proxy | Fix the matcher |
| `new NextResponse("...", { status: 401 })` has no effect, request continues | A `NextResponse` without rewrite, `Location` or JSON type continues the chain | Return `new Response(...)` or `NextResponse.json(...)` |
| Redirect throws or goes nowhere | Relative URL | `NextResponse.redirect(new URL("/login", request.url))` |
| Later middleware does not see a header | Header set on a response that stopped the chain, or set after the redirect | Set `request.headers.set(...)` before, in an earlier middleware |
| Page cannot read header with `headers()` | Header set only on the response, not on the request | Set it with `request.headers.set(...)`, NEMO forwards request header changes |
| Cookie lost on redirect | Cookie set on an unrelated `NextResponse`, not returned | Set on the response you return, or on a continuing response from an earlier middleware |
| Data from one request appears in another | Default storage (or a storage instance) is shared by all requests of that `createNEMO` | `storage: () => new MemoryStorageAdapter()` |
| `event.log()` prints nothing, even with `debug: true` | `event.log` is not wired to `debug` inside chains in 3.0.x | Use `event.warn` / `event.error` or `console.log` while debugging |
| Work started with `event.waitUntil` is cut off | `waitUntil` is not forwarded to the platform in NEMO 3.0.x | Use `after()` from `next/server` |
| `req.params` is undefined | It does not exist | `event.params` (or `event.getParams(...)`) |
| `StorageAdapter` import fails | Not exported from the main entry | `import { StorageAdapter } from "@zanreal/nemo/storage"` |
| `NemoMiddlewareError: Middleware execution failed` | A middleware threw and `silent` is false | Read `error.originalError` (the thrown value) and `error.metadata` (chain, pathname, routeKey, index); the message also names chain, path, route key and index; fix, or handle it with `errorHandler` |
| Next.js 16 ignores the file | Wrong name or export | `proxy.ts` with `export const proxy`, or legacy `middleware.ts` with `export const middleware` |

## Debug options (third argument of createNEMO)

```ts
import { createNEMO } from "@zanreal/nemo";
import { NextResponse } from "next/server";

export const proxy = createNEMO(
  { "/api/:path*": () => {} },
  undefined,
  {
    debug: true,          // internal logs: matched routes, execution, errors
    enableTiming: true,   // time per chain (before/main/after)
    silent: false,        // true: swallow errors and continue instead of throwing
    errorHandler: (error, metadata) => {
      console.error("NEMO failed", metadata.chain, metadata.routeKey, metadata.index, error);
      // return a response to use it, or nothing to fall back to throw/silent behavior
      return NextResponse.json({ error: "Internal error" }, { status: 500 });
    },
  },
);
```

Error flow: a thrown error goes to `errorHandler(error, metadata)`. A truthy return value becomes the response. Otherwise `silent: false` throws `NemoMiddlewareError`, `silent: true` continues with the next middleware.

`metadata` is `{ chain: "before" | "main" | "after"; index: number; pathname: string; routeKey: string; nestLevel?: number }`.

Turn `debug` off in production unless you need it, it is verbose.

## Bisecting a chain

1. Add a header marker at the top of each suspect middleware: `request.headers.set("x-hit-a", "1")`.
2. Request the path and inspect response headers (or `x-middleware-request-x-hit-a` in tests).
3. The first marker that is missing shows where the chain stopped or where the route did not match.
4. Check for the earlier middleware returning a stopping response.

## Writing tests

Call the handler directly with a `NextRequest` and a stub event. No server needed. Templates for bun, vitest and jest are in `references/testing.md`. Core shape:

```ts
import { NextRequest, type NextFetchEvent } from "next/server";
import { createNEMO } from "@zanreal/nemo";

const event = { waitUntil: () => {} } as unknown as NextFetchEvent;
const proxy = createNEMO({ "/dashboard/:path*": () => Response.redirect("http://localhost/login") });

const res = await proxy(new NextRequest("http://localhost/dashboard/x"), event);
// res?.status === 302, res?.headers.get("location") === "http://localhost/login"
```

What to assert:

- redirect: `res.status` and `res.headers.get("location")`
- rewrite: `res.headers.get("x-middleware-rewrite")`
- blocking response: `res.status`
- forwarded request header `x-foo`: `res.headers.get("x-middleware-request-x-foo")`
- response header: `res.headers.get("x-foo")`
- continue with no changes: a `NextResponse.next()`-style response with header `x-middleware-next: 1`
