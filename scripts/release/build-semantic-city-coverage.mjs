#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import polygonClipping from "polygon-clipping";

export const SEMANTIC_REPORT_SCHEMA = "uca-semantic-city-coverage/1.0";

const clipping = polygonClipping;

export async function buildSemanticCityCoverage({
  dataRoot = "public/data",
  manifestPath = "public/data/data-release-manifest.json",
  policyPath = "scripts/release/semantic-city-coverage.config.json",
  output,
  write = Boolean(output),
} = {}) {
  const absoluteDataRoot = resolve(dataRoot);
  const [manifest, policy] = await Promise.all([
    readJson(resolve(manifestPath)),
    readJson(resolve(policyPath)),
  ]);
  validatePolicy(policy);

  const sourceDefinitions = new Map(
    policy.sources.map((definition) => [definition.sourceId, definition]),
  );
  const manifestAssets = new Map(
    (manifest.assets ?? []).map((asset) => [asset.path, asset]),
  );
  const sourceAssets = new Map();
  for (const definition of policy.sources) {
    sourceAssets.set(
      definition.sourceId,
      await loadSourceAsset(definition, absoluteDataRoot),
    );
  }

  const boundaryAsset = sourceAssets.get("bkg-geobasis");
  const fuaAsset = sourceAssets.get("eurostat-gisco-fua");
  const cities = [];
  for (const context of policy.contexts) {
    const municipalityFeature = findFeature(
      boundaryAsset?.collection,
      "AGS",
      context.municipalityAgs,
    );
    const fuaFeature = findFeature(fuaAsset?.collection, "fua_id", context.fuaId);
    const contexts = {
      municipality: summarizeContext(
        "municipality",
        context.municipalityAgs,
        municipalityFeature,
      ),
      fua: summarizeContext("fua", context.fuaId, fuaFeature),
    };

    const sources = [];
    for (const source of manifest.sources ?? []) {
      const definition = sourceDefinitions.get(source.sourceId);
      if (!definition) continue;
      const asset = sourceAssets.get(source.sourceId);
      sources.push(
        await evaluateSourceForCity({
          source,
          definition,
          asset,
          context,
          municipalityFeature,
          fuaFeature,
          dataRoot: absoluteDataRoot,
          policy,
          manifestIndexAsset: manifestAssets.get(definition.path),
        }),
      );
    }
    sources.sort((left, right) => left.sourceId.localeCompare(right.sourceId));
    cities.push({
      id: context.id,
      label: context.label,
      point: { lat: context.lat, lon: context.lon },
      contexts,
      status:
        contexts.municipality.status === "pass" &&
        contexts.fua.status === "pass" &&
        sources.every((source) => source.promotionStatus === "pass")
          ? "pass"
          : "fail",
      sources,
    });
  }

  const pairs = cities.flatMap((city) => city.sources);
  const report = {
    schema: SEMANTIC_REPORT_SCHEMA,
    releaseId: manifest.releaseId,
    releaseDigest: manifest.releaseDigest,
    policy: {
      schema: policy.schema,
      referenceDate: policy.referenceDate,
      analysisRadiusMeters: policy.analysisRadiusMeters,
      geometryValidityMethod:
        "Structural WGS84 validation: supported type, finite/ranged coordinates, closed non-zero polygon rings, and non-degenerate lines.",
      coverageMethod:
        "Exact polygon intersection of present delivery cells with official BKG municipality and GISCO FUA geometry; Urban Atlas thematic coverage sums clipped classified polygons after feature de-duplication.",
      limitations: [
        "Delivery coverage measures the indexed area addressable through present assets; it does not infer feature completeness inside a cell.",
        "Point and line sources report delivery percentages for evidence only and are gated by exact analytical intersection, attributes, classes, and freshness instead.",
        "Urban Atlas is a mutually exclusive land-cover classification; its thematic coverage sums clipped feature areas and clamps the result at 100 percent. A future source that permits overlaps needs an explicit dissolve policy.",
        "Polygon structural validation does not replace a topology engine that reports every possible OGC validity defect.",
      ],
    },
    summary: {
      status: cities.every((city) => city.status === "pass") ? "pass" : "blocked",
      cities: cities.length,
      citiesPassing: cities.filter((city) => city.status === "pass").length,
      sourceCityPairs: pairs.length,
      availabilityPassing: pairs.filter(
        (pair) => pair.availability.status === "available",
      ).length,
      semanticPassing: pairs.filter(
        (pair) => pair.semanticQuality.status === "pass",
      ).length,
      semanticFailing: pairs.filter(
        (pair) => pair.semanticQuality.status === "fail",
      ).length,
      promotionPassing: pairs.filter(
        (pair) => pair.promotionStatus === "pass",
      ).length,
      promotionFailing: pairs.filter(
        (pair) => pair.promotionStatus === "fail",
      ).length,
    },
    cities,
  };

  if (write && output) {
    const absoluteOutput = resolve(output);
    await mkdir(dirname(absoluteOutput), { recursive: true });
    await writeFile(absoluteOutput, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }
  return report;
}

async function evaluateSourceForCity({
  source,
  definition,
  asset,
  context,
  municipalityFeature,
  fuaFeature,
  dataRoot,
  policy,
  manifestIndexAsset,
}) {
  const availabilityGate = source.cityGate?.[context.id];
  const availability = {
    status: availabilityGate?.point?.status ?? "missing",
    footprintContainment: availabilityGate?.footprint?.containment ?? "unknown",
    method: availabilityGate?.point?.method ?? "unavailable",
  };
  const analysisGeometry = rectangleGeometry(
    bboxAroundPoint(context.lat, context.lon, policy.analysisRadiusMeters),
  );
  const analysisFeatures = asset
    ? await loadIntersectingFeatures(asset, analysisGeometry, dataRoot)
    : [];
  const deduplicatedFeatures = deduplicateFeatures(analysisFeatures);
  const featureProfile = profileFeatures(
    deduplicatedFeatures,
    definition,
    source.sourceVersion,
  );

  const coverage = {};
  for (const [contextId, contextFeature] of [
    ["municipality", municipalityFeature],
    ["fua", fuaFeature],
  ]) {
    coverage[contextId] = contextFeature
      ? {
          deliveryPercent: await calculateDeliveryCoveragePercent(
            asset,
            contextFeature.geometry,
          ),
        }
      : { deliveryPercent: null };
  }

  if (definition.thematicCoverageThresholds) {
    for (const contextId of Object.keys(definition.thematicCoverageThresholds)) {
      const contextFeature =
        contextId === "municipality" ? municipalityFeature : fuaFeature;
      if (!contextFeature) {
        coverage[contextId].thematicPercent = null;
        continue;
      }
      coverage[contextId].thematicPercent = await calculateThematicCoveragePercent(
        asset,
        contextFeature.geometry,
        dataRoot,
      );
    }
  }

  const freshness = evaluateFreshness(
    source.sourceVersion,
    definition.freshness,
    policy.referenceDate,
  );
  const releaseContract = {
    indexAssetDeclared: Boolean(manifestIndexAsset),
    byteSizeMatches:
      Boolean(manifestIndexAsset) &&
      manifestIndexAsset.bytes === asset?.fingerprint?.bytes,
    sha256Matches:
      Boolean(manifestIndexAsset) &&
      manifestIndexAsset.sha256 === asset?.fingerprint?.sha256,
    sourceVersionMatches:
      String(source.sourceVersion ?? "") ===
      String(asset?.sourceVersion ?? ""),
  };
  const checks = [
    check(
      "release-contract-alignment",
      Object.values(releaseContract).every(Boolean),
      releaseContract,
      "declared index path, matching bytes/SHA-256, and matching sourceVersion",
      "Prevents semantic evidence from being attributed to a stale immutable release manifest.",
      "critical",
    ),
    check(
      "non-empty-analytical-intersection",
      featureProfile.featureCount >= definition.minimumAnalysisFeatures,
      featureProfile.featureCount,
      `>= ${definition.minimumAnalysisFeatures}`,
      `Exact feature intersection with the ${policy.analysisRadiusMeters} m regression context.`,
    ),
    check(
      "geometry-validity",
      featureProfile.geometryValidityPercent >=
        policy.requiredGeometryValidityPercent,
      featureProfile.geometryValidityPercent,
      `>= ${policy.requiredGeometryValidityPercent}%`,
      `${featureProfile.validGeometryCount}/${featureProfile.featureCount} intersecting features have structurally valid WGS84 geometry.`,
      "critical",
    ),
    check(
      "required-attribute-completeness",
      featureProfile.requiredAttributeCompletenessPercent >=
        policy.requiredAttributeCompletenessPercent,
      featureProfile.requiredAttributeCompletenessPercent,
      `>= ${policy.requiredAttributeCompletenessPercent}%`,
      `Required properties: ${definition.requiredProperties.join(", ")}.`,
    ),
    check(
      "source-version-consistency",
      featureProfile.sourceVersionConsistencyPercent === 100,
      featureProfile.sourceVersionConsistencyPercent,
      "100%",
      "Intersecting feature sourceVersion values must match the release sourceVersion.",
    ),
    check(
      "expected-class-coverage",
      featureProfile.distinctClasses.length >= definition.minimumDistinctClasses,
      featureProfile.distinctClasses.length,
      `>= ${definition.minimumDistinctClasses}`,
      `Distinct non-empty ${definition.classProperty} values in the regression context.`,
    ),
    check(
      "source-freshness",
      freshness.pass,
      freshness.observed,
      freshness.expected,
      freshness.method,
      "medium",
    ),
  ];

  for (const [contextId, minimum] of Object.entries(
    definition.coverageThresholds ?? {},
  )) {
    const observed = coverage[contextId]?.deliveryPercent;
    checks.push(
      check(
        `delivery-coverage-${contextId}`,
        Number.isFinite(observed) && observed >= minimum,
        observed,
        `>= ${minimum}%`,
        "Share of official context geometry intersected by present indexed delivery cells.",
      ),
    );
  }
  for (const [contextId, minimum] of Object.entries(
    definition.thematicCoverageThresholds ?? {},
  )) {
    const observed = coverage[contextId]?.thematicPercent;
    checks.push(
      check(
        `thematic-coverage-${contextId}`,
        Number.isFinite(observed) && observed >= minimum,
        observed,
        `>= ${minimum}%`,
        "Share of official context geometry covered by dissolved, valid thematic polygons.",
      ),
    );
  }

  const semanticStatus = checks.every((item) => item.pass) ? "pass" : "fail";
  return {
    sourceId: source.sourceId,
    sourceVersion: source.sourceVersion,
    availability,
    releaseContract,
    promotionStatus:
      availability.status === "available" && semanticStatus === "pass"
        ? "pass"
        : "fail",
    semanticQuality: {
      status: semanticStatus,
      featureProfile,
      coverage,
      freshness,
      checks,
      failedChecks: checks.filter((item) => !item.pass).map((item) => item.id),
      highestFailureSeverity: highestSeverity(
        checks.filter((item) => !item.pass).map((item) => item.severity),
      ),
    },
  };
}

export function profileFeatures(features, definition, releaseSourceVersion) {
  const featureCount = features.length;
  let validGeometryCount = 0;
  let requiredPropertyCells = 0;
  let populatedRequiredPropertyCells = 0;
  let matchingSourceVersions = 0;
  const classes = new Set();

  for (const feature of features) {
    if (
      definition.geometryTypes.includes(feature?.geometry?.type) &&
      validateGeometry(feature.geometry)
    ) {
      validGeometryCount += 1;
    }
    const properties = feature?.properties ?? {};
    for (const property of definition.requiredProperties) {
      requiredPropertyCells += 1;
      if (isPopulated(properties[property])) populatedRequiredPropertyCells += 1;
    }
    if (sourceVersionCompatible(properties.sourceVersion, releaseSourceVersion)) {
      matchingSourceVersions += 1;
    }
    if (isPopulated(properties[definition.classProperty])) {
      classes.add(String(properties[definition.classProperty]).trim());
    }
  }

  return {
    featureCount,
    validGeometryCount,
    geometryValidityPercent: percent(validGeometryCount, featureCount),
    requiredAttributeCompletenessPercent: percent(
      populatedRequiredPropertyCells,
      requiredPropertyCells,
    ),
    sourceVersionConsistencyPercent: percent(
      matchingSourceVersions,
      featureCount,
    ),
    distinctClasses: [...classes].sort(),
  };
}

export function validateGeometry(geometry) {
  if (!geometry || typeof geometry !== "object") return false;
  if (geometry.type === "Point") return validCoordinate(geometry.coordinates);
  if (geometry.type === "MultiPoint") {
    return (
      Array.isArray(geometry.coordinates) &&
      geometry.coordinates.length > 0 &&
      geometry.coordinates.every(validCoordinate)
    );
  }
  if (geometry.type === "LineString") return validLine(geometry.coordinates);
  if (geometry.type === "MultiLineString") {
    return (
      Array.isArray(geometry.coordinates) &&
      geometry.coordinates.length > 0 &&
      geometry.coordinates.every(validLine)
    );
  }
  if (geometry.type === "Polygon") return validPolygon(geometry.coordinates);
  if (geometry.type === "MultiPolygon") {
    return (
      Array.isArray(geometry.coordinates) &&
      geometry.coordinates.length > 0 &&
      geometry.coordinates.every(validPolygon)
    );
  }
  return false;
}

export function evaluateFreshness(sourceVersion, policy, referenceDate) {
  if (!policy) {
    return { pass: false, observed: sourceVersion, expected: "configured policy", method: "No freshness policy." };
  }
  const reference = parseIsoDay(referenceDate);
  if (policy.mode === "minimum-reference-year") {
    const year = firstFourDigitYear(sourceVersion);
    return {
      pass: year !== null && year >= policy.minimumYear,
      observed: year,
      expected: `>= ${policy.minimumYear}`,
      method: "Reference year parsed from sourceVersion.",
    };
  }
  const versionDate =
    policy.mode === "version-date-prefix"
      ? parseIsoDay(String(sourceVersion ?? "").slice(0, 10))
      : parseIsoDay(sourceVersion);
  const ageDays =
    reference && versionDate
      ? Math.floor((reference.getTime() - versionDate.getTime()) / 86_400_000)
      : null;
  return {
    pass:
      ageDays !== null &&
      ageDays >= 0 &&
      ageDays <= policy.maximumAgeDays,
    observed: ageDays,
    expected: `0..${policy.maximumAgeDays} days`,
    method: "Age in whole UTC days between sourceVersion date and policy referenceDate.",
  };
}

export function coveragePercent(coverageGeometries, contextGeometry) {
  if (!coverageGeometries.length || !isPolygonal(contextGeometry)) return 0;
  try {
    const context = asClippingGeometry(contextGeometry);
    const denominator = clippingArea(context);
    if (denominator <= 0) return 0;
    const dissolvedGroups = dissolveCoverageGeometries(coverageGeometries);
    const covered = dissolvedGroups.reduce((total, coverage) => {
      try {
        return total + clippingArea(clipping.intersection(context, coverage));
      } catch {
        return total;
      }
    }, 0);
    return round(Math.min(100, (covered / denominator) * 100), 4);
  } catch {
    return 0;
  }
}

function dissolveCoverageGeometries(geometries) {
  let pending = geometries.flatMap((geometry) => {
    try {
      const normalized = clipping.union(asClippingGeometry(geometry));
      return normalized.length ? [normalized] : [];
    } catch {
      return [];
    }
  });
  while (pending.length > 1) {
    const next = [];
    let mergedAny = false;
    for (let index = 0; index < pending.length; index += 24) {
      const batch = pending.slice(index, index + 24);
      if (batch.length === 1) {
        next.push(batch[0]);
        continue;
      }
      try {
        next.push(clipping.union(batch[0], ...batch.slice(1)));
        mergedAny = true;
      } catch {
        for (let pairIndex = 0; pairIndex < batch.length; pairIndex += 2) {
          const pair = batch.slice(pairIndex, pairIndex + 2);
          if (pair.length === 1) {
            next.push(pair[0]);
            continue;
          }
          try {
            next.push(clipping.union(pair[0], pair[1]));
            mergedAny = true;
          } catch {
            next.push(...pair);
          }
        }
      }
    }
    pending = next;
    if (!mergedAny) break;
  }
  return pending;
}

async function calculateDeliveryCoveragePercent(asset, contextGeometry) {
  if (!asset) return 0;
  if (asset.kind === "sharded") {
    const cells = asset.shards
      .filter((shard) => shard.present && bboxesIntersect(shard.bbox, geometryBbox(contextGeometry)))
      .map((shard) => rectangleGeometry(shard.bbox));
    return coveragePercent(cells, contextGeometry);
  }
  const geometries = (asset.collection?.features ?? [])
    .filter(
      (feature) =>
        isPolygonal(feature.geometry) &&
        bboxesIntersect(geometryBbox(feature.geometry), geometryBbox(contextGeometry)),
    )
    .map((feature) => feature.geometry);
  return coveragePercent(geometries, contextGeometry);
}

async function calculateThematicCoveragePercent(asset, contextGeometry, dataRoot) {
  if (!asset) return 0;
  const features = deduplicateFeatures(
    await loadIntersectingFeatures(asset, contextGeometry, dataRoot),
  ).filter(
    (feature) =>
      isPolygonal(feature.geometry) && validateGeometry(feature.geometry),
  );
  return coveragePercent(
    features.map((feature) => feature.geometry),
    contextGeometry,
  );
}

async function loadSourceAsset(definition, dataRoot) {
  try {
    const { document, fingerprint } = await readJsonWithFingerprint(
      join(dataRoot, definition.path),
    );
    if (definition.kind === "geojson") {
      return {
        kind: "geojson",
        collection: document?.type === "FeatureCollection" ? document : null,
        sourceVersion:
          document?.sourceVersion ??
          document?.features?.[0]?.properties?.sourceVersion ??
          document?.features?.[0]?.properties?.source_year ??
          null,
        fingerprint,
      };
    }
    if (document?.type !== "FeatureShardIndex" || !Array.isArray(document.shards)) {
      return null;
    }
    return {
      kind: "sharded",
      index: document,
      sourceVersion: document.sourceVersion ?? null,
      fingerprint,
      shards: document.shards
        .map((shard) => ({
          bbox: normalizeBbox(shard?.bbox),
          path: normalizeAssetPath(shard?.url),
          count: Number(shard?.count),
        }))
        .filter(
          (shard) =>
            shard.bbox &&
            shard.path &&
            Number.isInteger(shard.count) &&
            shard.count >= 0,
        )
        .map((shard) => ({
          ...shard,
          present: existsSync(join(dataRoot, shard.path)),
        })),
    };
  } catch {
    return null;
  }
}

async function loadIntersectingFeatures(asset, contextGeometry, dataRoot) {
  const contextBbox = geometryBbox(contextGeometry);
  if (!contextBbox) return [];
  if (asset.kind === "geojson") {
    return (asset.collection?.features ?? []).filter((feature) =>
      featureIntersectsGeometry(feature, contextGeometry),
    );
  }
  const features = [];
  for (const shard of asset.shards.filter((item) =>
    bboxesIntersect(item.bbox, contextBbox),
  )) {
    try {
      const collection = await readJson(join(dataRoot, shard.path));
      shard.present = true;
      if (Array.isArray(collection?.features)) {
        features.push(
          ...collection.features.filter((feature) =>
            featureIntersectsGeometry(feature, contextGeometry),
          ),
        );
      }
    } catch {
      shard.present = false;
    }
  }
  return features;
}

function featureIntersectsGeometry(feature, contextGeometry) {
  const geometry = feature?.geometry;
  if (!geometry) return false;
  const contextBbox = geometryBbox(contextGeometry);
  const featureBbox = geometryBbox(geometry);
  if (!contextBbox || !featureBbox || !bboxesIntersect(featureBbox, contextBbox)) return false;
  // Keep invalid candidates whose envelope touches the analytical context so
  // geometry defects cannot disappear from the validity denominator.
  if (!validateGeometry(geometry)) return true;
  if (geometry.type === "Point") return pointInGeometry(geometry.coordinates, contextGeometry);
  if (geometry.type === "MultiPoint") {
    return geometry.coordinates.some((point) => pointInGeometry(point, contextGeometry));
  }
  if (geometry.type === "LineString") return lineIntersectsGeometry(geometry.coordinates, contextGeometry);
  if (geometry.type === "MultiLineString") {
    return geometry.coordinates.some((line) => lineIntersectsGeometry(line, contextGeometry));
  }
  if (isPolygonal(geometry) && isPolygonal(contextGeometry)) {
    try {
      return clipping.intersection(
        asClippingGeometry(geometry),
        asClippingGeometry(contextGeometry),
      ).length > 0;
    } catch {
      return false;
    }
  }
  return false;
}

function lineIntersectsGeometry(line, geometry) {
  if (line.some((point) => pointInGeometry(point, geometry))) return true;
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  for (let index = 1; index < line.length; index += 1) {
    for (const polygon of polygons) {
      for (const ring of polygon) {
        for (let edge = 1; edge < ring.length; edge += 1) {
          if (segmentsIntersect(line[index - 1], line[index], ring[edge - 1], ring[edge])) {
            return true;
          }
        }
      }
    }
  }
  return false;
}

function segmentsIntersect(a, b, c, d) {
  const orientation = (p, q, r) =>
    Math.sign(
      (q[1] - p[1]) * (r[0] - q[0]) -
        (q[0] - p[0]) * (r[1] - q[1]),
    );
  const onSegment = (p, q, r) =>
    q[0] >= Math.min(p[0], r[0]) &&
    q[0] <= Math.max(p[0], r[0]) &&
    q[1] >= Math.min(p[1], r[1]) &&
    q[1] <= Math.max(p[1], r[1]);
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  if (o1 !== o2 && o3 !== o4) return true;
  return (
    (o1 === 0 && onSegment(a, c, b)) ||
    (o2 === 0 && onSegment(a, d, b)) ||
    (o3 === 0 && onSegment(c, a, d)) ||
    (o4 === 0 && onSegment(c, b, d))
  );
}

function pointInGeometry(point, geometry) {
  if (!isPolygonal(geometry)) return false;
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  return polygons.some(([outer, ...holes]) =>
    pointInRing(point, outer) && !holes.some((hole) => pointInRing(point, hole)),
  );
}

function pointInRing([x, y], ring) {
  let inside = false;
  for (let current = 0, previous = ring.length - 1; current < ring.length; previous = current++) {
    const [x1, y1] = ring[current];
    const [x2, y2] = ring[previous];
    if (y1 > y !== y2 > y && x < ((x2 - x1) * (y - y1)) / (y2 - y1) + x1) {
      inside = !inside;
    }
  }
  return inside;
}

function summarizeContext(type, expectedId, feature) {
  if (!feature) {
    return { type, expectedId, status: "fail", geometryType: null, areaSquareKilometres: null };
  }
  const valid = isPolygonal(feature.geometry) && validateGeometry(feature.geometry);
  return {
    type,
    expectedId,
    status: valid ? "pass" : "fail",
    geometryType: feature.geometry?.type ?? null,
    areaSquareKilometres: valid
      ? round(clippingArea(asClippingGeometry(feature.geometry)) * squareDegreesToSqKm(feature.geometry), 3)
      : null,
  };
}

function squareDegreesToSqKm(geometry) {
  const bbox = geometryBbox(geometry);
  const latitude = bbox ? (bbox[1] + bbox[3]) / 2 : 0;
  return 111.32 * 111.32 * Math.cos((latitude * Math.PI) / 180);
}

function findFeature(collection, property, expected) {
  return collection?.features?.find(
    (feature) => String(feature?.properties?.[property] ?? "") === String(expected),
  ) ?? null;
}

function deduplicateFeatures(features) {
  const unique = new Map();
  for (const feature of features) unique.set(featureKey(feature), feature);
  return [...unique.values()];
}

function featureKey(feature) {
  const properties = feature?.properties ?? {};
  const explicit =
    properties.fragmentId ??
    feature?.id ??
    properties.identifier ??
    properties.stop_id ??
    (properties.trip_id && properties.route_id
      ? `${properties.trip_id}:${properties.route_id}`
      : null);
  if (explicit) {
    return JSON.stringify([
      properties.sourceId ?? null,
      explicit,
      properties.partIndex ?? null,
    ]);
  }
  return createHash("sha256")
    .update(JSON.stringify([feature?.geometry, properties]))
    .digest("hex");
}

function check(id, pass, observed, expected, method, severity = "high") {
  return {
    id,
    pass: Boolean(pass),
    severity,
    confidence: "high",
    observed,
    expected,
    method,
  };
}

function highestSeverity(values) {
  const rank = { critical: 4, high: 3, medium: 2, low: 1 };
  return [...values].sort((left, right) => rank[right] - rank[left])[0] ?? null;
}

function isPopulated(value) {
  return value !== null && value !== undefined && String(value).trim() !== "";
}

function validCoordinate(value) {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    Number.isFinite(Number(value[0])) &&
    Number.isFinite(Number(value[1])) &&
    Number(value[0]) >= -180 &&
    Number(value[0]) <= 180 &&
    Number(value[1]) >= -90 &&
    Number(value[1]) <= 90
  );
}

