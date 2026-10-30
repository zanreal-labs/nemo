# Next.js 16: middleware.ts becomes proxy.ts

Next.js 16 renamed the Middleware convention to Proxy.

| | Next.js 15 and older | Next.js 16+ |
| --- | --- | --- |
| File | `middleware.ts` | `proxy.ts` |
| Export | `export const middleware` | `export const proxy` |
| `config.matcher` | same | same |

NEMO works with both. Only the file and export name change:

```ts
// proxy.ts
import { createNEMO } from "@zanreal/nemo";

export const proxy = createNEMO({
  "/dashboard/:path*": (request) => {
    request.headers.set("x-area", "dashboard");
  },
});

export const config = {
  matcher: ["/((?!_next/|_static|_vercel|[\\w-]+\\.\\w+).*)"],
};
```

Steps:

1. `git mv middleware.ts proxy.ts` (or `src/middleware.ts` to `src/proxy.ts`).
2. Rename the export to `proxy`. A default export also works, but keep one convention in the project.
3. Do not keep both files. Next.js 16 may still honor `middleware.ts` with a deprecation warning, but two entries lead to confusion.
4. Update tests and docs that import the old file name.
5. The Next.js team provides `npx @next/codemod@canary middleware-to-proxy .` for the rename of non-NEMO code. For NEMO projects the manual rename above is enough.
