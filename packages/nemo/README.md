# @zanreal/nemo

A middleware composition library for Next.js applications that allows you to organize and chain middleware functions based on URL patterns.

> **Next.js 16+ Compatibility:** This library is fully compatible with Next.js 16+ where `middleware.ts` has been renamed to `proxy.ts`. Use `export const proxy = createNEMO(...)` for Next.js 16+ and `export const middleware = createNEMO(...)` for Next.js <16.

> [!IMPORTANT]
> **This package moved from `@rescale/nemo` to `@zanreal/nemo` in v3.0.0.**
> The API is unchanged - only the package name is different. `@rescale/nemo` is now a
> deprecated alias that re-exports this package, so existing installs keep working, but it
> will stop receiving updates. Migrate with `npx @zanreal/nemo-codemod`, or read the
> [migration guide](https://zanreal.com/docs/oss/nemo/latest/migration).

[![codecov](https://codecov.io/gh/z4nr34l/nemo/graph/badge.svg?token=10CXWSP5BA)](https://codecov.io/gh/z4nr34l/nemo)
[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=zanreal-labs_nemo&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=zanreal-labs_nemo)

## Maintained by

<a href="https://zanreal.com">
  <img alt="ZanReal" src="https://cdn.zanreal.com/public/logo.svg" height="32" />
</a>

NEMO is maintained by [ZanReal](https://zanreal.com) as part of its [OSS Program](https://zanreal.com/oss) - see
[project stewardship](https://zanreal.com/docs/oss/nemo/latest/stewardship) for what that means.

## Installation

```bash
npm install @zanreal/nemo
```

```bash
pnpm add @zanreal/nemo
```

```bash
bun add @zanreal/nemo
```

## Agent skills

NEMO ships agent skills (the open [Agent Skills](https://agentskills.io) format) so coding agents such as Claude Code, Cursor, Codex and Copilot use the library correctly: right file name for your Next.js version, correct matching rules, and the pitfalls that docs and blog posts often get wrong.

| Skill | Use it for |
| --- | --- |
| `nemo-setup` | Install NEMO, create `proxy.ts` / `middleware.ts`, matcher, first routes |
| `nemo-middleware-patterns` | Chains, nesting, params, storage, redirects, rewrites, headers, auth, i18n |
| `nemo-migrate` | Move from a single middleware, from `@rescale/nemo` (codemod), or to Next.js 16 `proxy.ts` |
| `nemo-debugging` | Find out why a middleware does not run, and write tests for it |

Install all of them into your project with the [skills CLI](https://skills.sh):

```bash
npx skills add zanreal-labs/nemo
```

List first, or pick one skill and one agent:

```bash
npx skills add zanreal-labs/nemo --list
npx skills add zanreal-labs/nemo --skill nemo-setup -a claude-code
```

Claude Code plugin marketplace:

```bash
claude plugin marketplace add zanreal-labs/nemo
claude plugin install nemo@zanreal-nemo
```

The skills live in [`skills/`](https://github.com/zanreal-labs/nemo/tree/canary/skills) and describe the current major version (`@zanreal/nemo@3`). More in the [agent skills docs](https://github.com/zanreal-labs/nemo/blob/canary/docs/latest/agent-skills.mdx).

## Key Features

- Path-based middleware routing
- Global middleware support (before/after)
- Context sharing between middleware via shared storage
- Support for Next.js native middleware patterns
- Request/Response header and cookie forwarding
- Middleware nesting and composition
- Built-in logging system accessible in all middleware functions

## Middleware Composition

> **Note:** In Next.js 16+, use `proxy.ts` and export `proxy`. For Next.js <16, use `middleware.ts` and export `middleware`.

This example shows all possible options of NEMO usage and middlewares compositions, including nested routes:

```typescript
import { createNEMO } from '@zanreal/nemo';

// Next.js 16+: export const proxy = createNEMO(...)
// Next.js <16: export const middleware = createNEMO(...)
export const proxy = createNEMO({
  // Simple route with middleware chain
  '/api': [
    // First middleware in the chain
    async (request, { storage }) => {
      storage.set('timestamp', Date.now());
      // Continues to the next middleware
    },
    // Second middleware accesses shared storage
    async (request, { storage }) => {
      const timestamp = storage.get('timestamp');
      console.log(`Request started at: ${timestamp}`);
    }
  ],
  
  // Nested routes using object notation
  '/dashboard': {
    // This middleware runs on /dashboard
    middleware: async (request) => {
      console.log('Dashboard root');
    },
    
    // Nested route with parameter
    '/:teamId': {
      // This middleware runs on /dashboard/:teamId
      middleware: async (request, { params }) => {
        console.log(`Team dashboard: ${params.teamId}`);
      },
      
      // Further nesting with additional parameter
      '/users/:userId': async (request, { params }) => {
        console.log(`Team user: ${params.teamId}, User: ${params.userId}`);
      }
    },
    
    // Another nested route under /dashboard
    '/settings': async (request) => {
      console.log('Dashboard settings');
    }
  },
  
  // Pattern matching multiple routes
  '/(auth|login)': async (request) => {
    console.log('Auth page');
  }
});
```

Each middleware in a chain is executed in sequence until one returns a response or all are completed. Nested routes allow you to organize your middleware hierarchically, matching more specific paths while maintaining a clean structure.

### Nested Routes Execution Order

When a request matches a nested route, NEMO executes middleware in this order:

1. Global `before` middleware (if defined)
2. Root path middleware (`/`) for all non-root requests
3. Parent middleware (using the `middleware` property)
4. Child middleware
5. Global `after` middleware (if defined)

If any middleware returns a response (like a redirect), the chain stops and that response is returned immediately.

## API Reference

### Types

#### `NextMiddleware`

```typescript
type NextMiddleware = (
  request: NextRequest,
  event: NemoEvent
) => NextMiddlewareResult | Promise<NextMiddlewareResult>;
```

The standard middleware function signature used in NEMO, compatible with Next.js native middleware.

#### `MiddlewareConfig`

```typescript
type MiddlewareConfig = Record<string, MiddlewareConfigValue>;
```

A configuration object that maps route patterns to middleware functions or arrays of middleware functions. Compatible with both `middleware.ts` (Next.js <16) and `proxy.ts` (Next.js 16+) naming conventions.

#### `GlobalMiddlewareConfig`

```typescript
type GlobalMiddlewareConfig = Partial<
  Record<"before" | "after", NextMiddleware | NextMiddleware[]>
>;
```

Configuration for global middleware that runs before or after route-specific middleware.

### Main Functions

#### `createNEMO`

```typescript
function createNEMO(
  middlewares: MiddlewareConfig,
  globalMiddleware?: GlobalMiddlewareConfig,
  config?: NemoConfig
): NextMiddleware
```

> **Note:** The return type is compatible with both Next.js <16 `NextMiddleware` and Next.js 16+ `NextProxy` types, as they share the same function signature.

Creates a composed middleware function with enhanced features:

- Executes middleware in order (global before → path-matched middleware → global after)
- Provides shared storage context between middleware functions
- Handles errors with custom error handlers
- Supports custom storage adapters

#### `NemoConfig` options

```typescript
interface NemoConfig {
  debug?: boolean;
  silent?: boolean;
  errorHandler?: ErrorHandler;
  enableTiming?: boolean;
  storage?: StorageAdapter | (() => StorageAdapter);
}
```

## Matchers

To make it easier to understand, you can check the below examples:

### Simple route

Matches `/dashboard` route exactly.

```plaintext title="Simple route"
/dashboard
```

### Params

Path parameters allow you to capture parts of the URL path. The general pattern is `:paramName` where `paramName` is the name of the parameter that will be available in the middleware function's `event.params` object.

#### Named parameters

Named parameters are defined by prefixing a colon to the parameter name (:paramName).

```plaintext title="Named parameter"
/dashboard/:team
```

This matches `/dashboard/team1` and provides `team` param with value `team1`.

You can also place parameters in the middle of a path pattern:

```plaintext title="Parameter in the middle"
/team/:teamId/dashboard
```

This matches `/team/123/dashboard` and provides `teamId` param with value `123`.

#### Multiple parameters

You can include multiple parameters in a single pattern:

```plaintext title="Multiple parameters"
/users/:userId/posts/:postId
```

This matches `/users/123/posts/456` and provides parameters `userId: "123", postId: "456"`.

#### Custom matching parameters

Parameters can have a custom regexp pattern in parentheses, which overrides the default match:

```plaintext title="Custom parameter matching"
/icon-:size(\\d+).png
```

This matches `/icon-123.png` but not `/icon-abc.png` and provides `size` param with value `123`.

#### Optional parameters

Parameters can be suffixed with a question mark (`?`) to make them optional:

```plaintext title="Optional parameter"
/users/:userId?
```

This matches both `/users` and `/users/123`.

#### Custom prefix and suffix

Parameters can be wrapped in curly braces `{}` to create custom prefixes or suffixes:

```plaintext title="Custom prefix/suffix"
/product{-:version}?
```

This matches both `/product` and `/product-v1` and provides `version` param with value `v1` when present.

#### Zero or more segments

Parameters can be suffixed with an asterisk (`*`) to match zero or more segments:

```plaintext title="Zero or more segments"
/files/:path*
```

This matches `/files`, `/files/documents`, `/files/documents/work`, etc.

#### One or more segments

Parameters can be suffixed with a plus sign (`+`) to match one or more segments:

```plaintext title="One or more segments"
/files/:path+
```

This matches `/files/documents`, `/files/documents/work`, etc., but not `/files`.

#### OR patterns

You can match multiple pattern alternatives by using parentheses and the pipe character:

```plaintext title="OR pattern"
/(auth|login)
```

This matches both `/auth` and `/login`.

#### Unicode support

The matcher fully supports Unicode characters in both patterns and paths:

```plaintext title="Unicode support"
/café/:item
```

This matches `/café/croissant` and provides `item` param with value `croissant`.

### Parameter Constraints

You can constrain route parameters to match only specific values or exclude certain values:

```typescript
// Match only if :lang is either 'en' or 'cn'
const nemo = new NEMO({
  "/:lang(en|cn)/settings": [
    // This middleware only runs for /en/settings or /cn/settings
    (req) => {
      const { lang } = req.params;
      // lang will be either 'en' or 'cn'
      return NextResponse.next();
    },
  ],
});

// Exclude specific values from matching
const nemo = new NEMO({
  "/:path(!api)/:subpath": [
    // This middleware runs for any /:path/:subpath EXCEPT when path is 'api'
    // e.g., /docs/intro will match, but /api/users will not
    (req) => {
      const { path, subpath } = req.params;
      return NextResponse.next();
    },
  ],
});
```

## Usage Examples

### Basic Path-Based Middleware

> **Note:** In Next.js 16+, the file should be named `proxy.ts` instead of `middleware.ts`, and you should export `proxy` instead of `middleware`. For Next.js <16, use `middleware.ts` and export `middleware`.

```typescript
import { createNEMO } from '@zanreal/nemo';

// Next.js 16+: export const proxy = createNEMO(...)
// Next.js <16: export const middleware = createNEMO(...)
export const proxy = createNEMO({
  // Simple route
  '/api': async (request) => {
    // Handle API routes
  },
  
  // With parameter
  '/users/:userId': async (request, event) => {
    // Access parameter
    console.log(`User ID: ${event.params.userId}`);
  },
  
  // Optional pattern with custom prefix
  '/product{-:version}?': async (request, event) => {
    // event.params.version will be undefined for '/product'
    // or the version value for '/product-v1'
    console.log(`Version: ${event.params.version || 'latest'}`);
  },
  
  // Pattern with custom matching
  '/files/:filename(.*\\.pdf)': async (request, event) => {
    // Only matches PDF files
    console.log(`Processing PDF: ${event.params.filename}`);
  }
});
```

### Using Global Middleware

```typescript
import { createNEMO } from '@zanreal/nemo';

// Next.js 16+: export const proxy = createNEMO(...)
// Next.js <16: export const middleware = createNEMO(...)
export const proxy = createNEMO({
  '/api{/*path}': apiMiddleware,
},
{
  before: [loggerMiddleware, authMiddleware],
  after: cleanupMiddleware,
});
```

### Storage API

The Storage API allows you to share data between middleware executions:

```typescript
import { createNEMO } from '@zanreal/nemo';

// Next.js 16+: export const proxy = createNEMO(...)
// Next.js <16: export const middleware = createNEMO(...)
export const proxy = createNEMO({
  '/': [
    async (req, { storage }) => {
      // Set values
      storage.set('counter', 1);
      storage.set('items', ['a', 'b']);
      storage.set('user', { id: 1, name: 'John' });
      
      // Check if key exists
      if (storage.has('counter')) {
        // Get values (with type safety)
        const count = storage.get<number>('counter');
        const items = storage.get<string[]>('items');
        const user = storage.get<{id: number, name: string}>('user');
        
        // Delete a key
        storage.delete('counter');
      }
    }
  ]
});
```

### URL Parameters

Access URL parameters through the event's params property:

```typescript
import { createNEMO } from '@zanreal/nemo';

// Next.js 16+: export const proxy = createNEMO(...)
// Next.js <16: export const middleware = createNEMO(...)
export const proxy = createNEMO({
  '/users/:userId': async (request, event) => {
    const { userId } = event.params;
    console.log(`Processing request for user: ${userId}`);
  }
});
```

### Using the Logger

NEMO provides built-in logging capabilities through the event object that maintains consistent formatting and respects the debug configuration:

```typescript
import { createNEMO } from '@zanreal/nemo';

// Next.js 16+: export const proxy = createNEMO(...)
// Next.js <16: export const middleware = createNEMO(...)
export const proxy = createNEMO({
  '/api': async (request, event) => {
    // Debug logs (only shown when debug: true in config)
    event.log('Processing API request', request.nextUrl.pathname);
    
    try {
      // Your API logic
      const result = await processRequest(request);
      
      event.log('Request processed successfully', result);
      return NextResponse.json(result);
    } catch (error) {
      // Error logs (always shown)
      event.error('Failed to process request', error);
      
      // Warning logs (always shown)
      event.warn('This endpoint will be deprecated soon');
      
      return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
  }
}, undefined, { debug: true });
```

All logs maintain the "[NEMO]" prefix for consistency with internal framework logs.

## Notes

- Middleware functions are executed in order until a Response is returned
- The storage is shared between all middleware functions in the chain
- Headers and cookies are automatically forwarded between middleware functions
- Supports Next.js native middleware pattern

## Motivation

I'm working with Next.js project for a few years now, after Vercel moved multiple `/**/_middleware.ts` files to a single `/middleware.ts` file, there was a unfilled gap - but just for now.
After a 2023 retro I had found that there is no good solution for that problem, so I took matters into my own hands. I wanted to share that motivation with everyone here, as I think that we all need to remember how it all started.

Hope it will save you some time and would make your project DX better!
