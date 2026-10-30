import { pathToRegexp } from "path-to-regexp";
import { NemoMiddlewareError } from "./errors";
import { NemoEvent } from "./event";
import { Logger } from "./logger";
import { StorageAdapter } from "./storage/adapter";
import { MemoryStorageAdapter } from "./storage/adapters/memory";
import {
  type ChainType,
  type GlobalMiddlewareConfig,
  type MiddlewareChain,
  type MiddlewareConfig,
  type MiddlewareConfigValue,
  type MiddlewareMetadata,
  type NemoConfig,
  type NextMiddleware,
  type NextMiddlewareResult,
  type NextMiddlewareWithMeta,
} from "./types";
import { NextFetchEvent, NextRequest, NextResponse } from "next/server";

export { NemoMiddlewareError } from "./errors";
export { NemoEvent } from "./event";
export * from "./types";
export * from "./utils";

type NextMiddlewareFunction = (
  request: NextRequest,
  event: NextFetchEvent,
) => Promise<NextMiddlewareResult>;

export class NEMO {
  private readonly config: NemoConfig;
  private readonly middlewares: MiddlewareConfig;
  private readonly globalMiddleware?: GlobalMiddlewareConfig;
  private readonly logger: Logger;
  private readonly storage: StorageAdapter | (() => StorageAdapter);
  private readonly storageFactory: boolean;

  /**
   * NEMO Middleware/Proxy
   * Compatible with both Next.js <16 (middleware.ts) and Next.js 16+ (proxy.ts)
   * @param middlewares - Middleware configuration
   * @param globalMiddleware - Global middleware configuration
   * @param config - NEMO configuration
   */
  constructor(
    middlewares: MiddlewareConfig,
    globalMiddleware?: GlobalMiddlewareConfig,
    config?: NemoConfig,
  ) {
    this.config = {
      debug: false,
      silent: false,
      enableTiming: false,
      ...config,
    };
    this.middlewares = middlewares;
    this.globalMiddleware = globalMiddleware;
    this.logger = new Logger(this.config.debug || false);

    // Store storage configuration - if it's a function, we'll call it per request
    // This ensures proper isolation between requests, especially important for edge runtime
    if (this.config.storage) {
      if (typeof this.config.storage === "function") {
        this.storage = this.config.storage;
        this.storageFactory = true;
      } else {
        this.storage = this.config.storage;
        this.storageFactory = false;
      }
    } else {
      // No storage configured: create a fresh in-memory store for every request.
      // A single instance here would live as long as the module and be shared by all
      // requests, letting one request read values another request stored.
      this.storage = () => new MemoryStorageAdapter();
      this.storageFactory = true;
    }

    // Log initialization
    // For factory functions, we don't call it here to avoid creating unnecessary instances
    // The factory will be called per request for proper isolation
    const storageInstance = this.storageFactory
      ? undefined // Don't create instance during construction if it's a factory
      : (this.storage as StorageAdapter);
    this.logger.log("Initialized with config:", {
      debug: this.config.debug,
      silent: this.config.silent,
      enableTiming: this.config.enableTiming,
      middlewareCount: Object.keys(middlewares).length,
      hasGlobalMiddleware: !!globalMiddleware,
      storageAdapter: storageInstance
        ? storageInstance.constructor.name
        : this.config.storage
          ? "factory function"
          : "MemoryStorageAdapter (per request)",
      storageIsFactory: this.storageFactory,
    });
  }

