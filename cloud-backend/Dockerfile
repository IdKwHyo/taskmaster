FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8080

WORKDIR /app

RUN addgroup --system henry && adduser --system --ingroup henry henry

COPY pyproject.toml README.md ./
COPY henry_cloud ./henry_cloud

RUN pip install --no-cache-dir .

USER henry
EXPOSE 8080

CMD ["sh", "-c", "uvicorn henry_cloud.main:app --host 0.0.0.0 --port ${PORT} --workers 1"]

