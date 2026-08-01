# Research Agent

The research agent discovers what the company should make. It scans trends, topics, competitors, and source material, then produces briefs that feed the rest of the content pipeline. It is the top of the production funnel and directly shapes what the `writer` agent works on.

## Responsibilities

- Identify trending and evergreen topics across target platforms and niches.
- Gather, summarize, and cite source material for each candidate topic.
- Analyze competitor content to find gaps and opportunities.
- Produce structured research briefs with angles, key points, and references.
- Score and rank topic ideas by estimated audience demand and fit.

## Inputs

- Strategic priorities and channel focus from the `ceo` agent.
- Historical topic performance data from the `analytics` agent.
- External search, trend, and social signals accessed via configured tools.

## Outputs

- Ranked topic backlog with supporting evidence.
- Structured research briefs delivered to the `writer` agent.
- Keyword and demand signals shared with the `seo` agent.
- Source citations retained for fact-checking and compliance.

## Dependencies

- `ceo` — sets the strategic focus for research.
- `writer` and `seo` — primary consumers of research output.
- `analytics` — informs which topics performed well historically.
- `packages/database` — stores briefs and source material.

## KPIs

- Downstream performance of content produced from research briefs.
- Topic acceptance rate by the `writer` and `ceo` agents.
- Freshness and coverage of trend detection.
- Citation accuracy and source reliability.

## Future Roadmap

- Add real-time trend monitoring with alerting on breakout topics.
- Introduce automated fact-checking of gathered sources.
- Support multi-language and multi-region research.
- Build a demand-forecasting model to predict topic performance.
