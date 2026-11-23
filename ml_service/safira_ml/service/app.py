"""FastAPI service. Called server-to-server by the Express backend; not for browsers.

Every endpoint except /health requires the ``X-API-Key`` header to equal ML_SERVICE_API_KEY.
If that variable is not set the protected endpoints refuse to serve (fail closed).
"""

from __future__ import annotations

import hmac
import json
import logging
import os
import threading
from dataclasses import dataclass, field
from typing import Any, Optional

import numpy as np
import pandas as pd
from fastapi import Depends, FastAPI, Header, HTTPException, Query
from pydantic import BaseModel, Field, field_validator

from ..clustering import ROAD_GROUP_LABELS
from ..config import (
    DISCLAIMER, PIPELINE_VERSION, RAW_FEATURE_COLUMNS, SUPPORTED_CITIES, ExtractionParams,
    TrainingParams, data_dir, feature_info, model_dir,
)
from ..extract import MongoFeatureSource, extract_city, to_mongo_documents, write_city_csv
from ..persistence import ModelBundle, load_bundle, save_bundle
from ..route_profile import corridor_polygon, summarise_route
from ..store import SegmentStore
from ..training import train_model

log = logging.getLogger("safira_ml")
MAX_SEGMENTS_PER_ASSIGN = 5000


# ---- request models ------------------------------------------------------------------

def _city(value: str) -> str:
    if value not in SUPPORTED_CITIES:
        raise ValueError(f"cityId must be one of {', '.join(SUPPORTED_CITIES)}")
    return value


class GenerateRequest(BaseModel):
    cityId: str
    persistToMongo: bool = True
    writeCsv: bool = True
    replaceStale: bool = True

    _check_city = field_validator("cityId")(_city)


class TrainRequest(BaseModel):
    scope: str = "global"
    k: Optional[int] = Field(None, ge=2, le=20)
    assignToMongo: bool = True
    perCityCap: int = Field(20000, ge=500, le=200000)
    excludeEdgeSegments: bool = False

    @field_validator("scope")
    @classmethod
    def _scope(cls, value: str) -> str:
        if value != "global" and value not in SUPPORTED_CITIES:
            raise ValueError("scope must be 'global' or a supported city id")
        return value


class SegmentInput(BaseModel):
    id: Optional[str] = None
    roadGroup: Optional[str] = None
    features: dict[str, Optional[float]] = Field(default_factory=dict)


class AssignRequest(BaseModel):
    scope: str = "global"
    modelVersion: Optional[str] = None
    segments: list[SegmentInput] = Field(min_length=1, max_length=MAX_SEGMENTS_PER_ASSIGN)


class RouteInput(BaseModel):
    id: int | str
    coordinates: list[list[float]] = Field(min_length=2, max_length=30000)  # [lon, lat]


class RouteProfileRequest(BaseModel):
    cityId: str
    scope: str = "global"
    routes: list[RouteInput] = Field(min_length=1, max_length=5)

    _check_city = field_validator("cityId")(_city)


# ---- state ---------------------------------------------------------------------------

@dataclass
class ServiceSettings:
    api_key: Optional[str] = field(default_factory=lambda: os.environ.get("ML_SERVICE_API_KEY") or None)
    model_root: Optional[Any] = None


class ModelRegistry:
    def __init__(self, root=None):
        self.root = root
        self._cache: dict = {}
        self._lock = threading.Lock()

    def get(self, scope: str, version: Optional[str] = None) -> ModelBundle:
        root = self.root or model_dir()
        if version is None:
            latest = root / scope / "latest.json"
            if not latest.exists():
                raise HTTPException(404, f"No trained model for scope '{scope}'. Train one first.")
            version = json.loads(latest.read_text(encoding="utf-8"))["version"]
        key = (scope, version)
        with self._lock:
            if key not in self._cache:
                try:
                    self._cache[key] = load_bundle(scope, version, root)
                except (FileNotFoundError, ValueError) as error:
                    raise HTTPException(404, str(error)) from error
            return self._cache[key]

    def put(self, bundle: ModelBundle) -> None:
        with self._lock:
            self._cache[(bundle.scope, bundle.version)] = bundle


