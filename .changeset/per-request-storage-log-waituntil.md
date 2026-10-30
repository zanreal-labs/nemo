---
"@zanreal/nemo": patch
---

Fix three bugs in how the middleware chain sets up `NemoEvent`. One of them is a security fix.

**Security: default storage is now per request.** When no `storage` option was given, NEMO
created one `MemoryStorageAdapter` in the constructor and handed that same instance to every
request. Because `createNEMO()` runs once at module load, the store lived as long as the
server process (or edge isolate) and was shared by all requests it handled, including
concurrent ones. A value written with `event.storage.set()` while handling one request, such
as a user id or session data, could be read by a later or parallel request for a different
user. The default storage is now created fresh for every request. Within a request, sharing
between global `before`, route and global `after` middleware works as before.

If your code relied on default storage values surviving between requests, keep that data in
your own store instead. A custom adapter passed as an instance (`storage: new Adapter()`) is
still reused across requests by design; pass a factory (`storage: () => new Adapter()`) to get
per-request isolation.

**`event.waitUntil()` now reaches the platform.** The event handed to middleware was rebuilt
from a `_raw` property that Next.js's `NextFetchEvent` does not have, so the platform
`waitUntil` was dropped and promises were collected on an internal list nobody awaited.
Background work registered in middleware could be cut off when the response was sent. NEMO
now forwards `waitUntil` to the original Next.js event, which hands it to the platform or
tracks it where Next.js awaits it.

**`event.log()` now prints when `debug: true`.** The `debug` option was not passed to the
event created for each request, so `event.log()` inside middleware never printed anything.
`event.error()` and `event.warn()` were unaffected.

`@rescale/nemo` re-exports `@zanreal/nemo` and gets the same fixes.
