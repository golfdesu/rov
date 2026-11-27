# Stage 1: build the React draft UI
FROM node:22-slim AS frontend

WORKDIR /frontend

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
ARG VITE_DRAFT_ONLY=true
ARG VITE_OUT_DIR=dist-prod
ARG VITE_POSTHOG_KEY=""
ARG VITE_POSTHOG_HOST=""
ENV VITE_DRAFT_ONLY=$VITE_DRAFT_ONLY
ENV VITE_OUT_DIR=$VITE_OUT_DIR
ENV VITE_POSTHOG_KEY=$VITE_POSTHOG_KEY
ENV VITE_POSTHOG_HOST=$VITE_POSTHOG_HOST
RUN npm run build

# Stage 2: FastAPI serving image
FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir "torch>=2.2.0" --index-url https://download.pytorch.org/whl/cpu \
    && pip install --no-cache-dir --extra-index-url https://download.pytorch.org/whl/cpu -r requirements.txt

COPY src/ ./src/
COPY \
    data/heroes_130_summary.csv \
    data/hero_draft_stats.csv \
    data/hero_tier_overrides.json \
    data/dataset_metadata.json \
    data/matches_training.json \
    data/heroes_130_full.json \
    data/hero_level_stats.json \
    data/hero_skills_full.json \
    data/items.json \
    data/arcana.json \
    data/enchantments.json \
    ./data/
COPY models/sota_draft_gnn_transformer.pt ./models/
COPY configs/ ./configs/
COPY frontend/public/hero_images.json ./frontend/public/hero_images.json
ARG VITE_OUT_DIR=dist-prod
ENV ROV_ENV=production
ENV ROV_DB_PATH=/app/db/rov_app.db
COPY --from=frontend /frontend/${VITE_OUT_DIR}/ ./frontend/${VITE_OUT_DIR}/

RUN mkdir -p /app/db && useradd -m appuser && chown -R appuser:appuser /app
USER appuser

EXPOSE 8000

CMD ["uvicorn", "src.api:app", "--host", "0.0.0.0", "--port", "8000", "--no-server-header"]
