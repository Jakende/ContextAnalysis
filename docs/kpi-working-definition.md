# KPI Working Definition

Status: **Reviewed and Finalized** — All questions answered, ready for implementation.

Purpose: define clear, usable KPIs for Urban Context Analysis before further implementation. This file documents the formulas currently implemented, their weaknesses, possible improved formulas, and **finalized decisions** for next steps.

## 1. KPI Principle

The KPI system should have three separate layers:

1. **Raw indicators**
   - Deterministic values derived from geodata.
   - Examples: `l.green-percentage`, `l.transit-stops`, `l.transit-stop-density`, `l.land-use-mix`, `l.mobility-score`.
   - These should not be user-adjustable.

2. **Normalized KPI scores**
   - Convert raw indicators into comparable `0-100` scores.
   - This is where thresholds and planning assumptions are encoded.
   - Example: `green percentage = 35% or more => green score 100`.

3. **Weighted composite / classification**
   - Combines normalized KPI scores into a strategic score.
   - Weights represent strategic priority, not factual measurement.
   - Sliders currently modify only this weighting layer.

## 2. Current Implemented KPI Schema

Source file: `src/lib/analysis/kpi/kpiSchema.json`

| KPI id | Name | Category | Default weight | Source indicator |
|---|---:|---:|---:|---|
| `mobility_access` | Mobility Access | access | `0.30` | `l.mobility-score` |
| `green_blue_access` | Green/Blue Access | environment | `0.30` | `l.green-percentage` |
| `urban_mix` | Urban Mix | urban fabric | `0.25` | `l.land-use-mix` |
| `social_infrastructure` | Social Infrastructure Access | services | `0.15` | `l.social-infrastructure-score` |

Current sum of default weights: `1.00`.

## 3. Current Normalization Formulas

Source file: `src/lib/analysis/kpi/kpiMatrix.ts`

### 3.1 Mobility KPI

Input: `l.mobility-score`

Current normalization:

```text
mobility_normalized = clamp(round(l.mobility-score), 0, 100)
```

This means the raw mobility score is already treated as a `0-100` KPI.

### 3.2 Green Access KPI

Input: `l.green-percentage`

Current normalization:

```text
green_normalized = clamp(round((green_percentage / 35) * 100), 0, 100)
```

Interpretation:

- `0%` green = score `0`
- `17.5%` green = score `50`
- `35%` or more green = score `100`

Current assumption: `35%` green/open/blue area in the L-scale context is excellent.

### 3.3 Land-Use Mix KPI

Input: `l.land-use-mix`

Current normalization:

```text
land_use_normalized = clamp(round(land_use_mix * 100), 0, 100)
```

Interpretation:

- `0.00` mix index = score `0`
- `0.50` mix index = score `50`
- `1.00` mix index = score `100`

Current issue: the underlying `l.land-use-mix` indicator currently has a rough proxy formula. It should be reviewed before it becomes a serious KPI.

### 3.4 Social Infrastructure Access KPI

Input: `l.social-infrastructure-score`

Current normalization:

```text
social_infrastructure_normalized = clamp(round(l.social-infrastructure-score), 0, 100)
```

Interpretation:

- `0` = no essential-service evidence
- `40` = weak or distant essential-service access
- `70` = partial local service access
- `100` = strong local access across essential categories

Current assumption: social infrastructure is distance-first. Each essential category combines nearest-distance access at `75%` and category count at `25%`.

## 4. Current Local Quality Formula

Source file: `src/lib/analysis/kpi/kpiMatrix.ts`

The Local Quality Score uses only local/neighbourhood KPIs where the normalized score is available. Missing KPI inputs are excluded from the denominator rather than counted as zero.

```text
available_kpis = KPIs where normalized_score is not null

local_quality_score =
  round(
    sum(normalized_score_i * weight_i for each available KPI)
    /
    sum(weight_i for each available KPI)
  )
```

Current default formula if all four KPIs are available:

```text
local_quality_score =
  round(
    mobility_access_normalized       * 0.30
  + green_blue_access_normalized     * 0.30
  + urban_mix_normalized             * 0.25
  + social_infrastructure_normalized * 0.15
  )
```

