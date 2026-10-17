# Stage 1: build the React draft UI
FROM node:22-slim AS frontend

WORKDIR /frontend

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

# Stage 2: FastAPI serving image
FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY src/ ./src/
COPY data/ ./data/
COPY models/ ./models/
COPY configs/ ./configs/
COPY frontend/public/hero_images.json ./frontend/public/hero_images.json
COPY --from=frontend /frontend/dist/ ./frontend/dist/

RUN useradd -m appuser && chown -R appuser:appuser /app
USER appuser

EXPOSE 8000

CMD ["uvicorn", "src.api:app", "--host", "0.0.0.0", "--port", "8000"]
