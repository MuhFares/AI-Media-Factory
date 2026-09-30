import ai_media_factory.main as main
from ai_media_factory.main import (
    ProductionBriefRequest, RevisionRequest, VisualReviewRequest,
    FinalApprovalRequest, MetadataRequest, content_brief,
    content_start_production, content_revision, content_visual_review,
    content_final_approval, content_metadata, content_publication_prepare,
)


def _capture(monkeypatch):
    captured = {}
    def fake(path, method="GET", payload=None, owner_bearer=None):
        captured.update(path=path, method=method, payload=payload)
        return {"ok": True}
    monkeypatch.setattr(main, "_runtime_request", fake)
    return captured


def test_owner_product_mutations_map_to_canonical_control_routes(monkeypatch):
    c = _capture(monkeypatch)
    content_brief("content-1", ProductionBriefRequest(brief={"topic": "x"}))
    assert c["path"] == "/control/content/content-1/brief"
    content_start_production("content-1")
    assert c["path"].endswith("/start-production")
    content_revision("content-1", RevisionRequest(layer="IMAGE", owner_feedback="change", reason="mismatch"))
    assert c["payload"]["layer"] == "IMAGE"
    content_visual_review("content-1", VisualReviewRequest(
        artifact_id="art-1", technical_qa={"technicalValidity": "PASS"},
        semantic_qa="HUMAN_REVIEW_REQUIRED", owner_acceptance="ACCEPTED"))
    assert c["path"].endswith("/visual-reviews")
    content_final_approval("content-1", FinalApprovalRequest(final_artifact_id="final-1", rationale="reviewed"))
    assert c["payload"]["finalArtifactId"] == "final-1"
    content_metadata("content-1", MetadataRequest(title="Title", description="Description", visibility="private"))
    assert c["payload"]["visibility"] == "private"
    content_publication_prepare("content-1")
    assert c["path"].endswith("/publication-preparations")
    assert c["method"] == "POST"
