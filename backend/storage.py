import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PROJECT = ROOT.parent


def load_environment():
    try:
        lines = (PROJECT / ".env").read_text(encoding="utf-8").splitlines()
    except FileNotFoundError:
        return
    for line in lines:
        key, separator, value = line.partition("=")
        key, value = key.strip(), value.strip()
        if separator and key and key.isascii() and key.isidentifier() and not os.getenv(key):
            if len(value) >= 2 and value[0] in "\"'" and value[-1] == value[0]:
                value = value[1:-1]
            os.environ[key] = value


class Store:
    def __init__(self):
        directory = Path(os.getenv("RECLAIM_DATA_DIR") or ROOT / "data")
        directory.mkdir(parents=True, exist_ok=True)
        self.file = directory / "reclaim.json"
        desks = json.loads((PROJECT / "shared/custodyDesks.json").read_text(encoding="utf-8"))
        try:
            saved = json.loads(self.file.read_text(encoding="utf-8"))
        except FileNotFoundError:
            saved = {}

        self.data = {key: [] for key in ("users", "items", "claims", "conversations", "notifications", "matches")}
        self.data.update({"desks": desks, **saved})
        if not isinstance(self.data["items"], list) or not self.data["items"]:
            self.data["items"] = json.loads((ROOT / "seed_items.json").read_text(encoding="utf-8"))
        self.update_desks(desks)
        if self.data != saved:
            self.save()

    def update_desks(self, desks):
        aliases = {"vault": "osds", "library-security": "library", "main-gate": "gate"}
        previous = {desk["id"]: desk for desk in self.data["desks"] or []}
        current_ids = {desk["id"] for desk in desks}
        updated = []
        for desk in desks:
            existing = previous.get(desk["id"])
            if existing is None:
                existing = next((entry for key, entry in previous.items() if aliases.get(key) == desk["id"]), {})
            active = existing.get("active")
            updated.append({**desk, "active": desk["active"] if active is None else active})
        self.data["desks"] = updated

        for item in self.data["items"]:
            desk_id = item.get("custodyDeskId")
            if not desk_id or desk_id in current_ids:
                continue
            if desk_id in aliases:
                item["custodyDeskId"] = aliases[desk_id]
            else:
                item["previousCustodyDesk"] = (
                    previous.get(desk_id, {}).get("name")
                    or item.get("previousCustodyDesk")
                    or "Former custody desk"
                )
                item.pop("custodyDeskId")

    def save(self):
        temporary = self.file.with_suffix(".json.tmp")
        try:
            temporary.write_text(json.dumps(self.data, indent=2, allow_nan=False), encoding="utf-8")
            temporary.replace(self.file)
        except (OSError, ValueError):
            if self.file.exists():
                saved = json.loads(self.file.read_text(encoding="utf-8"))
                for key, value in self.data.items():
                    if isinstance(value, list):
                        value[:] = saved.get(key, [])
            raise