  /**
   * Computes if the given path matches the given pattern using path-to-regexp
   * @param pattern - The pattern to match
   * @param path - The path to check
   * @param exact - Whether to match exactly or as a prefix
   * @returns Whether the path matches the pattern
   */
  private computePathMatch(
    pattern: string,
    path: string,
    exact: boolean = false,
  ): boolean {
    // Special case for root path
    if (pattern === "/") {
      return exact ? path === "/" || path === "" : true;
    }

    // Handle Unicode paths properly
    let decodedPath: string;
    let decodedPattern: string;

    try {
      decodedPath = decodeURIComponent(path);
    } catch (error) {
      this.logger.error(`Error decoding path ${path}:`, error);
      decodedPath = path; // Fall back to raw path
    }

    try {
      decodedPattern = decodeURIComponent(pattern);
    } catch (error) {
      this.logger.error(`Error decoding pattern ${pattern}:`, error);
      decodedPattern = pattern; // Fall back to raw pattern
    }

    // For simple paths (no special characters), we have special handling
    if (
      !pattern.includes(":") &&
      !pattern.includes("*") &&
      !pattern.includes("(")
    ) {
      // For exact matching, paths must be identical
      if (exact) {
        return decodedPath === decodedPattern;
      }

      // For non-exact matching:
      // 1. Path is exactly the pattern
      // 2. Path starts with pattern followed by a slash
      return (
        decodedPath === decodedPattern ||
        decodedPath.startsWith(decodedPattern + "/")
      );
    }

    // For patterns with special characters, use path-to-regexp
    try {
      const regexp = pathToRegexp(decodedPattern, [], {
        end: exact,
        strict: false,
        sensitive: false,
      });
      return regexp.test(decodedPath);
    } catch (error) {
      this.logger.error(
        `Error creating regexp for pattern ${decodedPattern}:`,
        error,
      );
      return false;
    }
  }

  /**
   * Porównuje początkowe i końcowe nagłówki i zwraca różnicę
   * @param initialHeaders - Początkowe nagłówki żądania
   * @param finalHeaders - Końcowe nagłówki żądania
   * @returns Obiekt zawierający nowe i zmodyfikowane nagłówki
   */
  private getHeadersDiff(
    initialHeaders: Headers,
    finalHeaders: Headers,
  ): Record<string, string> {
    const entries: [string, string][] = [];
    const seen = new Set<string>();

    // Optimize header comparison using Sets
    finalHeaders.forEach((value, key) => {
      seen.add(key);
      const initialValue = initialHeaders.get(key);
      if (!initialValue || initialValue !== value) {
        entries.push([key, value]);
      }
    });

    // Check for deleted headers
    initialHeaders.forEach((_, key) => {
      if (!seen.has(key)) {
        entries.push([key, ""]); // Mark for deletion
      }
    });

    return Object.fromEntries(entries);
  }

  /**
   * Attaches metadata to the given middleware function.
   * @param middleware - The middleware function to attach metadata to.
   * @param metadata - The metadata to attach.
   * @returns The middleware function with attached metadata.
   */
  private attachMetadata(
    middleware: NextMiddleware,
    metadata: MiddlewareMetadata,
  ): NextMiddlewareWithMeta {
    const middlewareWithMeta = middleware as NextMiddlewareWithMeta;
    middlewareWithMeta.__nemo = metadata;

    return middlewareWithMeta;
  }

  /**
   * Creates a full pattern path by combining base path and key
   * @param key - The route key
   * @param basePath - The base path
   * @returns The combined full pattern
   */
  private createFullPattern(key: string, basePath: string): string {
    // Check if basePath exists first
    if (!basePath) {
      return key; // If no basePath, just return the key
    }

    // Now handle different key scenarios
    if (key === "/") {
      return basePath; // For root key with basePath, return just the basePath
    } else {
      return `${basePath}${key}`; // Otherwise concatenate them
    }
  }

