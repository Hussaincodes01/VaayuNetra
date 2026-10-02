# VayuNetra worker for NVIDIA GPUs (CUDA 12.6). CPU-only machines: Dockerfile.cpu.
# torch comes from the base image, so the [ml] extra is not installed here.
FROM pytorch/pytorch:2.8.0-cuda12.6-cudnn9-runtime

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app

COPY pyproject.toml README.md ./
COPY src ./src
RUN pip install ".[ee,api,pdf]" "segmentation-models-pytorch>=0.3.3" \
 && python -m playwright install --with-deps chromium

# Chip cache (Sentinel-2 chips and pass lists); mount a volume so it survives rebuilds.
VOLUME ["/app/cache"]
ENTRYPOINT ["vayu"]
CMD ["worker", "--health-port", "8787"]
