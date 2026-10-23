"""The browser's session, without DRF's CSRF token: the session cookie is SameSite=Lax, so another
site's form or fetch doesn't carry it, and library.middleware refuses a write whose Origin is
another site's. (Kept apart from accounts.py: DRF imports this while it loads its own views.)"""
from rest_framework import authentication


class SessionAuthentication(authentication.SessionAuthentication):
    def enforce_csrf(self, request):
        return
