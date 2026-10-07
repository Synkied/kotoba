"""Listening practice keeps answer keys on the server until submission."""
import unicodedata

from django.shortcuts import get_object_or_404
from django.db import transaction
from rest_framework.decorators import api_view
from rest_framework.response import Response

from .models import ListeningLesson, ListeningExercise, ListeningAttempt
from .listening_packages import import_package


def normalized(value):
    return unicodedata.normalize("NFKC", value).strip().casefold()


def attempt_data(attempt):
    return {
        "id": attempt.id, "responses": attempt.responses, "feedback": attempt.feedback,
        "score": attempt.score, "total": attempt.total, "created_at": attempt.created_at,
    }


def exercise_data(exercise):
    latest = exercise.attempts.filter(revision=exercise.revision).first()
    page = next((p for p in exercise.lesson.pages if p["number"] == exercise.worksheet_page), {})
    return {
        "id": exercise.id, "position": exercise.position, "title": exercise.title,
        "instructions": exercise.instructions, "example": exercise.example,
        "audio": exercise.audio.url, "image": exercise.image.url if exercise.image else exercise.image.storage.url(page["image"]) if page.get("image") else None,
        "image_alt": exercise.image_alt or f"Worksheet page {exercise.worksheet_page}",
        "worksheet_page": exercise.worksheet_page, "worksheet_text": page.get("text", ""), "revision": exercise.revision,
        "questions": [{k: v for k, v in q.items() if k not in ("answer", "explanation")} for q in exercise.questions],
        "has_answer_key": bool(exercise.questions) and all(bool(q.get("answer")) for q in exercise.questions),
        "attempt_count": exercise.attempts.count(),
        "latest_attempt": attempt_data(latest) if latest else None,
    }


def lesson_data(lesson):
    return {
        "id": lesson.id, "title": lesson.title, "description": lesson.description,
        "pdf": lesson.pdf.url, "page_count": len(lesson.pages), "exercises": [exercise_data(e) for e in lesson.exercises.all()],
    }


@api_view(["GET"])
def lessons(request):
    return Response([lesson_data(lesson) for lesson in ListeningLesson.objects.prefetch_related("exercises")])


@api_view(["POST"])
def upload(request):
    try:
        lesson = import_package(request.FILES.getlist("files"), request.data.get("title", ""))
    except ValueError as error:
        return Response({"error": str(error)}, status=400)
    return Response(lesson_data(lesson), status=201)


@api_view(["PATCH"])
def edit_exercise(request, exercise_id):
    if not isinstance(request.data, dict):
        return Response({"error": "Check the quiz fields and try again."}, status=400)
    with transaction.atomic():
        exercise = get_object_or_404(ListeningExercise.objects.select_for_update(), pk=exercise_id)
        if request.data.get("revision") != exercise.revision:
            return Response({"error": "This quiz changed in another tab. Reload before editing it."}, status=409)
        title = request.data.get("title", exercise.title)
        instructions = request.data.get("instructions", exercise.instructions)
        page = request.data.get("worksheet_page", exercise.worksheet_page)
        questions = request.data.get("questions", exercise.questions)
        if not isinstance(title, str) or not title.strip() or len(title) > 200 or not isinstance(instructions, str) or len(instructions) > 2000:
            return Response({"error": "Enter a quiz title (up to 200 characters) and instructions (up to 2,000 characters)."}, status=400)
        if type(page) is not int or not 1 <= page <= max(1, len(exercise.lesson.pages)):
            return Response({"error": "Choose a page from this worksheet."}, status=400)
        if not isinstance(questions, list) or not 1 <= len(questions) <= 50:
            return Response({"error": "Add between 1 and 50 questions to this quiz."}, status=400)
        cleaned, ids = [], set()
        for q in questions:
            if not isinstance(q, dict) or not isinstance(q.get("id"), str) or not 1 <= len(q["id"]) <= 80 or q["id"] in ids or not isinstance(q.get("prompt"), str) or not q["prompt"].strip() or len(q["prompt"]) > 500:
                return Response({"error": "Give each question a unique ID and a prompt of up to 500 characters."}, status=400)
            ids.add(q["id"])
            entry = {"id": q["id"], "prompt": q["prompt"].strip()}
            choices = q.get("choices")
            if choices is not None:
                if not isinstance(choices, list) or not 2 <= len(choices) <= 10 or any(not isinstance(c, dict) or not isinstance(c.get("value"), str) or not c["value"].strip() or len(c["value"]) > 80 or not isinstance(c.get("label"), str) or not c["label"].strip() or len(c["label"]) > 100 for c in choices) or len({c["value"] for c in choices}) != len(choices):
                    return Response({"error": "Each multiple-choice question needs 2–10 distinct, labeled choices."}, status=400)
                entry["choices"] = [{"value": c["value"], "label": c["label"].strip()} for c in choices]
            old = next((old for old in exercise.questions if old["id"] == q["id"]), {})
            if old.get("prompt") == entry["prompt"] and old.get("choices") == entry.get("choices"):
                for key in ("answer", "explanation", "placeholder"):
                    if key in old:
                        entry[key] = old[key]
            cleaned.append(entry)
        if cleaned != exercise.questions:
            exercise.revision += 1
        exercise.questions = cleaned
        exercise.title, exercise.instructions = title.strip(), instructions.strip()
        if exercise.worksheet_page != page:
            # Selecting another page replaces the prepared crop with that page.
            exercise.image = ""
            exercise.image_alt = ""
        exercise.worksheet_page = page
        exercise.save()
    return Response(exercise_data(exercise))


@api_view(["POST"])
def submit(request, exercise_id):
    exercise = get_object_or_404(ListeningExercise, pk=exercise_id)
    responses = request.data.get("responses") if isinstance(request.data, dict) else None
    expected = {q["id"] for q in exercise.questions}
    if not expected:
        return Response({"error": "Add questions to this quiz before answering it."}, status=400)
    if isinstance(request.data, dict) and request.data.get("revision", exercise.revision) != exercise.revision:
        return Response({"error": "This quiz changed in another tab. Reload before answering it."}, status=409)
    if not isinstance(responses, dict) or set(responses) != expected:
        return Response({"error": "Answer every question before saving."}, status=400)
    cleaned, feedback = {}, []
    for question in exercise.questions:
        value = responses[question["id"]]
        if not isinstance(value, str) or not value.strip() or len(value) > 500:
            return Response({"error": "Each answer must contain between 1 and 500 characters."}, status=400)
        value = value.strip()
        choices = question.get("choices", [])
        if choices and value not in {c["value"] for c in choices}:
            return Response({"error": "Choose one of the listed answers."}, status=400)
        cleaned[question["id"]] = value
        answer = question.get("answer")
        accepted = answer if isinstance(answer, list) else [answer] if answer else []
        feedback.append({
            "id": question["id"], "correct": normalized(value) in {normalized(a) for a in accepted} if accepted else None,
            "answer": accepted[0] if accepted else None, "explanation": question.get("explanation", ""),
        })
    score = sum(f["correct"] is True for f in feedback) if all(f["correct"] is not None for f in feedback) else None
    attempt = ListeningAttempt.objects.create(exercise=exercise, responses=cleaned, feedback=feedback, score=score, total=len(expected), revision=exercise.revision)
    return Response(attempt_data(attempt), status=201)
