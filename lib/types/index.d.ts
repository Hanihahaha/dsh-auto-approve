/**
 * dsh-auto-approve type declarations (host half).
 */

/** Manual auto-approve mode shared by the command and the browser toggle. */
export type AutoApproveMode = "off" | "sandbox" | "all";

/** Carrier-neutral failure returned by one route endpoint. */
export interface AutoApproveRouteFailure {
  readonly code: string;
  readonly message: string;
  readonly details: object;
}

/** Result of one route endpoint call. */
export type AutoApproveRouteResult =
  | { readonly ok: true; readonly value: { readonly mode: AutoApproveMode } }
  | { readonly ok: false; readonly error: AutoApproveRouteFailure };

/**
 * Authenticated Fetch route the browser header toggle posts to, below
 * Connection's `/api` prefix. The `/api` carrier applies the trust fence and
 * the browser-session check before dispatch, and the route writes no session
 * event — and therefore no conversation row — for the toggle's reads and
 * writes.
 */
export declare const FETCH_PATH: "/api/dsh-auto-approve";

/** Plugin identity used by the Loader registry. */
export declare const name: "auto-approve";

/**
 * Apply one mode word to the process-local mode.
 * @param raw - user- or wire-supplied mode word (`all`/`on`, `sandbox`, `off`).
 * @returns the resulting mode, or undefined when the word is not a mode.
 */
export declare function parseMode(raw: unknown): AutoApproveMode | undefined;

/**
 * Serve one route endpoint: `status` reads the mode, `set` writes it.
 * Takes no context by design — the toggle must have no session to log into.
 * @param endpoint - route-relative endpoint name.
 * @param payload - endpoint-owned request payload.
 * @returns the result envelope for this endpoint.
 */
export declare function handleEndpoint(endpoint: string, payload: unknown): AutoApproveRouteResult;

/**
 * Answer one authenticated request on {@link FETCH_PATH}: validates the method
 * and JSON body, then dispatches through {@link handleEndpoint}.
 * @param request - the request the `/api` carrier already authenticated.
 * @returns the JSON envelope the browser half parses.
 */
export declare function serveRequest(request: Request): Promise<Response>;

/** Host plugin exports consumed by the dsh plugin loader. */
export interface AutoApprovePlugin {
  readonly name: "auto-approve";
  readonly apply: (ctx: unknown) => void;
}
