FROM python:3.11-slim

WORKDIR /app
COPY backend/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY backend /app/backend
COPY scripts /app/scripts
ENV APP_DATA_DIR=/app/backend/.data
ENV APP_UPLOAD_DIR=/app/backend/uploads
ENV MODEL_ARTIFACTS_DIR=/app/models
EXPOSE 8000
CMD ["uvicorn", "backend.app:app", "--host", "0.0.0.0", "--port", "8000"]
