# Testing NEMO configs

Export the config so tests can import it without Next.js running. Both `proxy.ts` and `middleware.ts` can export the handler, so tests import it directly.

## bun (`bun test`)

```ts
import { describe, expect, test } from "bun:test";
import { NextRequest, NextResponse, type NextFetchEvent } from "next/server";
import { createNEMO } from "@zanreal/nemo";

const event = { waitUntil: () => {} } as unknown as NextFetchEvent;

const proxy = createNEMO({
  "/dashboard/:path*": (request) => {
    if (!request.cookies.has("session")) {
      return NextResponse.redirect(new URL("/login", request.url));
    }
    request.headers.set("x-user", "1");
  },
});

describe("proxy", () => {
  test("redirects anonymous users", async () => {
    const res = await proxy(new NextRequest("http://localhost/dashboard/x"), event);
    expect(res?.status).toBe(307);
    expect(res?.headers.get("location")).toBe("http://localhost/login");
  });

  test("forwards a header for signed in users", async () => {
    const req = new NextRequest("http://localhost/dashboard/x", {
      headers: { cookie: "session=abc" },
    });
    const res = await proxy(req, event);
    expect(res?.headers.get("x-middleware-request-x-user")).toBe("1");
  });
});
```

## vitest

Same body, different imports:

```ts
import { describe, expect, test } from "vitest";
```

Use the `node` environment (`// @vitest-environment node` or `test.environment: "node"`), `NextRequest` needs Web `Request` and `Headers`. To spy use `vi.fn()` instead of `mock()`.

## jest

```ts
/** @jest-environment node */
import { NextRequest, type NextFetchEvent } from "next/server";
import { createNEMO } from "@zanreal/nemo";
// describe, test, expect are globals
```

`@zanreal/nemo` is ESM. With `ts-jest` or `next/jest` make sure ESM packages are transformed, for example `transformIgnorePatterns: ["/node_modules/(?!@zanreal/nemo)"]`.

## Ordering and storage

```ts
test("runs parents before children", async () => {
  const order: string[] = [];
  const p = createNEMO({
    "/a": {
      middleware: () => { order.push("a"); },
      "/b": () => { order.push("b"); },
    },
  });
  await p(new NextRequest("http://localhost/a/b"), event);
  expect(order).toEqual(["a", "b"]);
});
```

Storage isolation test:

```ts
import { MemoryStorageAdapter } from "@zanreal/nemo/storage";

test("storage does not leak between requests", async () => {
  const seen: Array<string | undefined> = [];
  const p = createNEMO(
    {
      "/x": (request, e) => {
        seen.push(e.storage.get<string>("k"));
        e.storage.set("k", "v");
      },
    },
    undefined,
    { storage: () => new MemoryStorageAdapter() },
  );
  await p(new NextRequest("http://localhost/x"), event);
  await p(new NextRequest("http://localhost/x"), event);
  expect(seen).toEqual([undefined, undefined]);
});
```

Without the `storage` factory the second request would see `"v"`.

## Error handling test

```ts
test("errorHandler turns a throw into a 500", async () => {
  const p = createNEMO(
    { "/boom": () => { throw new Error("x"); } },
    undefined,
    { errorHandler: () => new Response("fail", { status: 500 }), silent: true },
  );
  const res = await p(new NextRequest("http://localhost/boom"), event);
  expect(res?.status).toBe(500);
});
```

## Pitfalls in tests

- Use absolute URLs in `new NextRequest(...)`.
- `event.waitUntil` stub is required because Next types expect a `NextFetchEvent`.
- The handler returns a response (possibly `NextResponse.next`-like) even when nothing matched, so assert on headers, not on `undefined`.
