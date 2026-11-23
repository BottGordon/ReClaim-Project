import json
import logging
import os
import re
from contextlib import asynccontextmanager
from threading import Lock

import httpx
import uvicorn
from fastapi import FastAPI, Request, Response
from starlette.concurrency import run_in_threadpool

from admin import Admin
from auth import Auth, public_user
from common import ApiError, MAX_BODY_BYTES, clean
from records import Records
from storage import Store, load_environment

logger = logging.getLogger("uvicorn.error")
AUTH_ROUTES = {
    "register": Auth.registration,
    "start-registration": Auth.registration,
    "verify-registration-email": Auth.registration,
    "verify": Auth.legacy_verification,
    "resend-verification": Auth.legacy_verification,
    "forgot-password": Auth.reset,
    "verify-password-reset": Auth.reset,
    "reset-password": Auth.reset,
}


def json_response(status, payload):
    return Response(
        json.dumps(payload, separators=(",", ":"), allow_nan=False),
        status_code=status,
        media_type="application/json; charset=utf-8",
        headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"},
    )


def reject_constant(value):
    raise ValueError(f"Invalid JSON constant: {value}")


async def read_body(request):
    body = bytearray()
    async for chunk in request.stream():
        if len(body) + len(chunk) > MAX_BODY_BYTES:
            raise ApiError(413, "Request is too large.")
        body.extend(chunk)
    if not body:
        return {}
    try:
        data = json.loads(body.decode("utf-8", errors="replace"), parse_constant=reject_constant)
        if isinstance(data, dict):
            return data
    except (ValueError, RecursionError):
        pass
    raise ApiError(400, "Request body must be valid JSON.")


class Service:
    def __init__(self, store, client):
        self.auth = Auth(store, client)
        self.records = Records(store)
        self.admin = Admin(self.records)
        self.lock = Lock()
        self.routes = self.api_routes()

    def api_routes(self):
        auth, records, admin = self.auth, self.records, self.admin
        # Method, path, access level, JSON body, and endpoint handler.
        routes = [
            ("GET", r"/api/health", None, False, lambda *_: (200, {
                "ok": True, "service": "reclaim-api", "custodyDeskCount": len(records.desks),
            })),
            ("POST", r"/api/auth/supabase-session", None, True, lambda u, t, m, d: auth.exchange_session(d)),
            ("POST", r"/api/auth/login", None, True, lambda u, t, m, d: auth.login(d)),
            ("POST", r"/api/auth/logout", None, False, self.logout),
            ("GET", r"/api/auth/me", "user", False, lambda u, *_: (200, {"user": public_user(u)})),
            ("GET", r"/api/bootstrap", "user", False, self.bootstrap),
            ("GET", r"/api/items", "user", False, lambda u, *_: (200, {"items": records.visible_items(u)})),
            ("POST", r"/api/items", "user", True, lambda u, t, m, d: records.create_item(u, d)),
            ("POST", r"/api/items/([0-9]+)/verify-answer", "user", True, lambda u, t, m, d: records.verify_answer(u, m[1], d)),
            ("POST", r"/api/claims", "user", True, lambda u, t, m, d: records.create_claim(u, d)),
            ("PATCH", r"/api/claims/([0-9]+)", "user", True, lambda u, t, m, d: records.update_claim(u, int(m[1]), d)),
            ("PATCH", r"/api/items/([0-9]+)/(returned|undo-return)", "user", False, lambda u, t, m, d: records.update_return(u, m[1], m[2] == "undo-return")),
            ("GET", r"/api/notifications", "user", False, lambda u, *_: (200, {"notifications": records.inbox(u)})),
            ("PATCH", r"/api/notifications/([^/]+)", "user", True, lambda u, t, m, d: records.update_notification(u, m[1], d)),
            ("POST", r"/api/conversations", "user", True, lambda u, t, m, d: records.start_conversation(u, d)),
            ("POST", r"/api/conversations/([0-9]+)/messages", "user", True, lambda u, t, m, d: records.update_conversation(u, int(m[1]), d, False)),
            ("PATCH", r"/api/conversations/([0-9]+)/read", "user", False, lambda u, t, m, d: records.update_conversation(u, int(m[1]), d, True)),
            ("PATCH", r"/api/profile", "user", True, self.update_profile),
            ("PUT", r"/api/profile/password", "user", True, lambda u, t, m, d: auth.change_password(u, t, d)),
            ("GET", r"/api/admin/overview", "admin", False, lambda u, *_: admin.overview(u)),
            ("POST", r"/api/admin/items", "admin", True, lambda u, t, m, d: admin.log_walk_in(u, d)),
            ("PATCH", r"/api/admin/claims/([0-9]+)", "admin", True, lambda u, t, m, d: admin.update_claim(u, int(m[1]), d, False)),
            ("POST", r"/api/admin/claims/([0-9]+)/messages", "admin", True, lambda u, t, m, d: admin.update_claim(u, int(m[1]), d, True)),
            ("PATCH", r"/api/admin/items/([0-9]+)/(status|custody|privacy)", "admin", True, lambda u, t, m, d: admin.update_item(m[1], m[2], d)),
            ("POST", r"/api/admin/matches", "admin", True, lambda u, t, m, d: admin.link_match(u, d)),
            ("PATCH", r"/api/admin/desks/([a-z-]+)", "admin", True, lambda u, t, m, d: admin.update_desk(m[1], d)),
        ]
        for action, endpoint in AUTH_ROUTES.items():
            def handler(user, token, match, data, method=endpoint, name=action):
                return method(auth, name, data)

            routes.append(("POST", f"/api/auth/{action}", None, True, handler))
        return [(method, re.compile(path), access, body, handler) for method, path, access, body, handler in routes]

    def logout(self, user, token, match, data):
        self.auth.sessions.pop(token, None)
        return 200, {"ok": True}

    def bootstrap(self, user, token, match, data):
        admin = self.auth.is_admin(token)
        profile = public_user(user)
        profile["role"] = "Admin" if admin else user["accountType"]
        return 200, {"isAdmin": admin, "user": profile, **self.records.bootstrap(user)}

    def update_profile(self, user, token, match, data):
        if "photo" in data:
            photo = clean(data["photo"], 3 * 1024 * 1024)
            if photo and not re.fullmatch(r"data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+", photo):
                raise ApiError(400, "Upload a PNG, JPEG, or WebP profile photo.")
            user["photo"] = photo
        self.records.store.save()
        return 200, {"user": public_user(user)}

    def resolve(self, method, path):
        for verb, pattern, access, uses_body, handler in self.routes:
            if verb == method and (match := pattern.fullmatch(path)):
                return access, uses_body, handler, match
        if path.startswith("/api/admin/"):
            return "admin", False, lambda *_: (404, {"error": "Admin endpoint not found."}), None
        return "user", False, lambda *_: (404, {"error": "Endpoint not found."}), None

    def authorize(self, token, access):
        if access is None:
            return None
        user = self.auth.require_user(token)
        if access == "admin" and not self.auth.is_admin(token):
            raise ApiError(403, "Administrator access is required.", "ADMIN_REQUIRED")
        return user

    def check_session(self, token):
        with self.lock:
            self.auth.require_user(token)

    def respond(self, token, access, handler, match, data):
        # Keep authorization, state changes and response serialization consistent
        # when the ASGI server handles multiple requests at once.
        with self.lock:
            user = self.authorize(token, access)
            if isinstance(data, ApiError):
                raise data
            return json_response(*handler(user, token, match, data))


