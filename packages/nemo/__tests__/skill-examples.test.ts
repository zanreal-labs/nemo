/**
 * Keeps the code examples in /skills (agent skills) honest.
 * Each test mirrors a snippet from a SKILL.md or references/*.md file.
 */
import { describe, expect, test } from "bun:test";
import { NextRequest, NextResponse, type NextFetchEvent } from "next/server";
import {
  NEMO,
  NemoMiddlewareError,
  createNEMO,
  type MiddlewareConfig,
  type NextMiddleware,
} from "../src";
import { MemoryStorageAdapter, StorageAdapter } from "../src/storage";

const event = { waitUntil: () => {} } as unknown as NextFetchEvent;
const req = (path: string, init?: ConstructorParameters<typeof NextRequest>[1]) =>
  new NextRequest(`http://localhost${path}`, init);

describe("nemo-setup examples", () => {
  const middlewares = {
    "/dashboard/:path*": async (request) => {
      request.headers.set("x-section", "dashboard");
      return NextResponse.next();
    },
  } satisfies MiddlewareConfig;
  const proxy = createNEMO(middlewares);

  test("satisfies MiddlewareConfig and forwards header", async () => {
    const res = await proxy(req("/dashboard/a"), event);
    expect(res?.headers.get("x-middleware-request-x-section")).toBe(
      "dashboard",
    );
  });

  test("new NEMO(...).middleware equals createNEMO", async () => {
    const p = new NEMO(middlewares).middleware;
    const res = await p(req("/dashboard"), event);
    expect(res?.headers.get("x-middleware-request-x-section")).toBe(
      "dashboard",
    );
  });

  test("top-level key is exact, :path* is prefix, root is exact", async () => {
    const hits: string[] = [];
    const p = createNEMO({
      "/pricing": () => {
        hits.push("pricing");
      },
      "/blog/:path*": () => {
        hits.push("blog");
      },
      "/": () => {
        hits.push("root");
      },
    });
    await p(req("/pricing/x"), event);
    expect(hits).toEqual([]);
    await p(req("/pricing"), event);
    await p(req("/blog"), event);
    await p(req("/blog/a/b"), event);
    await p(req("/"), event);
    expect(hits).toEqual(["pricing", "blog", "blog", "root"]);
  });

  test("nested object with global before and after", async () => {
    const order: string[] = [];
    const p = createNEMO(
      {
        "/app": {
          middleware: () => {
            order.push("app");
          },
          "/settings": () => {
            order.push("settings");
          },
        },
      },
      {
        before: () => {
          order.push("before");
        },
        after: () => {
          order.push("after");
        },
      },
    );
    await p(req("/app/settings"), event);
    expect(order).toEqual(["before", "app", "settings", "after"]);
  });
});

