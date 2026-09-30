/**
 * M4 YouTube runtime safety layer (validation-mode private upload path).
 *
 * Fail-closed pre-upload order — this module STOPS before upload:
 *
 *   load external credential → validate scopes → mint access token →
 *   channels.list(mine=true) → exact controlled-channel assertion →
 *   exact private-visibility assertion → M4 budget checks → READY bundle.
 *
 * The READY bundle hands an ephemeral access token, verified channel id,
 * and visibility="private" to the future M4 executor. This module never
 * calls publish, never touches the database, grants no authority, and
 * logs no secrets. Channel identity is exact ID equality only — never
 * title, handle, email, or filename.
 */
import {
  readCredential, refreshAccessToken, verifyChannel,
  YOUTUBE_OAUTH_SCOPES,
  type OAuthTransport, type DurableCredential,
} from "./youtube-oauth.js";
import { requirePrivateVisibility } from "../adapters/publishing.js";

/** Owner-declared M4 controlled channel (Morroway). */
export const M4_CONTROLLED_CHANNEL_ID = "UCA5ECzcK_96akfUT5fQUT3A";

/** Previously OAuth-tested channel. NEVER valid for M4. */
export const M4_REJECTED_CHANNEL_ID = "UCCzGNVr5YQP_DC8zKOGIONA";

/** Scopes the persisted grant must contain (never broadened here). */
export const M4_REQUIRED_SCOPES: readonly string[] = [...YOUTUBE_OAUTH_SCOPES];

export interface M4BudgetPolicy {
  readonly privateUploadsMax: 1;
  readonly publicUploadsMax: 0;
  readonly unlistedUploadsMax: 0;
}

export const M4_BUDGET: M4BudgetPolicy = {
  privateUploadsMax: 1, publicUploadsMax: 0, unlistedUploadsMax: 0,
};

export interface M4ReadyBundle {
  readonly accessToken: string;
  readonly channelId: string;
  readonly channelTitle: string;
  readonly visibility: "private";
}

export class M4GuardError extends Error {}

/** Proof from credential metadata that the grant covers every M4 scope. */
export function assertCredentialScopes(cred: DurableCredential): void {
  const have = new Set(cred.scopes);
  for (const scope of M4_REQUIRED_SCOPES) {
    if (!have.has(scope)) throw new M4GuardError(`M4_SCOPE_MISSING:${scope}`);
  }
}

/** Exact channel-ID equality. Anything else fails closed before upload. */
export function assertControlledChannel(channelId: string): void {
  if (channelId !== M4_CONTROLLED_CHANNEL_ID) {
    throw new M4GuardError("M4_CHANNEL_MISMATCH");
  }
}

function assertM4Budget(policy: M4BudgetPolicy): void {
  if (policy.privateUploadsMax !== 1 || policy.publicUploadsMax !== 0 || policy.unlistedUploadsMax !== 0) {
    throw new M4GuardError("M4_BUDGET_POLICY_INVALID");
  }
}

export interface M4PrepareDeps {
  readFile(path: string): Promise<string>;
}

export interface M4PrepareInput {
  readonly credentialPath: string;
  readonly requestedVisibility: unknown;
  readonly budget?: M4BudgetPolicy;
}

/**
 * Execute every pre-upload check in fail-closed order and return the
 * READY bundle. Stops before upload: no publisher is invoked here.
 * Secrets never appear in thrown messages.
 */
export async function prepareM4Upload(
  deps: M4PrepareDeps,
  transport: OAuthTransport,
  input: M4PrepareInput,
): Promise<M4ReadyBundle> {
  const cred = await readCredential(deps, input.credentialPath).catch(() => {
    throw new M4GuardError("M4_CREDENTIAL_UNAVAILABLE");
  });
  assertCredentialScopes(cred);
  const minted = await refreshAccessToken(transport, cred).catch(() => {
    throw new M4GuardError("M4_TOKEN_REFRESH_FAILED");
  });
  const channel = await verifyChannel(transport, minted.accessToken).catch(() => {
    throw new M4GuardError("M4_CHANNEL_UNRESOLVED");
  });
  assertControlledChannel(channel.channelId);
  const visibility = requirePrivateVisibility(input.requestedVisibility);
  assertM4Budget(input.budget ?? M4_BUDGET);
  return {
    accessToken: minted.accessToken, channelId: channel.channelId,
    channelTitle: channel.channelTitle, visibility,
  };
}
