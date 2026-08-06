import { realpath } from "node:fs/promises";
import { resolve } from "node:path";

const fileMutationQueues = new Map<string, Promise<void>>();

// Registering a call's place in the queue involves an async realpath lookup, so two calls
// arriving back-to-back could otherwise both read the map before either has written its own
// entry back to it. Chaining registrations through this promise serializes just that bookkeeping
// step, so each call sees the queue state left by every call registered before it.
let registrationQueue: Promise<void> = Promise.resolve();

function isMissingPathError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    ((error as NodeJS.ErrnoException).code === "ENOENT" || (error as NodeJS.ErrnoException).code === "ENOTDIR")
  );
}

/**
 * Resolves `filePath` to the key its mutation queue is tracked under: its real (symlink-resolved)
 * path when it already exists on disk, falling back to its plain resolved path otherwise (e.g. a
 * file being written for the first time, or one nested under a path segment that isn't a
 * directory). This way two different spellings of the same file — a relative path and an
 * absolute one, or a symlink and its target — still queue behind each other.
 */
async function getMutationQueueKey(filePath: string): Promise<string> {
  const resolvedPath = resolve(filePath);
  try {
    return await realpath(resolvedPath);
  } catch (err) {
    if (isMissingPathError(err)) {
      return resolvedPath;
    }
    throw err;
  }
}

/**
 * Serializes filesystem-mutating operations that target the same file, so overlapping tool calls
 * on one path — two edits, a write racing an edit, an insert racing a remove — run one at a time
 * instead of interleaving their read-modify-write steps (which could otherwise silently drop one
 * side's change, or write to a file a concurrent remove just deleted). Operations on different
 * files still run fully in parallel — this only chains work behind other work already queued
 * against the same (real, symlink-resolved) path.
 *
 * Only serializes by the literal target path passed in — a recursive `remove` doesn't take an
 * exclusive lock over the whole subtree it's deleting, so a concurrent call targeting a path
 * nested inside that subtree isn't blocked by it.
 */
export async function withFileMutationQueue<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
  const registration = registrationQueue.then(async () => {
    const key = await getMutationQueueKey(filePath);
    const currentQueue = fileMutationQueues.get(key) ?? Promise.resolve();
    let releaseNext!: () => void;
    const nextQueue = new Promise<void>((resolveQueue) => {
      releaseNext = resolveQueue;
    });
    const chainedQueue = currentQueue.then(() => nextQueue);
    fileMutationQueues.set(key, chainedQueue);
    return { key, currentQueue, chainedQueue, releaseNext };
  });
  registrationQueue = registration.then(
    () => undefined,
    () => undefined
  );

  const { key, currentQueue, chainedQueue, releaseNext } = await registration;
  await currentQueue;
  try {
    return await fn();
  } finally {
    releaseNext();
    // Only the last-registered waiter for this key clears the map entry — an earlier finally
    // running after a later registration would otherwise delete the newer, still-pending queue.
    if (fileMutationQueues.get(key) === chainedQueue) {
      fileMutationQueues.delete(key);
    }
  }
}