describe("nemo-middleware-patterns examples", () => {
  test("continue vs stop", async () => {
    const calls: string[] = [];
    const later: NextMiddleware = () => {
      calls.push("later");
    };
    const cases: Array<[string, NextMiddleware, boolean]> = [
      ["undefined", () => {}, true],
      ["next", () => NextResponse.next(), true],
      ["NextResponse 401", () => new NextResponse("no", { status: 401 }), true],
      [
        "redirect",
        (r) => NextResponse.redirect(new URL("/login", r.url)),
        false,
      ],
      ["json", () => NextResponse.json({ a: 1 }), false],
      ["plain Response", () => new Response("no", { status: 401 }), false],
    ];
    for (const [name, first, continues] of cases) {
      calls.length = 0;
      const p = createNEMO({ "/x": [first, later] });
      await p(req("/x"), event);
      expect([name, calls.includes("later")]).toEqual([name, continues]);
    }
  });

  test("auth gate with nested admin check", async () => {
    const p = createNEMO({
      "/dashboard": {
        middleware: (request) => {
          if (!request.cookies.has("session")) {
            return NextResponse.redirect(new URL("/login", request.url));
          }
        },
        "/admin": (request) => {
          if (request.cookies.get("role")?.value !== "admin") {
            return new Response("Forbidden", { status: 403 });
          }
        },
      },
    });
    const anon = await p(req("/dashboard/admin"), event);
    expect(anon?.status).toBe(307);
    expect(anon?.headers.get("location")).toBe("http://localhost/login");
    const user = await p(
      req("/dashboard/admin", { headers: { cookie: "session=1" } }),
      event,
    );
    expect(user?.status).toBe(403);
  });

  test("event.params with constrained locale", async () => {
    let seen: unknown;
    const p = createNEMO({
      "/:locale(en|pl)/:path*": (request, e) => {
        seen = e.params.locale;
      },
    });
    await p(req("/pl/about"), event);
    expect(seen).toBe("pl");
  });

  test("negative lookahead pattern", async () => {
    const hits: string[] = [];
    const p = createNEMO({
      "/:section((?!api)[^/]+)": () => {
        hits.push("page");
      },
    });
    await p(req("/about"), event);
    await p(req("/api"), event);
    expect(hits).toEqual(["page"]);
  });

  test("storage factory isolates requests", async () => {
    const seenIsolated: Array<string | undefined> = [];
    const isolated = createNEMO(
      {
        "/x": (_r, e) => {
          seenIsolated.push(e.storage.get<string>("k"));
          e.storage.set("k", "v");
        },
      },
      undefined,
      { storage: () => new MemoryStorageAdapter() },
    );
    await isolated(req("/x"), event);
    await isolated(req("/x"), event);
    expect(seenIsolated).toEqual([undefined, undefined]);
  });

  test("event.skip and skipAfter", async () => {
    const calls: string[] = [];
    const p = createNEMO(
      {
        "/api/:path*": [
          (r, e) => {
            if (r.headers.get("x-internal") === "1") e.skip({ skipAfter: true });
          },
          () => {
            calls.push("second");
          },
        ],
      },
      {
        after: () => {
          calls.push("after");
        },
      },
    );
    await p(req("/api/a", { headers: { "x-internal": "1" } }), event);
    expect(calls).toEqual([]);
    await p(req("/api/a"), event);
    expect(calls).toEqual(["second", "after"]);
  });

  test("custom adapter compiles and works", async () => {
    class MapStorageAdapter extends StorageAdapter {
      private store = new Map<string, unknown>();
      get<T>(key: string): T | undefined {
        return this.store.get(key) as T | undefined;
      }
      set<T>(key: string, value: T): void {
        this.store.set(key, value);
      }
      has(key: string): boolean {
        return this.store.has(key);
      }
      delete(key: string): boolean {
        return this.store.delete(key);
      }
      clear(): void {
        this.store.clear();
      }
      entries(): IterableIterator<[string, unknown]> {
        return this.store.entries();
      }
      keys(): IterableIterator<string> {
        return this.store.keys();
      }
      values(): IterableIterator<unknown> {
        return this.store.values();
      }
      get size(): number {
        return this.store.size;
      }
      fromEntries(entries: Iterable<readonly [string, unknown]>): void {
        this.store = new Map(entries);
      }
      toString(): string {
        return JSON.stringify([...this.store.entries()]);
      }
      fromString(json: string): boolean {
        try {
          this.store = new Map(JSON.parse(json) as [string, unknown][]);
          return true;
        } catch {
          return false;
        }
      }
    }
    let value: string | undefined;
    const p = createNEMO(
      {
        "/x": [
          (_r, e) => {
            e.storage.set("a", "b");
          },
          (_r, e) => {
            value = e.storage.get<string>("a");
          },
        ],
      },
      undefined,
      { storage: () => new MapStorageAdapter() },
    );
    await p(req("/x"), event);
    expect(value).toBe("b");
  });

  test("global after can set response headers", async () => {
    const p = createNEMO(
      {},
      {
        after: () =>
          NextResponse.next({ headers: { "x-content-type-options": "nosniff" } }),
      },
    );
    const res = await p(req("/anything"), event);
    expect(res?.headers.get("x-content-type-options")).toBe("nosniff");
  });
});

describe("nemo-debugging examples", () => {
  test("errorHandler turns a throw into a 500", async () => {
    const p = createNEMO(
      {
        "/boom": () => {
          throw new Error("x");
        },
      },
      undefined,
      { errorHandler: () => new Response("fail", { status: 500 }), silent: true },
    );
    const res = await p(req("/boom"), event);
    expect(res?.status).toBe(500);
  });

  test("redirect via Response.redirect stops", async () => {
    const p = createNEMO({
      "/dashboard/:path*": () => Response.redirect("http://localhost/login"),
    });
    const res = await p(req("/dashboard/x"), event);
    expect(res?.status).toBe(302);
    expect(res?.headers.get("location")).toBe("http://localhost/login");
  });
});

