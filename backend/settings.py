import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

UPLOAD_DIR = Path(os.getenv("ARTIFACT_UPLOAD_DIR", str(Path(__file__).parent / "uploads"))).resolve()
MAX_FILE_BYTES = int(os.getenv("ARTIFACT_MAX_FILE_BYTES", str(100 * 1024 * 1024)))
PUBLIC_URL = os.getenv("ARTIFACT_PUBLIC_URL", "http://localhost:8000").rstrip("/")
DATABASE_URL = os.getenv("DATABASE_URL", "")
COOKIE_SECURE = PUBLIC_URL.startswith("https://")
if MAX_FILE_BYTES <= 0:
    raise ValueError("ARTIFACT_MAX_FILE_BYTES must be positive")
