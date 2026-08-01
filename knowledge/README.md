# Knowledge Base

This directory is the curated knowledge base that powers agent retrieval (Retrieval-Augmented Generation, or RAG) across the AI Media Factory. Content here is human-curated markdown and structured data that is embedded into the vector store and retrieved by agents at runtime to inform their decisions and output.

## Distinction from `data/`

There is a deliberate separation between this directory and `data/`:

- **`data/`** holds raw and processed datasets — the factual, machine-generated, or ingested material of the system.
- **`knowledge/`** holds curated wisdom — human-authored, reviewed, and maintained guidance, playbooks, and frameworks intended for retrieval.

In short, `data/` is what the system has collected; `knowledge/` is what the organization has learned and deliberately chosen to teach its agents.

## Subfolders

| Subfolder | Purpose |
| --- | --- |
| `business/` | Company strategy, positioning, ideal customer profile, and brand voice. |
| `competitors/` | Competitor teardowns, benchmarks, and channel analysis. |
| `content/` | Content strategy, formats, hooks, and storytelling frameworks. |
| `youtube/` | YouTube-specific playbooks, algorithm notes, and best practices. |
| `tiktok/` | TikTok playbooks, trends, and format knowledge. |
| `instagram/` | Instagram and Reels playbooks and best practices. |
| `seo/` | SEO knowledge, keyword strategy, and on-page/off-page notes. |
| `analytics/` | Metric definitions, KPI glossary, and benchmark data. |
| `prompts/` | Proven prompt patterns and prompt engineering lessons. |
| `lessons/` | Post-mortems and lessons learned that feed continuous improvement. |

## Conventions

Content should be written as clear, self-contained markdown suitable for embedding and retrieval. Each document should focus on a single topic so that retrieved chunks remain coherent and useful.
