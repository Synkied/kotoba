# kotoba in one image: the React app, Django, Whisper (scoring, transcription, the
# recording editor) and the Kokoro voice. GPU=1 adds the CUDA libraries for an NVIDIA card.

FROM node:24-alpine AS web
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Python dependencies, built where a compiler is available (pyopenjtalk has no wheels)
FROM python:3.12-slim AS deps
ARG GPU=0
COPY --from=ghcr.io/astral-sh/uv:0.12 /uv /usr/local/bin/uv
RUN apt-get update && apt-get install -y --no-install-recommends build-essential cmake \
 && rm -rf /var/lib/apt/lists/*
ENV UV_PROJECT_ENVIRONMENT=/app/.venv UV_PYTHON_DOWNLOADS=never UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
WORKDIR /app/backend
COPY backend/pyproject.toml backend/uv.lock backend/.python-version ./
RUN uv sync --locked --no-install-project --extra whisper --extra voice --extra claude $([ "$GPU" = 1 ] && echo --extra gpu) \
 && /app/.venv/bin/python -m unidic download

FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/.venv /app/.venv
WORKDIR /app/backend
COPY backend/ ./
COPY --from=web /src/frontend/dist /app/frontend/dist

RUN useradd --uid 1000 --create-home kotoba && mkdir /data && chown kotoba /data
USER kotoba
# Whisper and Kokoro download their weights on first use, into the data volume
ENV PATH=/app/.venv/bin:$PATH PYTHONUNBUFFERED=1 \
    KOTOBA_DATA=/data KOTOBA_DEBUG=0 HF_HOME=/data/models
VOLUME /data
EXPOSE 8780
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8780/api/stats', timeout=4)"
CMD ["sh", "-c", "python manage.py migrate --noinput && python manage.py refresh_readings --if-changed && exec waitress-serve --listen=0.0.0.0:8780 --threads=8 --channel-timeout=300 kotoba.wsgi:application"]
