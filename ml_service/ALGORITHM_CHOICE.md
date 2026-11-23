# Why K-Means? (and why not the others)

A plain-language explanation of the algorithm choice, meant to be repeated to teachers, reviewers
or teammates. The numbers come from `python -m safira_ml.cli compare` (see the end), so the claims
can be checked rather than taken on trust.

## The problem in one paragraph

Safira has hundreds of thousands of road segments, and each one has a few numbers describing the
mapped infrastructure around it (distance to the nearest police station, number of shops nearby,
and so on). **Nobody has labelled any segment as "good" or "bad"**, so this is *unsupervised*
learning: we ask the computer to *group similar segments* and then we describe each group in words.
There is no "right answer" to score against, so we cannot say an algorithm is "90% accurate".
We can only check whether an algorithm does what the application needs and whether its groups are
sensible and repeatable.

## The three things Safira actually needs

Think of these as the job requirements. An algorithm that fails one is not hired, however clever.

| # | Requirement | Why it matters here |
|---|---|---|
| 1 | **It can place a brand-new road segment into a group using a saved model.** | The app must not retrain on every request. When a user draws a route, we look up its segments and name their groups instantly. |
| 2 | **Every segment gets a group.** | A route display with big "unknown" gaps is not useful. Some methods deliberately throw away segments as "noise". |
| 3 | **Running it twice gives about the same groups.** | If the groups change when you re-run, you cannot trust or explain them. Measured with *stability* (does it give the same answer on different random 70% slices of the data?). |

After these, we compare the survivors on **quality** signals: how well separated the groups are
(*silhouette*), whether the groups still make sense on a city the model never saw (*cross-city
transfer*), and whether the groups are just "which city is this?" in disguise (*city dependence*).
If two methods are practically tied, we pick the **simpler** one, because a simpler model is
easier to explain, test and maintain.

## The contenders, in one sentence each

| Algorithm | Everyday picture | Verdict for Safira |
|---|---|---|
| **K-Means** | Pick *k* meeting points; every segment walks to its nearest one; move the meeting points to the middle of their crowd; repeat. | **Chosen.** Meets all three requirements; each group has a centre you can describe ("typical segment: 2 shops, police 600 m away"); a new segment is just "which centre is nearest?". |
| **MiniBatch K-Means** | K-Means done on small random handfuls to save time. | Same idea, slightly noisier answers. Only worth it for millions of rows; we have a few hundred thousand. |
| **Bisecting K-Means** | Split everyone into 2 groups, then keep splitting the biggest group. | A valid option and usually near-identical results. No clear gain, slightly more machinery. |
| **Gaussian Mixture (GMM)** | Assume each group is a bell-shaped cloud; each segment is *partly* in several clouds. | Soft membership is nice, but our features are counts and distances with many zeros, which are not bell-shaped. Needs more data to fit stably. |
| **Birch** | Squash the data into a summary tree in one pass, then cluster the summary. | Fast, but results depend on a tuning threshold and the order the data arrives in. |
| **Agglomerative (Ward)** | Start with every segment alone; repeatedly merge the two most similar groups. | Good groups, **but it has no "place a new segment" step**, and memory grows with the square of the data. |
| **Spectral** | Build a "who is similar to whom" network and cut it into pieces. | Can find odd shapes, but no "place a new segment" step and too heavy for a whole road network. |
| **DBSCAN / HDBSCAN** | Find crowded neighbourhoods; anything in an empty area is "noise". | Wrong picture. Infrastructure is a smooth gradient from busy centre to sparse edge, not separate islands. They leave many segments as noise and cannot place new ones. |
| **K-Medoids** | K-Means, but centres must be real segments. | Not included in scikit-learn; marginal benefit here. |

## What the benchmark showed (demo run)

The demo below used **synthetic test data**, so it only proves the benchmark works. Do not quote
its numbers as results about Indian cities.

- Only algorithms with a native "place a new segment" step could pass requirement 1; Ward, Spectral, DBSCAN and HDBSCAN could not.
- DBSCAN and HDBSCAN left roughly 45% of segments as noise, failing requirement 2.
- K-Means, MiniBatch and Bisecting K-Means were within a few hundredths of each other: **a tie**, resolved by the "simpler wins" rule.
- GMM and Spectral scored clearly lower on cross-city transfer.

**Your real result may differ.** Run the benchmark on the real data before presenting any numbers.

## Questions you may be asked

**"Isn't K-Means just the default?"** It was the starting choice, but this benchmark tests it
against nine alternatives under written-down rules. It wins only if it earns it on your data.

**"DBSCAN had the best silhouette score, why not use it?"** Because that score is computed only on
the segments DBSCAN kept. It discarded about 45% as noise, so it looked tidy by ignoring the hard
cases. It also cannot place new segments.

**"Why not deep learning?"** There are no labels and the features are ~10 numbers per segment.
Deep models would add complexity without anything to learn from, and would be much harder to explain.

**"Does a cluster mean a road is safe or unsafe?"** No. Clusters describe how much *mapped*
infrastructure is nearby. They are not crime predictions. Sparse mapping and sparse infrastructure
look identical to the model.

**"How do you know the number of groups is right?"** We do not assume it. The elbow method and
silhouette are computed for k = 2..10, and the choice is a suggestion that can be overridden.

**"Is there a fairness problem if the cities differ?"** City is never a feature, the global model
trains on a city-balanced sample, and the benchmark reports how strongly the groups line up with
city (NMI) and how well a model trained on other cities describes a held-out city.

## Limitations of the comparison itself

- Silhouette and Davies-Bouldin favour compact, round groups, which is the shape K-Means makes. That is why stability, city dependence and cross-city transfer are also used.
- It runs on a city-balanced subsample (default 4,000 rows) because Ward and spectral clustering do not scale.
- Thresholds (5% noise, stability 0.60, tie tolerance 0.03) are judgement calls, printed in the report and editable at the top of `safira_ml/compare.py`.
- With no ground truth, "best" means "best against these stated criteria", not "most correct".

## Reproduce it

```bash
cd ml_service
python -m safira_ml.cli compare                      # reads RoadSegmentFeature from MongoDB
python -m safira_ml.cli compare --from-csv data/road_features.csv --sample 6000
python -m safira_ml.cli compare --only kmeans,ward,gmm_diag
```

Outputs: `reports/algorithm_comparison.md` (table, recommendation, per-algorithm rejection reasons),
`.json` (all numbers) and `.png` (chart). Algorithm keys: `kmeans, minibatch_kmeans,
bisecting_kmeans, gmm_diag, gmm_full, birch, ward, spectral, dbscan, hdbscan`.
