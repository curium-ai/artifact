#!/bin/sh
set -eu

# Fail the deployment before opening a port if the schema cannot be upgraded.
alembic upgrade head
exec uvicorn main:app --host 0.0.0.0 --port "${PORT:-8000}"