@asynccontextmanager
async def lifespan(app):
    load_environment()
    configured_origins = os.getenv("CORS_ORIGINS") or "http://localhost:8443"
    app.state.allowed_origins = {origin.strip() for origin in configured_origins.split(",") if origin.strip()}
    with httpx.Client(timeout=10, follow_redirects=False) as client:
        app.state.service = Service(Store(), client)
        yield


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)


@app.api_route("/{path:path}", methods=["GET", "POST", "PATCH", "PUT", "DELETE", "HEAD", "OPTIONS", "TRACE", "CONNECT"])
async def handle(request: Request):
    origin = request.headers.get("origin")
    allowed = origin in request.app.state.allowed_origins
    if request.method == "OPTIONS":
        response = Response(status_code=204) if allowed else json_response(403, {"error": "Origin not allowed."})
    else:
        response = await dispatch(request)
    if allowed:
        response.headers.update({
            "Access-Control-Allow-Origin": origin,
            "Vary": "Origin",
            "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
        })
    return response


async def dispatch(request):
    service = request.app.state.service
    raw_path = request.scope.get("raw_path")
    path = raw_path.decode("ascii", errors="replace") if raw_path else request.url.path
    access, uses_body, handler, match = service.resolve(request.method, path.rstrip("/") or "/")
    token = re.sub(r"^Bearer\s+", "", request.headers.get("authorization", ""), flags=re.I)
    try:
        data = {}
        if uses_body:
            if access is not None:
                await run_in_threadpool(service.check_session, token)
            try:
                data = await read_body(request)
            except ApiError as error:
                data = error
        return await run_in_threadpool(service.respond, token, access, handler, match, data)
    except ApiError as error:
        payload = {"error": str(error)}
        if error.code:
            payload["code"] = error.code
        return json_response(error.status, payload)
    except httpx.RequestError:
        logger.exception("ReClaim upstream request failed")
        return json_response(502, {"error": "An upstream service did not respond."})
    except Exception:
        logger.exception("ReClaim API request failed")
        return json_response(500, {"error": "Unexpected server error."})


if __name__ == "__main__":
    load_environment()
    host = os.getenv("API_HOST") or "127.0.0.1"
    port = int(os.getenv("API_PORT") or os.getenv("PORT") or "3001")
    uvicorn.run(app, host=host, port=port, workers=1)