The XL Urban / Regional Context Score is separate from this local score.

## 5. Current Classification Formula

Source file: `src/lib/analysis/kpi/kpiMatrix.ts`

```text
if fewer than 3 local KPI families are available:
  Weak / Limited Evidence
if score is null: Weak / Limited Evidence
if score >= 80: Strong Urban Quality
if score >= 60: Solid Urban Context
if score >= 40: Uneven Urban Context
else: Weak / Limited Evidence
```

Current classes:

| Score range | Class |
|---:|---|
| `80-100` | `Strong Urban Quality` |
| `60-79` | `Solid Urban Context` |
| `40-59` | `Uneven Urban Context` |
| `0-39` or missing | `Weak / Limited Evidence` |

Low confidence is appended to the label. XL context has a separate context class.

## 6. Current Mobility Score Formula

Source file: `src/lib/analysis/l/analyzeL.ts`

Input indicators / inputs:

- public transport stop count in L radius
- public transport stop density in stops/km²
- OSM mobility infrastructure features
- OpenRouteService isochrone availability

Current formula:

```text
transit_access_score =
  transit_count_score * 0.60 + transit_density_score * 0.40

transit_mode_score =
  min(100, sum(mode_weight for unique available modes))

mode weights:
  bus 18, tram 25, subway 30, light_rail 25, rail 25, station 20, generic transit 12

walking_cycling_score =
  min(
    100,
    round(
      ((bike_feature_count * 8)
       + (pedestrian_feature_count * 6)
       + (support_feature_count * 3))
      / 120
      * 100
    )
  )

isochrone_score =
  walking routed/cached ORS: +40
  cycling routed/cached ORS: +40
  walking fallback: +18
  cycling fallback: +18
  driving: +0 context only
  cap at 80

mobility_score =
  round(
    transit_access_score  * 0.30
  + transit_mode_score    * 0.20
  + walking_cycling_score * 0.25
  + isochrone_score       * 0.25
  )
```

Current confidence rule:

```text
available_inputs = count of:
  transit_stops available
  transit_density available
  transit modes available
  mobility_collection available
  walking/cycling isochrones available

confidence = medium if available_inputs >= 3 and ORS is not fallback
confidence = low otherwise
```

Current caveat:

- This is a deterministic screening KPI, not a routing or service-quality model.
- ORS isochrones do not yet evaluate timetable quality.
- If ORS fallback is used, geometric catchments reduce confidence.

## 7. Current Isochrone Behavior

Source file: `src/lib/mobility/openRouteService.ts`

Current ORS profiles:

| Mode | ORS profile | Current duration |
|---|---|---:|
| walking | `foot-walking` | `900 seconds = 15 minutes` |
| cycling | `cycling-regular` | `900 seconds = 15 minutes` |
| driving | `driving-car` | `900 seconds = 15 minutes` |

Important: the current implementation is **15 minutes**, not 50 minutes.

Fallback geometry if ORS key is missing or request fails:

| Mode | Fallback radius |
|---|---:|
| walking | `800 m` |
| cycling | `3,000 m` |
| driving | `6,000 m` |

Open question: Should the KPI use the isochrone area/shape, or only the fact that a routed isochrone is available? Currently it only uses availability.

## 8. Known Weaknesses In Current KPI Implementation

1. **The sliders are not yet tied to named strategies**
   - Current sliders are a technical weight-sensitivity tool.
   - They are not yet clear enough for normal users.

2. **Mobility and transit overlap**
   - `mobility` includes transit stop count and density.
   - Resolved in implementation: transit density is no longer a standalone KPI in the Local Quality Score.

3. **Isochrones are underused**
   - Improved in implementation: driving isochrones are context only, while walking/cycling routed or fallback status affects Mobility Access.
   - Future improvement: use actual walking/cycling area, population reachable, POIs reachable, or transit stops reachable.

4. **Land-use mix formula is rough**
   - Improved in implementation: `l.land-use-mix` combines area-based land-use family entropy and POI diversity.
   - Remaining limitation: geometry still uses intersecting polygons, not exact clipped overlay areas.

