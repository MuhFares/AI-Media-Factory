# CEO Agent

The CEO agent is the top of the org chart. It sets strategy for the digital media company, prioritizes what gets produced, and supervises every specialist agent. It does not perform production work itself; it decides what work matters and holds the other agents accountable to outcomes.

## Responsibilities

- Define and maintain the company's content strategy, editorial direction, and channel priorities.
- Translate high-level business goals into concrete initiatives and delegate them to specialist agents.
- Supervise all specialist agents, resolve conflicts between them, and approve or reject major decisions.
- Allocate budget and attention across `research`, `writer`, `video`, and `growth` based on expected return.
- Review company-wide performance and adjust strategy in response to results.

## Inputs

- Business objectives, target platforms, and constraints supplied by the human operator.
- Aggregated performance and insight reports from the `analytics` agent.
- Budget and unit-economics summaries from the `finance` agent.
- Growth experiment outcomes and audience signals from the `growth` agent.

## Outputs

- Prioritized initiative backlog and strategic directives for the `orchestrator` agent to execute.
- Resource and budget allocations passed to `finance` for enforcement.
- Editorial guidelines and quality bars distributed to production agents.
- Go / no-go decisions on campaigns, series, and major content bets.

## Dependencies

- `orchestrator` — turns CEO directives into executable workflows.
- `analytics` and `finance` — supply the data the CEO reasons over.
- `growth` — provides audience-side inputs to strategy.
- All specialist agents report upward to the CEO within the org-chart model.

## KPIs

- Alignment of executed work with stated strategic priorities.
- Portfolio-level return on content investment.
- Decision quality measured against downstream performance outcomes.
- Timeliness of strategic direction relative to market and trend shifts.

## Future Roadmap

- Introduce scenario planning across multiple content strategies.
- Add automated re-prioritization triggered by `analytics` thresholds.
- Support multi-brand or multi-channel portfolio governance.
- Formalize an approval policy layer for high-risk or high-cost initiatives.
