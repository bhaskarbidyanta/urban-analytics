from __future__ import annotations

import json
import math
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd
import pulp
from sklearn.neighbors import KernelDensity


ROOT = Path(__file__).resolve().parents[2]
SOURCE_CSV = ROOT / "CAD_FireStation_Enhanced.csv"
OUTPUT_JSON = ROOT / "public" / "data" / "fire" / "fire-sla-analysis.json"
SLA_MINUTES = 8.0
STATION_COUNT = 3
STATION_CAPACITY = 2


@dataclass(frozen=True)
class StationOption:
    station_id: str
    station_name: str
    lat: float
    lng: float
    score: float


def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    radius = 6371.0
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lng = math.radians(lng2 - lng1)
    a = (
        math.sin(delta_phi / 2) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lng / 2) ** 2
    )
    return radius * (2 * math.atan2(math.sqrt(a), math.sqrt(1 - a)))


def offset_point(lat: float, lng: float, meters: float, bearing_degrees: float) -> tuple[float, float]:
    radius = 6378137.0
    distance = meters / radius
    bearing = math.radians(bearing_degrees)
    lat1 = math.radians(lat)
    lng1 = math.radians(lng)

    lat2 = math.asin(
        math.sin(lat1) * math.cos(distance)
        + math.cos(lat1) * math.sin(distance) * math.cos(bearing)
    )
    lng2 = lng1 + math.atan2(
        math.sin(bearing) * math.sin(distance) * math.cos(lat1),
        math.cos(distance) - math.sin(lat1) * math.sin(lat2),
    )

    return (math.degrees(lat2), math.degrees(lng2))


def load_frame() -> pd.DataFrame:
    frame = pd.read_csv(SOURCE_CSV)
    frame["Call_Received_Time"] = pd.to_datetime(
        frame["Call_Received_Time"],
        format="%d-%m-%Y %H:%M",
        dayfirst=True,
        errors="coerce",
    )
    frame["Dispatch_Time"] = pd.to_datetime(
        frame["Dispatch_Time"],
        format="%d-%m-%Y %H:%M",
        dayfirst=True,
        errors="coerce",
    )
    frame["Arrival_Time"] = pd.to_datetime(
        frame["Arrival_Time"],
        format="%d-%m-%Y %H:%M",
        dayfirst=True,
        errors="coerce",
    )
    frame["travel_time_min"] = pd.to_numeric(frame["travel_time_min"], errors="coerce").fillna(
        pd.to_numeric(frame["Travel_Time_min"], errors="coerce")
    )
    frame["response_time_min"] = pd.to_numeric(
        frame["response_time_min"], errors="coerce"
    ).fillna(pd.to_numeric(frame["Response_Time_min"], errors="coerce"))
    frame["Distance_Covered_km"] = pd.to_numeric(
        frame["Distance_Covered_km"], errors="coerce"
    ).fillna(0.0)
    frame["Severity_Level"] = pd.to_numeric(frame["Severity_Level"], errors="coerce").fillna(1)
    frame["Hour_of_Day"] = pd.to_numeric(frame["Hour_of_Day"], errors="coerce").fillna(
        frame["Call_Received_Time"].dt.hour
    )
    frame["Latitude"] = pd.to_numeric(frame["Latitude"], errors="coerce")
    frame["Longitude"] = pd.to_numeric(frame["Longitude"], errors="coerce")
    frame = frame.dropna(subset=["Latitude", "Longitude"]).copy()
    frame["priority_rank"] = (
        frame["Priority"]
        .fillna(frame["priority"])
        .astype(str)
        .str.lower()
        .map({"critical": 4, "high": 3, "medium": 2, "low": 1})
        .fillna(2)
        .astype(float)
    )
    frame["incident_weight"] = (
        1.0
        + frame["Severity_Level"] * 0.85
        + frame["priority_rank"] * 0.55
        + np.where(frame["Exceeded_8min_SLA"].astype(str).str.lower() == "yes", 0.75, 0.0)
    )
    return frame