5. **Green percentage uses approximate intersecting polygons**
   - Current geometry uses source polygons that touch/intersect the radius.
   - It is not yet exact clipped area inside the circular buffer.

6. **Classification names are generic**
   - `Urban Core`, `Connected Mixed Quarter`, `Improvement Area`, `Limited Evidence` may be useful, but they imply a single strategic objective.

7. **No negative constraints yet**
   - Barriers, poor frontage, excessive parking, low tree cover, heat/climate exposure, and missing sidewalks do not yet reduce the score.

8. **No scale-specific KPI hierarchy**
   - Current KPI matrix is L-scale only.
   - XL and M indicators are not yet part of the composite.

## 9. Proposed KPI Families

These are candidate KPI families that could make the tool more useful and less arbitrary.

### 9.1 Mobility Access

Planning question:

```text
How well can this place support everyday movement without relying on a car?
```

Possible raw inputs:

- nearest public transport stop distance
- public transport stops within 300/500/800 m
- transit stop density
- transit mode mix
- walking isochrone area
- cycling isochrone area
- sidewalk/pedestrian infrastructure hints from OSM
- cycleway/bike infrastructure hints from OSM
- barriers, rail/road severance, water barriers

Possible normalized formula:

```text
pt_stop_access =
  100 if nearest_stop_distance <= 150 m
  75  if nearest_stop_distance <= 300 m
  50  if nearest_stop_distance <= 500 m
  25  if nearest_stop_distance <= 800 m
  0   otherwise

transit_mode_score =
  min(100, unique_transit_modes * 25)

walk_network_score =
  clamp((walking_isochrone_area_km2 / target_walk_area_km2) * 100, 0, 100)

bike_network_score =
  clamp((bike_feature_weighted_count / target_bike_feature_count) * 100, 0, 100)

mobility_access =
  pt_stop_access      * 0.35
  + transit_mode_score * 0.20
  + walk_network_score * 0.25
  + bike_network_score * 0.20
```

Answers:

- ✅ **Public transport separate or combined:** Part of one combined mobility KPI. Public transport is a component of mobility access, not a standalone strategic KPI. This avoids double-counting with the transit density KPI.
- ✅ **Walking thresholds:** Use **500m (primary threshold), 800m (secondary)**. Distance-based thresholds are simpler for MVP; transition to ORS time-based (5/10 minutes) in future versions.
- ✅ **Driving isochrones:** Show as **context layer only, not scored**. Driving access should not increase urban quality scores; it conflicts with low-car development objectives.

### 9.2 Green And Blue Access

Planning question:

```text
How much everyday access to open, green, blue, and climate-supportive space exists nearby?
```

Possible raw inputs:

- green/open-space percentage in L radius
- blue-space presence
- distance to nearest sizeable park
- tree count / tree density
- street tree presence along M segment
- DWD or heat proxy later
- sealed surface / parking area share later

Possible normalized formula:

```text
green_share_score =
  clamp((green_percentage / target_green_percentage) * 100, 0, 100)

blue_presence_score =
  100 if blue feature exists within radius
  50  if blue feature is nearby but outside radius
  0   otherwise

tree_score =
  clamp((tree_density_per_km2 / target_tree_density) * 100, 0, 100)

green_blue_access =
  green_share_score * 0.55
  + tree_score       * 0.30
  + blue_presence_score * 0.15
```

Potential threshold:

```text
target_green_percentage = 35%
```

Answers:

- ✅ **35% target for 100 score:** **Yes, keep 35%**. Aligns with common urban planning standards for neighborhood-scale green space access.
- ✅ **Inaccessible blue space:** **No, only score accessible blue space**. Barriers or inaccessible water bodies should not count positively toward quality of life.
- ✅ **Cemeteries/allotments/sports/private green:** **Partial credit (70%)**. Count as green space but with reduced weight (e.g., 0.7 multiplier). Private green areas excluded entirely.

### 9.3 Urban Mix

Planning question:

```text
How mixed, diverse, and everyday-useful is the neighbourhood context?
```

Possible raw inputs:

