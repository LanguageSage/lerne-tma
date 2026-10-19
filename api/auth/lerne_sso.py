"""Lerne identity proofs only; sessions remain owned by Auth v2 in each DB."""
import base64
import calendar
from datetime import timedelta
import hashlib
import json
import os
import re
import secrets
import uuid
from urllib.parse import urlencode, urlsplit

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey

from .errors import AuthError
from .providers import VerifiedIdentity, CLOCK_SKEW
from api.models import auth_utcnow

CONFIRMATION_TTL = timedelta(seconds=60)
SIGNING_CONTEXT = b'lerne-game-sso-v1.'


def _origin(name):
    value = os.getenv(name, '').rstrip('/')
    parsed = urlsplit(value)
    local = (parsed.scheme == 'http' and parsed.hostname in ('localhost', '127.0.0.1')
             and os.getenv('ENVIRONMENT') == 'development' and not os.getenv('VERCEL'))
    if (not parsed.netloc or parsed.username or parsed.password or parsed.path
            or parsed.query or parsed.fragment or (parsed.scheme != 'https' and not local)):
        raise AuthError('provider_not_configured', 503)
    return value


def configuration(role):
    is_test = os.getenv('LERNE_DEPLOYMENT') == 'game-test'
    if os.getenv('LERNE_SSO_ROLE') != role or is_test != (role == 'client'):
        raise AuthError('provider_not_configured', 503)
    issuer, client = _origin('LERNE_SSO_ISSUER_ORIGIN'), _origin('LERNE_SSO_CLIENT_ORIGIN')
    if issuer == client:
        raise AuthError('provider_not_configured', 503)
    try:
        if role == 'issuer':
            key = serialization.load_pem_private_key(
                os.environ['LERNE_SSO_PRIVATE_KEY'].replace('\\n', '\n').encode(), password=None)
            if not isinstance(key, Ed25519PrivateKey):
                raise ValueError()
        else:
            key = serialization.load_pem_public_key(
                os.environ['LERNE_SSO_PUBLIC_KEY'].replace('\\n', '\n').encode())
            if not isinstance(key, Ed25519PublicKey):
                raise ValueError()
    except (KeyError, TypeError, ValueError):
        raise AuthError('provider_not_configured', 503) from None
    return issuer, client, key


def validate_request(request_id, nonce):
    try:
        if str(uuid.UUID(request_id)) != request_id or not re.fullmatch(r'no_[A-Za-z0-9_-]{43}', nonce):
            raise ValueError()
    except (ValueError, TypeError, AttributeError):
        raise AuthError('invalid_challenge', 400) from None


def authorization_url(challenge):
    issuer, _, _ = configuration('client')
    return issuer + '/auth/lerne?' + urlencode({'request_id': challenge.id, 'nonce': challenge.nonce})


def _encode(value):
    return base64.urlsafe_b64encode(value).decode().rstrip('=')


def _decode(value):
    if not re.fullmatch(r'[A-Za-z0-9_-]+', value):
        raise ValueError()
    return base64.b64decode(value + '=' * (-len(value) % 4), altchars=b'-_', validate=True)


def issue_confirmation(access_token, request_id, nonce):
    from .service import authenticate
    issuer, client, key = configuration('issuer')
    validate_request(request_id, nonce)
    principal = authenticate(access_token)  # Strict v2 session; never X-User-ID.
    now = auth_utcnow()
    claims = {'v': 1, 'iss': issuer, 'aud': client, 'sub': str(principal.account_id),
              'request_id': request_id, 'nonce': nonce, 'jti': str(uuid.uuid4()),
              'iat': calendar.timegm(now.utctimetuple()),
              'exp': calendar.timegm((now + CONFIRMATION_TTL).utctimetuple())}
    payload = _encode(json.dumps(claims, separators=(',', ':'), sort_keys=True).encode())
    assertion = payload + '.' + _encode(key.sign(SIGNING_CONTEXT + payload.encode()))
    # Fragment is not sent to HTTP servers or in Referer. No Lerne session token.
    return {'return_url': client + '/lerne-sso-callback.html#' + urlencode({
        'request_id': request_id, 'assertion': assertion}), 'expires_in': 60}


def verify_confirmation(assertion, *, request_id, nonce):
    issuer, client, key = configuration('client')
    try:
        if not isinstance(assertion, str) or not 1 <= len(assertion) <= 4096:
            raise ValueError()
        payload, signature = assertion.split('.')
        key.verify(_decode(signature), SIGNING_CONTEXT + payload.encode())
        claims = json.loads(_decode(payload))
        now = auth_utcnow()
        seconds = calendar.timegm(now.utctimetuple())
        if (claims.get('v') != 1 or claims.get('iss') != issuer or claims.get('aud') != client
                or claims.get('request_id') != request_id
                or not isinstance(claims.get('nonce'), str)
                or not secrets.compare_digest(claims['nonce'], nonce or '')
                or type(claims.get('iat')) is not int or type(claims.get('exp')) is not int
                or claims['iat'] > seconds + int(CLOCK_SKEW.total_seconds())
                or not 0 < claims['exp'] - claims['iat'] <= 60 or claims['exp'] <= seconds
                or not isinstance(claims.get('sub'), str)
                or not re.fullmatch(r'-?[1-9][0-9]{0,15}', claims['sub'])
                or abs(int(claims['sub'])) >= 2**52
                or str(uuid.UUID(claims['jti'])) != claims['jti']):
            raise ValueError()
        from datetime import datetime, timezone
        issued = datetime.fromtimestamp(claims['iat'], timezone.utc).replace(tzinfo=None)
        expires = datetime.fromtimestamp(claims['exp'], timezone.utc).replace(tzinfo=None)
        fingerprint = hashlib.sha256(('lerne\n' + issuer + '\n' + claims['jti']).encode()).hexdigest()
        return VerifiedIdentity('lerne', issuer + '#' + claims['sub'], issued, expires, fingerprint)
    except (InvalidSignature, ValueError, KeyError, TypeError, AttributeError, OverflowError):
        raise AuthError('invalid_provider_proof') from None
