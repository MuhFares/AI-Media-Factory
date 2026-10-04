# AMF Balanced Routing Runtime Integration V1

The Morroway worker now resolves text-model routes from active project-scoped `production_model_routing_versions` / `production_model_routing_entries` before constructing its existing provider boundary. Runtime precedence is: explicitly requested approved slot → active Morroway project routing → approved global default when present → legacy configuration only for projects without canonical routing. Morroway never falls through to environment or historical AgentRouter defaults when canonical resolution fails.

The resolved input carries routing version, profile, slot, exact model, fallback/premium flags, resolution reason, and immutable price-snapshot ID into existing execution provenance configuration. Premium escalation requires an explicit authorization marker. Missing role, missing active version, unavailable approved slot, or missing catalog/price evidence fails closed.

Research retrieval stays separate: governed search/social capabilities collect evidence; the canonical `research` route controls synthesis only. The nine deterministic/provider-specific roles remain outside text-model routing. Legacy AgentRouter configuration is retained for non-canonical projects and historical evidence only.

The Model Intelligence Routing tab is the compact read-only operational view of the active Morroway version. It groups Executive, Research, Creative, Quality, and Business Intelligence routes and displays the benchmark-derived USD 0.0024 estimate as an estimate—not billing.
