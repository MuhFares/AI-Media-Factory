from ai_media_factory.main import CommandRequest, command_room
import ai_media_factory.main as main


def test_single_agent_defaults_to_ask_agent(monkeypatch):
    captured = {}
    monkeypatch.setattr(main, "_runtime_request", lambda _path, _method, payload: captured.setdefault("payload", payload))
    command_room(CommandRequest(project_id="morroway", audience=["research"], message="idea"))
    assert captured["payload"]["mode"] == "ASK_AGENT"


def test_multiple_agents_default_to_multi_agent_review(monkeypatch):
    captured = {}
    monkeypatch.setattr(main, "_runtime_request", lambda _path, _method, payload: captured.setdefault("payload", payload))
    command_room(CommandRequest(project_id="morroway", audience=["research", "planner"], message="idea"))
    assert captured["payload"]["mode"] == "MULTI_AGENT_REVIEW"