function validLine(line) {
  return (
    Array.isArray(line) &&
    line.length >= 2 &&
    line.every(validCoordinate) &&
    line.some((coordinate) => coordinate[0] !== line[0][0] || coordinate[1] !== line[0][1])
  );
}

function validPolygon(polygon) {
  return (
    Array.isArray(polygon) &&
    polygon.length > 0 &&
    polygon.every(
      (ring) =>
        Array.isArray(ring) &&
        ring.length >= 4 &&
        ring.every(validCoordinate) &&
        coordinatesEqual(ring[0], ring[ring.length - 1]) &&
        Math.abs(ringArea(ring)) > 1e-15,
    )
  );
}

function coordinatesEqual(left, right) {
  return left?.[0] === right?.[0] && left?.[1] === right?.[1];
}

function isPolygonal(geometry) {
  return geometry?.type === "Polygon" || geometry?.type === "MultiPolygon";
}

function asClippingGeometry(geometry) {
  return geometry.coordinates;
}

function clippingArea(multiPolygonOrPolygon) {
  if (!Array.isArray(multiPolygonOrPolygon) || !multiPolygonOrPolygon.length) return 0;
  const first = multiPolygonOrPolygon[0]?.[0]?.[0];
  const polygons =
    typeof first === "number"
      ? [multiPolygonOrPolygon]
      : multiPolygonOrPolygon;
  return polygons.reduce((total, polygon) => {
    const outer = Math.abs(ringArea(polygon[0] ?? []));
    const holes = polygon
      .slice(1)
      .reduce((sum, ring) => sum + Math.abs(ringArea(ring)), 0);
    return total + Math.max(0, outer - holes);
  }, 0);
}