def estimate_existing_stations(frame: pd.DataFrame) -> list[dict[str, object]]:
    stations: list[dict[str, object]] = []
    for station_id, group in frame.groupby("Station_ID"):
        lat = float(group["Latitude"].median())
        lng = float(group["Longitude"].median())
        speed_series = group["Distance_Covered_km"] / group["travel_time_min"].replace(0, np.nan)
        speed_km_per_min = float(speed_series.replace([np.inf, -np.inf], np.nan).dropna().median())
        if not math.isfinite(speed_km_per_min):
            speed_km_per_min = 0.52

        busy_probability = float(
            (
                group["unit_status"]
                .astype(str)
                .str.lower()
                .isin(["busy", "enroute", "out_of_service"])
                .mean()
            )
        )
        stations.append(
            {
                "stationId": station_id,
                "stationName": f"Existing {station_id}",
                "lat": round(lat, 6),
                "lng": round(lng, 6),
                "capacity": STATION_CAPACITY,
                "historicalAssignments": int(len(group)),
                "avgTravelMinutes": round(float(group["travel_time_min"].mean()), 2),
                "avgResponseMinutes": round(float(group["response_time_min"].mean()), 2),
                "busyProbability": round(min(max(busy_probability, 0.1), 0.95), 3),
                "speedKmPerMin": round(speed_km_per_min, 3),
                "zones": sorted(group["Zone"].astype(str).value_counts().head(3).index.tolist()),
            }
        )
    return sorted(stations, key=lambda item: item["stationId"])


def build_candidate_sites(frame: pd.DataFrame, existing_stations: list[dict[str, object]]) -> list[StationOption]:
    coords = frame[["Latitude", "Longitude"]].to_numpy()
    weights = frame["incident_weight"].to_numpy()
    kde = KernelDensity(bandwidth=0.018, kernel="gaussian")
    kde.fit(coords, sample_weight=weights)

    lat_min, lat_max = frame["Latitude"].min(), frame["Latitude"].max()
    lng_min, lng_max = frame["Longitude"].min(), frame["Longitude"].max()
    lat_grid = np.linspace(lat_min, lat_max, 18)
    lng_grid = np.linspace(lng_min, lng_max, 18)
    mesh = np.array([[lat, lng] for lat in lat_grid for lng in lng_grid])
    scores = np.exp(kde.score_samples(mesh))
    ranked_indexes = np.argsort(scores)[::-1]

    candidates: list[StationOption] = []
    min_spacing_km = 1.7

    for rank in ranked_indexes:
        lat, lng = mesh[rank]
        if any(haversine_km(lat, lng, option.lat, option.lng) < min_spacing_km for option in candidates):
            continue
        candidates.append(
            StationOption(
                station_id=f"CAND-{len(candidates) + 1:02d}",
                station_name=f"Candidate {len(candidates) + 1:02d}",
                lat=float(lat),
                lng=float(lng),
                score=float(scores[rank]),
            )
        )
        if len(candidates) >= 18:
            break

    for station in existing_stations:
        candidates.append(
            StationOption(
                station_id=f"EX-{station['stationId']}",
                station_name=str(station["stationName"]),
                lat=float(station["lat"]),
                lng=float(station["lng"]),
                score=max(candidate.score for candidate in candidates),
            )
        )

    unique: list[StationOption] = []
    for candidate in candidates:
        if any(haversine_km(candidate.lat, candidate.lng, item.lat, item.lng) < 0.05 for item in unique):
            continue
        unique.append(candidate)
    return unique


def get_network_speed(existing_stations: list[dict[str, object]]) -> float:
    speeds = [float(station["speedKmPerMin"]) for station in existing_stations if station["speedKmPerMin"]]
    if not speeds:
        return 0.52
    return float(np.median(speeds))


def estimate_travel_minutes(
    lat1: float, lng1: float, lat2: float, lng2: float, speed_km_per_min: float
) -> float:
    route_km = haversine_km(lat1, lng1, lat2, lng2) * 1.18
    return route_km / max(speed_km_per_min, 0.18)


