# Matching reference (@zanreal/nemo 3.0.0)

## Which kind of key matches what

| Config value | Matches |
| --- | --- |
| `"/foo": fn` or `[fn, fn]` at top level | exactly `/foo` (and not `/foo/bar`) |
| `"/foo": { middleware, "/bar": fn }` | `/foo` and everything under it for `middleware`; `/foo/bar` for the child |
| `"/foo/:path*": fn` | `/foo`, `/foo/a`, `/foo/a/b` |
| `"/foo/:id": fn` | `/foo/123` only (one segment), not `/foo` and not `/foo/1/2` |
| `"/": fn` | exactly `/` |

Nested children are joined to the parent: `"/dashboard": { "/users": { "/:userId": fn } }` matches `/dashboard/users/123`, and the whole chain `dashboard -> users -> :userId` runs in that order (parents first).

Tip: when a nested parent has no function of its own, use an object without `middleware`:

```ts
"/api": {
  "/v1": { middleware: fn },
  "/v2": fn,
}
```

## Pattern syntax

Patterns with `:`, `*` or `(` go through path-to-regexp v6.3 (case insensitive, non-strict, trailing slash optional). Plain paths are compared directly.

Valid v6 forms:

- `/:id` named segment
- `/:path*` zero or more segments, `/:path+` one or more, `/:id?` optional
- `/:locale(en|pl)` constrained segment
- `/:section((?!api)[^/]+)` negative lookahead: any single segment except one starting with `api`
- `/(.*)` anything

Do NOT write (they fail or silently never match):

- `/api{/*path}`: v8 syntax. In v6 the pattern fails to parse, NEMO logs it and the route never matches. No error is thrown.
- `/(!api)/...` as an exclude: in v6 it matches the literal text `!api`.
- Regex flags or full regexes as keys.

An invalid pattern is swallowed. If a route "never runs", test the pattern with `path-to-regexp@6` in isolation or log with `debug: true`.

## Params

`event.params` holds the params of the CURRENT route key, including params from parent keys:

```ts
"/org/:orgId": {
  "/project/:projectId": (request, event) => {
    const { orgId, projectId } = event.params; // strings, or string[] for :x* and :x+
  },
}
```

`request.params` does not exist. Do not use it.

## Matcher vs NEMO routes

`export const config = { matcher }` decides whether Next.js calls your proxy at all. NEMO routes decide which functions run after that. If a path is excluded in the matcher, no NEMO route can ever see it.

Recommended matcher that skips Next internals and files with an extension:

```ts
export const config = {
  matcher: ["/((?!_next/|_static|_vercel|[\\w-]+\\.\\w+).*)"],
};
```

The matcher must be a static literal. It cannot be built from variables.

## Order of execution

1. `globalMiddleware.before`
2. matched routes: prefix (nested parent) matches before exact matches, longer patterns first, each route's array in order
3. `globalMiddleware.after`

A stop (redirect, rewrite, JSON, plain `Response`) ends everything, including `after`.
