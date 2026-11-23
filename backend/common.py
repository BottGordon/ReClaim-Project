import re
import secrets
import time
from datetime import datetime, timezone

MAX_IMAGE_BYTES = 5 * 1024 * 1024
MAX_BODY_BYTES = 7 * 1024 * 1024
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


def phone_number(value):
    text = clean(value, 40)
    if not re.fullmatch(r"\+?[0-9 ()-]+", text):
        raise ApiError(400, "Enter a valid contact number with 7 to 15 digits.")
    digits = re.sub(r"[^0-9]", "", text)
    international = text.startswith("+") or digits.startswith("00")
    if not text.startswith("+") and digits.startswith("00"):
        digits = digits[2:]
    if not 7 <= len(digits) <= 15:
        raise ApiError(400, "Enter a valid contact number with 7 to 15 digits.")
    if international and digits.startswith("0"):
        raise ApiError(400, "Enter a valid international contact number.")
    if not international and re.fullmatch(r"0[2-9][0-9]{8,9}", digits):
        digits = "63" + digits[1:]
        international = True
    return ("+" if international or re.fullmatch(r"63[2-9][0-9]{8,9}", digits) else "") + digits


def student_number(value):
    digits = re.fullmatch(r"([0-9]{4})-?([0-9]{5})", clean(value, 20))
    if not digits:
        raise ApiError(400, "Enter your nine-digit student number.")
    return digits[1] + digits[2]


def valid_upload(value, media_types, max_bytes=MAX_IMAGE_BYTES):
    if not isinstance(value, str):
        return False
    header, separator, encoded = value.partition(",")
    if not separator or not any(header == f"data:{media};base64" for media in media_types):
        return False
    if len(encoded) > ((max_bytes + 2) // 3) * 4 or len(encoded) % 4:
        return False
    return bool(re.fullmatch(r"[A-Za-z0-9+/]+={0,2}", encoded)) and (
        len(encoded) // 4 * 3 - (len(encoded) - len(encoded.rstrip("="))) <= max_bytes
    )