def solve_mclp(
    frame: pd.DataFrame, candidates: list[StationOption], speed_km_per_min: float
) -> tuple[list[StationOption], dict[str, list[int]]]:
    incident_ids = frame["Incident_ID"].tolist()
    weights = frame["incident_weight"].tolist()
    coverage_map: dict[str, list[int]] = {}

    for candidate in candidates:
        coverage_indexes: list[int] = []
        for index, row in enumerate(frame.itertuples()):
            travel_minutes = estimate_travel_minutes(
                candidate.lat,
                candidate.lng,
                row.Latitude,
                row.Longitude,
                speed_km_per_min,
            )
            if travel_minutes <= SLA_MINUTES:
                coverage_indexes.append(index)
        coverage_map[candidate.station_id] = coverage_indexes

    problem = pulp.LpProblem("fire_mclp", pulp.LpMaximize)
    x = {
        candidate.station_id: pulp.LpVariable(f"x_{candidate.station_id}", cat="Binary")
        for candidate in candidates
    }
    y = {incident_id: pulp.LpVariable(f"y_{index}", cat="Binary") for index, incident_id in enumerate(incident_ids)}

    problem += pulp.lpSum(weights[index] * y[incident_id] for index, incident_id in enumerate(incident_ids))
    problem += pulp.lpSum(x[candidate.station_id] for candidate in candidates) == STATION_COUNT

    for index, incident_id in enumerate(incident_ids):
        covering_candidates = [
            x[candidate.station_id]
            for candidate in candidates
            if index in coverage_map[candidate.station_id]
        ]
        if covering_candidates:
            problem += y[incident_id] <= pulp.lpSum(covering_candidates)
        else:
            problem += y[incident_id] == 0

    solver = pulp.PULP_CBC_CMD(msg=False)
    problem.solve(solver)

    selected = [candidate for candidate in candidates if x[candidate.station_id].value() == 1]
    return selected, coverage_map


def pick_nearest_existing_station(
    candidate: StationOption, existing_stations: list[dict[str, object]]
) -> dict[str, object]:
    return min(
        existing_stations,
        key=lambda station: haversine_km(
            candidate.lat, candidate.lng, float(station["lat"]), float(station["lng"])
        ),
    )


def build_assignments(
    frame: pd.DataFrame,
    selected_sites: list[StationOption],
    existing_stations: list[dict[str, object]],
    speed_km_per_min: float,
) -> tuple[list[dict[str, object]], list[dict[str, object]], dict[str, list[dict[str, object]]]]:
    selected_station_rows: list[dict[str, object]] = []
    station_lookup: dict[str, dict[str, object]] = {}

    for index, site in enumerate(selected_sites, start=1):
        inherited_station = pick_nearest_existing_station(site, existing_stations)
        selected_station = {
            "stationId": f"OPT-{index:02d}",
            "stationName": f"Optimized Station {index}",
            "candidateId": site.station_id,
            "lat": round(site.lat, 6),
            "lng": round(site.lng, 6),
            "capacity": STATION_CAPACITY,
            "kdeScore": round(site.score, 6),
            "busyProbability": inherited_station["busyProbability"],
            "speedKmPerMin": inherited_station["speedKmPerMin"] or speed_km_per_min,
            "inheritedStationId": inherited_station["stationId"],
            "inheritedZones": inherited_station["zones"],
        }
        selected_station_rows.append(selected_station)
        station_lookup[selected_station["stationId"]] = selected_station

    incident_rows: list[dict[str, object]] = []
    assignments_by_station: dict[str, list[dict[str, object]]] = defaultdict(list)

    for row in frame.itertuples():
        travel_options = []
        for station in selected_station_rows:
            travel_minutes = estimate_travel_minutes(
                station["lat"],
                station["lng"],
                row.Latitude,
                row.Longitude,
                float(station["speedKmPerMin"]),
            )
            travel_options.append(
                {
                    "stationId": station["stationId"],
                    "travelMinutes": travel_minutes,
                    "withinSla": travel_minutes <= SLA_MINUTES,
                }
            )
        travel_options.sort(key=lambda item: item["travelMinutes"])

        primary = travel_options[0]
        backups_in_sla = [option for option in travel_options if option["withinSla"]]
        unit_coverages = []
        for option in backups_in_sla:
            station_busy = float(station_lookup[option["stationId"]]["busyProbability"])
            unit_coverages.extend([station_busy, station_busy])

        expected_coverage_probability = 0.0
        if unit_coverages:
            busy_product = 1.0
            for busy_probability in unit_coverages:
                busy_product *= busy_probability
            expected_coverage_probability = 1.0 - busy_product

        incident = {
            "incidentId": row.Incident_ID,
            "lat": round(float(row.Latitude), 6),
            "lng": round(float(row.Longitude), 6),
            "zone": str(row.Zone),
            "incidentType": str(row.Incident_Type),
            "severity": int(row.Severity_Level),
            "priority": str(row.Priority),
            "hourOfDay": int(row.Hour_of_Day),
            "historicalStationId": str(row.Station_ID),
            "historicalResponseMinutes": round(float(row.response_time_min), 2),
            "historicalSlaMet": bool(str(row.Exceeded_8min_SLA).lower() != "yes"),
            "optimizedStationId": primary["stationId"],
            "optimizedTravelMinutes": round(primary["travelMinutes"], 2),
            "optimizedSlaMet": bool(primary["travelMinutes"] <= SLA_MINUTES),
            "backupStationsWithinSla": [
                {"stationId": option["stationId"], "travelMinutes": round(option["travelMinutes"], 2)}
                for option in backups_in_sla[1:]
            ],
            "expectedCoverageProbability": round(expected_coverage_probability, 4),
            "weight": round(float(row.incident_weight), 3),
        }
        incident_rows.append(incident)
        assignments_by_station[primary["stationId"]].append(incident)

    for station in selected_station_rows:
        assigned = assignments_by_station[station["stationId"]]
        station["coveredIncidents"] = len(assigned)
        station["avgTravelMinutes"] = round(
            float(np.mean([item["optimizedTravelMinutes"] for item in assigned])) if assigned else 0.0,
            2,
        )
        station["slaCoverageRate"] = round(
            float(np.mean([1.0 if item["optimizedSlaMet"] else 0.0 for item in assigned])) if assigned else 0.0,
            4,
        )
        station["expectedCoverageRate"] = round(
            float(np.mean([item["expectedCoverageProbability"] for item in assigned])) if assigned else 0.0,
            4,
        )

    return selected_station_rows, incident_rows, assignments_by_station


