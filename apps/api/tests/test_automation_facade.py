"""Program 6 facade automation mapping (no network; _runtime_request mocked)."""
import ai_media_factory.main as main
from ai_media_factory.main import (
    automation_policy_set, AutomationPolicyRequest,
    automation_job_schedule, AutomationJobRequest,
    automation_budget_set, AutomationBudgetRequest,
    automation_tick, AutomationTickRequest,
    automation_explain, automation_measurement_schedule,
    AutomationMeasurementRequest, automation_learning_chain,
    AutomationLearningChainRequest, runtime_resource,
)


def _capture(monkeypatch):
    captured = {}

    def fake_runtime(path, method="GET", payload=None, owner_bearer=None):
        captured["path"] = path
        captured["method"] = method
        captured["payload"] = payload
        return {"ok": True}

    monkeypatch.setattr(main, "_runtime_request", fake_runtime)
    return captured


def test_policy_maps_fields(monkeypatch):
    captured = _capture(monkeypatch)
    automation_policy_set(AutomationPolicyRequest(
        project_id="studio", enabled=True, level="L2_GOVERNED",
        allowed_ops=["internal.prepare"], human_gated_ops=["workflow.resume"],
        provider_policy={"mode": "DENY_ALL"},
        publication_policy="PREPARE_ONLY", next_cycle_policy="OWNER_START_ONLY"))
    assert captured["path"] == "/control/automation/policy"
    assert captured["payload"]["projectId"] == "studio"
    assert captured["payload"]["enabled"] is True
    assert captured["payload"]["level"] == "L2_GOVERNED"
    assert captured["payload"]["nextCyclePolicy"] == "OWNER_START_ONLY"


def test_job_schedule_requires_idempotency_key(monkeypatch):
    captured = _capture(monkeypatch)
    automation_job_schedule(AutomationJobRequest(
        project_id="studio", job_type="eligible_work_evaluation",
        idempotency_key="idem-1"))
    assert captured["path"] == "/control/automation/jobs"
    assert captured["payload"]["idempotencyKey"] == "idem-1"


def test_budget_tick_explain_map(monkeypatch):
    captured = _capture(monkeypatch)
    automation_budget_set(AutomationBudgetRequest(
        project_id="studio", call_kind="llm", limit_count=10))
    assert captured["path"] == "/control/automation/budgets"
    assert captured["payload"]["limitCount"] == 10
    automation_tick(AutomationTickRequest(project_id="studio", max_actions=3))
    assert captured["path"] == "/control/automation/tick"
    assert captured["payload"]["maxActions"] == 3
    automation_explain({"project_id": "studio"})
    assert captured["path"] == "/control/automation/explain"
    assert captured["payload"]["projectId"] == "studio"


def test_measurement_and_learning_map(monkeypatch):
    captured = _capture(monkeypatch)
    automation_measurement_schedule(AutomationMeasurementRequest(
        project_id="studio", idempotency_key="m-1", channel_id="channel-1"))
    assert captured["path"] == "/control/automation/analytics/measurements"
    assert captured["payload"]["channelId"] == "channel-1"
    automation_learning_chain(AutomationLearningChainRequest(
        project_id="studio", observation_id="obs-1"))
    assert captured["path"] == "/control/automation/learning/chain"
    assert captured["payload"]["observationId"] == "obs-1"


def test_runtime_resource_allows_automation_reads(monkeypatch):
    captured = _capture(monkeypatch)
    runtime_resource("automation-status", project_id="studio")
    assert captured["path"].startswith("/control/automation/status")
    runtime_resource("automation-overview", project_id="studio")
    assert captured["path"] == "/control/automation/overview"
    runtime_resource("automation-policy", project_id="studio")
    assert captured["path"].startswith("/control/automation/policy")
