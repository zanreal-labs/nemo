# Responses, headers and cookies

## Forwarding headers

Any of these makes a header visible to later middleware in the same chain:

```ts
request.headers.set("x-tenant", "acme");                       // direct
return NextResponse.next({ request: { headers: new Headers(request.headers) } }); // via response
```

At the end of the chain NEMO compares the request headers with the initial ones and builds `NextResponse.next({ headers, request: { headers } })` from the difference. So changed headers reach:

- later middleware,
- server components and route handlers via `headers()` from `next/headers`,
- the browser, as response headers.

Do not put secrets in forwarded headers if the value must not reach the browser.

In tests the forwarded form is the response header `x-middleware-request-<name>`.

## Response headers only

```ts
return NextResponse.next({ headers: { "x-frame-options": "DENY" } });
```

Continuing responses are merged: headers from several middlewares accumulate, the last write to the same name wins.

## Cookies

Read: `request.cookies.get("name")?.value`, `request.cookies.has("name")`.

Set on a continuing response:

```ts
const response = NextResponse.next();
response.cookies.set("seen", "1", { path: "/", httpOnly: true });
return response;
```

Cookies set by earlier middleware are carried onto a later redirect or rewrite, so "set cookie then redirect" across two middlewares works.

## Redirect and rewrite

```ts
return NextResponse.redirect(new URL("/login", request.url));         // stops, 307
return NextResponse.redirect(new URL("/new", request.url), 308);      // permanent
const url = request.nextUrl.clone();
url.pathname = `/en${url.pathname}`;
return NextResponse.rewrite(url);                                      // stops, URL unchanged in the browser
```

Absolute URLs only. `NextResponse.redirect("/login")` throws in the Next.js runtime.

## Blocking

```ts
return new Response("Forbidden", { status: 403 });
return NextResponse.json({ error: "Too many requests" }, { status: 429 });
```

Never `new NextResponse("...", { status })` for blocking: NEMO treats it as a continuing response.

## Rewrites that need to keep running other middleware

A rewrite stops the chain. If you need to rewrite AFTER other logic (for example locale rewrite after auth), order it last in the array or put it in global `after`.
