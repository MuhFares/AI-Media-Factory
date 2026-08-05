# Security Policy

This document describes the security policy for the AI Media Factory monorepo. It is a pre-production template and is expected to evolve as the platform matures toward general availability.

## Supported Versions

The following table indicates which versions of AI Media Factory currently receive security updates.

| Version | Supported |
| --- | --- |
| 0.1.x | Yes |
| < 0.1.0 | No |

As the project is pre-production, only the latest development line is supported. This table will be expanded once stable releases are published.

## Reporting a Vulnerability

We take security issues seriously and appreciate responsible disclosure.

- Report vulnerabilities privately to security@ai-media-factory.example.
- Do not open public issues, pull requests, or discussions for security-sensitive matters.
- Include a clear description, affected components, reproduction steps, and any relevant proof-of-concept material.

### Response SLA

| Stage | Target |
| --- | --- |
| Acknowledgement of report | Within 3 business days |
| Initial assessment and triage | Within 7 business days |
| Status updates | At least every 14 days until resolution |
| Remediation for critical issues | Prioritized and coordinated with the reporter |

We will coordinate a disclosure timeline with the reporter and credit contributors who wish to be acknowledged.

## Scope

This policy applies to the source code, services, and infrastructure definitions contained within this monorepo, including the apps, packages, agents, workflows, and configuration surfaces.

Out of scope items include third-party services not operated by the project, social engineering of personnel, and physical attacks against infrastructure.

## Secrets Management Policy

- No secrets, credentials, API keys, or tokens may be committed to version control under any circumstances.
- Use `.env` files for local development; these must be git-ignored and never shared through the repository.
- Use a dedicated secret manager for shared and production environments.
- Reference environment configuration through the `configs/environments` layout rather than embedding values in source.
- Rotate credentials promptly if exposure is suspected, and treat any committed secret as compromised.

## Dependency and Supply-Chain Policy

- Dependencies must be pinned to explicit versions to ensure reproducible builds.
- Lockfiles must be committed and kept in sync with manifest declarations.
- Dependency updates should be reviewed for provenance, license, and known vulnerabilities before adoption.
- Automated scanning of dependencies is expected as part of the continuous integration pipeline.

## Data Handling

- Classify data by sensitivity and apply appropriate access controls.
- Minimize collection and retention of sensitive data to what is strictly required.
- Runtime artifacts under the storage plane are git-ignored and must not be committed.
- Handle exported deliverables and rendered media as potentially sensitive, applying retention and disposal policies accordingly.

## Note

This document is a pre-production template. Contact addresses, SLAs, and supported version details are placeholders and must be reviewed and finalized prior to any production release.
