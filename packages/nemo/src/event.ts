/* eslint-disable @typescript-eslint/no-unused-vars -- library */
/* eslint-disable security/detect-object-injection -- library */
/* eslint-disable @typescript-eslint/prefer-as-const -- library */
/* eslint-disable @typescript-eslint/no-explicit-any -- library */
import type { WaitUntil } from "next/dist/server/after/builtin-request-context";
import type { NextRequest } from "next/server";
import { match } from "path-to-regexp";
import { Logger } from "./logger";
import type { StorageAdapter } from "./storage/adapter";
import { MemoryStorageAdapter } from "./storage/adapters/memory";
import type { MiddlewareMetadata } from "./types";

// Change from private symbols to Symbol.for()
const responseSymbol = Symbol.for("response");
const passThroughSymbol = Symbol.for("passThrough");
const waitUntilSymbol = Symbol.for("waitUntil");

export class FetchEvent implements Omit<Event, 'composedPath'> {
  // (this means removing `FetchEventResult.waitUntil` which also requires a builder change)
  readonly [waitUntilSymbol]:
    | { kind: "internal"; promises: Promise<any>[] }
    | { kind: "external"; function: WaitUntil };

  private [responseSymbol]: Promise<Response> | null = null;
  private [passThroughSymbol] = false;
  private hasResponded = false;

  bubbles = false;
  cancelBubble = false;
  cancelable = false;
  composed = false;
  currentTarget = null;
  defaultPrevented = false;
  eventPhase = 0;
  isTrusted = true;
  returnValue = true;
  srcElement = null;
  target = null;
  timeStamp = Date.now();
  type = "fetch";
  readonly NONE: 0 = 0;
  readonly CAPTURING_PHASE: 1 = 1;
  readonly AT_TARGET: 2 = 2;
  readonly BUBBLING_PHASE: 3 = 3;

  constructor(_request: Request, waitUntil?: WaitUntil) {
    this[waitUntilSymbol] = waitUntil
      ? { kind: "external", function: waitUntil }
      : { kind: "internal", promises: [] };
  }

  composedPath(): EventTarget[] {
    throw new Error("Method not implemented.");
  }
  initEvent(type: string, bubbles?: boolean, cancelable?: boolean): void {
    throw new Error("Method not implemented.");
  }
  preventDefault(): void {
    throw new Error("Method not implemented.");
  }
  stopImmediatePropagation(): void {
    throw new Error("Method not implemented.");
  }
  stopPropagation(): void {
    throw new Error("Method not implemented.");
  }

  respondWith(response: Response | Promise<Response>): void {
    if (this.hasResponded) {
      throw new Error("FetchEvent.respondWith() has already been called");
    }
    this.hasResponded = true;
    this[responseSymbol] = Promise.resolve(response);
  }

  passThroughOnException(): void {
    this[passThroughSymbol] = true;
  }

  waitUntil(promise: Promise<any>): void {
    if (this.hasResponded) {
      throw new Error(
        "FetchEvent.waitUntil() cannot be called after response has been sent",
      );
    }
    if (this[waitUntilSymbol].kind === "external") {
      // if we received an external waitUntil, we delegate to it

      const waitUntil = this[waitUntilSymbol].function;
      return waitUntil(promise);
    } else {
      // if we didn't receive an external waitUntil, we make it work on our own
      // (and expect the caller to do something with the promises)
      this[waitUntilSymbol].promises.push(promise);
    }
  }
}

export function getWaitUntilPromiseFromEvent(
  event: FetchEvent,
): Promise<void> | undefined {
  return event[waitUntilSymbol].kind === "internal"
    ? Promise.all(event[waitUntilSymbol].promises).then(() => {})
    : undefined;
}

export class NextFetchEvent extends FetchEvent {
  sourcePage: string;

  constructor(params: {
    request: NextRequest;
    page: string;
    context: { waitUntil: WaitUntil } | undefined;
  }) {
    super(params.request, params.context?.waitUntil);
    this.sourcePage = params.page;
  }
}

/**
 * A wrapper around NextFetchEvent that allows for additional context to be passed
 * through the middleware chain.
 */
export class NemoEvent extends NextFetchEvent {
  storage: StorageAdapter;
  private currentMetadata?: MiddlewareMetadata;
  private readonly logger: Logger;
  private shouldSkipRemaining: boolean = false;
  private shouldSkipAfter: boolean = false;

  constructor(params: {
    request: NextRequest;
    sourcePage: string;
    context?: {
      waitUntil: WaitUntil;
    };
    nemo?: Record<string, unknown>;
    storage?: StorageAdapter;
    debug?: boolean;
  }) {
    super(params as never);
    this.storage = params.storage || new MemoryStorageAdapter(params.nemo);
    this.logger = new Logger(params.debug || false);
  }

  /**
   * Log a debug message (only displayed when debug is enabled)
   * @param args - Arguments to log
   */
  log(...args: any[]): void {
    this.logger.log(...args);
  }

  /**
   * Log an error message (always displayed)
   * @param args - Arguments to log
   */
  error(...args: any[]): void {
    this.logger.error(...args);
  }

  /**
   * Log a warning message (always displayed)
   * @param args - Arguments to log
   */
  warn(...args: any[]): void {
    this.logger.warn(...args);
  }

  /**
   * Updates the current middleware metadata
   * @param metadata - The metadata from the middleware that's currently being processed
   */
  setCurrentMetadata(metadata: MiddlewareMetadata): void {
    this.currentMetadata = metadata;
  }

