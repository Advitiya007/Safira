"""MongoDB connection from environment variables only (no credentials in code or logs)."""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv
from pymongo import MongoClient
from pymongo.database import Database

from .config import PACKAGE_ROOT

_loaded = False


def load_environment() -> None:
    """Load ml_service/.env (or the file named by ML_ENV_FILE) once. Real env vars win."""
    global _loaded
    if _loaded:
        return
    explicit = os.environ.get("ML_ENV_FILE")
    load_dotenv(Path(explicit) if explicit else PACKAGE_ROOT / ".env", override=False)
    _loaded = True


def get_database() -> Database:
    load_environment()
    uri = os.environ.get("MONGO_URI")
    if not uri:
        raise RuntimeError("MONGO_URI is not set (see ml_service/.env.example)")
    client = MongoClient(uri, appname="safira-ml", serverSelectionTimeoutMS=10_000)
    name = os.environ.get("MONGO_DB_NAME")
    if name:
        return client[name]
    try:
        return client.get_default_database()
    except Exception as error:  # no database in the URI
        raise RuntimeError("Set MONGO_DB_NAME or include the database name in MONGO_URI") from error
