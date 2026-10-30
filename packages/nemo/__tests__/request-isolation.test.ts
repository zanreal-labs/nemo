import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { NextFetchEvent } from "next/dist/server/web/spec-extension/fetch-event";
import { NextRequest } from "next/server";
import { NEMO, type NemoEvent } from "../src";
import { MemoryStorageAdapter } from "../src/storage/adapters/memory";

// These tests drive the middleware through a real Next.js NextFetchEvent, the same object
// Next.js passes to middleware.ts / proxy.ts, instead of a hand-made mock.
function realEvent(waitUntil?: (promise: Promise<unknown>) => void) {
  const request = new NextRequest("https://example.com/");
  return new NextFetchEvent({
    request,
    page: "/",
    context: waitUntil ? { waitUntil } : undefined,
  } as never);
}

describe("event.log inside a chain", () => {
  let logSpy: ReturnType<typeof spyOn> | undefined;

  afterEach(() => {
    logSpy?.mockRestore();
  });

  test("prints when the NEMO instance has debug enabled", async () => {
    logSpy = spyOn(console, "log").mockImplementation(() => {});
    const nemo = new NEMO(
      {
        "/": (_req, event) => {
          event.log("from middleware");
        },
      },
      undefined,
      { debug: true },
    );

    await nemo.middleware(new NextRequest("https://example.com/"), realEvent());

    const printed = logSpy.mock.calls.some((call: unknown[]) =>
      call.includes("from middleware"),
    );
    expect(printed).toBe(true);
  });

  test("stays silent when debug is disabled", async () => {
    logSpy = spyOn(console, "log").mockImplementation(() => {});
    const nemo = new NEMO({
      "/": (_req, event) => {
        event.log("from middleware");
      },
    });

    await nemo.middleware(new NextRequest("https://example.com/"), realEvent());

    const printed = logSpy.mock.calls.some((call: unknown[]) =>
      call.includes("from middleware"),
    );
    expect(printed).toBe(false);
  });
});

describe("event.waitUntil inside a chain", () => {
  test("reaches the platform waitUntil passed to Next.js", async () => {
    const platformWaitUntil = mock(() => {});
    const work = Promise.resolve("background");
    const nemo = new NEMO({
      "/": (_req, event) => {
        event.waitUntil(work);
      },
    });

    await nemo.middleware(
      new NextRequest("https://example.com/"),
      realEvent(platformWaitUntil),
    );

    expect(platformWaitUntil).toHaveBeenCalledTimes(1);
    expect(platformWaitUntil).toHaveBeenCalledWith(work);
  });

  test("lands on the original event when Next.js tracks promises itself", async () => {
    // Without a platform waitUntil, Next.js collects promises on the event it created and
    // awaits them after the middleware returns. The promise must end up on that event.
    const event = realEvent();
    const original = spyOn(event, "waitUntil");
    const work = Promise.resolve();
    const nemo = new NEMO({
      "/": (_req, e) => {
        e.waitUntil(work);
      },
    });

    await nemo.middleware(new NextRequest("https://example.com/"), event);

    expect(original).toHaveBeenCalledWith(work);
  });

  test("works in global before/after middleware too", async () => {
    const platformWaitUntil = mock(() => {});
    const nemo = new NEMO(
      { "/": () => {} },
      {
        before: (_req, event) => event.waitUntil(Promise.resolve("before")),
        after: (_req, event) => event.waitUntil(Promise.resolve("after")),
      },
    );

    await nemo.middleware(
      new NextRequest("https://example.com/"),
      realEvent(platformWaitUntil),
    );

    expect(platformWaitUntil).toHaveBeenCalledTimes(2);
  });
});

describe("default storage isolation", () => {
  test("does not carry values from one request into the next", async () => {
    const seen: unknown[] = [];
    const nemo = new NEMO({
      "/": (req, event: NemoEvent) => {
        seen.push(event.storage.get("user"));
        event.storage.set("user", req.headers.get("x-user"));
      },
    });

    await nemo.middleware(
      new NextRequest("https://example.com/", {
        headers: { "x-user": "alice" },
      }),
      realEvent(),
    );
    await nemo.middleware(
      new NextRequest("https://example.com/", { headers: { "x-user": "bob" } }),
      realEvent(),
    );

    expect(seen).toEqual([undefined, undefined]);
  });

  test("keeps concurrent requests apart", async () => {
    const results: Record<string, unknown> = {};
    const nemo = new NEMO({
      "/": [
        async (req, event: NemoEvent) => {
          event.storage.set("user", req.headers.get("x-user"));
          // Yield so the other request runs its first middleware in between.
          await new Promise((resolve) => setTimeout(resolve, 5));
        },
        (req, event: NemoEvent) => {
          results[req.headers.get("x-user") as string] =
            event.storage.get("user");
        },
      ],
    });

    await Promise.all([
      nemo.middleware(
        new NextRequest("https://example.com/", {
          headers: { "x-user": "alice" },
        }),
        realEvent(),
      ),
      nemo.middleware(
        new NextRequest("https://example.com/", {
          headers: { "x-user": "bob" },
        }),
        realEvent(),
      ),
    ]);

    expect(results).toEqual({ alice: "alice", bob: "bob" });
  });

  test("still shares storage within one request", async () => {
    let read: unknown;
    const nemo = new NEMO(
      {
        "/": (_req, event: NemoEvent) => {
          read = event.storage.get("fromBefore");
        },
      },
      {
        before: (_req, event) => {
          event.storage.set("fromBefore", 42);
        },
      },
    );

    await nemo.middleware(new NextRequest("https://example.com/"), realEvent());

    expect(read).toBe(42);
  });

  test("a storage factory is called once per request", async () => {
    const factory = mock(() => new MemoryStorageAdapter());
    const nemo = new NEMO({ "/": () => {} }, undefined, { storage: factory });

    await nemo.middleware(new NextRequest("https://example.com/"), realEvent());
    await nemo.middleware(new NextRequest("https://example.com/"), realEvent());

    expect(factory).toHaveBeenCalledTimes(2);
  });
});