  /**
   * Propagate the queue of middleware functions for the given request.
   * @param request - The request to propagate the queue for.
   * @returns The queue of middleware functions.
   */
  private propagateQueue(request: NextRequest): NextMiddlewareWithMeta[] {
    const pathname = request.nextUrl.pathname;
    this.logger.log("Processing request for path:", pathname);

    const queue: NextMiddlewareWithMeta[] = [];
    const processedPatterns = new Set<string>(); // Track processed patterns

    // Add before middlewares
    // Extract the middleware array from global middleware configuration
    let beforeMiddlewareArray: MiddlewareChain = [];

    if (this.globalMiddleware?.before) {
      beforeMiddlewareArray = Array.isArray(this.globalMiddleware.before)
        ? this.globalMiddleware.before
        : [this.globalMiddleware.before];
    }

    // Map middleware array to attach metadata
    const beforeMiddlewares = beforeMiddlewareArray.map((middleware, index) =>
      this.attachMetadata(middleware, {
        chain: "before",
        index,
        pathname,
        routeKey: "global:before",
      }),
    );
    queue.push(...beforeMiddlewares);

    // Collection of matched routes with their metadata to be processed in order
    type MatchedRoute = {
      pattern: string;
      middleware: NextMiddleware | NextMiddleware[];
      nestLevel: number;
      isExactMatch: boolean;
    };

    const matchedRoutes: MatchedRoute[] = [];

    // Special case for root path - only process the root middleware for exact root path matches
    // This ensures root middleware only runs for "/" and not for other paths
    const rootMiddleware = this.middlewares["/"];
    if (rootMiddleware && (pathname === "/" || pathname === "")) {
      const rootValue = rootMiddleware;
      processedPatterns.add("/");

      if (typeof rootValue === "function" || Array.isArray(rootValue)) {
        matchedRoutes.push({
          pattern: "/",
          middleware: rootValue,
          nestLevel: 0,
          isExactMatch: true,
        });
      } else if (
        typeof rootValue === "object" &&
        rootValue !== null &&
        "middleware" in rootValue
      ) {
        matchedRoutes.push({
          pattern: "/",
          middleware: rootValue.middleware,
          nestLevel: 0,
          isExactMatch: true,
        });
      }
    }

    // Collect all matching routes
    const collectMatchingRoutes = (
      middlewares: Record<string, MiddlewareConfigValue>,
      basePath = "",
      nestLevel = 0,
    ) => {
      // Helper function to check if we should process this route
      const shouldProcessRoute = (
        routeKey: string,
        pattern: string,
      ): boolean => {
        // Skip processing if the key is "middleware" - it's a special property
        if (routeKey === "middleware") return false;

        // Skip root path cases
        if (routeKey === "/") {
          if (basePath !== "" || processedPatterns.has("/")) return false;
          if (pathname !== "/" && pathname !== "") return false;
        }

        // Skip if already processed
        if (processedPatterns.has(pattern)) return false;

        return true;
      };

      // Helper function to add middleware to matched routes
      const addToMatchedRoutes = (
        pattern: string,
        middleware: NextMiddleware | NextMiddleware[],
        isExactMatch: boolean,
      ) => {
        matchedRoutes.push({
          pattern,
          middleware,
          nestLevel,
          isExactMatch,
        });
      };

      Object.entries(middlewares).forEach(([key, value]) => {
        // Combine base path with current key for nested routes
        const fullPattern = this.createFullPattern(key, basePath);

        if (!shouldProcessRoute(key, fullPattern)) return;

        // Mark as processed
        processedPatterns.add(fullPattern);

        // Different path matching logic based on nestLevel and value type
        const isExactMatch = this.computePathMatch(fullPattern, pathname, true);
        const supportsNesting =
          typeof value === "object" &&
          value !== null &&
          !Array.isArray(value) &&
          Object.keys(value).some((k) => k !== "middleware");

        // Determine if this is a prefix match
        let isPrefixMatch = false;
        if (nestLevel === 0 && !supportsNesting) {
          // Top-level routes without nesting only match exactly
          isPrefixMatch = isExactMatch;
        } else {
          // Nested routes can match prefix
          isPrefixMatch = this.computePathMatch(fullPattern, pathname, false);
        }

        // Process this route if it matches the path
        if (isPrefixMatch) {
          // Handle middleware based on type
          if (typeof value === "function" || Array.isArray(value)) {
            addToMatchedRoutes(fullPattern, value, isExactMatch);
          } else if (
            typeof value === "object" &&
            value !== null &&
            "middleware" in value
          ) {
            addToMatchedRoutes(fullPattern, value.middleware, isExactMatch);
          }
        }

        // Process nested routes if applicable
        if (supportsNesting) {
          const nestedEntries = { ...value };
          delete (nestedEntries as Record<string, unknown>).middleware;

          if (Object.keys(nestedEntries).length > 0) {
            collectMatchingRoutes(nestedEntries, fullPattern, nestLevel + 1);
          }
        }
      });
    };

    // Start the recursive route collection process from the root middleware config
    collectMatchingRoutes(this.middlewares);

    /**
     * Sort matched routes by priority:
     * 1. Root path ("/") always comes first
     * 2. Routes are ordered by nest level (parent routes before children)
     * 3. Exact path matches take priority over prefix matches
     * 4. Longer patterns take priority over shorter ones (more specific wins)
     */
    matchedRoutes.sort((a, b) => {
      if (a.pattern === "/") return -1;
      if (b.pattern === "/") return 1;

      if (a.nestLevel !== b.nestLevel) {
        return a.nestLevel - b.nestLevel;
      }

      if (a.isExactMatch !== b.isExactMatch) {
        return a.isExactMatch ? 1 : -1; // Exact matches come later
      }

      return b.pattern.length - a.pattern.length;
    });

    /**
     * Add all matched middleware functions to the execution queue
     * Each middleware receives metadata about its position in the chain
     * and the route it belongs to
     */
    matchedRoutes.forEach(({ pattern, middleware, nestLevel }) => {
      if (Array.isArray(middleware)) {
        middleware.forEach((middlewareFn, index) => {
          queue.push(
            this.attachMetadata(middlewareFn, {
              chain: "main",
              index,
              pathname,
              routeKey: pattern,
              nestLevel,
            }),
          );
        });
      }
      // Handle single middleware function
      else if (typeof middleware === "function") {
        queue.push(
          this.attachMetadata(middleware, {
            chain: "main",
            index: queue.length - beforeMiddlewares.length,
            pathname,
            routeKey: pattern,
            nestLevel,
          }),
        );
      }
    });

    // Add after middlewares
    // Extract the middleware array from global middleware configuration
    let afterMiddlewareArray: MiddlewareChain = [];

    if (this.globalMiddleware?.after) {
      afterMiddlewareArray = Array.isArray(this.globalMiddleware.after)
        ? this.globalMiddleware.after
        : [this.globalMiddleware.after];
    }

    // Map middleware array to attach metadata
    const afterMiddlewares = afterMiddlewareArray.map((middleware, index) =>
      this.attachMetadata(middleware, {
        chain: "after",
        index,
        pathname,
        routeKey: "global:after",
      }),
    );
    queue.push(...afterMiddlewares);

    this.logger.log("Generated middleware queue:", {
      total: queue.length,
      before: beforeMiddlewares.length,
      main: queue.length - beforeMiddlewares.length - afterMiddlewares.length,
      after: afterMiddlewares.length,
    });

    return queue;
  }

