/**
 * dsh-auto-approve type declarations (host half).
 */

export interface AutoApprovePlugin {
  readonly name: "auto-approve";
  readonly apply: (ctx: unknown) => void;
}
