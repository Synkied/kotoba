"""Spaced review from practice scores (SM-2, with the 0-100 overall score as the grade)."""
from datetime import timedelta

from django.utils import timezone

PASS = 70  # an overall score below this sends the sentence back to tomorrow


def schedule(sentence, overall: int) -> None:
    grade = max(0, min(5, round(overall / 20)))
    if overall < PASS:
        if sentence.reps:
            sentence.lapses += 1
        sentence.reps = 0
        sentence.interval = 1 if overall >= 40 else 0  # under 40: again in this session
    else:
        sentence.reps += 1
        sentence.interval = 1 if sentence.reps == 1 else 3 if sentence.reps == 2 else round(sentence.interval * sentence.ease, 1)
    sentence.ease = max(1.3, sentence.ease + 0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02))
    sentence.due = timezone.now() + (timedelta(days=sentence.interval) if sentence.interval else timedelta(minutes=10))
    sentence.last = overall
    sentence.best = max(sentence.best or 0, overall)
