"""ASGI entry point:  uvicorn safira_ml.service.main:app --host 127.0.0.1 --port 8001"""

from ..db import load_environment
from .app import create_app

load_environment()
app = create_app()
