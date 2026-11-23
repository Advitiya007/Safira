"""Test-only helper: mongomock's bulk_write predates newer pymongo UpdateOne options.

This adapter applies each UpdateOne via update_one so SegmentStore can be tested without a
MongoDB server. It does not emulate geo queries (the API tests emulate $geoIntersects).
"""

from types import SimpleNamespace

import mongomock


def mock_collection(name="roadsegmentfeatures"):
    collection = mongomock.MongoClient().db[name]

    def bulk_write(operations, ordered=True):
        upserted = modified = 0
        for operation in operations:
            result = collection.update_one(operation._filter, operation._doc, upsert=bool(operation._upsert))
            upserted += 1 if result.upserted_id is not None else 0
            modified += result.modified_count
        return SimpleNamespace(upserted_count=upserted, modified_count=modified)

    collection.bulk_write = bulk_write
    return collection
