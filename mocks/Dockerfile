# Simulated government systems. Build from the repository root:
#   docker build -f mocks/Dockerfile -t adili/mocks mocks
FROM ghcr.io/astral-sh/uv:0.9-python3.13-bookworm-slim AS builder
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never
WORKDIR /app
RUN --mount=type=cache,target=/root/.cache/uv \
    --mount=type=bind,source=uv.lock,target=uv.lock \
    --mount=type=bind,source=pyproject.toml,target=pyproject.toml \
    uv sync --locked --no-dev --no-install-project
COPY . .
RUN --mount=type=cache,target=/root/.cache/uv uv sync --locked --no-dev

FROM python:3.13-slim-bookworm
RUN groupadd --system app && useradd --system --gid app --home /app app
WORKDIR /app
COPY --from=builder --chown=app:app /app /app
ENV PATH="/app/.venv/bin:$PATH" PYTHONUNBUFFERED=1 PORT=8000
USER app
EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=6 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health').status == 200 else 1)"
# Migrations run as a separate release step: `python manage.py migrate`.
CMD ["gunicorn", "config.wsgi:application"]
