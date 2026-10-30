/**
 * Keeps the code examples in /skills (agent skills) honest.
 * Each test mirrors a snippet from a SKILL.md or references/*.md file.
 */
import { describe, expect, test } from "bun:test";
import { NextRequest, NextResponse, type NextFetchEvent } from "next/server";
import {
  NEMO,
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

  test("storage factory isolates requests, default storage is shared", async () => {
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