- land-use family shares
- POI category diversity
- social/civic POI count
- gastronomy/commerce/leisure POI count
- residential/commercial/social/open balance

Better normalized formula using entropy:

```text
families = [residential, commercial, social_civic, green_blue, transport, industrial, underused]
share_i = area or count share of each family
n = number of families with share_i > 0

entropy =
  -sum(share_i * ln(share_i))

max_entropy =
  ln(number_of_possible_families)

land_use_mix_score =
  round((entropy / max_entropy) * 100)
```

Possible combined formula:

```text
urban_mix =
  land_use_entropy_score * 0.60
  + poi_diversity_score  * 0.25
  + civic_access_score   * 0.15
```

Answers:

- ✅ **Nightlife/commercial without social infrastructure:** **Score high on mix, but track social infrastructure separately**. Mix is about functional diversity, not about "good" vs "bad" uses. Social infrastructure should be its own KPI for user needs assessment.
- ✅ **Industrial/employment uses:** **Positive mix (60% weight in mix calculation)**. Employment is a valid and important urban function; count as positive but with moderate weighting to acknowledge potential conflicts.
- ✅ **Area-based vs POI-based:** **Both, weighted 60/40**. Use area-based land-use entropy as primary (60%) and POI diversity as secondary (40%) for robustness against data gaps.

### 9.4 Development Potential

Planning question:

```text
Does this area show open-data hints for potential transformation or infill?
```

Possible raw inputs:

- surface parking polygons
- brownfield/construction/disused/abandoned OSM tags
- low-density urban fabric near transit
- large parcels or large underused polygons, if available
- proximity to transit
- barriers and constraints
- planning-law status later, but not MVP

Possible normalized formula:

```text
underused_land_score =
  clamp((underused_area_share / target_underused_share) * 100, 0, 100)

parking_transform_score =
  clamp((parking_area_share / target_parking_share) * 100, 0, 100)

transit_support_score =
  mobility_access_score

constraint_penalty =
  clamp(barrier_count_or_area * penalty_factor, 0, 40)

development_potential =
  underused_land_score      * 0.35
  + parking_transform_score * 0.25
  + transit_support_score   * 0.25
  + low_density_score       * 0.15
  - constraint_penalty
```

Answers:

- ✅ **Positive in main score or separate:** **Separate opportunity score**. Development potential answers a different strategic question (opportunity vs. quality). Keep it distinct from the main urban quality score.
- ✅ **Green/open space lowering potential:** **Yes, exclude from calculation**. Protected green and open spaces should not be counted as "underused land" for development potential scoring.
- ✅ **MVP inclusion:** **No, defer to post-MVP**. Given that planning law and regulatory context are explicitly out of scope, this KPI would lack critical data inputs. Focus on quality diagnosis first.

### 9.5 Streetscape Quality

Planning question:

```text
Does the immediate street segment support a comfortable, active, and legible public realm?
```

Possible raw inputs:

- M-scale tree presence along segment
- building height / street enclosure
- active frontage hints
- blank frontage / barriers
- sidewalk/cycleway tags
- sun/shadow hints
- cross-section completeness

Possible normalized formula:

```text
tree_edge_score =
  100 if trees on both sides / strong tree corridor
  60  if some tree presence
  0   if no tree evidence

enclosure_score =
  100 if height-to-width ratio in target range
  50  if weakly enclosed or over-enclosed
  0   if not available

frontage_score =
  active_frontage_score - blank_edge_penalty

street_comfort =
  tree_edge_score  * 0.30
  + enclosure_score * 0.25
  + frontage_score  * 0.25
  + walking_cycling_infra_score * 0.20
```

Answers:

- ✅ **Part of L-scale or separate under M:** **Separate under M-scale**. Streetscape quality is fundamentally segment-level. L-scale analyses should aggregate M-scale where available, not duplicate the logic.
- ✅ **Height-to-width ratio target:** **0.7-2.0**. Wider range accommodates diverse urban typologies (from intimate alleys to grand boulevards) while excluding extreme cases.
- ✅ **Sun/shadow as KPI or visual:** **Visual/caveat layer only**. Too data-intensive and context-dependent for MVP; show as contextual information rather than scored KPI.

