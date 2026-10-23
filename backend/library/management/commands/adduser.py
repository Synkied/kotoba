"""Make an account: the way in when sign-up is closed (KOTOBA_SIGNUP isn't 1)."""
import getpass
import sys

from django.core.management.base import BaseCommand, CommandError

from library.accounts import make_user


class Command(BaseCommand):
    help = "Make a kotoba account. The password is asked for, or read from stdin with --password-stdin."

    def add_arguments(self, parser):
        parser.add_argument("username")
        parser.add_argument("--staff", action="store_true",
                            help="may use the translator set in the environment (the server's own API key)")
        parser.add_argument("--password-stdin", action="store_true", help="read the password from stdin")

    def handle(self, *args, username, staff, password_stdin, **kw):
        if password_stdin:
            password = sys.stdin.readline().rstrip("\n")
        else:
            password = getpass.getpass("Password: ")
            if getpass.getpass("Again: ") != password:
                raise CommandError("The two passwords differ.")
        try:
            user = make_user(username, password, is_staff=staff)
        except ValueError as e:
            raise CommandError(str(e))
        self.stdout.write(f"Made {user.username}{' (staff)' if staff else ''}. Sign in at kotoba's address.")