describe("matching facts stated in the skills", () => {
  test("nested children match as prefixes", async () => {
    const hits: string[] = [];
    const p = createNEMO({
      "/app": {
        middleware: () => {
          hits.push("app");
        },
        "/settings": () => {
          hits.push("settings");
        },
      },
      "/dashboard": {
        "/users": {
          "/:userId": (_r, e) => {
            hits.push(`user:${String(e.params.userId)}`);
          },
        },
      },
    });
    await p(req("/app/settings/deep"), event);
    await p(req("/dashboard/users/12/edit"), event);
    expect(hits).toEqual(["app", "settings", "user:12"]);
  });

  test("plain paths are case sensitive, patterns are not", async () => {
    const hits: string[] = [];
    const p = createNEMO({
      "/Pricing": () => {
        hits.push("plain");
      },
      "/blog/:path*": () => {
        hits.push("pattern");
      },
    });
    await p(req("/pricing"), event);
    await p(req("/BLOG/x"), event);
    expect(hits).toEqual(["pattern"]);
  });

  test("invalid v8 pattern and (!api) never match", async () => {
    const hits: string[] = [];
    const p = createNEMO({
      "/api{/*path}": () => {
        hits.push("v8");
      },
      "/(!api)/:x": () => {
        hits.push("bang");
      },
    });
    await p(req("/api/x"), event);
    expect(hits).toEqual([]);
  });

  // TODO(after #220 merges): the default storage becomes per request
  // (fix/chain-log-waituntil-storage). Then expect [undefined, undefined]
  // and rename this test. This pins canary behaviour (3.0.2 and older).
  test("default storage is shared between requests (3.0.2 and older)", async () => {
    const seen: Array<string | undefined> = [];
    const p = createNEMO({
      "/x": (_r, e) => {
        seen.push(e.storage.get<string>("k"));
        e.storage.set("k", "v");
      },
    });
    await p(req("/x"), event);
    await p(req("/x"), event);
    expect(seen).toEqual([undefined, "v"]);
  });

  test("event.skip() without skipAfter keeps the after chain", async () => {
    const calls: string[] = [];
    const p = createNEMO(
      {
        "/a": [
          (_r, e) => {
            e.skip();
          },
          () => {
            calls.push("second");
          },
        ],
      },
      {
        after: () => {
          calls.push("after");
        },
      },
    );
    await p(req("/a"), event);
    expect(calls).toEqual(["after"]);
  });

  test("NemoMiddlewareError exposes originalError and metadata", async () => {
    const boom = new Error("boom");
    const p = createNEMO({
      "/e": () => {
        throw boom;
      },
    });
    const original = console.error;
    console.error = () => {};
    let caught: unknown;
    try {
      await p(req("/e"), event);
    } catch (error) {
      caught = error;
    } finally {
      console.error = original;
    }
    expect(caught).toBeInstanceOf(NemoMiddlewareError);
    const err = caught as NemoMiddlewareError;
    expect(err.originalError).toBe(boom);
    expect(err.metadata.routeKey).toBe("/e");
    expect(err.metadata.chain).toBe("main");
  });

  test("response headers from NextResponse.next are also forwarded", async () => {
    const p = createNEMO({
      "/h": () => NextResponse.next({ headers: { "x-frame-options": "DENY" } }),
    });
    const res = await p(req("/h"), event);
    expect(res?.headers.get("x-frame-options")).toBe("DENY");
    expect(res?.headers.get("x-middleware-request-x-frame-options")).toBe("DENY");
  });

  test("cookie set earlier is carried onto a later redirect", async () => {
    const p = createNEMO({
      "/r": [
        () => {
          const response = NextResponse.next();
          response.cookies.set("seen", "1", { path: "/" });
          return response;
        },
        (request) => NextResponse.redirect(new URL("/n", request.url)),
      ],
    });
    const res = await p(req("/r"), event);
    expect(res?.status).toBe(307);
    expect(res?.headers.getSetCookie()).toEqual(["seen=1; Path=/"]);
  });
});

describe("recipes and migration examples", () => {
  test("i18n rewrite in global after", async () => {
    const locales = ["en", "pl"];
    const p = createNEMO(
      {},
      {
        after: (request) => {
          const { pathname } = request.nextUrl;
          const hasLocale = locales.some(
            (l) => pathname === `/${l}` || pathname.startsWith(`/${l}/`),
          );
          if (hasLocale) return;
          const url = request.nextUrl.clone();
          url.pathname = `/en${pathname === "/" ? "" : pathname}`;
          return NextResponse.rewrite(url);
        },
      },
    );
    expect(
      (await p(req("/about"), event))?.headers.get("x-middleware-rewrite"),
    ).toBe("http://localhost/en/about");
    expect(
      (await p(req("/pl/x"), event))?.headers.get("x-middleware-rewrite"),
    ).toBeNull();
  });

  test("migrated single middleware", async () => {
    const middleware = createNEMO(
      {
        "/dashboard/:path*": (request) => {
          if (!request.cookies.has("session")) {
            return NextResponse.redirect(new URL("/login", request.url));
          }
        },
        "/api/:path*": (request) => {
          request.headers.set("x-api", "1");
        },
        "/old": (request) =>
          NextResponse.redirect(new URL("/new", request.url), 308),
      },
      {
        before: (request) => {
          request.headers.set("x-request-id", crypto.randomUUID());
        },
      },
    );
    const dash = await middleware(req("/dashboard"), event);
    expect(dash?.headers.get("location")).toBe("http://localhost/login");
    const old = await middleware(req("/old"), event);
    expect(old?.status).toBe(308);
    const api = await middleware(req("/api/x"), event);
    expect(api?.headers.get("x-middleware-request-x-api")).toBe("1");
    expect(api?.headers.get("x-middleware-request-x-request-id")).toBeTruthy();
  });

  test("rate limit recipe returns 429 after the limit", async () => {
    const hits = new Map<string, { count: number; reset: number }>();
    const p = createNEMO({
      "/api/:path*": (request) => {
        const ip =
          request.headers.get("x-forwarded-for")?.split(",")[0] ?? "unknown";
        const now = Date.now();
        const entry = hits.get(ip);
        if (!entry || entry.reset < now) {
          hits.set(ip, { count: 1, reset: now + 60_000 });
          return;
        }
        entry.count += 1;
        if (entry.count > 2) {
          return NextResponse.json({ error: "Too many requests" }, { status: 429 });
        }
      },
    });
    for (let i = 0; i < 2; i++) await p(req("/api/x"), event);
    expect((await p(req("/api/x"), event))?.status).toBe(429);
  });
});