def create_app(
    settings: Optional[ServiceSettings] = None,
    database=None,
    store: Optional[SegmentStore] = None,
    registry: Optional[ModelRegistry] = None,
) -> FastAPI:
    settings = settings or ServiceSettings()
    registry = registry or ModelRegistry(settings.model_root)
    busy = threading.Lock()
    app = FastAPI(title="Safira infrastructure clustering service", version=PIPELINE_VERSION)

    def get_db():
        if database is not None:
            return database
        from ..db import get_database
        try:
            return get_database()
        except Exception as error:  # surface config problems without leaking the URI
            raise HTTPException(503, f"Database unavailable: {type(error).__name__}") from error

    def get_store() -> SegmentStore:
        return store or SegmentStore.from_database(get_db())

    def require_key(x_api_key: Optional[str] = Header(default=None)) -> None:
        if not settings.api_key:
            raise HTTPException(503, "ML_SERVICE_API_KEY is not configured on the ML service")
        if not x_api_key or not hmac.compare_digest(x_api_key, settings.api_key):
            raise HTTPException(401, "Invalid or missing API key")

    def exclusive():
        if not busy.acquire(blocking=False):
            raise HTTPException(409, "Another generate/train job is already running")

    @app.get("/health")
    def health():
        root = settings.model_root or model_dir()
        latest = root / "global" / "latest.json"
        version = json.loads(latest.read_text(encoding="utf-8"))["version"] if latest.exists() else None
        return {"status": "ok", "pipelineVersion": PIPELINE_VERSION, "globalModelVersion": version}

    @app.get("/v1/features/info", dependencies=[Depends(require_key)])
    def features_info():
        return {"features": feature_info(), "roadGroups": ROAD_GROUP_LABELS, "disclaimer": DISCLAIMER}

    @app.post("/v1/features/generate", dependencies=[Depends(require_key)])
    def generate(request: GenerateRequest):
        exclusive()
        try:
            db = get_db()
            docs = MongoFeatureSource(db).load(request.cityId)
            try:
                frame, meta = extract_city(request.cityId, docs)
            except ValueError as error:
                raise HTTPException(422, str(error)) from error
            result: dict = {"meta": meta}
            if request.writeCsv:
                path = write_city_csv(frame, meta, data_dir() / "road_features.csv")
                result["csvFile"] = path.name
            if request.persistToMongo:
                segment_store = get_store()
                segment_store.ensure_indexes()
                result["mongo"] = segment_store.upsert_city(
                    to_mongo_documents(frame, meta), meta["runId"], request.replaceStale
                )
            return result
        finally:
            busy.release()

    @app.post("/v1/model/train", dependencies=[Depends(require_key)])
    def train(request: TrainRequest):
        exclusive()
        try:
            segment_store = get_store()
            frame = segment_store.training_frame(None if request.scope == "global" else [request.scope])
            if frame.empty:
                raise HTTPException(422, "No RoadSegmentFeature documents found; run feature generation first")
            params = TrainingParams(per_city_cap=request.perCityCap,
                                    exclude_edge_segments=request.excludeEdgeSegments)
            try:
                result = train_model(frame, request.scope, params, request.k,
                                     source_data_versions=frame.attrs.get("source_data_versions"))
            except ValueError as error:
                raise HTTPException(422, str(error)) from error
            save_bundle(result.bundle, settings.model_root)
            registry.put(result.bundle)
            response = {"model": _model_payload(result.bundle)}
            if request.assignToMongo:
                response["assignment"] = segment_store.assign_clusters(
                    result.bundle, None if request.scope == "global" else request.scope
                )
            return response
        finally:
            busy.release()

    @app.get("/v1/model", dependencies=[Depends(require_key)])
    def get_model(scope: str = "global", version: Optional[str] = None):
        return _model_payload(registry.get(scope, version))

    @app.get("/v1/model/profiles", dependencies=[Depends(require_key)])
    def get_profiles(scope: str = "global", version: Optional[str] = None):
        bundle = registry.get(scope, version)
        return {
            "modelVersion": bundle.version,
            "scope": bundle.scope,
            "createdAt": bundle.meta["createdAt"],
            "clusters": [_public_profile(c) for c in sorted(
                bundle.meta["clusters"], key=lambda c: (c["serviceIndex"] is None, c["serviceIndex"] or 0))],
            "featuresUsed": bundle.meta["features"]["numeric"],
            "featureInfo": {k: v for k, v in feature_info(
                ExtractionParams(**bundle.meta["extractionParams"])).items()
                if k in bundle.meta["features"]["numeric"]},
            "droppedFeatures": bundle.meta["features"]["droppedFeatures"],
            "metrics": {k: bundle.meta["metrics"][k] for k in ("silhouette", "daviesBouldin")},
            "disclaimer": DISCLAIMER,
        }

    @app.post("/v1/segments/assign", dependencies=[Depends(require_key)])
    def assign(request: AssignRequest):
        bundle = registry.get(request.scope, request.modelVersion)
        frame = pd.DataFrame([
            {**{c: np.nan for c in RAW_FEATURE_COLUMNS},
             **{k: (np.nan if v is None else v) for k, v in s.features.items() if k in RAW_FEATURE_COLUMNS},
             "road_group": s.roadGroup}
            for s in request.segments
        ])
        predicted = bundle.predict(frame)
        return {
            "modelVersion": bundle.version,
            "scope": bundle.scope,
            "assignments": [
                {"id": segment.id, "clusterId": int(row.cluster_id), "clusterName": row.cluster_name,
                 "distanceToCentroid": float(row.distance_to_centroid), "atypical": bool(row.atypical),
                 "imputedFeatures": list(row.imputed_features)}
                for segment, row in zip(request.segments, predicted.itertuples())
            ],
            "disclaimer": DISCLAIMER,
        }

    @app.post("/v1/routes/profile", dependencies=[Depends(require_key)])
    def route_profile(request: RouteProfileRequest):
        bundle = registry.get(request.scope)
        segment_store = get_store()
        results = []
        for route in request.routes:
            try:
                polygon = corridor_polygon(route.coordinates)
                docs = segment_store.find_near(request.cityId, polygon)
                resolved = _resolve_clusters(docs, bundle)
                summary = summarise_route(route.coordinates, resolved)
            except ValueError as error:
                raise HTTPException(422, f"Route {route.id}: {error}") from error
            summary["routeId"] = route.id
            summary["segmentsConsidered"] = len(docs)
            results.append(summary)
        return {
            "modelVersion": bundle.version,
            "scope": bundle.scope,
            "cityId": request.cityId,
            "routes": results,
            "disclaimer": DISCLAIMER,
        }

    return app


