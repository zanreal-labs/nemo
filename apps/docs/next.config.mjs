// Redirect-only shell.
//
// The documentation moved to the repository root (`docs/`) and is published at
// https://zanreal.com/docs/oss/nemo, which the marketing site builds from that
// directory - the same arrangement as every other ZanReal OSS package.
//
// Nothing here renders documentation any more. This app exists solely to serve
// the redirect table below, so that every URL this host ever published keeps
// resolving. Some of them are baked into immutable npm metadata and can never
// be allowed to 404.
const DOCS = "https://zanreal.com/docs/oss/nemo";

// Top-level pages of the current major (`docs/latest/*.mdx` at the repository
// root). Listed rather than read from disk because this app is built from
// `apps/docs` and must not depend on files outside it.
const LATEST_PAGES = [
  "advanced-matching",
  "best-practices",
  "configuration",
  "context",
  "functions",
  "matcher",
  "migration",
  "nesting",
  "stewardship",
];

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Every rule below is `permanent`, which Next.js serves as a 308. Search
  // engines consolidate a 308 exactly as they do a 301, and nothing here is
  // temporary: these paths are never coming back to this host.
  //
  // Two properties matter more than the individual rules:
  //
  //   1. Path for path. `/docs/2.0/functions` goes to the new v2 functions
  //      page, not to the docs root. Collapsing a version tree onto one page
  //      throws away the link equity every one of those URLs accumulated, and
  //      Google reads a redirect to an unrelated page as a soft 404 - it drops
  //      the target rather than transferring anything to it.
  //
  //   2. One hop. The rules map the ORIGINAL paths straight to their FINAL
  //      destination rather than chaining `/docs/2.0/x` -> `/docs/v2/x` ->
  //      `zanreal.com/...`. The version folders were renamed as part of the
  //      same move, so a chain was the tempting shape; consolidation is
  //      strongest across a single hop, and each extra hop is another chance
  //      for a crawler to give up before the end.
  //
  // Order is significant: Next.js takes the first match, so the exact paths
  // come before the `:path*` catch-alls.
  redirects: () => {
    return [
      // The old docs root.
      { source: "/", destination: DOCS, permanent: true },
      { source: "/docs", destination: DOCS, permanent: true },

      // MUST come before the generic /docs/2.0/:path* rule below. The
      // stewardship page did not just move host, it changed major: it now
      // belongs to the current major only, so the generic rule would send it
      // to a v2 page that no longer exists. This URL is linked from the
      // published README of @zanreal/nemo, so it has to land on real content.
      {
        source: "/docs/2.0/stewardship",
        destination: `${DOCS}/latest/stewardship`,
        permanent: true,
      },

      // Bare version roots, ahead of the catch-alls so the destination has no
      // trailing empty segment.
      { source: "/docs/2.0", destination: `${DOCS}/v2`, permanent: true },
      { source: "/docs/1.4", destination: `${DOCS}/v1`, permanent: true },

      // The version trees, path for path.
      //
      // /docs/2.0/migration is the one URL in here that can NEVER 404: it is
      // baked into the npm deprecation metadata of @rescale/nemo, which npm
      // serves for the already-published versions and which cannot be edited.
      // Every install of the alias prints it. It is covered by this rule
      // rather than by a rule of its own because the page did not change
      // major - it is still the v2 migration guide - but it is the reason this
      // rule exists at all, and it must survive any future edit to this list.
      { source: "/docs/2.0/:path*", destination: `${DOCS}/v2/:path*`, permanent: true },
      { source: "/docs/1.4/:path*", destination: `${DOCS}/v1/:path*`, permanent: true },

      // Unversioned pages. Before the 2.0 folder existed, the then-current docs
      // were published straight under /docs (the Wayback Machine has
      // /docs/functions, /docs/configuration, /docs/context and
      // /docs/conventions/*). Those pages are the current major's now, and on
      // zanreal.com the current major lives under /latest, so the generic rule
      // below used to send them to /docs/oss/nemo/functions, which is a 404.
      {
        source: `/docs/:page(${LATEST_PAGES.join("|")})`,
        destination: `${DOCS}/latest/:page`,
        permanent: true,
      },
      { source: "/docs/:section(conventions|3rd-parties)/:path*", destination: `${DOCS}/latest/:section/:path*`, permanent: true },

      // The folder names zanreal.com uses, in case a link was rewritten by hand.
      { source: "/docs/:version(latest|v2|v1)/:path*", destination: `${DOCS}/:version/:path*`, permanent: true },

      // Anything else under /docs goes to the docs root. Appending the path
      // here used to produce a 404 on zanreal.com for every URL that is not a
      // real page there (e.g. /docs/getting-started); the root is the nearest
      // page that exists. It also keeps any /docs path on this host from
      // quietly serving content again alongside the copy on zanreal.com.
      { source: "/docs/:path*", destination: DOCS, permanent: true },
    ];
  },
};

export default config;
