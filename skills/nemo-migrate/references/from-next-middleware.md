# From a single Next.js middleware to NEMO

## Before

```ts
// middleware.ts
import { NextResponse, type NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  request.headers.set("x-request-id", crypto.randomUUID());

  if (pathname.startsWith("/dashboard")) {
    if (!request.cookies.has("session")) {
      return NextResponse.redirect(new URL("/login", request.url));
    }
  }

  if (pathname.startsWith("/api")) {
    request.headers.set("x-api", "1");
  }

  if (pathname === "/old") {
    return NextResponse.redirect(new URL("/new", request.url), 308);
  }

  return NextResponse.next({ request: { headers: request.headers } });
}

export const config = {
  matcher: ["/((?!_next/|_static|_vercel|[\\w-]+\\.\\w+).*)"],
};
```

## After

```ts
// middleware.ts (Next.js 16: proxy.ts and `export const proxy`)
import { createNEMO } from "@zanreal/nemo";
import { NextResponse } from "next/server";

export const middleware = createNEMO(
  {
    "/dashboard/:path*": (request) => {
      if (!request.cookies.has("session")) {
        return NextResponse.redirect(new URL("/login", request.url));
      }
    },
    "/api/:path*": (request) => {
      request.headers.set("x-api", "1");
    },
    "/old": (request) => NextResponse.redirect(new URL("/new", request.url), 308),
  },
  {
    before: (request) => {
      request.headers.set("x-request-id", crypto.randomUUID());
    },
  },
);

export const config = {
  matcher: ["/((?!_next/|_static|_vercel|[\\w-]+\\.\\w+).*)"],
};
```

## Mapping table

| Old code | NEMO |
| --- | --- |
| `pathname === "/x"` | top-level `"/x": fn` (exact). Nested keys are prefix matches, so an exact check under a nested key needs `request.nextUrl.pathname === ...` inside |
| `pathname.startsWith("/x")` | `"/x/:path*": fn` (also matches `/x`), or a nested object |
| `pathname.startsWith("/x/y")` inside the `/x` branch | nested key `"/y"` under `"/x"` |
| regex on pathname | pattern with `(regex)`, see `nemo-middleware-patterns/references/matching.md` |
| code before all branches | `globalMiddleware.before` |
| code after all branches | `globalMiddleware.after` |
| `return NextResponse.next()` at the end | not needed, NEMO builds the final response |
| `return NextResponse.next({ request: { headers } })` | set `request.headers` directly, NEMO forwards the diff |
| `matchPath(...)` helpers | patterns with params, `event.params` |

## Ordering and early returns

The old function ran top to bottom with early returns. In NEMO the order is `before`, then matched routes (parents first), then `after`. Make sure a guard that used to run first still sits in `before` or in an earlier/parent route. A guard that returns a redirect or plain `Response` stops everything that would have run later, exactly like the early `return`.

## Matcher

Keep the matcher at first. After migrating you can narrow it so Next.js does not invoke the proxy for paths no NEMO route cares about, but only after tests prove behavior. The matcher must stay a static literal.

## Verify

Request the same list of URLs against old and new code (redirect targets, status, forwarded headers). Use the test template in `nemo-debugging/references/testing.md`.