def _resolve_clusters(docs: list[dict], bundle: ModelBundle) -> list[dict]:
    """Use stored assignments for the active model version; recompute the rest on the fly."""
    resolved, stale_index = [], []
    for position, doc in enumerate(docs):
        assignment = doc.get("modelAssignment") or {}
        current = assignment.get("modelVersion") == bundle.version
        resolved.append({
            "geometry": doc.get("geometry"),
            "clusterId": assignment.get("clusterId") if current else None,
            "clusterName": assignment.get("clusterName") if current else None,
        })
        if not current:
            stale_index.append(position)
    if stale_index:
        frame = pd.DataFrame([
            {**{c: (np.nan if (docs[i].get("features") or {}).get(c) is None else docs[i]["features"][c]
                    ) for c in RAW_FEATURE_COLUMNS}, "road_group": docs[i].get("roadGroup")}
            for i in stale_index
        ])
        predicted = bundle.predict(frame)
        for i, (_, row) in zip(stale_index, predicted.iterrows()):
            resolved[i]["clusterId"] = int(row["cluster_id"])
            resolved[i]["clusterName"] = row["cluster_name"]
    return resolved


def _public_profile(cluster: dict) -> dict:
    return {
        "clusterId": cluster["clusterId"],
        "name": cluster["name"],
        "level": cluster["level"],
        "description": cluster["description"],
        "size": cluster["size"],
        "share": cluster["share"],
        "serviceIndex": cluster["serviceIndex"],
        "features": {k: {"median": v["median"], "p25": v["p25"], "p75": v["p75"],
                         "missingShare": v["missingShare"]} for k, v in cluster["features"].items()},
        "roadGroupShares": cluster["roadGroupShares"],
    }


def _model_payload(bundle: ModelBundle) -> dict:
    meta = bundle.meta
    return {
        "modelVersion": meta["modelVersion"], "scope": meta["scope"], "createdAt": meta["createdAt"],
        "k": meta["k"], "kSelection": meta["kSelection"], "metrics": meta["metrics"],
        "features": meta["features"], "training": meta["training"],
        "extractionParams": meta["extractionParams"], "clusters": meta["clusters"],
        "libraryVersions": meta["libraryVersions"], "disclaimer": meta["disclaimer"],
    }