def derive_zone_busy_probabilities(frame: pd.DataFrame) -> list[dict[str, object]]:
    rows = []
    for zone, group in frame.groupby("Zone"):
        busy_probability = float(
            (
                group["unit_status"]
                .astype(str)
                .str.lower()
                .isin(["busy", "enroute", "out_of_service"])
                .mean()
            )
        )
        rows.append(
            {
                "zone": str(zone),
                "busyProbability": round(min(max(busy_probability, 0.1), 0.95), 3),
                "incidentCount": int(len(group)),
                "avgHistoricalResponseMinutes": round(float(group["response_time_min"].mean()), 2),
            }
        )
    return sorted(rows, key=lambda item: item["incidentCount"], reverse=True)


def build_hotspots(frame: pd.DataFrame) -> list[dict[str, object]]:
    coords = frame[["Latitude", "Longitude"]].to_numpy()
    weights = frame["incident_weight"].to_numpy()
    kde = KernelDensity(bandwidth=0.016, kernel="gaussian")
    kde.fit(coords, sample_weight=weights)

    lat_grid = np.linspace(frame["Latitude"].min(), frame["Latitude"].max(), 16)
    lng_grid = np.linspace(frame["Longitude"].min(), frame["Longitude"].max(), 16)
    mesh = np.array([[lat, lng] for lat in lat_grid for lng in lng_grid])
    scores = np.exp(kde.score_samples(mesh))
    score_max = float(scores.max()) if len(scores) else 1.0

    hotspots = []
    for index in np.argsort(scores)[::-1][:18]:
        lat, lng = mesh[index]
        hotspots.append(
            {
                "id": f"hotspot-{len(hotspots) + 1}",
                "lat": round(float(lat), 6),
                "lng": round(float(lng), 6),
                "intensity": round(float(scores[index] / score_max), 4),
            }
        )
    return hotspots


