-- DuckDB source query for the portable coverage audit.
-- The report snapshot then flattens the nested sources[].coverage object into
-- one row per source and regression city without changing status or counts.
SELECT *
FROM read_json_auto(
  'public/data/data-release-manifest.json',
  maximum_object_size = 104857600
);
