import { getSandboxState, fileIsSafe, type SandboxMode } from "./sandbox.ts";

/**
 * Optional, best-effort cross-extension integration with
 * `@gotgenes/pi-permission-system` (https://pi.dev/packages/@gotgenes/pi-permission-system).
 *
 * This project takes NO dependency on that package — it isn't in
 * package.json at all — so `tsc --noEmit`/`npm test` pass identically
 * whether or not a consumer has it installed:
 *
 * - The module specifier is built at runtime, not written as a string
 *   literal, so TypeScript can't try to statically resolve it at type-check
 *   time and fail when the package isn't present.
 * - The service is duck-typed against a minimal local interface
 *   (`PermissionsServiceLike` below) instead of importing the package's own
 *   published types, since this project doesn't install it to get those
 *   types from. If the real shape ever drifts from this guess, the worst
 *   case is the `try/catch` below swallowing the mismatch and this
 *   integration quietly doing nothing — never a broken build or a crash.
 * - Every call is wrapped in try/catch; the package being absent, or its
 *   `getPermissionsService()` returning undefined (not loaded yet, or this
 *   session has no active permission-system extension), is treated as
 *   "nothing to integrate with".
 *
 * What it does when the package IS installed and configured to use it:
 * while `/toggle-sandbox` is `"on"`, this project's own local sandbox
 * (`resolveSandboxPath` in `sandbox.ts`) already fully enforces
 * root-containment and the credential-glob restrictions on every tool call —
 * so a *second*, independent "may I touch this path?" prompt from
 * permission-system for anything inside the project root is redundant. This
 * module registers an authorizer that auto-allows exactly that case, so the
 * user isn't asked twice for something already fully covered. While sandbox
 * state is `"off"`, the authorizer declines every request (returns
 * `undefined`), so permission-system's own configured policy — including any
 * `"ask"` rules — governs unmodified; that's the intended meaning of `"off"`
 * (see `sandbox.ts`): no local sandboxing, fully delegated.
 *
 * IMPORTANT: this only takes effect if the user's own permission-system
 * config also names this authorizer — registration is opt-in on their side
 * (`registerAuthorizer` docs: "decides nothing until you name it here").
 * See CLAUDE.md for the config snippet to add.
 */

type PermissionState = "allow" | "deny" | "ask";

export interface AuthorizeRequest {
  surface: string;
  value?: string;
  agentName?: string | null;
}

type AuthorizeFn = (
  request: AuthorizeRequest
) => PermissionState | undefined | Promise<PermissionState | undefined>;

interface PermissionsServiceLike {
  registerAuthorizer(name: string, authorize: AuthorizeFn): () => void;
}

// Path-shaped surfaces, per permission-system's own `checkPermission` docs:
// "path", "external_directory", or a path-bearing tool name directly
// (read/write/edit/grep/find/ls). Everything else (bash, mcp, skill, ...)
// isn't a bare filesystem path and is deliberately left alone here.
//
// Mapped to the SandboxMode that governs the *same* operation in this
// project's own tools, so the authorizer's "allow" tracks exactly what
// `resolveSandboxPath`/`fileIsSafe` would actually let through — read-only
// surfaces use "read" mode, mutating ones use "edit" mode. The generic
// "path"/"external_directory" surfaces don't say which; "edit" mode is used
// for those since EDIT_RESTRICTED_GLOBS is a superset of READ_RESTRICTED_GLOBS
// (anything edit-mode allows is also read-mode-safe), so it's the
// conservative choice when the actual operation is unknown.
const PATH_SHAPED_SURFACE_MODES: Record<string, SandboxMode> = {
  path: "edit",
  external_directory: "edit",
  read: "read",
  grep: "read",
  find: "read",
  ls: "read",
  write: "edit",
  edit: "edit",
};

export const SANDBOX_AUTHORIZER_NAME = "pi-small-models-sandbox";

// Built by concatenation rather than written as a string literal, so
// TypeScript's dynamic-import resolution can't statically resolve (and fail
// on) a package this project doesn't depend on — see the file-level comment.
const PERMISSION_SYSTEM_MODULE = ["@gotgenes", "pi-permission-system"].join("/");

/**
 * The pure decision an authorizer call boils down to, factored out so it's
 * directly unit-testable without needing the real package installed or a
 * live service to call through — `registerSandboxAuthorizer` below just
 * hands this to `registerAuthorizer` bound to a specific `root`.
 */
export function decideAuthorization(root: string, request: AuthorizeRequest): PermissionState | undefined {
  if (getSandboxState() !== "on") return undefined; // "off" defers entirely, see file header
  const mode = PATH_SHAPED_SURFACE_MODES[request.surface];
  if (!mode) return undefined;
  if (!request.value) return undefined;
  // fileIsSafe applies the *same* containment + restricted-glob check resolveSandboxPath would —
  // not just "is it in the project root" — so a credential path (.ssh/id_rsa, .env, .git/**, ...)
  // inside the root correctly does NOT get auto-allowed here, even though it's geometrically
  // inside the root: this project's own sandbox would reject it too, so permission-system's own
  // ask/deny for it must still be allowed to fire.
  return fileIsSafe(root, request.value, mode) ? "allow" : undefined;
}

let disposeAuthorizer: (() => void) | undefined;

/**
 * (Re-)registers the auto-allow authorizer against whatever project `root`
 * the current session is running in. Safe to call multiple times — e.g. once
 * per `session_start`, including on `/reload` — since any previous
 * registration this module owns is disposed first: permission-system throws
 * on a duplicate name, and its own registry is rebuilt fresh on every reload
 * anyway (its "Reload Safety" docs: re-register on every initialization
 * rather than caching).
 */
export async function registerSandboxAuthorizer(root: string): Promise<void> {
  teardownSandboxAuthorizer();

  let service: PermissionsServiceLike | undefined;
  try {
    const mod = (await import(PERMISSION_SYSTEM_MODULE)) as {
      getPermissionsService?: () => PermissionsServiceLike | undefined;
    };
    service = mod.getPermissionsService?.();
  } catch {
    return; // package not installed — nothing to integrate with
  }
  if (!service) return; // installed but not loaded/published for this session

  try {
    disposeAuthorizer = service.registerAuthorizer(SANDBOX_AUTHORIZER_NAME, (request) =>
      decideAuthorization(root, request)
    );
  } catch {
    // Registration itself failed (e.g. a stale instance's name wasn't
    // cleared yet) — leave disposeAuthorizer unset, nothing more to do.
  }
}

/** Call on session_shutdown so a stale registration doesn't outlive its session. */
export function teardownSandboxAuthorizer(): void {
  disposeAuthorizer?.();
  disposeAuthorizer = undefined;
}