  /**
   * Process the queue of middleware functions.
   * @param queue - The queue of middleware functions to process.
   * @param request - The request to process the queue for.
   * @param event - The fetch event to process the queue for.
   * @returns The result of the middleware processing.
   */
  private async processQueue(
    queue: NextMiddlewareWithMeta[],
    request: NextRequest,
    event: NemoEvent,
  ): Promise<NextMiddlewareResult> {
    const initialHeaders = new Headers(request.headers);
    const chainTiming = this.initializeTimingTracking();

    this.logger.log("Starting middleware queue processing");

    const result = await this.executeMiddlewareChain(
      queue,
      request,
      event,
      chainTiming,
    );
    this.logFinalTiming(chainTiming);

    return result || this.createFinalResponse(initialHeaders, request);
  }

  private initializeTimingTracking(): {
    before: number;
    main: number;
    after: number;
  } | null {
    return this.config.enableTiming ? { before: 0, main: 0, after: 0 } : null;
  }

  private shouldSkipMiddleware(
    middlewareChain: ChainType | undefined,
    currentChain: ChainType | undefined,
    skipCurrentChain: boolean,
    event: NemoEvent,
  ): boolean {
    if (skipCurrentChain && middlewareChain === currentChain) {
      return true;
    }

    if (middlewareChain === "after" && event.shouldSkipAfterChain()) {
      return true;
    }

    return false;
  }

  private handleChainTransition(
    middlewareChain: ChainType | undefined,
    currentChain: ChainType | undefined,
    event: NemoEvent,
  ): {
    newChain: ChainType | undefined;
    shouldResetSkip: boolean;
  } {
    if (!middlewareChain || middlewareChain === currentChain) {
      return { newChain: currentChain, shouldResetSkip: false };
    }

    if (currentChain !== undefined) {
      event.resetSkip();
      return { newChain: middlewareChain, shouldResetSkip: true };
    }

    return { newChain: middlewareChain, shouldResetSkip: false };
  }

