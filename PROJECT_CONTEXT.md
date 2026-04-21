# Urban Analytics Project Context

## Problem Statement & Objective

### Problem Statement

Urban emergency systems generate large amounts of spatial and operational data, but raw incident logs, station coordinates, and travel-time records do not directly reveal where service gaps exist. Traditional map views alone are not enough to explain inequality in access, hotspot concentration, or whether current fire-station placement is optimal for real response conditions.

### Objective

Build a scalable geospatial analytics workflow that converts urban incident and station data into decision-ready location intelligence.

### What the project works upon

- Emergency response mapping and accessibility analysis
- Fire-station planning and response-time optimization
- Spatial equity evaluation across population-weighted regions
- Hotspot and coldspot detection for delayed service areas
- SLA and overflow analysis for fire operations

### Goal

- Estimate nearest-station travel performance
- Visualize operational coverage on interactive maps
- Quantify inequality in access times
- Detect statistically significant service hotspots
- Recommend improved station layouts
- Evaluate current vs optimized emergency response outcomes

## Project Execution Phases

### Phase 1: Research & Conceptual Foundation

This phase establishes the project as a location-intelligence system for emergency response. The work focuses on understanding how routing, geospatial clustering, hotspot statistics, equity metrics, and station-coverage optimization can be combined into one decision-support platform.

### Phase 2: Data Understanding & Functional Role

The project uses multiple datasets, each serving a different functional role:

- `public/data/stations.csv` for emergency station locations
- `public/data/incidents.csv` for general incident mapping
- `public/data/population-h3.csv` for population-weighted H3 cells
- `CAD_FireStation_Enhanced.csv` for detailed fire-response and SLA modeling
- generated fire CSV/JSON assets for recommended stations, metrics, summaries, and simulations

These datasets support routing analysis, hotspot analytics, equity measurement, fire optimization, and overflow simulation.

### Phase 3: Data Analysis & Dashboard Development

The application presents results through a Next.js dashboard with dedicated views for:

- city map and live incident exploration,
- matrix travel-time results,
- spatial equity analytics,
- hotspot analysis,
- fire analytics,
- fire SLA and overflow dashboard.

The output is designed to be visual, operational, and decision-oriented rather than just tabular.

### Phase 4: Mobility and Response Metrics Implementation

In this project, the implemented location metrics are emergency-response focused:

- nearest-station travel time,
- isochrone-based coverage,
- weighted access inequality,
- hotspot significance,
- recommended fire-station coverage,
- SLA compliance and overflow behavior.

## Technology Stack

### Frontend and application layer

- Next.js 16
- React 19
- JavaScript and TypeScript
- Tailwind CSS 4 and custom CSS
- Axios
- `@react-google-maps/api`

### Spatial and analytics libraries

- `h3-js`
- `@turf/turf`

### Python analytics stack

- pandas
- numpy
- matplotlib
- scikit-learn
- PuLP
- osmnx
- networkx
- geopandas
- shapely

### Data storage approach

- CSV for input and derived datasets
- JSON for summaries, assignment caches, and SLA outputs
- static assets in `public/data`

## APIs Used

### External APIs

- Google Maps JavaScript API
  - used to render maps, markers, polygons, circles, and route overlays
- OpenRouteService Matrix API
  - used for travel-time and route-distance calculations between stations and incidents
- OpenRouteService Isochrone API
  - used for time-based reachability polygons

### Internal API routes

- `/api/matrix`
- `/api/isochrone`
- `/api/fire/summary`
- `/api/fire/recommend`
- `/api/fire/estimate`
- `/api/fire/sla`

## Key Analytics Foundations

### Emergency Response Accessibility

The project estimates which station can serve an incident or population cell fastest. This forms the base layer for route analysis, accessibility reporting, and downstream equity/hotspot modules.

### Spatial Equity Metrics

The project measures whether different areas receive equally good or poor access by using weighted metrics over H3 population cells. Dense population zones have more influence than sparsely populated ones.

### Hotspot Detection

The project goes beyond visual map inspection by statistically identifying clusters of high or low response times across neighboring H3 cells.

### Fire Optimization and SLA Modeling

The fire module compares current station placement with recommended station layouts and then measures the impact on modeled response time, coverage, utilization, and overflow performance.

## Algorithms Used

### K-Means Clustering

Used to cluster fire incident demand and generate recommended fire-station locations.

### Elbow Method

Used to compare cluster inertia across different `k` values and support station-count exploration.

### Nearest-Facility / Minimum Travel-Time Assignment

Used to assign each incident or population cell to the station with the lowest travel duration.

### Haversine Distance

Used as a geographic fallback when live routing data is unavailable and for local proximity calculations.

