/**
 * dsh-auto-approve type declarations (host half).
 */

/** Manual auto-approve mode shared by the command and the browser toggle. */
export type AutoApproveMode = "off" | "sandbox" | "all";

/** Carrier-neutral failure returned by one private-channel endpoint. */
export interface AutoApproveRpcFailure {
  readonly code: string;
  readonly message: string;
  readonly details: object;
}

/** Result of one private-channel endpoint call. */
export type AutoApproveRpcResult =
  | { readonly ok: true; readonly value: { readonly mode: AutoApproveMode } }
  | { readonly ok: false; readonly error: AutoApproveRpcFailure };

/**
 * Logical Connection RPC channel the browser header toggle calls. The host half
 * mounts it on its own web route, so no session event — and therefore no
 * conversation row — is written for the toggle's reads and writes.
 */
export declare const RPC_CHANNEL: "/dsh-auto-approve";

/** Plugin identity used by the Loader registry. */
export declare const name: "auto-approve";

/**
 * Apply one mode word to the process-local mode.
 * @param raw - user- or wire-supplied mode word (`all`/`on`, `sandbox`, `off`).
 * @returns the resulting mode, or undefined when the word is not a mode.
 */
export declare function parseMode(raw: unknown): AutoApproveMode | undefined;

/**
 * Serve one private-channel endpoint: `status` reads the mode, `set` writes it.
 * Takes no context by design — the toggle must have no session to log into.
 * @param endpoint - channel-relative endpoint name.
 * @param payload - endpoint-owned request payload.
 * @returns the Connection RPC result for this endpoint.
 */
export declare function rpcHandler(endpoint: string, payload: unknown): Promise<AutoApproveRpcResult>;

/** Host plugin exports consumed by the dsh plugin loader. */
export interface AutoApprovePlugin {
  readonly name: "auto-approve";
  readonly apply: (ctx: unknown) => void;
}
