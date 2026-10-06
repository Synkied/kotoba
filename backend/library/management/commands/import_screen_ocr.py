"""Bring screen_ocr's capture history into kotoba (run once; re-running skips what's there)."""
import json
import os
import sqlite3
from datetime import datetime, timezone

from django.core.files import File
from django.core.management.base import BaseCommand
from django.db import transaction

from library import ingest
from library.models import Source
from library.serializers import clean_labels
from library.views import _make_sentences


def default_dir():
    base = os.environ.get("XDG_DATA_HOME") or os.path.expanduser("~/.local/share")
    mac = os.path.expanduser("~/Library/Application Support/screen-ocr")
    return mac if os.path.isdir(mac) else os.path.join(base, "screen-ocr")


class Command(BaseCommand):
    help = "Import captures from screen_ocr's history.db"

    def add_arguments(self, parser):
        parser.add_argument("--dir", default=default_dir(), help="screen_ocr data folder")
        parser.add_argument("--status", default="kept", choices=["inbox", "kept"],
                            help="where imported captures land (default: kept, i.e. the library)")

    def handle(self, *args, dir, status, **kw):
        db = os.path.join(dir, "history.db")
        if not os.path.exists(db):
            self.stderr.write(f"No history at {db}")
            return
        conn = sqlite3.connect(db)
        conn.row_factory = sqlite3.Row
        added = skipped = 0
        for row in conn.execute("SELECT * FROM captures ORDER BY created_at"):
            when = datetime.fromtimestamp(row["created_at"], tz=timezone.utc)
            if Source.objects.filter(kind="capture", created_at=when, text=row["text"]).exists():
                skipped += 1
                continue
            with transaction.atomic():
                s = Source.objects.create(kind="capture", status=status, text=row["text"],
                                          category=row["category"] or "", created_at=when,
                                          labels=clean_labels(json.loads(row["labels"] or "[]")))
                img = row["image"] and os.path.join(dir, "images", row["image"])
                if img and os.path.exists(img):
                    with open(img, "rb") as f:
                        s.image.save(row["image"], File(f))
                _make_sentences(s, ingest.split_text(s.text))
            added += 1
        self.stdout.write(f"Imported {added} captures ({skipped} already there).")