  /**
   * Skip the remaining middlewares in the current chain (before/main/after)
   * This allows a middleware to stop the execution of subsequent middlewares
   * without returning a terminating response (like redirect/rewrite).
   * 
   * @param options - Optional configuration for skip behavior
   * @param options.skipAfter - If true, also skip all after chain middlewares
   * 
   * @example
   * ```ts
   * // Skip remaining middlewares in current chain only
   * async (request, event) => {
   *   if (someCondition) {
   *     event.skip();
   *     // Remaining middlewares in this chain will not execute
   *   }
   * }
   * ```
   * 
   * @example
   * ```ts
   * // Skip remaining middlewares and after chain
   * async (request, event) => {
   *   if (someCondition) {
   *     event.skip({ skipAfter: true });
   *     // Remaining middlewares in this chain AND after chain will not execute
   *   }
   * }
   * ```
   */
  skip(options?: { skipAfter?: boolean }): void {
    this.shouldSkipRemaining = true;
    if (options?.skipAfter) {
      this.shouldSkipAfter = true;
    }
  }

  /**
   * Check if skip was called
   * @internal
   */
  shouldSkip(): boolean {
    return this.shouldSkipRemaining;
  }

  /**
   * Check if skipAfter was called
   * @internal
   */
  shouldSkipAfterChain(): boolean {
    return this.shouldSkipAfter;
  }

  /**
   * Reset skip flag (used internally when transitioning between chain sections)
   * @internal
   */
  /**
   * Reset skip flag (used internally when transitioning between chain sections)
   * Note: Only resets shouldSkipRemaining; shouldSkipAfter persists to honor
   * the request to skip after-chain middlewares across all chain transitions.
   * @internal
   */
  resetSkip(): void {
    this.shouldSkipRemaining = false;
  }

  /**
   * Getter for route parameters from the current request path
   * @returns An object containing the extracted parameters from the current route
   *
   * @example
   * ```ts
   * // For route defined as "/users/:userId"
   * // When accessing "/users/123"
   * const { userId } = event.params; // "123"
   * ```
   */
  get params(): Record<string, string | string[]> {
    if (!this.currentMetadata) {
      return {};
    }

    return this.extractParamsFromPath(
      this.currentMetadata.routeKey,
      this.currentMetadata.pathname,
    );
  }

  /**
   * Extract URL parameters from a path using a route pattern
   * @private
   * @param routePattern - The route pattern with parameter placeholders
   * @param pathname - The actual pathname to extract parameters from
   * @returns An object containing the extracted parameters
   */
  private extractParamsFromPath(
    routePattern: string,
    pathname: string,
  ): Record<string, string | string[]> {
    if (!routePattern || !pathname) {
      return {};
    }

    try {
      // Use path-to-regexp's match function with end:false to allow matching partial paths
      // This ensures parameters can be extracted even when the actual path extends beyond the route pattern
      const matchRoute = match(routePattern, { end: false });
      const result = matchRoute(pathname);

      if (!result) {
        return {};
      }

      return (result.params as Record<string, string | string[]>) || {};
    } catch (error) {
      console.error("Error extracting URL parameters:", error);
      return {};
    }
  }

  /**
   * Extract URL parameters from a path using a route pattern
   * @param options - Options for parameter extraction
   * @param options.metadata - The metadata from the middleware (optional if currentMetadata is set)
   * @param options.routePattern - The route pattern with parameter placeholders (optional)
   * @param options.pathname - The actual pathname to extract parameters from (optional)
   * @returns An object containing the extracted parameters
   */
  getParams(
    options?:
      | MiddlewareMetadata
      | {
          metadata?: MiddlewareMetadata;
          routePattern?: string;
          pathname?: string;
        },
  ): Record<string, string | string[]> {
    // Handle backward compatibility with just metadata parameter
    if (options && "chain" in options) {
      // It's the old-style metadata parameter. The branch has already proved it is
      // present, so there is nothing to fall back to and nothing to null-check.
      return this.extractParamsFromPath(options.routeKey, options.pathname);
    }

    // Handle new options object
    if (options && typeof options === "object") {
      // If direct pattern and path are provided, use those
      if (options.routePattern && options.pathname) {
        return this.extractParamsFromPath(
          options.routePattern,
          options.pathname,
        );
      }

      // Use provided metadata or fall back to current metadata
      const meta = options.metadata || this.currentMetadata;

      if (!meta) {
        return {};
      }

      return this.extractParamsFromPath(meta.routeKey, meta.pathname);
    }

    // No options provided, use current metadata
    if (!this.currentMetadata) {
      return {};
    }

    return this.extractParamsFromPath(
      this.currentMetadata.routeKey,
      this.currentMetadata.pathname,
    );
  }

  static from(
    event: NextFetchEvent,
    nemoContext: Record<string, unknown> = {},
    storage?: StorageAdapter,
    debug?: boolean,
  ): NemoEvent {
    // @ts-expect-error - `_raw` is not part of NextFetchEvent; kept for callers that set it
    const original = event?._raw || {};

    // Next.js keeps the platform waitUntil (or its own promise list) in a private symbol
    // on the event it created, so it cannot be read from here. Delegate to that event's
    // public waitUntil instead: it forwards to the platform when there is one, and
    // otherwise records the promise where Next.js awaits it after the middleware returns.
    const context =
      original.context ??
      (typeof event?.waitUntil === "function"
        ? { waitUntil: (promise: Promise<any>) => event.waitUntil(promise) }
        : undefined);

    return new NemoEvent({
      request: original.request,
      sourcePage: event?.sourcePage,
      context,
      nemo: nemoContext,
      storage: storage || new MemoryStorageAdapter(nemoContext),
      debug,
    });
  }
}
