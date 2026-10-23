"""Accounts: who is signed in. The browser keeps a session cookie (library.auth); screen-ocr
and scripts send "Authorization: Token <key>", a key each user can see and replace on the
Add-ons page."""
from django.conf import settings
from django.contrib.auth import authenticate, get_user_model, login, logout, password_validation, update_session_auth_hash
from django.core.exceptions import ValidationError
from django.db import transaction
from rest_framework.authtoken.models import Token
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import SimpleRateThrottle


class SigninThrottle(SimpleRateThrottle):
    """A few tries a minute from one address, for signing in and signing up."""

    scope = "signin"

    def get_cache_key(self, request, view):
        return self.cache_format % {"scope": self.scope, "ident": self.get_ident(request)}


def _user_json(user) -> dict:
    return {"id": user.id, "username": user.get_username(), "staff": user.is_staff}


@api_view(["GET"])
@permission_classes([AllowAny])
def account(request):
    """Who is signed in (null when nobody is), and whether a new account can be made here."""
    user = request.user if request.user.is_authenticated else None
    return Response({"user": _user_json(user) if user else None, "signup": settings.SIGNUP})


@api_view(["POST"])
@permission_classes([AllowAny])
@throttle_classes([SigninThrottle])
def signin(request):
    """{username, password}"""
    user = authenticate(request._request, username=str(request.data.get("username", "")).strip(),
                        password=str(request.data.get("password", "")))
    if user is None:
        return Response({"error": "That username and password don't match."}, status=400)
    login(request._request, user)
    return Response({"user": _user_json(user)})


@api_view(["POST"])
@permission_classes([AllowAny])
def signout(request):
    logout(request._request)
    return Response(status=204)


def make_user(username: str, password: str, **extra):
    """A new account, checked as the sign-up form checks it. Raises ValueError with what's wrong."""
    User = get_user_model()
    username = username.strip()
    if not username:
        raise ValueError("Choose a username.")
    if User.objects.filter(username__iexact=username).exists():
        raise ValueError("That username is taken.")
    user = User(username=username, **extra)
    try:
        user.full_clean(exclude=["password"])
        password_validation.validate_password(password, user)
    except ValidationError as e:
        raise ValueError(" ".join(e.messages)) from e
    user.set_password(password)
    user.save()
    return user


@api_view(["POST"])
@permission_classes([AllowAny])
@throttle_classes([SigninThrottle])
def signup(request):
    """{username, password}: only when KOTOBA_SIGNUP=1."""
    if not settings.SIGNUP:
        return Response({"error": "New accounts are made by whoever runs this kotoba."}, status=403)
    try:
        with transaction.atomic():
            user = make_user(str(request.data.get("username", "")), str(request.data.get("password", "")))
    except ValueError as e:
        return Response({"error": str(e)}, status=400)
    login(request._request, user, backend="django.contrib.auth.backends.ModelBackend")
    return Response({"user": _user_json(user)}, status=201)


@api_view(["POST"])
def password(request):
    """{current, new}: change your password; this browser stays signed in, others are signed out."""
    user = request.user
    if not user.check_password(str(request.data.get("current", ""))):
        return Response({"error": "Your current password isn't that."}, status=400)
    new = str(request.data.get("new", ""))
    try:
        password_validation.validate_password(new, user)
    except ValidationError as e:
        return Response({"error": " ".join(e.messages)}, status=400)
    user.set_password(new)
    user.save(update_fields=["password"])
    update_session_auth_hash(request._request, user)
    return Response(status=204)


@api_view(["GET", "POST"])
def token(request):
    """Your key for screen-ocr and scripts. POST replaces it: the old one stops working."""
    if request.method == "POST":
        Token.objects.filter(user=request.user).delete()
    key, _ = Token.objects.get_or_create(user=request.user)
    return Response({"token": key.key, "created": key.created})


@api_view(["GET"])
@permission_classes([AllowAny])
def health(request):
    """For the container's health check: up, and nothing more."""
    return Response({"ok": True})


def command_user(username: str | None):
    """The user a management command works for: the one named, or the only one there is."""
    from django.core.management.base import CommandError
    users = get_user_model().objects.all()
    if username:
        found = users.filter(username=username).first()
        if not found:
            raise CommandError(f"There's no user {username!r}. Make one with: python manage.py adduser {username}")
        return found
    if users.count() == 1:
        return users.get()
    raise CommandError("Say whose this is with --user <username>." if users.exists()
                       else "There are no users yet. Make one with: python manage.py adduser <username>")