function ringArea(ring) {
  let sum = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    sum += ring[index][0] * ring[index + 1][1] - ring[index + 1][0] * ring[index][1];
  }
  return sum / 2;
}

function rectangleGeometry([west, south, east, north]) {
  return {
    type: "Polygon",
    coordinates: [[
      [west, south],
      [east, south],
      [east, north],
      [west, north],
      [west, south],
    ]],
  };
}

function bboxAroundPoint(lat, lon, radiusMeters) {
  const latDelta = radiusMeters / 111_320;
  const lonDelta =
    radiusMeters /
    Math.max(1, Math.cos((lat * Math.PI) / 180) * 111_320);
  return [lon - lonDelta, lat - latDelta, lon + lonDelta, lat + latDelta];
}

function geometryBbox(geometry) {
  if (!geometry?.coordinates) return null;
  const bbox = [Infinity, Infinity, -Infinity, -Infinity];
  let count = 0;
  const visit = (value) => {
    if (!Array.isArray(value)) return;
    if (value.length >= 2 && Number.isFinite(Number(value[0])) && Number.isFinite(Number(value[1]))) {
      bbox[0] = Math.min(bbox[0], Number(value[0]));
      bbox[1] = Math.min(bbox[1], Number(value[1]));
      bbox[2] = Math.max(bbox[2], Number(value[0]));
      bbox[3] = Math.max(bbox[3], Number(value[1]));
      count += 1;
      return;
    }
    value.forEach(visit);
  };
  visit(geometry.coordinates);
  return count ? bbox : null;
}

