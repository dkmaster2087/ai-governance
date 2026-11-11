"""Check the X-Probaline-Identity header on a Python API (FastAPI or Flask).

Only calls that came through Probaline carry a valid one: a five-minute ES256 token naming who asked.
Needs PyJWT with crypto support:  pip install "pyjwt[crypto]>=2.8"

    verifier = ProbalineIdentity(issuer="https://gateway.acme.example", audience="https://hr.acme.example/api")

    # FastAPI
    @app.get("/employees/{id}")
    def get_employee(id: str, who: dict = Depends(verifier.fastapi_dependency())): ...

    # Flask
    @app.get("/employees/<id>")
    @verifier.flask_required
    def get_employee(id): who = flask.g.probaline

Set report_only=True first: calls without a valid identity are logged, not refused.
"""
import logging
import jwt
from jwt import PyJWKClient

HEADER = "X-Probaline-Identity"
TOKEN_TYPE = "probaline-identity+jwt"
log = logging.getLogger("probaline")


class IdentityError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


class ProbalineIdentity:
    def __init__(self, issuer, audience, jwks_url=None, leeway=30, report_only=False):
        self.issuer = issuer.rstrip("/")
        self.audience = audience.rstrip("/")
        self.leeway = leeway
        self.report_only = report_only
        self.jwks = PyJWKClient(jwks_url or self.issuer + "/.well-known/jwks.json", cache_keys=True, lifespan=300)

    def verify(self, token):
        if not token:
            raise IdentityError("missing", "No X-Probaline-Identity header: the call didn't come through Probaline")
        try:
            header = jwt.get_unverified_header(token)
        except jwt.PyJWTError:
            raise IdentityError("malformed", "The identity token is malformed")
        # Only ES256: never "none", never a shared secret.
        if header.get("alg") != "ES256" or header.get("typ") != TOKEN_TYPE:
            raise IdentityError("wrong_type", "Not a Probaline identity token")
        try:
            key = self.jwks.get_signing_key(header.get("kid")).key
        except jwt.PyJWKClientError as e:
            raise IdentityError("unknown_key", f"Couldn't find Probaline's key: {e}")
        try:
            claims = jwt.decode(token, key, algorithms=["ES256"], leeway=self.leeway,
                                options={"verify_aud": False, "verify_iss": False, "require": ["exp", "iat", "iss", "aud", "sub"]})
        except jwt.ExpiredSignatureError:
            raise IdentityError("expired", "The identity token has expired")
        except jwt.ImmatureSignatureError:
            raise IdentityError("not_yet_valid", "The identity token isn't valid yet")
        except jwt.InvalidSignatureError:
            raise IdentityError("bad_signature", "The identity token's signature is wrong")
        except jwt.PyJWTError as e:
            raise IdentityError("malformed", f"The identity token is invalid: {e}")
        # Issuer and audience compared without a trailing slash.
        if str(claims["iss"]).rstrip("/") != self.issuer:
            raise IdentityError("wrong_issuer", "The identity token is from a different Probaline gateway")
        auds = claims["aud"] if isinstance(claims["aud"], list) else [claims["aud"]]
        if self.audience not in [str(a).rstrip("/") for a in auds]:
            raise IdentityError("wrong_audience", "The identity token is for a different API")
        return claims

    def check(self, token, method="", path=""):
        """The identity, None when report-only let the call through, or raises IdentityError."""
        try:
            return self.verify(token)
        except IdentityError as e:
            log.warning("Call without a valid Probaline identity: %s %s %s %s", e.code, e, method, path)
            if self.report_only:
                return None
            raise

    def fastapi_dependency(self):
        from fastapi import HTTPException, Request

        def dependency(request: Request):
            try:
                return self.check(request.headers.get(HEADER), request.method, request.url.path)
            except IdentityError as e:
                raise HTTPException(status_code=401, detail={"error": str(e), "code": e.code})
        return dependency

    def flask_required(self, view):
        from functools import wraps
        from flask import g, jsonify, request

        @wraps(view)
        def wrapped(*args, **kwargs):
            try:
                g.probaline = self.check(request.headers.get(HEADER), request.method, request.path)
            except IdentityError as e:
                return jsonify(error=str(e), code=e.code), 401
            return view(*args, **kwargs)
        return wrapped


if __name__ == "__main__":
    # Used by the package's tests: python probaline_identity.py <issuer> <audience> <jwks_url> <token>
    import json
    import sys
    v = ProbalineIdentity(sys.argv[1], sys.argv[2], jwks_url=sys.argv[3])
    try:
        print(json.dumps({"ok": True, "sub": v.verify(sys.argv[4] if len(sys.argv) > 4 else "")["sub"]}))
    except IdentityError as e:
        print(json.dumps({"ok": False, "code": e.code}))