def build_overflow_scenario(
    incidents: list[dict[str, object]], stations: list[dict[str, object]]
) -> dict[str, object]:
    primary_station = max(stations, key=lambda item: item["coveredIncidents"])
    nearest_fire = next(
        (
            incident
            for incident in sorted(
                incidents,
                key=lambda item: (
                    item["optimizedStationId"] != primary_station["stationId"],
                    item["incidentType"] != "Structure Fire",
                    -item["severity"],
                ),
            )
            if incident["optimizedStationId"] == primary_station["stationId"]
        ),
        incidents[0],
    )
    fallback_station = min(
        [station for station in stations if station["stationId"] != primary_station["stationId"]],
        key=lambda station: haversine_km(
            nearest_fire["lat"], nearest_fire["lng"], station["lat"], station["lng"]
        ),
    )
    second_lat, second_lng = offset_point(nearest_fire["lat"], nearest_fire["lng"], 100, 55)
    primary_eta = estimate_travel_minutes(
        primary_station["lat"],
        primary_station["lng"],
        second_lat,
        second_lng,
        float(primary_station["speedKmPerMin"]),
    )
    fallback_eta = estimate_travel_minutes(
        fallback_station["lat"],
        fallback_station["lng"],
        second_lat,
        second_lng,
        float(fallback_station["speedKmPerMin"]),
    )

    return {
        "narrative": "Incident A consumes both units at the nearest station, so a second nearby fire must overflow to the next best station.",
        "primaryStationId": primary_station["stationId"],
        "fallbackStationId": fallback_station["stationId"],
        "stationCapacity": STATION_CAPACITY,
        "incidentA": {
            "incidentId": nearest_fire["incidentId"],
            "lat": nearest_fire["lat"],
            "lng": nearest_fire["lng"],
            "incidentType": nearest_fire["incidentType"],
            "requiredUnits": 2,
            "servedByStationId": primary_station["stationId"],
            "etaMinutes": nearest_fire["optimizedTravelMinutes"],
        },
        "incidentB": {
            "incidentId": "SYNTH-OVERFLOW-100M",
            "lat": round(second_lat, 6),
            "lng": round(second_lng, 6),
            "distanceFromIncidentAMeters": 100,
            "requiredUnits": 1,
            "primaryStationWouldTakeMinutes": round(primary_eta, 2),
            "fallbackStationEtaMinutes": round(fallback_eta, 2),
            "slaMetByFallback": bool(fallback_eta <= SLA_MINUTES),
            "slaDeltaMinutes": round(fallback_eta - primary_eta, 2),
        },
    }


def incident_required_units(incident_type: str, severity: int) -> int:
    fire_like = incident_type.lower() in {
        "structure fire",
        "vehicle fire",
        "wildland fire",
        "electrical fire",
        "hazmat",
        "gas leak",
    }
    return 2 if fire_like and severity >= 3 else 1


def service_duration_minutes(incident_type: str, severity: int) -> float:
    type_bonus = {
        "Structure Fire": 18,
        "Vehicle Fire": 12,
        "Wildland Fire": 20,
        "Electrical Fire": 10,
        "Hazmat": 22,
        "Gas Leak": 16,
        "Rescue": 14,
        "Medical Emergency": 8,
        "False Alarm": 3,
    }
    return 10 + severity * 6 + type_bonus.get(incident_type, 8)


