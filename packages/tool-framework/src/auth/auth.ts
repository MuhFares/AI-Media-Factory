/**
 * Tool Authentication (Req #11).
 * ARCHITECTURE ONLY — declarations, no logic.
 */

export type AuthRequirement =
  | { type: "none" }
  | { type: "api_key"; keyName: string }
  | { type: "oauth2"; provider: string; scopes: string[] }
  | { type: "bearer_token"; tokenName: string }
  | { type: "mTLS"; certName: string }
  | { type: "aws_iam"; roleArn: string }
  | { type: "gcp_iam"; serviceAccount: string }
  | { type: "custom"; handler: string };

export interface CredentialResolver {
  resolve(requirements: AuthRequirement[], context: AuthContext): Promise<ResolvedCredentials>;
}

export interface ResolvedCredentials {
  headers?: Record<string, string>;
  queryParams?: Record<string, string>;
  bodyParams?: Record<string, string>;
  envVars?: Record<string, string>;
  certificates?: Certificate[];
}

export interface Certificate {
  name: string;
  cert: string;
  key?: string;
}

export interface AuthContext {
  agent: string;
  toolId: string;
  workflowId?: string;
  environment: "development" | "staging" | "production";
}

export interface CredentialStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  delete(key: string): Promise<void>;
}