  private processMiddlewareResult(
    result: NextMiddlewareResult,
    request: NextRequest,
    event: NemoEvent,
    middlewareChain: ChainType | undefined,
  ): Promise<{ shouldTerminate: boolean; shouldSkipChain: boolean }> {
    if (this.isTerminatingResult(result)) {
      return Promise.resolve({ shouldTerminate: true, shouldSkipChain: false });
    }

    this.applyHeadersToRequest(result, request);

    if (event.shouldSkip()) {
      this.logger.log("Skipping remaining middlewares in chain:", {
        chain: middlewareChain,
      });
      return Promise.resolve({
        shouldTerminate: false,
        shouldSkipChain: true,
      });
    }

    return Promise.resolve({ shouldTerminate: false, shouldSkipChain: false });
  }

  private async executeMiddlewareChain(
    queue: NextMiddlewareWithMeta[],
    request: NextRequest,
    event: NemoEvent,
    chainTiming: { before: number; main: number; after: number } | null,
  ): Promise<NextMiddlewareResult> {
    let currentChain: ChainType | undefined = undefined;
    let skipCurrentChain = false;

    for (const middleware of queue) {
      try {
        const middlewareChain = middleware.__nemo?.chain;

        const transition = this.handleChainTransition(
          middlewareChain,
          currentChain,
          event,
        );
        currentChain = transition.newChain;
        if (transition.shouldResetSkip) {
          skipCurrentChain = false;
        }

        if (
          this.shouldSkipMiddleware(
            middlewareChain,
            currentChain,
            skipCurrentChain,
            event,
          )
        ) {
          continue;
        }

        const result = await this.executeMiddleware(
          middleware,
          request,
          event,
          chainTiming,
        );
        const processResult = await this.processMiddlewareResult(
          result,
          request,
          event,
          middlewareChain,
        );

        if (processResult.shouldTerminate) {
          return this.attachCarriedCookies(result, request);
        }
        if (processResult.shouldSkipChain) {
          skipCurrentChain = true;
        }
      } catch (error) {
        const errorResult = await this.handleMiddlewareError(error, middleware);
        if (errorResult) {
          return errorResult;
        }
      }
    }
    return null;
  }

  private async executeMiddleware(
    middleware: NextMiddlewareWithMeta,
    request: NextRequest,
    event: NemoEvent,
    chainTiming: { before: number; main: number; after: number } | null,
  ): Promise<NextMiddlewareResult> {
    const startTime = this.config.enableTiming ? performance.now() : 0;

    this.logMiddlewareExecution(middleware);

    if (middleware.__nemo) {
      event.setCurrentMetadata(middleware.__nemo);
    }

    const result = await middleware(request, event);
    this.updateTimingStats(startTime, middleware, chainTiming);

    return result;
  }

  private logMiddlewareExecution(middleware: NextMiddlewareWithMeta): void {
    this.logger.log("Executing middleware:", {
      chain: middleware.__nemo?.chain,
      index: middleware.__nemo?.index,
      pathname: middleware.__nemo?.pathname,
      routeKey: middleware.__nemo?.routeKey,
      nestLevel: middleware.__nemo?.nestLevel,
    });
  }

  private isTerminatingResult(result: NextMiddlewareResult): boolean {
    if (!result) return false;

    const isNextResponse =
      result instanceof NextResponse &&
      !result.headers.has("x-middleware-rewrite") &&
      !result.headers.has("Location") &&
      !result.headers.get("content-type")?.includes("application/json");

    return !isNextResponse;
  }

  /**
   * Carries cookies set by earlier middleware onto a terminating response.
   *
   * A redirect or rewrite ends the chain and is returned as-is, so any `Set-Cookie` accumulated
   * on the request carrier before it — a session refresh ahead of an i18n rewrite, say — would
   * otherwise be dropped. Values already on the response are left alone rather than duplicated.
   */
  private attachCarriedCookies(
    result: NextMiddlewareResult,
    request: NextRequest,
  ): NextMiddlewareResult {
    if (!(result instanceof Response)) return result;

    const carried = request.headers.getSetCookie();
    if (carried.length === 0) return result;

    const present = new Set(result.headers.getSetCookie());
    const missing = carried.filter((cookie) => !present.has(cookie));
    if (missing.length === 0) return result;

    try {
      for (const cookie of missing) {
        result.headers.append("set-cookie", cookie);
      }
      return result;
    } catch {
      // `Response.redirect()` returns a response whose headers carry an immutable guard, so
      // appending throws `TypeError: immutable` and would take down the whole chain rather
      // than lose a cookie. Rebuild it instead — `new Headers(...)` preserves repeated
      // set-cookie values, and the dedupe is redone in case the loop above applied some
      // before throwing.
      const headers = new Headers(result.headers);
      const already = new Set(headers.getSetCookie());
      for (const cookie of missing) {
        if (!already.has(cookie)) {
          headers.append("set-cookie", cookie);
          already.add(cookie);
        }
      }

      return new Response(result.body, {
        status: result.status,
        statusText: result.statusText,
        headers,
      });
    }
  }

