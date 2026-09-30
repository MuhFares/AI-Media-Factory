"""Durable, traversal-safe Wan reconciliation receipts (stdlib only)."""

import hashlib
import json
import os
import uuid


def receipt_path(receipt_dir: str, client_execution_id: str) -> str:
    identity_hash = hashlib.sha256(client_execution_id.encode("utf-8")).hexdigest()
    return os.path.join(receipt_dir, f"{identity_hash}.json")


def load_receipt(receipt_dir: str, client_execution_id: str):
    path = receipt_path(receipt_dir, client_execution_id)
    if not os.path.exists(path):
        return None
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def persist_receipt(receipt_dir: str, client_execution_id: str, receipt: dict):
    os.makedirs(receipt_dir, exist_ok=True)
    path = receipt_path(receipt_dir, client_execution_id)
    temp = path + f".tmp.{uuid.uuid4().hex[:8]}"
    with open(temp, "w", encoding="utf-8") as handle:
        json.dump(receipt, handle, sort_keys=True)
    os.replace(temp, path)
