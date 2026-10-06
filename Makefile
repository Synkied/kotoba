# kotoba: `make` lists the targets. Local runs need uv, npm and ffmpeg; the Docker targets need Docker only.
PORT     ?= 8780
# What to install locally: whisper (speaking scores, transcription, the recording editor),
# voice (the Kokoro voice). EXTRAS= installs the plain hub.
EXTRAS   ?= whisper voice
GPU      ?= 0
VOICEVOX ?= 0
OCR_DIR  ?= $(or $(XDG_DATA_HOME),$(HOME)/.local/share)/screen-ocr
OCR_SRC  ?= ../screen_ocr
JPCUT_DIR ?= ../jp-shadow-cut

UV       = cd backend && uv run
SYNC     = $(foreach e,$(EXTRAS),--extra $(e)) $(if $(filter 1,$(GPU)),--extra gpu)
COMPOSE  = KOTOBA_PORT=$(PORT) GPU=$(GPU) $(if $(filter 1,$(VOICEVOX)),COMPOSE_PROFILES=voicevox) \
           docker compose -f compose.yaml $(if $(filter 1,$(GPU)),-f compose.gpu.yaml)

.DEFAULT_GOAL := help
.PHONY: help install build migrate run dev dev-api dev-web check import-ocr import-jpcut transcribe \
        ocr-client docker-build up down logs status shell docker-import-ocr clean

help: ## List the targets
	@awk 'BEGIN {FS = ":.*## "} /^[a-z-]+:.*## / {printf "  \033[1m%-18s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)
	@echo "  Options: EXTRAS=\"$(EXTRAS)\" GPU=$(GPU) VOICEVOX=$(VOICEVOX) PORT=$(PORT)"

## Local

install: ## Install kotoba (EXTRAS="whisper voice", GPU=1 for an NVIDIA card)
	cd backend && uv sync $(SYNC)
ifneq (,$(filter voice,$(EXTRAS)))
	cd backend && (uv run python -c "import unidic, os, sys; sys.exit(not os.path.exists(os.path.join(unidic.DICDIR, 'mecabrc')))" \
	  || uv run python -m unidic download)
endif
	cd frontend && npm ci
	@command -v ffmpeg >/dev/null || echo "Note: install ffmpeg for transcription, waveforms and rendering."

build: ## Build the frontend into frontend/dist
	cd frontend && npm run build

migrate: ## Create or update the database
	$(UV) python manage.py migrate

run: build migrate ## Build and serve on http://127.0.0.1:8780
	$(UV) waitress-serve --listen=127.0.0.1:$(PORT) --threads=8 --channel-timeout=300 kotoba.wsgi:application

dev: migrate ## Hot-reload development: API on 8780, app on http://localhost:5173
	$(MAKE) -j2 dev-api dev-web

dev-api:
	$(UV) python manage.py runserver $(PORT)

dev-web:
	cd frontend && KOTOBA_API=http://127.0.0.1:$(PORT) npm run dev

check: ## Type-check, lint and run Django's checks
	cd frontend && npx tsc -b && npm run lint
	$(UV) python manage.py check

import-ocr: ## Import screen_ocr's history (OCR_DIR=... to override)
	$(UV) python manage.py import_screen_ocr --dir "$(OCR_DIR)"

import-jpcut: ## Import jp-shadow-cut's recordings, cuts and scripts (JPCUT_DIR=...)
	$(UV) python manage.py import_jpcut "$(abspath $(JPCUT_DIR))"

transcribe: ## Transcribe waiting uploads now, with progress (the server also does it by itself)
	$(UV) python manage.py transcribe

ocr-client: ## Install the screen-ocr capture client on this computer (needs uv and Tesseract)
	uv tool install --force "screen-ocr[desktop] @ $(if $(findstring ://,$(OCR_SRC)),$(OCR_SRC),file://$(abspath $(OCR_SRC)))"
	@echo "Capture with: screen-ocr --server http://localhost:$(PORT)"

## Docker (GPU=1, VOICEVOX=1)

docker-build: ## Build the image
	$(COMPOSE) build

up: ## Start kotoba in Docker on http://localhost:8780
	$(COMPOSE) up -d --build --remove-orphans
	@echo "kotoba: http://localhost:$(PORT)  (Whisper downloads its model on first use)"

down: ## Stop it (your data and the downloaded models are kept)
	$(COMPOSE) --profile '*' down

logs: ## Follow the logs
	$(COMPOSE) logs -f

status: ## Show what's running
	$(COMPOSE) ps

shell: ## Open a shell in the container
	$(COMPOSE) exec kotoba sh

docker-import-ocr: ## Import screen_ocr's history into the container
	$(COMPOSE) run --rm -v "$(OCR_DIR):/ocr:ro" kotoba python manage.py import_screen_ocr --dir /ocr

clean: ## Remove build output and the backend virtualenv
	rm -rf frontend/dist backend/.venv
