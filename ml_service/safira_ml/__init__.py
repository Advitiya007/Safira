"""Safira infrastructure clustering (unsupervised, descriptive).

Clusters describe the *mapped* OpenStreetMap infrastructure around road segments.
They are not crime predictions and not safety labels.
"""

from .config import PIPELINE_VERSION

__all__ = ["PIPELINE_VERSION"]
