# Apps

Runtime applications for the AI Media Factory operating system. Four apps make up the runtime: `api`, `web`, `worker`, and `orchestrator`. Each is independently deployable and communicates with the others through HTTP and a shared job queue.

## api

The `api` app is the HTTP control plane. It exposes the public and internal endpoints used to manage projects, media assets, and workflow definitions. It authenticates callers, validates requests, persists state through the database package, and enqueues work for downstream apps. It is the single front door for the `web` dashboard and external integrations.

## web

The `web` app is the SaaS dashboard. It is the primary human-facing surface where operators create projects, configure agents, monitor jobs, and review generated media. It talks only to the `api` control plane and never directly to the worker or orchestrator, keeping the control plane authoritative for all state changes.

## worker

The `worker` app performs background and media processing. It consumes jobs placed on the queue by `api` and `orchestrator`, running long or resource intensive tasks such as video rendering, image generation, and FFmpeg processing. Workers scale horizontally and report progress and results back through the shared datastores.

## orchestrator

The `orchestrator` app is the AI workflow brain. It loads agent definitions, composes them into graphs and crews, and drives multi step AI workflows. When a workflow needs heavy media processing, the orchestrator delegates that work to the `worker` app rather than performing it inline, keeping AI reasoning and media rendering cleanly separated.

## Request and Job Flow

```
        +-----+        HTTP        +-----+
        | web | -----------------> | api |
        +-----+                    +-----+
                                      |
                          enqueue     |     enqueue
                     +----------------+----------------+
                     |                                 |
                     v                                 v
              +--------------+                  +-------------+
              | orchestrator |  --- delegate -> |   worker    |
              +--------------+   media jobs     +-------------+
                     |                                 |
                     +-------- results / state --------+
                                      |
                                      v
                                 datastores
```

The `web` dashboard sends requests to `api`. The `api` control plane enqueues workflow jobs for the `orchestrator` and media jobs for the `worker`. The `orchestrator` may further delegate heavy media tasks to the `worker`. Both apps write results and state back to the shared datastores, where `api` reads them to serve the dashboard.