  private applyHeadersToRequest(
    result: NextMiddlewareResult,
    request: NextRequest,
  ): void {
    if (result instanceof NextResponse) {
      result.headers.forEach((value, key) => {
        // Extract headers from x-middleware-request-* format
        // When NextResponse.next({ request: { headers } }) is used,
        // Next.js stores these headers as x-middleware-request-{header-name}
        if (key.startsWith("x-middleware-request-")) {
          // Remove the x-middleware-request- prefix and apply to request
          const headerName = key.replace("x-middleware-request-", "");

          // `set-cookie` is never a real request header. It only shows up here because
          // NextResponse.next({ request }) serialises the request headers — including the
          // cookies this chain has already accumulated — into x-middleware-request-set-cookie.
          // That value is a snapshot taken when the middleware ran, so re-applying it with
          // .set() clobbers every cookie appended since. The live carrier is append-only and
          // therefore always a superset of the snapshot, so the snapshot can be dropped.
          if (headerName.toLowerCase() === "set-cookie") {
            return;
          }

          request.headers.set(headerName, value);
        } else if (!key.startsWith("x-middleware-")) {
          // Apply other non-middleware headers directly
          if (key.toLowerCase() === "set-cookie") {
            request.headers.append(key, value);
          } else {
            request.headers.set(key, value);
          }
        }
      });
    }
  }

  private updateTimingStats(
    startTime: number,
    middleware: NextMiddlewareWithMeta,
    chainTiming: { before: number; main: number; after: number } | null,
  ): void {
    if (this.config.enableTiming && chainTiming && middleware.__nemo?.chain) {
      const duration = performance.now() - startTime;
      const chain = middleware.__nemo.chain;
      chainTiming[chain] += duration;
      this.logger.log(`Middleware execution time: ${duration.toFixed(2)}ms`);
    }
  }

  private async handleMiddlewareError(
    error: unknown,
    middleware: NextMiddlewareWithMeta,
  ): Promise<NextMiddlewareResult> {
    this.logger.error("Middleware execution failed:", {
      error,
      metadata: middleware.__nemo,
    });

    if (this.config.errorHandler) {
      const handled = await this.config.errorHandler(
        error as Error,
        middleware.__nemo!,
      );
      if (handled) {
        this.logger.log("Error handled by custom handler");
        return handled;
      }
    }

    if (!this.config.silent) {
      throw new NemoMiddlewareError(
        "Middleware execution failed",
        middleware.__nemo!,
        error,
      );
    }

    return null;
  }

  private logFinalTiming(
    chainTiming: { before: number; main: number; after: number } | null,
  ): void {
    if (this.config.enableTiming && chainTiming) {
      const total = chainTiming.before + chainTiming.main + chainTiming.after;
      this.logger.log("Chain timing summary:", {
        before: `${chainTiming.before.toFixed(2)}ms`,
        main: `${chainTiming.main.toFixed(2)}ms`,
        after: `${chainTiming.after.toFixed(2)}ms`,
        total: `${total.toFixed(2)}ms`,
      });
    }
  }