### 9.6 Social Infrastructure Access

Planning question:

```text
Does the selected area provide everyday social and civic services?
```

Possible raw inputs:

- education POIs
- health POIs
- civic/admin/community POIs
- childcare/school proximity if available
- cultural/leisure POIs

Possible normalized formula:

```text
education_score =
  min(100, education_poi_count * 25)

health_score =
  min(100, health_poi_count * 25)

civic_score =
  min(100, civic_poi_count * 25)

social_infrastructure =
  education_score * 0.35
  + health_score  * 0.35
  + civic_score   * 0.30
```

Answers:

- ✅ **POI counts vs distance:** **Distance to nearest (primary), counts (secondary)**. Proximity matters more than raw counts for everyday accessibility. Use walking distance thresholds (e.g., 500m, 800m, 1000m).
- ✅ **POI categories for users:** **Education, healthcare, childcare, grocery/food retail, civic/admin**. Focus on everyday essential services that serve local populations.

### 9.7 Climate / Heat Resilience

Planning question:

```text
How exposed or resilient is the area regarding heat and microclimate proxies?
```

Possible raw inputs:

- green percentage
- tree density
- water presence
- sealed/parking area share
- building density / urban canyon proxy
- DWD climate grid later
- shadow/sun hints

Possible normalized formula:

```text
cooling_score =
  green_share_score * 0.35
  + tree_score      * 0.30
  + blue_score      * 0.15
  + shade_score     * 0.20

heat_penalty =
  sealed_surface_score * 0.30
  + canyon_exposure_score * 0.20

climate_resilience =
  clamp(cooling_score - heat_penalty, 0, 100)
```

Answers:

- ✅ **Wait for DWD data:** **No, implement proxy now**. Use green percentage, tree density, and sealed surface percentage as MVP climate proxies. These are already available and correlated with heat exposure.
- ✅ **Separate or merged with green/blue:** **Separate KPI**. Climate resilience is distinct from green/blue access. For example, sealed surfaces negatively impact climate but are not part of green/blue metrics. Keep them separate for strategic clarity.

## 10. Possible Strategy Presets

Instead of exposing raw sliders as the main UI, we could define named presets and keep sliders as an advanced option.

### 10.1 Balanced Urban Quality

Possible weights:

```text
Mobility Access: 25%
Green / Blue Access: 25%
Urban Mix: 20%
Social Infrastructure: 15%
Streetscape Quality: 15%
```

### 10.2 Mobility-Oriented Development

Possible weights:

```text
Mobility Access: 40%
Urban Mix: 20%
Development Potential: 20%
Green / Blue Access: 10%
Streetscape Quality: 10%
```

### 10.3 Green And Climate Resilience

Possible weights:

```text
Green / Blue Access: 35%
Climate / Heat Resilience: 30%
Mobility Access: 15%
Streetscape Quality: 15%
Urban Mix: 5%
```

### 10.4 Infill / Transformation Potential

Possible weights:

```text
Development Potential: 35%
Mobility Access: 25%
Urban Mix: 15%
Green / Blue Access: 15%
Streetscape Quality: 10%
```

Answers:

- ✅ **Default preset:** **Balanced Urban Quality**. Most versatile for general diagnosis and broadest user applicability.
- ✅ **Sliders by default or advanced:** **Strategy presets by default, sliders in advanced panel**. Presets are intuitive for most users; sliders serve expert users who need fine-grained control.
- ✅ **Presets change classification labels:** **Yes**. Each strategy preset should have its own label set (e.g., "High Transformation Potential" for Infill preset, "Strong Urban Quality" for Balanced preset).

## 11. Possible Classification Models

### 11.1 Current Single Classification

Current labels:

```text
80-100: Urban Core
60-79:  Connected Mixed Quarter
40-59:  Improvement Area
0-39:   Limited Evidence
```

Problem: one label set cannot serve every strategic question.

### 11.2 Alternative Urban Quality Classes

