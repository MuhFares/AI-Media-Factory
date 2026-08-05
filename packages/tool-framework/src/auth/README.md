# Authentication

> Contracts only — declarations, no logic.

| File | Defines | Req |
|---|---|---|
| `auth.ts` | `AuthRequirement`, `CredentialResolver`, `ResolvedCredentials`, `CredentialStore` | #11 |

Supports: API key, OAuth2, Bearer token, mTLS, AWS IAM, GCP IAM, custom handlers. Credentials resolved at invocation time from secure store, never logged.