  private createFinalResponse(
    initialHeaders: Headers,
    request: NextRequest,
  ): NextMiddlewareResult {
    const finalHeaders = new Headers(request.headers);
    const headerDiff = this.getHeadersDiff(initialHeaders, finalHeaders);

    // getHeadersDiff collapses to a plain object, and Headers.forEach yields one entry per
    // set-cookie value — so every cookie but the last would be lost. Carry them across
    // individually instead of through the diff record.
    delete headerDiff["set-cookie"];
    this.logger.log("Headers modified:", headerDiff);

    const responseHeaders = new Headers(headerDiff);
    const alreadyOnRequest = new Set(initialHeaders.getSetCookie());
    for (const cookie of finalHeaders.getSetCookie()) {
      if (!alreadyOnRequest.has(cookie)) {
        responseHeaders.append("set-cookie", cookie);
      }
    }

    // Pass headers diff for response headers and request headers for forwarding
    // This ensures both response headers and request headers (from x-middleware-request-*)
    // are properly handled
    return NextResponse.next({
      headers: responseHeaders,
      request: {
        headers: finalHeaders,
      },
    });
  }

  /**
   * Middleware/Proxy handler
   * Compatible with both Next.js <16 (middleware.ts) and Next.js 16+ (proxy.ts)
   * @param request - The request to process the middleware for.
   * @param event - The fetch event to process the middleware for.
   * @returns The result of the middleware processing.
   */
  middleware: NextMiddlewareFunction = async (
    request: NextRequest,
    event: NextFetchEvent,
  ): Promise<NextMiddlewareResult> => {
    // Get storage instance - if it's a factory function, call it per request
    // This ensures proper isolation between requests, especially important for edge runtime
    const storageInstance = this.storageFactory
      ? (this.storage as () => StorageAdapter)()
      : (this.storage as StorageAdapter);

    // Create NemoEvent with empty initial context and custom storage
    const nemoEvent = NemoEvent.from(
      event as never,
      {},
      storageInstance,
      this.config.debug,
    );

    const queue: NextMiddlewareWithMeta[] = this.propagateQueue(request);

    return this.processQueue(queue, request, nemoEvent);
  };
}

/**
 * @deprecated This function is going to be deprecated as it's named just like many other packages and can cause conflicts. Use `new NEMO()` instead.
 *
 * Example for Next.js 16+: `export const proxy = createNEMO(middlewares, globalMiddleware, config)`
 * Example for Next.js <16: `export const middleware = createNEMO(middlewares, globalMiddleware, config)`
 *
 * @param middlewares - Middleware configuration
 * @param globalMiddleware - Global middleware configuration
 * @returns NextMiddleware (compatible with both Next.js <16 NextMiddleware and Next.js 16+ NextProxy)
 *
 * @example
 * ```ts
 * import { createNEMO } from "@zanreal/nemo";
 *
 * // Next.js 16+: export const proxy = createNEMO({...})
 * // Next.js <16: export const middleware = createNEMO({...})
 * const proxy = createNEMO({
 *  "/api/:path*": (req, event) => {
 *    console.log("API request:", req.nextUrl.pathname);
 *  },
 * });
 * ```
 */
export function createMiddleware(
  middlewares: MiddlewareConfig,
  globalMiddleware?: GlobalMiddlewareConfig,
  config?: NemoConfig,
): NextMiddlewareFunction {
  console.warn(
    "[NEMO] `createMiddleware` is deprecated. Use `createNEMO` instead.",
  );

  return new NEMO(middlewares, globalMiddleware, config).middleware;
}

/**
 * Creates a new NEMO instance with the given middlewares and optional configurations.
 *
 * Compatible with both Next.js <16 (middleware.ts) and Next.js 16+ (proxy.ts).
 *
 * @param middlewares - Middleware configuration
 * @param globalMiddleware - Global middleware configuration
 * @param config - Optional Nemo configuration
 * @returns NextMiddleware (compatible with both Next.js <16 NextMiddleware and Next.js 16+ NextProxy)
 *
 * @example
 * ```ts
 * import { createNEMO } from "@zanreal/nemo";
 *
 * // Next.js 16+: export const proxy = createNEMO({...})
 * // Next.js <16: export const middleware = createNEMO({...})
 * const proxy = createNEMO({
 *  "/api/:path*": (req, event) => {
 *    console.log("API request:", req.nextUrl.pathname);
 *  },
 * });
 * ```
 */
export function createNEMO(
  middlewares: MiddlewareConfig,
  globalMiddleware?: GlobalMiddlewareConfig,
  config?: NemoConfig,
): NextMiddlewareFunction {
  return new NEMO(middlewares, globalMiddleware, config).middleware;
}
