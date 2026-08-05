# Checkpoints

Workflow and agent checkpoints for AI Media Factory.

Contents are runtime-generated and git-ignored; this README and .gitkeep anchor the folder in version control.

## What lives here

- Workflow checkpoints: captured state of long-running workflows at defined points.
- Agent checkpoints: captured agent state for durable continuity.

Checkpoints enable resume (continuing an interrupted run from its last saved point), replay (re-executing from a known state for inspection or reproduction), and recovery (restoring a run after failure without starting over). They are essential for the reliability of long-running processes.
