# From @rescale/nemo to @zanreal/nemo

`@rescale/nemo` was renamed to `@zanreal/nemo` at 3.0.0. Exports and signatures are identical. `@rescale/nemo@3` still exists as a deprecated alias that re-exports `@zanreal/nemo`, so nothing breaks immediately, but it receives no updates. A `^2` range does not resolve to that alias.

Still on `@rescale/nemo` 1.x? The 1.x API differs. Upgrade to the 2.x API first (see the v1.4 docs at zanreal.com/docs/oss/nemo/v1), then run the codemod.

## Codemod

```bash
npx @zanreal/nemo-codemod [paths...] [options]
```

| Option | Meaning |
| --- | --- |
| `--dry` | report changes, write nothing |
| `--print` | print the transformed source of each changed file |
| `--dep-range <range>` | range written to `package.json` (default `^3.0.0`) |
| `--extensions <list>` | comma separated, default `js,jsx,ts,tsx,mjs,cjs,mts,cts` |
| `--ignore-pattern <glob>` | skip files, repeatable |
| `--skip-manifests` | leave `package.json` files alone |

Recommended sequence:

1. Commit or stash current work.
2. `npx @zanreal/nemo-codemod --dry --print` and read the output.
3. `npx @zanreal/nemo-codemod` (pass a path such as `src` to limit scope; in a monorepo run it at the root).
4. Reinstall: `npm install`, `pnpm install`, `yarn` or `bun install`. Lockfiles are not edited by the codemod.
5. Run type check, tests and a build.

What it rewrites: `import`/`export ... from`, `require`, dynamic `import()`, `jest.mock` / `vi.mock` specifiers, `declare module`, subpaths of the package, and the dependency name in `package.json` (dependencies, devDependencies, peerDependencies, optionalDependencies). It leaves comments and plain strings alone. If a source transform fails, it stops before it touches any manifest.

## Manual steps (if you prefer)

```bash
npm uninstall @rescale/nemo && npm install @zanreal/nemo
```

Then replace every `@rescale/nemo` with `@zanreal/nemo` in imports, mocks and type declarations:

```ts
// before
import { createNEMO } from "@rescale/nemo";
// after
import { createNEMO } from "@zanreal/nemo";
```

## Also check after migrating

- Remove `createMiddleware` usage, it only logs a deprecation warning. `createNEMO` takes the same arguments.
- Search CI config, Dockerfiles and docs for the old name.
- If the project had `@rescale/nemo` in `transpilePackages` or `serverExternalPackages`, rename it.