def run_des_simulation(
    frame: pd.DataFrame, stations: list[dict[str, object]]
) -> dict[str, object]:
    working = frame.sort_values("Call_Received_Time").head(320).copy()
    station_state = {
        station["stationId"]: {
            "available_at": [pd.Timestamp.min for _ in range(STATION_CAPACITY)],
            "responses": 0,
            "busy_minutes": 0.0,
            "overflow_responses": 0,
        }
        for station in stations
    }
    incident_results = []

    for row in working.itertuples():
        call_time = row.Call_Received_Time if pd.notna(row.Call_Received_Time) else pd.Timestamp("2024-01-01")
        demand_units = incident_required_units(str(row.Incident_Type), int(row.Severity_Level))
        ranked = []
        for station in stations:
            travel_minutes = estimate_travel_minutes(
                station["lat"],
                station["lng"],
                row.Latitude,
                row.Longitude,
                float(station["speedKmPerMin"]),
            )
            ranked.append((travel_minutes, station))
        ranked.sort(key=lambda item: item[0])

        assigned_units = []
        used_station_ids: list[str] = []
        for travel_minutes, station in ranked:
            unit_schedule = station_state[station["stationId"]]["available_at"]
            available_indexes = [
                index for index, available_at in enumerate(unit_schedule) if available_at <= call_time
            ]
            if not available_indexes:
                continue
            while available_indexes and len(assigned_units) < demand_units:
                unit_index = available_indexes.pop(0)
                assigned_units.append((station, unit_index, travel_minutes))
                used_station_ids.append(station["stationId"])
            if len(assigned_units) >= demand_units:
                break

        if len(assigned_units) < demand_units:
            travel_minutes, station = ranked[0]
            next_unit_index = min(
                range(STATION_CAPACITY),
                key=lambda index: station_state[station["stationId"]]["available_at"][index],
            )
            wait_until = station_state[station["stationId"]]["available_at"][next_unit_index]
            effective_departure = max(call_time, wait_until)
            assigned_units = [(station, next_unit_index, travel_minutes + (effective_departure - call_time).total_seconds() / 60)]
            used_station_ids = [station["stationId"]]

        response_minutes = max(item[2] for item in assigned_units)
        service_minutes = service_duration_minutes(str(row.Incident_Type), int(row.Severity_Level))
        for station, unit_index, effective_travel in assigned_units:
            release_at = call_time + pd.to_timedelta(effective_travel + service_minutes, unit="m")
            station_state[station["stationId"]]["available_at"][unit_index] = release_at
            station_state[station["stationId"]]["responses"] += 1
            station_state[station["stationId"]]["busy_minutes"] += effective_travel + service_minutes
            if station["stationId"] != ranked[0][1]["stationId"]:
                station_state[station["stationId"]]["overflow_responses"] += 1

        incident_results.append(
            {
                "incidentId": row.Incident_ID,
                "responseMinutes": round(response_minutes, 2),
                "slaMet": response_minutes <= SLA_MINUTES,
                "overflowed": len(set(used_station_ids)) > 1 or used_station_ids[0] != ranked[0][1]["stationId"],
            }
        )

    incident_count = len(incident_results) or 1
    station_utilization = []
    horizon_minutes = max(
        1.0,
        (
            (
                (working["Call_Received_Time"].max() or pd.Timestamp("2024-01-01"))
                - (working["Call_Received_Time"].min() or pd.Timestamp("2024-01-01"))
            ).total_seconds()
            / 60
        ),
    )
    for station in stations:
        state = station_state[station["stationId"]]
        utilization = state["busy_minutes"] / (horizon_minutes * STATION_CAPACITY)
        station_utilization.append(
            {
                "stationId": station["stationId"],
                "responses": int(state["responses"]),
                "overflowResponses": int(state["overflow_responses"]),
                "utilization": round(min(utilization, 0.99), 4),
            }
        )

    return {
        "incidentsSimulated": incident_count,
        "slaMetRate": round(
            sum(1 for result in incident_results if result["slaMet"]) / incident_count,
            4,
        ),
        "overflowIncidentRate": round(
            sum(1 for result in incident_results if result["overflowed"]) / incident_count,
            4,
        ),
        "averageResponseMinutes": round(
            float(np.mean([result["responseMinutes"] for result in incident_results])),
            2,
        ),
        "stationUtilization": sorted(station_utilization, key=lambda item: item["utilization"], reverse=True),
        "sampleIncidents": incident_results[:24],
    }


def build_algorithm_cards() -> list[dict[str, object]]:
    return [
        {
            "shortName": "KDE",
            "longName": "Kernel Density Estimation",
            "usedFor": "Convert incident coordinates into a demand-intensity surface and generate hotspot candidate sites.",
            "whyChosen": "Best fit for finding latent fire-demand clusters before any location optimization.",
        },
        {
            "shortName": "MCLP",
            "longName": "Maximum Covering Location Problem",
            "usedFor": "Choose exactly 3 station locations that maximize weighted incident coverage within the 8-minute SLA.",
            "whyChosen": "Matches the fixed-budget requirement of placing 3 stations across the map.",
        },
        {
            "shortName": "MEXCLP",
            "longName": "Maximum Expected Covering Location Problem",
            "usedFor": "Evaluate how likely incidents are to remain covered when units at a station are already busy.",
            "whyChosen": "Necessary because your overflow scenario depends on station availability, not just distance.",
        },
        {
            "shortName": "MALP",
            "longName": "Maximum Availability Location Problem",
            "usedFor": "Estimate zone-specific availability using different busy probabilities by demand zone.",
            "whyChosen": "The CSV shows uneven demand and status mix across zones, so one global busy rate would be too coarse.",
        },
        {
            "shortName": "DES",
            "longName": "Discrete Event Simulation",
            "usedFor": "Replay concurrent incidents with station capacities, dispatch queues, and overflow responses.",
            "whyChosen": "This is the clearest way to quantify how SLAs degrade when two incidents occur near each other.",
        },
    ]


