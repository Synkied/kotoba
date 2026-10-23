from django.contrib.auth import get_user_model
from django.test import TestCase


class SignedIn(TestCase):
    """A test signed in as self.user, a learner who owns what the test makes. Staff (staff = True)
    may use the translator from the environment."""

    staff = False

    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        cls.user = get_user_model().objects.create_user("learner", password="a-long-test-password", is_staff=cls.staff)

    def setUp(self):
        super().setUp()
        self.client.force_login(self.user)