function normalizeBbox(value) {
  if (
    !Array.isArray(value) ||
    value.length !== 4 ||
    !value.every(Number.isFinite) ||
    value[0] > value[2] ||
    value[1] > value[3]
  ) {
    return null;
  }
  return value;
}

function bboxesIntersect(left, right) {
  return Boolean(
    left &&
    right &&
    left[0] <= right[2] &&
    left[2] >= right[0] &&
    left[1] <= right[3] &&
    left[3] >= right[1],
  );
}

function normalizeAssetPath(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const path = value
    .trim()
    .replace(/^https?:\/\/[^/]+\//i, "")
    .replace(/[?#].*$/, "")
    .replace(/^\/?data\//, "")
    .replace(/^\/+/, "");
  return path && !path.split("/").includes("..") ? path : null;
}

function parseIsoDay(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.slice(0, 10))) return null;
  const date = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function firstFourDigitYear(value) {
  const match = String(value ?? "").match(/(?:19|20)\d{2}/);
  return match ? Number(match[0]) : null;
}

function sourceVersionCompatible(featureVersion, releaseVersion) {
  if (!isPopulated(featureVersion) || !isPopulated(releaseVersion)) return false;
  const feature = String(featureVersion).trim();
  const release = String(releaseVersion).trim();
  return feature === release || release.split("+").includes(feature);
}

function percent(numerator, denominator) {
  return denominator > 0 ? round((numerator / denominator) * 100, 4) : 0;
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function validatePolicy(policy) {
  if (policy?.schema !== "uca-semantic-city-coverage-policy/1.0") {
    throw new Error(`Unsupported semantic coverage policy: ${policy?.schema}`);
  }
  if (!Array.isArray(policy.contexts) || !policy.contexts.length) {
    throw new Error("Semantic coverage policy has no regression contexts.");
  }
  if (!Array.isArray(policy.sources) || !policy.sources.length) {
    throw new Error("Semantic coverage policy has no source definitions.");
  }
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function readJsonWithFingerprint(path) {
  const bytes = await readFile(path);
  return {
    document: JSON.parse(bytes.toString("utf8")),
    fingerprint: {
      bytes: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    },
  };
}

const isMain =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = Object.fromEntries(
    process.argv.slice(2).map((argument) => {
      const [key, ...values] = argument.replace(/^--/, "").split("=");
      return [key, values.join("=") || true];
    }),
  );
  const report = await buildSemanticCityCoverage({
    dataRoot: args["data-root"] || "public/data",
    manifestPath: args.manifest || "public/data/data-release-manifest.json",
    policyPath:
      args.policy || "scripts/release/semantic-city-coverage.config.json",
    output:
      args.output === "false"
        ? undefined
        : args.output || "docs/data-quality/semantic-city-coverage.json",
    write: args.output !== "false",
  });
  console.log(JSON.stringify(report.summary, null, 2));
  if (args.enforce === "true" && report.summary.status !== "pass") {
    process.exitCode = 1;
  }
}