def build_summary(
    frame: pd.DataFrame,
    optimized_incidents: list[dict[str, object]],
    overflow_scenario: dict[str, object],
    des_results: dict[str, object],
) -> dict[str, object]:
    historical_sla_rate = float(
        (frame["Exceeded_8min_SLA"].astype(str).str.lower() != "yes").mean()
    )
    optimized_sla_rate = float(
        np.mean([1.0 if incident["optimizedSlaMet"] else 0.0 for incident in optimized_incidents])
    )
    expected_coverage_rate = float(
        np.mean([incident["expectedCoverageProbability"] for incident in optimized_incidents])
    )
    avg_historical_response = float(frame["response_time_min"].mean())
    avg_optimized_response = float(
        np.mean([incident["optimizedTravelMinutes"] for incident in optimized_incidents])
    )
    overflow_count = sum(1 for incident in optimized_incidents if incident["backupStationsWithinSla"])

    return {
        "totalIncidents": int(len(frame)),
        "historicalSlaRate": round(historical_sla_rate, 4),
        "optimizedPrimarySlaRate": round(optimized_sla_rate, 4),
        "expectedCoverageRate": round(expected_coverage_rate, 4),
        "historicalAverageResponseMinutes": round(avg_historical_response, 2),
        "optimizedAverageTravelMinutes": round(avg_optimized_response, 2),
        "overflowCandidateIncidents": int(overflow_count),
        "desOverflowRate": des_results["overflowIncidentRate"],
        "desSlaMetRate": des_results["slaMetRate"],
        "overflowScenarioSlaDeltaMinutes": overflow_scenario["incidentB"]["slaDeltaMinutes"],
    }


def main() -> None:
    OUTPUT_JSON.parent.mkdir(parents=True, exist_ok=True)

    frame = load_frame()
    existing_stations = estimate_existing_stations(frame)
    candidates = build_candidate_sites(frame, existing_stations)
    speed_km_per_min = get_network_speed(existing_stations)
    selected_sites, _ = solve_mclp(frame, candidates, speed_km_per_min)
    optimized_stations, optimized_incidents, _ = build_assignments(
        frame, selected_sites, existing_stations, speed_km_per_min
    )
    hotspots = build_hotspots(frame)
    zone_busy_probabilities = derive_zone_busy_probabilities(frame)
    overflow_scenario = build_overflow_scenario(optimized_incidents, optimized_stations)
    des_results = run_des_simulation(frame, optimized_stations)
    summary = build_summary(frame, optimized_incidents, overflow_scenario, des_results)

    payload = {
        "generatedAt": pd.Timestamp.utcnow().isoformat(),
        "sourceCsv": SOURCE_CSV.name,
        "assumptions": {
            "slaMinutes": SLA_MINUTES,
            "selectedStationCount": STATION_COUNT,
            "stationCapacityUnits": STATION_CAPACITY,
            "travelModel": "Historical median speed from CAD data with a 1.18 road detour factor.",
        },
        "algorithms": build_algorithm_cards(),
        "summary": summary,
        "existingStations": existing_stations,
        "optimizedStations": optimized_stations,
        "zoneBusyProbabilities": zone_busy_probabilities,
        "hotspots": hotspots,
        "incidents": optimized_incidents,
        "overflowScenario": overflow_scenario,
        "desSimulation": des_results,
    }

    OUTPUT_JSON.write_text(json.dumps(payload, indent=2), encoding="utf8")
    print(f"Wrote {OUTPUT_JSON}")


if __name__ == "__main__":
    main()