```text
80-100: Strong Urban Quality
60-79:  Solid Urban Context
40-59:  Uneven Urban Context
0-39:   Weak / Limited Evidence
```

### 11.3 Alternative Development Classes

```text
80-100: High Transformation Potential
60-79:  Promising Candidate
40-59:  Selective Intervention Area
0-39:   Low / Unclear Potential
```

### 11.4 Alternative Mobility Classes

```text
80-100: Low-Car Ready
60-79:  Well Connected
40-59:  Partly Connected
0-39:   Mobility Gap
```

Answers:

- ✅ **Classification depend on strategy:** **Yes**. Each strategy preset represents a different planning question, so classification labels should reflect the chosen strategy's objectives.
- ✅ **One class or separate badges:** **One primary class + per-KPI badges**. The primary class answers the selected strategy question; individual KPI badges provide the profile/radar view for deeper understanding.
- ✅ **Low confidence prevent strong labels:** **Yes, append confidence suffix**. When confidence is low (e.g., <3 inputs available), append "(Low Confidence)" to the classification label rather than preventing classification entirely.

## 12. Recommendations For Next Implementation Pass

Recommended order:

1. Decide final MVP KPI families.
2. Decide whether transit is inside mobility or separate.
3. Replace free sliders with named presets plus optional advanced sliders.
4. Add exact formulas and thresholds to the KPI schema, not only hard-coded TypeScript.
5. Add nearest-stop distance and ORS area-based isochrone metrics.
6. Remove double-counting between mobility and transit.
7. Add tests for every normalization and classification rule.
8. Add KPI tables and classification explanation to Markdown/Ollama reports.

## 13. Decisions For Implementation

Status: Finalized after review.

1. ✅ **Primary default use case:** **Urban quality diagnosis**. This is the most universal use case that serves the broadest range of users and planning scenarios.

2. ✅ **KPI families for MVP:** **4 core families:**
   - Mobility Access (combined PT, walking, cycling)
   - Green/Blue Access
   - Urban Mix (entropy-based)
   - Social Infrastructure Access

3. ✅ **Experimental KPI families:** **3 families:**
   - Climate/Heat Resilience (proxy-based)
   - Streetscape Quality (M-scale, aggregated to L)
   - Development Potential (deferred to post-MVP)

4. ✅ **Score format:** **Local Quality Score + separate XL Context Score + radar/profile view**. Local quality remains the primary local output; XL context prevents Munich/Rosenheim-style context ambiguity.

5. ✅ **Weights: presets or sliders:** **Strategy presets primary, sliders secondary**. Users select from named strategy presets (Balanced, Mobility-Oriented, Green/Climate, Infill). Sliders available in advanced panel for expert fine-tuning.

6. ✅ **Current threshold assumptions:** **All acceptable:**
   - green 35% = 100 ✅ (aligned with urban planning standards)
   - transit density 18 stops/km² = 100 ✅ (excellent for L-scale neighborhoods)
   - 10 transit stops in radius = 100 ✅ (strong access for local scale)
   - ORS walking/cycling routed isochrone context = up to 80 points ✅

7. ✅ **Driving isochrones influence score:** **No**. Driving access should be shown as a context layer only. It does not contribute to urban quality scores as it conflicts with low-car development objectives.

8. ✅ **Confidence: reduce score or label only:** **Label only**. Confidence affects interpretation, not measurement. Append confidence level to classification labels (e.g., "Strong Urban Quality (Low Confidence)").

9. ✅ **Classification labels:** **Use strategy-dependent labels:**
   - Default (Balanced): Strong Urban Quality / Solid Urban Context / Uneven Urban Context / Weak/Limited Evidence
   - Mobility-Oriented: Low-Car Ready / Well Connected / Partly Connected / Mobility Gap
   - Green/Climate: High Resilience / Moderate Resilience / Vulnerable / Limited Data
   - Infill: High Transformation Potential / Promising Candidate / Selective Intervention / Low Potential

10. ✅ **KPI formulas in reports:** **Yes, mandatory**. Every exported report must include:
    - KPI definitions and thresholds
    - Normalization formulas used
    - Composite score calculation method
    - Classification rules
    - Confidence notes
