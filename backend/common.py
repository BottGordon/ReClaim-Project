import re
import secrets
import time
from datetime import datetime, timezone

MAX_BODY_BYTES = 6 * 1024 * 1024
PASSWORD_RULE = "Password must be 8+ characters and include an uppercase letter, a number, and a special character."


class ApiError(Exception):
    def __init__(self, status, message, code=None):
        super().__init__(message)
        self.status = status
        self.code = code


def clean(value, limit=500):
    if value is None:
        return ""
    if isinstance(value, bool):
        value = str(value).lower()
    elif isinstance(value, list):
        value = ",".join(clean(entry, limit) for entry in value)
    elif isinstance(value, dict):
        value = "[object Object]"
    # The existing limits are measured in UTF-16 code units.
    return str(value).strip().encode("utf-16-le", "surrogatepass")[:limit * 2].decode("utf-16-le", "surrogatepass")


def required(value, label, limit=500):
    result = clean(value, limit)
    if not result:
        raise ApiError(400, f"{label} is required.")
    return result


def identifier(prefix):
    return prefix + secrets.token_hex(12)


def milliseconds():
    return time.time_ns() // 1_000_000


def timestamp():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def display_date():
    now = datetime.now()
    return f"{now:%b} {now.day}, {now.year}"


def find(records, **fields):
    return next((entry for entry in records if all(entry.get(key) == value for key, value in fields.items())), None)


def item_id(value):
    try:
        return float(value) if isinstance(value, (int, float, str)) and not isinstance(value, bool) else None
    except ValueError:
        return None


def json_truth(value):
    return True if isinstance(value, (list, dict)) else bool(value)
