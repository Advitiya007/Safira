"""RoadSegmentFeature collection access.

This is the ONLY collection the ML code writes to. ``GeographicFeature`` is read-only here.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Iterable, Optional

import numpy as np
import pandas as pd
from pymongo import UpdateOne

from .config import RAW_FEATURE_COLUMNS, SEGMENT_COLLECTION
from .persistence import ModelBundle

BATCH = 1000


class SegmentStore:
    def __init__(self, collection):
        self.collection = collection

    @classmethod
    def from_database(cls, database, collection_name: str = SEGMENT_COLLECTION) -> "SegmentStore":
        return cls(database[collection_name])

    def ensure_indexes(self) -> None:
        self.collection.create_index([("cityId", 1), ("segmentKey", 1)], unique=True)
        self.collection.create_index([("geometry", "2dsphere")])
        self.collection.create_index([("cityId", 1), ("modelAssignment.modelVersion", 1)])

    def upsert_city(self, docs: list[dict], run_id: str, replace_stale: bool = True) -> dict:
        """Upsert extracted segments. Re-extraction resets modelAssignment (it would be stale)."""
        if not docs:
            raise ValueError("No segment documents to store")
        city_id = docs[0]["cityId"]
        written = 0
        for start in range(0, len(docs), BATCH):
            operations = [
                UpdateOne({"cityId": d["cityId"], "segmentKey": d["segmentKey"]}, {"$set": d}, upsert=True)
                for d in docs[start:start + BATCH]
            ]
            result = self.collection.bulk_write(operations, ordered=False)
            written += (result.upserted_count or 0) + (result.modified_count or 0)
        removed = 0
        if replace_stale:
            removed = self.collection.delete_many(
                {"cityId": city_id, "extraction.runId": {"$ne": run_id}}
            ).deleted_count
        return {"cityId": city_id, "received": len(docs), "written": written, "removedStale": removed}

    # ---- reading ---------------------------------------------------------------------

    def training_frame(self, cities: Optional[Iterable[str]] = None) -> pd.DataFrame:
        query = {"cityId": {"$in": list(cities)}} if cities else {}
        projection = {"_id": 0, "cityId": 1, "segmentKey": 1, "roadType": 1, "roadGroup": 1,
                      "features": 1, "flags": 1, "extraction.runId": 1,
                      "extraction.sourceDataVersions": 1}
        rows, versions = [], set()
        for doc in self.collection.find(query, projection, batch_size=5000):
            features = doc.get("features") or {}
            flags = doc.get("flags") or {}
            row = {
                "segment_key": doc["segmentKey"], "cityId": doc["cityId"],
                "road_type": doc.get("roadType"), "road_group": doc.get("roadGroup"),
                "is_short": bool(flags.get("isShort")), "near_bbox_edge": bool(flags.get("nearBboxEdge")),
            }
            for column in RAW_FEATURE_COLUMNS:
                value = features.get(column)
                row[column] = np.nan if value is None else value
            rows.append(row)
            versions.update((doc.get("extraction") or {}).get("sourceDataVersions") or [])
        frame = pd.DataFrame(rows)
        frame.attrs["source_data_versions"] = sorted(versions)
        return frame

    def find_near(self, city_id: str, polygon_geojson: dict, limit: int = 20000) -> list[dict]:
        query = {"cityId": city_id, "geometry": {"$geoIntersects": {"$geometry": polygon_geojson}}}
        projection = {"_id": 0, "segmentKey": 1, "geometry": 1, "roadGroup": 1, "features": 1,
                      "modelAssignment": 1}
        return list(self.collection.find(query, projection).limit(limit))

    # ---- assignment ------------------------------------------------------------------

    def assign_clusters(self, bundle: ModelBundle, city_id: Optional[str] = None, batch: int = 5000) -> dict:
        """Write modelAssignment for every stored segment using the already-fitted bundle."""
        query = {"cityId": city_id} if city_id else {}
        projection = {"_id": 1, "cityId": 1, "roadGroup": 1, "features": 1}
        total, buffer = 0, []
        now = datetime.now(timezone.utc)

        def flush(items):
            frame = pd.DataFrame([
                {**{c: (np.nan if (d.get("features") or {}).get(c) is None else d["features"][c]
                        ) for c in RAW_FEATURE_COLUMNS}, "road_group": d.get("roadGroup")}
                for d in items
            ])
            predicted = bundle.predict(frame)
            operations = []
            for doc, (_, row) in zip(items, predicted.iterrows()):
                operations.append(UpdateOne({"_id": doc["_id"]}, {"$set": {"modelAssignment": {
                    "scope": bundle.scope,
                    "modelVersion": bundle.version,
                    "clusterId": int(row["cluster_id"]),
                    "clusterName": row["cluster_name"],
                    "distanceToCentroid": float(row["distance_to_centroid"]),
                    "atypical": bool(row["atypical"]),
                    "imputedFeatures": list(row["imputed_features"]),
                    "assignedAt": now,
                }}}))
            self.collection.bulk_write(operations, ordered=False)
            return len(items)

        for doc in self.collection.find(query, projection, batch_size=batch):
            buffer.append(doc)
            if len(buffer) >= batch:
                total += flush(buffer)
                buffer = []
        if buffer:
            total += flush(buffer)
        return {"assigned": total, "modelVersion": bundle.version, "scope": bundle.scope}
