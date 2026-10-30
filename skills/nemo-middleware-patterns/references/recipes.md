# Recipes

All recipes assume `proxy.ts` (Next.js 16+). For older Next.js export `middleware` instead. Each is a complete file unless noted.

## Auth gate with public paths

```ts
import { createNEMO } from "@zanreal/nemo";
import { NextResponse } from "next/server";

export const proxy = createNEMO({
  "/account/:path*": (request) => {
    if (!request.cookies.has("session")) {
      const url = new URL("/login", request.url);
      url.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
      return NextResponse.redirect(url);
    }
  },
  "/login": (request) => {
    if (request.cookies.has("session")) {
      return NextResponse.redirect(new URL("/account", request.url));
    }
  },
});

export const config = {
  matcher: ["/((?!_next/|_static|_vercel|api/|[\\w-]+\\.\\w+).*)"],
};
```

Cookie presence is an optimistic check. Verify the session on the server (route handler, server component, data layer) as well.

## Role check after authentication

Authentication in an earlier middleware, role in a nested one:

```ts
import { createNEMO } from "@zanreal/nemo";
import { NextResponse } from "next/server";

export const proxy = createNEMO({
  "/admin": {
    middleware: (request) => {
      if (!request.cookies.has("session")) {
        return NextResponse.redirect(new URL("/login", request.url));
      }
    },
    "/billing/:path*": (request) => {
      if (request.cookies.get("role")?.value !== "owner") {
        return new Response("Forbidden", { status: 403 });
      }
    },
  },
});
```

## i18n rewrite (default locale without prefix)

```ts
import { createNEMO } from "@zanreal/nemo";
import { NextResponse } from "next/server";

const locales = ["en", "pl"];

export const proxy = createNEMO(
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
```

Putting the rewrite in `after` lets every route middleware run first. If you use `next-intl`, call its middleware inside one NEMO function and return its response:

```ts
import createIntlMiddleware from "next-intl/middleware";
import { createNEMO } from "@zanreal/nemo";
import { routing } from "./i18n/routing";

const intl = createIntlMiddleware(routing);

export const proxy = createNEMO({
  "/:path*": (request) => intl(request),
});
```

`intl(request)` returns a response that is a rewrite or redirect when it has something to do, and the chain stops there.

## Supabase session refresh as `before`

`updateSession` is the helper from the Supabase Next.js guide (your own file). It refreshes the auth cookies and returns a `NextResponse` that carries them.

```ts
import { createNEMO } from "@zanreal/nemo";
import { updateSession } from "./lib/supabase/middleware";

export const proxy = createNEMO(
  {
    "/dashboard/:path*": (request) => {
      request.headers.set("x-area", "dashboard");
    },
  },
  {
    before: (request) => updateSession(request),
  },
);
```

A `NextResponse.next(...)` returned from `before` continues the chain and its cookies are kept. If `updateSession` returns a redirect (for example to `/login`), the chain stops, which is the intended behavior for unauthenticated users.

## Other auth libraries

Any helper that takes a `NextRequest` and returns a `NextResponse` or `Response` can be called inside a NEMO function and its result returned. Follow the continue-or-stop table: a redirect or a plain `Response` stops the chain, `NextResponse.next()` continues. Do not call helpers that need `next/headers` inside the proxy unless the library documents proxy support.

## Simple rate limit (in-memory, per instance)

Good enough for a demo or a single instance. Use a shared store (Upstash, KV) for production and do the lookup inside the middleware.

```ts
import { createNEMO } from "@zanreal/nemo";
import { NextResponse } from "next/server";

const hits = new Map<string, { count: number; reset: number }>();

export const proxy = createNEMO({
  "/api/:path*": (request) => {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0] ?? "unknown";
    const now = Date.now();
    const entry = hits.get(ip);
    if (!entry || entry.reset < now) {
      hits.set(ip, { count: 1, reset: now + 60_000 });
      return;
    }
    entry.count += 1;
    if (entry.count > 100) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }
  },
});
```

The `Map` is module scope on purpose here, it is not NEMO storage.

## Request logging with `after()`

```ts
import { createNEMO } from "@zanreal/nemo";
import { after } from "next/server";

export const proxy = createNEMO(
  {},
  {
    before: (request) => {
      const started = Date.now();
      after(() => {
        console.log(request.method, request.nextUrl.pathname, `${Date.now() - started}ms`);
      });
    },
  },
);
```

## Security headers on every response

```ts
import { createNEMO } from "@zanreal/nemo";
import { NextResponse } from "next/server";

export const proxy = createNEMO(
  {},
  {
    after: () =>
      NextResponse.next({
        headers: {
          "x-content-type-options": "nosniff",
          "referrer-policy": "strict-origin-when-cross-origin",
        },
      }),
  },
);
```
