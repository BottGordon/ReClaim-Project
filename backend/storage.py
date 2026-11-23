import json
import os
from pathlib import Path
from common import ApiError

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
    def __init__(self, client=None):
        mode = os.getenv("RECLAIM_STORAGE") or ("supabase" if os.getenv("RENDER") == "true" and os.getenv("IS_PULL_REQUEST") != "true" else "file")
        if mode not in ("supabase", "file"):
            raise RuntimeError("RECLAIM_STORAGE must be supabase or file.")
        self.remote = mode == "supabase"
        self.client = client
        self.revision = None
        self.needs_reload = False
        if self.remote:
            url = os.getenv("SUPABASE_URL") or os.getenv("VITE_SUPABASE_URL")
            key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
            if not url or not key or client is None:
                raise RuntimeError("Supabase record storage requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.")
            self.endpoint = url.rstrip("/") + "/rest/v1/reclaim_record_store"
            self.headers = {"apikey": key, "Authorization": f"Bearer {key}", "Prefer": "return=representation"}
        directory = Path(os.getenv("RECLAIM_DATA_DIR") or ROOT / "data")
        if not self.remote:
            directory.mkdir(parents=True, exist_ok=True)
        self.file = directory / "reclaim.json"
        desks = json.loads((PROJECT / "shared/custodyDesks.json").read_text(encoding="utf-8"))
        saved = self.load_remote() if self.remote else None
        if saved is None:
            try:
                saved = json.loads(self.file.read_text(encoding="utf-8"))
            except FileNotFoundError:
                saved = {}

        self.data = {key: [] for key in ("users", "items", "claims", "conversations", "notifications", "matches")}
        self.data.update({"desks": desks, **saved})
        if not isinstance(self.data["items"], list) or not self.data["items"]:
            self.data["items"] = json.loads((ROOT / "seed_items.json").read_text(encoding="utf-8"))
        self.update_desks(desks)
        self.snapshot = json.dumps(self.data, allow_nan=False)
        if self.data != saved or (self.remote and self.revision is None):
            self.save()

    def load_remote(self):
        response = self.client.get(self.endpoint, headers=self.headers, params={"id": "eq.workspace"})
        if not response.is_success:
            raise ApiError(503, "Could not load the persistent ReClaim records. Check the storage migration and server configuration.")
        rows = response.json()
        if not rows:
            return None
        self.revision = rows[0]["revision"]
        return rows[0]["payload"]

    def reload_after_failed_save(self):
        if not self.needs_reload:
            return
        saved = self.load_remote()
        if saved is None:
            raise ApiError(503, "Could not reload the persistent ReClaim records. Try again shortly.")
        self.restore(saved)
        self.snapshot = json.dumps(self.data, allow_nan=False)
        self.needs_reload = False

    def restore(self, saved):
        # Auth and Records retain references to the workspace lists.
        for key, value in list(self.data.items()):
            if isinstance(value, list):
                value[:] = saved.get(key, [])
            elif key not in saved:
                del self.data[key]
        for key, value in saved.items():
            if not isinstance(self.data.get(key), list):
                self.data[key] = value

    def save_remote(self):
        revision = 1 if self.revision is None else self.revision + 1
        payload = {"revision": revision, "payload": self.data}
        # Return only the revision so PostgREST does not send the workspace and its images back.
        params = {"select": "revision"}
        if self.revision is None:
            response = self.client.post(self.endpoint, headers=self.headers, json={"id": "workspace", **payload},
                                        params=params, timeout=30)
        else:
            params.update({"id": "eq.workspace", "revision": f"eq.{self.revision}"})
            response = self.client.patch(self.endpoint, headers=self.headers, json=payload,
                                         params=params, timeout=30)
        if not response.is_success or not response.json():
            raise ApiError(503, "Could not save the persistent ReClaim records. Try again shortly.")
        self.revision = revision

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
            snapshot = json.dumps(self.data, allow_nan=False)
            if self.remote:
                self.save_remote()
            else:
                temporary.write_text(snapshot, encoding="utf-8")
                temporary.replace(self.file)
            self.snapshot = snapshot
        except Exception:
            self.restore(json.loads(self.snapshot))
            self.needs_reload = self.remote
            raise
