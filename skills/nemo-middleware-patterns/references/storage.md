# Storage

`event.storage` is a synchronous key-value store that lives for the chain.

```ts
event.storage.set("user", { id: "1" });
const user = event.storage.get<{ id: string }>("user");
event.storage.has("user");
event.storage.delete("user");
event.storage.clear();
event.storage.size;
[...event.storage.keys()];
```

## Lifetime and isolation

By default each request gets its own fresh `MemoryStorageAdapter`, shared only by the middleware of that one request. Version note: this is the behaviour from the first release after 3.0.2. On 3.0.2 and older the default store was created once and reused for every request, so values from request A were readable in request B (a security issue); there, pass a factory as below. A ready-made instance (`storage: new MyAdapter()`) is reused across requests in every version, so pass a factory for per-request stores:

```ts
import { createNEMO } from "@zanreal/nemo";
import { MemoryStorageAdapter } from "@zanreal/nemo/storage";

export const proxy = createNEMO(
  { "/": () => {} },
  undefined,
  { storage: () => new MemoryStorageAdapter() },
);
```

Pass a shared instance only on purpose (a tiny in-memory cache). Edge instances are not shared across regions and are recycled, so never rely on it for correctness.

Imports: `StorageAdapter` and `MemoryStorageAdapter` are exported from `@zanreal/nemo/storage` (and `@zanreal/nemo/storage/adapters/memory`), not from `@zanreal/nemo`.

## Custom adapter

Extend the abstract class and implement every member. All methods are synchronous.

```ts
import { StorageAdapter } from "@zanreal/nemo/storage";

export class MapStorageAdapter extends StorageAdapter {
  private store = new Map<string, unknown>();

  get<T>(key: string): T | undefined {
    return this.store.get(key) as T | undefined;
  }
  set<T>(key: string, value: T): void {
    this.store.set(key, value);
  }
  has(key: string): boolean {
    return this.store.has(key);
  }
  delete(key: string): boolean {
    return this.store.delete(key);
  }
  clear(): void {
    this.store.clear();
  }
  entries(): IterableIterator<[string, unknown]> {
    return this.store.entries();
  }
  keys(): IterableIterator<string> {
    return this.store.keys();
  }
  values(): IterableIterator<unknown> {
    return this.store.values();
  }
  get size(): number {
    return this.store.size;
  }
  fromEntries(entries: Iterable<readonly [string, unknown]>): void {
    this.store = new Map(entries);
  }
  toString(): string {
    return JSON.stringify([...this.store.entries()]);
  }
  fromString(json: string): boolean {
    try {
      this.store = new Map(JSON.parse(json) as [string, unknown][]);
      return true;
    } catch {
      return false;
    }
  }
}
```

Use it with `{ storage: () => new MapStorageAdapter() }`.

Anything async (Redis, KV, database) does not fit the synchronous contract. Do async lookups inside the middleware and put the result into `event.storage` or a request header.