### Weighted Gini Coefficient

Used to measure access inequality across population-weighted H3 cells.

### Weighted Theil Index

Used as an entropy-based inequality metric for response-time distribution.

### Lorenz Curve

Used to visualize cumulative inequality in service burden across the served population.

### Getis-Ord Gi*

Used to identify statistically significant hot spots and cold spots of response times.

### H3 Ring-Neighbor Analysis

Used to define neighborhood structure for hotspot calculations.

### Kernel Density Estimation (KDE)

Used in the fire SLA workflow to convert weighted incident coordinates into a demand-intensity surface and candidate station regions.

### MCLP: Maximum Covering Location Problem

Used to choose a fixed number of fire-station locations that maximize weighted coverage within the SLA threshold.

### MEXCLP-Style Expected Coverage Logic

Used to account for cases where a station may be geographically suitable but operationally busy.

### MALP-Style Availability Estimation

Used to model different busy probabilities across zones.

### Discrete Event Simulation (DES)

Used to replay concurrent incidents, station capacity usage, queueing, and overflow dispatch behavior.

## Implementation Logic

### General map and routing workflow

- Load station, incident, and population datasets
- Normalize CSV inputs into application-ready objects
- Call OpenRouteService for matrix or isochrone outputs
- save derived CSV results to `public/data`
- visualize results on the map and dashboard pages

### Fire analytics workflow

- Load current fire stations, incidents, and station metrics
- cluster historical incident demand using K-Means
- generate recommended station centroids
- estimate inherited response speeds from current stations
- compare current vs recommended travel and response performance
- render KPIs, plots, and map overlays

### Fire SLA workflow

- load CAD-style fire response records
- estimate existing station characteristics
- build candidate sites using KDE
- solve station placement using MCLP
- estimate expected coverage using availability logic
- simulate concurrent incidents using DES
- publish the final SLA analysis as JSON for the dashboard

## Pipeline of the Project

### Input

- stations
- incidents
- population H3 cells
- CAD fire records

### Processing

- CSV parsing and normalization
- routing and distance estimation
- travel-time matrix generation
- hotspot and equity computations
- fire-demand clustering
- coverage optimization
- overflow simulation

### Output

- matrix result files
- equity summaries
- hotspot classifications
- fire-station recommendations
- SLA analytics JSON
- dashboard KPIs, maps, tables, and graphs

## Validation & Output

### What is implemented and validated in this project

- matrix outputs are stored as generated CSV files
- hotspot results are cross-checked through H3-based neighborhood significance
- equity outputs are summarized through weighted Gini, Theil, and Lorenz curve logic
- fire recommendations are compared against current station performance
- SLA outputs are validated through optimization summary, overflow scenario, and DES simulation results

### Main output pages

- `/`
- `/matrix-results`
- `/equity`
- `/hotspots`
- `/fire`
- `/fire-sla`

## Challenges Faced & Solutions

### Challenge 1: Real route travel is more complex than straight-line distance

**Solution:** OpenRouteService matrix and isochrone APIs are used for realistic routing, with Haversine-based fallback estimation when required.

### Challenge 2: Unequal service quality is difficult to see from raw maps

**Solution:** Weighted Gini, Theil, Lorenz curve, and grouped catchment summaries convert access inequality into measurable indicators.

### Challenge 3: Hotspot detection should be statistically valid

**Solution:** Getis-Ord Gi* is applied over true H3 ring neighbors instead of relying only on visual cluster inspection.

### Challenge 4: Fire-station planning must reflect demand concentration

**Solution:** K-Means and KDE are used to identify concentrated demand patterns and candidate station regions.

### Challenge 5: Station placement is a constrained optimization problem

**Solution:** MCLP is used to maximize weighted incident coverage within the 8-minute SLA under a fixed station count.

### Challenge 6: Closest station does not always mean available station

**Solution:** Availability-aware coverage logic, busy probabilities, and station-capacity assumptions are included in the SLA workflow.

### Challenge 7: Concurrent incidents affect real-world response performance

**Solution:** DES is used to simulate overflow, unit occupation, queueing effects, and utilization under overlapping incidents.

### Challenge 8: The project needs both analytics generation and interactive presentation

**Solution:** Python scripts generate heavy analytics outputs offline, while the Next.js application serves them through interactive operational dashboards.

## Conclusion & Key Learnings

This project demonstrates how location intelligence can be applied to emergency response planning through geospatial analytics, optimization, and simulation. It combines web mapping, routing APIs, statistical analysis, and fire coverage modeling into a practical decision-support system that helps identify service gaps, compare current and proposed station layouts, and improve operational response planning.
