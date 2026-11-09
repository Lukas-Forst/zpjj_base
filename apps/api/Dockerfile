FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
WORKDIR /srv
COPY pyproject.toml uv.lock .python-version ./
RUN uv sync --frozen --no-dev
COPY . .
ENV PATH="/srv/.venv/bin:$PATH" ENV=prod DATABASE_URL=sqlite:////data/hub.db
EXPOSE 8080
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app_factory --factory --host 0.0.0.0 --port 8080 --proxy-headers --forwarded-allow-ips='*'"]
