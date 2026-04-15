from __future__ import annotations

import json
import math
import os
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from urllib import error, request

import matplotlib
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from sklearn.cluster import KMeans

matplotlib.use("Agg")


ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "public" / "data" / "fire"
GRAPH_DIR = DATA_DIR / "graphs"
ENV_FILE = ROOT / ".env.local"
ORS_MATRIX_URL = "https://api.openrouteservice.org/v2/matrix/driving-car"


@dataclass(frozen=True)
class StationSeed:
    station_id: str
    station_name: str
    lat: float
    lng: float
    area: str
    capacity: int


STATION_SEEDS = [
    StationSeed("FS-201", "Shivajinagar Station", 18.5314, 73.8478, "Pune Core", 4),
    StationSeed("FS-202", "Kothrud Station", 18.5074, 73.8077, "Pune West", 4),
    StationSeed("FS-203", "Hadapsar Station", 18.4966, 73.9418, "Pune East", 5),
    StationSeed("FS-204", "Wagholi Station", 18.5793, 73.9792, "Pune Fringe", 3),
    StationSeed("FS-205", "Kharadi Station", 18.5518, 73.9351, "Pune East", 4),
    StationSeed("FS-206", "Baner Station", 18.5590, 73.7868, "Pune North West", 4),
    StationSeed("FS-207", "Nigdi Station", 18.6512, 73.7706, "PCMC West", 5),
    StationSeed("FS-208", "Bhosari Station", 18.6298, 73.8468, "PCMC East", 4),
]

CLUSTER_CENTERS = np.array(
    [
        [18.5310, 73.8570],
        [18.5520, 73.9150],
        [18.5000, 73.9250],
        [18.6440, 73.8020],
        [18.6170, 73.8780],
    ]
)
CLUSTER_WEIGHTS = np.array([0.16, 0.26, 0.18, 0.22, 0.18])
CALL_TYPES = [
    ("Structure Fire", 0.30),
    ("Residential Alarm", 0.18),
    ("Vehicle Fire", 0.12),
    ("Commercial Fire", 0.16),
    ("Electrical Fire", 0.10),
    ("Industrial Incident", 0.08),
    ("Rescue Assist", 0.06),
]
LOCALITIES = [
    "Shivajinagar",
    "Kothrud",
    "Baner",
    "Hadapsar",
    "Kharadi",
    "Wagholi",
    "Nigdi",
    "Bhosari",
    "Pimpri",
    "Chinchwad",
]


def ensure_dirs() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    GRAPH_DIR.mkdir(parents=True, exist_ok=True)


def read_env_value(key: str) -> str:
    if os.getenv(key):
        return os.getenv(key, "")

    if not ENV_FILE.exists():
        return ""

    for line in ENV_FILE.read_text(encoding="utf8").splitlines():
        if not line or line.lstrip().startswith("#") or "=" not in line:
            continue
        env_key, value = line.split("=", 1)
        if env_key.strip() == key:
            return value.strip().strip('"').strip("'")

    return ""


def weighted_choice(rng: np.random.Generator, values: list[tuple[str, float]]) -> str:
    names = [value for value, _ in values]
    weights = [weight for _, weight in values]
    return rng.choice(names, p=np.array(weights) / np.sum(weights))


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    radius = 6371.0
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)

    a = (
        math.sin(delta_phi / 2) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2) ** 2
    )
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return radius * c


def approximate_distance_meters(from_lat: float, from_lng: float, to_lat: float, to_lng: float) -> float:
    return haversine_km(from_lat, from_lng, to_lat, to_lng) * 1000 * 1.2


def run_kmeans(points: np.ndarray, k: int, seed: int = 42) -> tuple[np.ndarray, np.ndarray, float]:
    model = KMeans(
        n_clusters=k,
        init="k-means++",
        n_init=20,
        max_iter=300,
        random_state=seed,
    )
    labels = model.fit_predict(points)
    return model.cluster_centers_, labels, float(model.inertia_)


def build_station_frame() -> pd.DataFrame:
    return pd.DataFrame(
        [
            {
                "station_id": station.station_id,
                "station_name": station.station_name,
                "lat": station.lat,
                "lng": station.lng,
                "area": station.area,
                "capacity": station.capacity,
            }
            for station in STATION_SEEDS
        ]
    )


def build_base_incidents(count: int = 1000, seed: int = 42) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    rows: list[dict[str, object]] = []
    start_date = datetime(2025, 1, 1, 0, 0, 0)

    for index in range(count):
        cluster_index = rng.choice(len(CLUSTER_CENTERS), p=CLUSTER_WEIGHTS)
        cluster_lat, cluster_lng = CLUSTER_CENTERS[cluster_index]
        lat = float(np.clip(rng.normal(cluster_lat, 0.020), 18.43, 18.72))
        lng = float(np.clip(rng.normal(cluster_lng, 0.024), 73.72, 74.02))

        hourly_weights = np.array(
            [
                0.020, 0.017, 0.015, 0.014, 0.015, 0.020,
                0.035, 0.055, 0.070, 0.060, 0.050, 0.045,
                0.042, 0.040, 0.042, 0.045, 0.055, 0.070,
                0.075, 0.070, 0.055, 0.040, 0.028, 0.025,
            ]
        )
        day_offset = int(rng.integers(0, 365))
        hour = int(rng.choice(np.arange(24), p=hourly_weights / hourly_weights.sum()))
        minute = int(rng.integers(0, 60))
        second = int(rng.integers(0, 60))
        incident_time = start_date + timedelta(days=day_offset, hours=hour, minutes=minute, seconds=second)

        rows.append(
            {
                "incident_id": f"CAD-F-{incident_time:%Y%m}-{index + 1:04d}",
                "incident_time": incident_time.isoformat(),
                "incident_hour": hour,
                "lat": round(lat, 6),
                "lng": round(lng, 6),
                "call_type": weighted_choice(rng, CALL_TYPES),
                "alarm_level": int(rng.choice([1, 2, 3], p=[0.68, 0.24, 0.08])),
                "priority_code": int(rng.choice([1, 2, 3, 4], p=[0.22, 0.38, 0.28, 0.12])),
                "dispatch_zone": f"Z-{cluster_index + 1}",
                "locality": str(rng.choice(LOCALITIES)),
            }
        )

    return pd.DataFrame(rows)


def post_ors_matrix(payload: dict[str, object], api_key: str) -> dict[str, object]:
    request_body = json.dumps(payload).encode("utf8")
    req = request.Request(
        ORS_MATRIX_URL,
        data=request_body,
        headers={
            "Authorization": api_key,
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with request.urlopen(req, timeout=60) as response:
        return json.loads(response.read().decode("utf8"))


def build_network_assignments(
    stations: pd.DataFrame,
    incidents: pd.DataFrame,
    station_id_col: str,
    station_name_col: str,
    cache_name: str,
) -> pd.DataFrame:
    cache_path = DATA_DIR / cache_name
    if cache_path.exists():
        cached = pd.read_json(cache_path)
        cached_station_ids = set(cached.get("assigned_station_id", pd.Series(dtype=str)).astype(str))
        expected_station_ids = set(stations[station_id_col].astype(str))
        if len(cached) == len(incidents) and cached_station_ids.issubset(expected_station_ids):
            return cached

    api_key = read_env_value("ORS_API_KEY")
    assignments: list[dict[str, object]] = []
    batch_size = 45

    for start in range(0, len(incidents), batch_size):
        chunk = incidents.iloc[start:start + batch_size].copy()

        if api_key:
            payload = {
                "locations": [
                    *stations[["lng", "lat"]].values.tolist(),
                    *chunk[["lng", "lat"]].values.tolist(),
                ],
                "sources": list(range(len(stations))),
                "destinations": list(range(len(stations), len(stations) + len(chunk))),
                "metrics": ["distance", "duration"],
            }
            try:
                response = post_ors_matrix(payload, api_key)
                distances = response.get("distances", [])
                durations = response.get("durations", [])
            except Exception as exc:
                print(f"Falling back for batch {start}:{start + len(chunk)} because ORS failed: {exc}")
                distances = []
                durations = []
                for station in stations.itertuples():
                    station_distances = []
                    station_durations = []
                    for incident in chunk.itertuples():
                        distance_m = approximate_distance_meters(station.lat, station.lng, incident.lat, incident.lng)
                        station_distances.append(distance_m)
                        station_durations.append(distance_m / 10.5)
                    distances.append(station_distances)
                    durations.append(station_durations)
        else:
            distances = []
            durations = []
            for station in stations.itertuples():
                station_distances = []
                station_durations = []
                for incident in chunk.itertuples():
                    distance_m = approximate_distance_meters(station.lat, station.lng, incident.lat, incident.lng)
                    station_distances.append(distance_m)
                    station_durations.append(distance_m / 10.5)
                distances.append(station_distances)
                durations.append(station_durations)

        for offset, incident in enumerate(chunk.itertuples()):
            best_station_index = None
            best_duration = None
            best_distance = None

            for station_index, station in enumerate(stations.itertuples()):
                duration_value = durations[station_index][offset]
                distance_value = distances[station_index][offset]
                if duration_value is None or distance_value is None:
                    distance_value = approximate_distance_meters(
                        station.lat,
                        station.lng,
                        incident.lat,
                        incident.lng,
                    )
                    duration_value = distance_value / 10.5
                if best_duration is None or duration_value < best_duration:
                    best_station_index = station_index
                    best_duration = duration_value
                    best_distance = distance_value

            if best_station_index is None or best_distance is None or best_duration is None:
                fallback_station = stations.iloc[0]
                best_station_index = 0
                best_distance = approximate_distance_meters(
                    fallback_station["lat"],
                    fallback_station["lng"],
                    incident.lat,
                    incident.lng,
                )
                best_duration = best_distance / 10.5

            chosen_station = stations.iloc[best_station_index]
            assignments.append(
                {
                    "incident_id": incident.incident_id,
                    "assigned_station_id": chosen_station[station_id_col],
                    "assigned_station_name": chosen_station[station_name_col],
                    "route_distance_meters": round(float(best_distance), 2),
                    "route_duration_seconds": round(float(best_duration), 2),
                }
            )

    assignment_frame = pd.DataFrame(assignments)
    assignment_frame.to_json(cache_path, orient="records", indent=2)
    return assignment_frame


def add_historical_response_fields(incidents: pd.DataFrame, seed: int = 42) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    enriched = incidents.copy()
    enriched["dispatch_delay_seconds"] = rng.integers(25, 120, len(enriched))
    enriched["turnout_seconds"] = rng.integers(35, 90, len(enriched))
    noise = rng.normal(0, 24, len(enriched))

    traffic_multiplier = np.ones(len(enriched))
    traffic_multiplier[(enriched["incident_hour"] >= 6) & (enriched["incident_hour"] <= 9)] = 1.18
    traffic_multiplier[(enriched["incident_hour"] >= 17) & (enriched["incident_hour"] <= 20)] = 1.24
    traffic_multiplier[(enriched["incident_hour"] >= 0) & (enriched["incident_hour"] <= 4)] = 0.86

    enriched["response_time_seconds"] = (
        enriched["turnout_seconds"]
        + (enriched["route_duration_seconds"] * traffic_multiplier)
        + noise
    ).clip(lower=150).round().astype(int)

    incident_times = pd.to_datetime(enriched["incident_time"])
    incident_starts = incident_times + pd.to_timedelta(enriched["dispatch_delay_seconds"], unit="s")
    incident_ends = incident_starts + pd.to_timedelta(enriched["response_time_seconds"], unit="s")

    enriched["incident_start"] = incident_starts.dt.strftime("%Y-%m-%dT%H:%M:%S")
    enriched["incident_end"] = incident_ends.dt.strftime("%Y-%m-%dT%H:%M:%S")
    enriched["distance_km_est"] = (enriched["route_distance_meters"] / 1000).round(3)
    return enriched


def summarize_station_metrics(incidents: pd.DataFrame) -> pd.DataFrame:
    metrics = (
        incidents.groupby(["station_id", "station_name"], as_index=False)
        .agg(
            incident_count=("incident_id", "count"),
            avg_distance_km=("distance_km_est", "mean"),
            avg_response_seconds=("response_time_seconds", "mean"),
            avg_route_duration_seconds=("route_duration_seconds", "mean"),
        )
        .sort_values("station_id")
    )
    metrics["avg_speed_kmph"] = (
        metrics["avg_distance_km"] / (metrics["avg_response_seconds"] / 3600.0)
    ).round(2)
    metrics["avg_distance_km"] = metrics["avg_distance_km"].round(2)
    metrics["avg_response_seconds"] = metrics["avg_response_seconds"].round(1)
    metrics["avg_route_duration_seconds"] = metrics["avg_route_duration_seconds"].round(1)
    return metrics


def assign_recommended_speeds(
    recommended: pd.DataFrame,
    station_metrics: pd.DataFrame,
    current_stations: pd.DataFrame,
) -> pd.DataFrame:
    speed_map = {
        row.station_id: row.avg_speed_kmph for row in station_metrics.itertuples()
    }
    rows = []
    for station in recommended.itertuples():
        best_current_id = None
        best_distance = None
        for current in current_stations.itertuples():
            distance = haversine_km(station.lat, station.lng, current.lat, current.lng)
            if best_distance is None or distance < best_distance:
                best_current_id = current.station_id
                best_distance = distance
        rows.append(
            {
                "recommended_station_id": station.recommended_station_id,
                "inherited_station_id": best_current_id,
                "inherited_speed_kmph": round(float(speed_map.get(best_current_id, station_metrics["avg_speed_kmph"].mean())), 2),
            }
        )
    return recommended.merge(pd.DataFrame(rows), on="recommended_station_id", how="left")


def build_recommended_stations(
    incidents: pd.DataFrame,
    centroids: np.ndarray,
    labels: np.ndarray,
    recommended_assignments: pd.DataFrame,
    station_metrics: pd.DataFrame,
    current_stations: pd.DataFrame,
) -> pd.DataFrame:
    frame = incidents.copy()
    frame["cluster_id"] = labels
    recommended = pd.DataFrame(
        [
            {
                "recommended_station_id": f"RFS-{cluster_id + 1:02d}",
                "cluster_id": cluster_id,
                "lat": round(float(centroid[0]), 6),
                "lng": round(float(centroid[1]), 6),
            }
            for cluster_id, centroid in enumerate(centroids)
        ]
    )
    recommended = assign_recommended_speeds(recommended, station_metrics, current_stations)

    merged_assignments = recommended_assignments.merge(
        recommended,
        left_on="assigned_station_id",
        right_on="recommended_station_id",
        how="left",
    )
    merged_assignments["estimated_response_seconds"] = (
        merged_assignments["route_distance_meters"]
        / (merged_assignments["inherited_speed_kmph"] * 1000 / 3600)
    )

    summary_rows = []
    for station in recommended.itertuples():
        members = frame[frame["cluster_id"] == station.cluster_id]
        station_routes = merged_assignments[
            merged_assignments["assigned_station_id"] == station.recommended_station_id
        ]
        summary_rows.append(
            {
                "recommended_station_id": station.recommended_station_id,
                "cluster_id": station.cluster_id,
                "lat": station.lat,
                "lng": station.lng,
                "incident_coverage": int(len(members)),
                "avg_distance_km": round(float(station_routes["route_distance_meters"].mean() / 1000), 2),
                "estimated_response_seconds": round(float(station_routes["estimated_response_seconds"].mean()), 1),
                "dominant_locality": members["locality"].mode().iat[0],
                "inherited_station_id": station.inherited_station_id,
                "inherited_speed_kmph": station.inherited_speed_kmph,
            }
        )

    return pd.DataFrame(summary_rows).sort_values("cluster_id")


def save_graphs(
    incidents: pd.DataFrame,
    current_stations: pd.DataFrame,
    centroids: np.ndarray,
    labels: np.ndarray,
    inertias: list[float],
) -> None:
    cluster_colors = ["#ff6b5f", "#ffc145", "#45c4ff", "#56d364", "#c084fc", "#fb7185"]

    fig, ax = plt.subplots(figsize=(8, 5))
    ks = list(range(2, 8))
    ax.plot(ks, inertias, marker="o", linewidth=2.8, color="#ff914d")
    ax.set_title("KMeans Elbow Curve for Fire Incidents")
    ax.set_xlabel("Number of clusters (k)")
    ax.set_ylabel("Inertia")
    ax.grid(alpha=0.22)
    fig.tight_layout()
    fig.savefig(GRAPH_DIR / "fire-kmeans-elbow.png", dpi=170)
    plt.close(fig)

    fig, ax = plt.subplots(figsize=(8, 6))
    for cluster_id in sorted(set(labels)):
        members = incidents[labels == cluster_id]
        ax.scatter(
            members["lng"],
            members["lat"],
            s=18,
            alpha=0.55,
            color=cluster_colors[cluster_id % len(cluster_colors)],
            label=f"Cluster {cluster_id + 1}",
        )
    ax.scatter(
        centroids[:, 1],
        centroids[:, 0],
        s=180,
        color="#111827",
        marker="X",
        edgecolors="#ffffff",
        linewidths=1.4,
        label="Recommended stations",
    )
    ax.scatter(
        current_stations["lng"],
        current_stations["lat"],
        s=120,
        color="#b91c1c",
        marker="s",
        edgecolors="#fff4ec",
        linewidths=1.2,
        label="Current stations",
        zorder=5,
    )
    for station in current_stations.itertuples():
        ax.annotate(
            station.station_id,
            (station.lng, station.lat),
            xytext=(6, 6),
            textcoords="offset points",
            fontsize=7,
            color="#7f1d1d",
            weight="bold",
        )
    ax.set_title("KMeans Cluster Map for 1000 CAD-Style Fire Incidents")
    ax.set_xlabel("Longitude")
    ax.set_ylabel("Latitude")
    ax.legend(loc="best", fontsize=8)
    ax.grid(alpha=0.18)
    fig.tight_layout()
    fig.savefig(GRAPH_DIR / "fire-kmeans-clusters.png", dpi=170)
    plt.close(fig)

    by_hour = incidents.copy()
    by_hour["hour"] = pd.to_datetime(by_hour["incident_time"]).dt.hour
    hourly = by_hour.groupby("hour", as_index=False)["response_time_seconds"].mean()

    fig, ax = plt.subplots(figsize=(8, 5))
    ax.bar(hourly["hour"], hourly["response_time_seconds"], color="#45c4ff", width=0.8)
    ax.set_title("Average Historical Response Time by Hour")
    ax.set_xlabel("Hour of day")
    ax.set_ylabel("Average response time (seconds)")
    ax.grid(axis="y", alpha=0.2)
    fig.tight_layout()
    fig.savefig(GRAPH_DIR / "fire-response-by-hour.png", dpi=170)
    plt.close(fig)


def build_summary_payload(
    incidents: pd.DataFrame,
    station_metrics: pd.DataFrame,
    recommended: pd.DataFrame,
    current_assignments: pd.DataFrame,
    recommended_assignments: pd.DataFrame,
    inertias: list[float],
) -> dict[str, object]:
    by_hour = incidents.copy()
    by_hour["hour"] = pd.to_datetime(by_hour["incident_time"]).dt.hour
    hour_means = by_hour.groupby("hour")["response_time_seconds"].mean()
    overall_mean = float(incidents["response_time_seconds"].mean())
    peak_mean = float(hour_means.loc[[7, 8, 9, 17, 18, 19]].mean())
    night_mean = float(hour_means.loc[[0, 1, 2, 3, 4]].mean())

    current_avg_distance = float(current_assignments["route_distance_meters"].mean() / 1000)
    current_modeled = float(incidents["modeled_current_response_seconds"].mean())
    optimized_avg_distance = float(recommended_assignments["route_distance_meters"].mean() / 1000)
    optimized_modeled = float(recommended_assignments["estimated_response_seconds"].mean())
    delta_seconds = optimized_modeled - current_modeled
    delta_distance = optimized_avg_distance - current_avg_distance
    improved_share = float(
        (
            recommended_assignments["estimated_response_seconds"].values
            < incidents["modeled_current_response_seconds"].values
        ).mean()
    )

    return {
        "generatedAt": datetime.utcnow().isoformat() + "Z",
        "incidentCount": int(len(incidents)),
        "stationCount": int(station_metrics.shape[0]),
        "recommendedStationCount": int(recommended.shape[0]),
        "avgResponseSeconds": round(overall_mean, 1),
        "avgDistanceKm": round(current_avg_distance, 2),
        "peakHourMultiplier": round(peak_mean / overall_mean, 2),
        "nightHourMultiplier": round(night_mean / overall_mean, 2),
        "comparison": {
            "currentHistoricalAvgResponseSeconds": round(overall_mean, 1),
            "currentModeledAvgResponseSeconds": round(current_modeled, 1),
            "optimizedModeledAvgResponseSeconds": round(optimized_modeled, 1),
            "responseDeltaSeconds": round(delta_seconds, 1),
            "responseDeltaPercent": round((delta_seconds / current_modeled) * 100, 1),
            "currentAvgDistanceKm": round(current_avg_distance, 2),
            "optimizedAvgDistanceKm": round(optimized_avg_distance, 2),
            "distanceDeltaKm": round(delta_distance, 2),
            "improvedIncidentShare": round(improved_share * 100, 1),
        },
        "elbowInertia": [{"k": k, "inertia": round(value, 1)} for k, value in zip(range(2, 8), inertias)],
        "graphs": {
            "elbow": "/data/fire/graphs/fire-kmeans-elbow.png",
            "clusters": "/data/fire/graphs/fire-kmeans-clusters.png",
            "responseByHour": "/data/fire/graphs/fire-response-by-hour.png",
        },
    }


def main() -> None:
    ensure_dirs()

    station_frame = build_station_frame()
    base_incidents = build_base_incidents()
    points = base_incidents[["lat", "lng"]].to_numpy()

    inertias: list[float] = []
    best_centroids = np.empty((0, 2))
    best_labels = np.empty(0, dtype=int)

    for k in range(2, 8):
        centroids, labels, inertia = run_kmeans(points, k=k, seed=42)
        inertias.append(inertia)
        if k == 5:
            best_centroids = centroids
            best_labels = labels

    current_assignments = build_network_assignments(
        station_frame,
        base_incidents,
        "station_id",
        "station_name",
        "ors-current-assignments.json",
    )

    incidents = base_incidents.merge(current_assignments, on="incident_id", how="left").rename(
        columns={
            "assigned_station_id": "station_id",
            "assigned_station_name": "station_name",
        }
    )
    incidents = add_historical_response_fields(incidents)
    incidents["modeled_current_response_seconds"] = incidents["response_time_seconds"]

    station_metrics = summarize_station_metrics(incidents)

    recommended_seed_frame = pd.DataFrame(
        [
            {
                "recommended_station_id": f"RFS-{index + 1:02d}",
                "recommended_station_name": f"Recommended RFS-{index + 1:02d}",
                "lat": round(float(centroid[0]), 6),
                "lng": round(float(centroid[1]), 6),
            }
            for index, centroid in enumerate(best_centroids)
        ]
    )

    recommended_assignments = build_network_assignments(
        recommended_seed_frame.rename(
            columns={
                "recommended_station_id": "station_id",
                "recommended_station_name": "station_name",
            }
        ),
        base_incidents,
        "station_id",
        "station_name",
        "ors-recommended-assignments.json",
    )

    recommended_stations = build_recommended_stations(
        incidents,
        best_centroids,
        best_labels,
        recommended_assignments,
        station_metrics,
        station_frame,
    )

    recommended_assignments = recommended_assignments.merge(
        recommended_stations[[
            "recommended_station_id",
            "inherited_speed_kmph",
        ]],
        left_on="assigned_station_id",
        right_on="recommended_station_id",
        how="left",
    )
    recommended_assignments["estimated_response_seconds"] = (
        recommended_assignments["route_distance_meters"]
        / (recommended_assignments["inherited_speed_kmph"] * 1000 / 3600)
    )

    save_graphs(incidents, station_frame, best_centroids, best_labels, inertias)

    incidents_output = incidents[
        [
            "incident_id",
            "incident_time",
            "incident_start",
            "incident_end",
            "response_time_seconds",
            "lat",
            "lng",
            "station_id",
            "station_name",
            "call_type",
            "alarm_level",
            "priority_code",
            "dispatch_zone",
            "locality",
            "distance_km_est",
            "route_distance_meters",
            "route_duration_seconds",
            "modeled_current_response_seconds",
        ]
    ]

    incidents_output.to_csv(DATA_DIR / "fire-incidents.csv", index=False)
    station_frame.to_csv(DATA_DIR / "fire-stations.csv", index=False)
    station_metrics.to_csv(DATA_DIR / "fire-station-metrics.csv", index=False)
    recommended_stations.to_csv(DATA_DIR / "fire-recommended-stations.csv", index=False)

    summary_payload = build_summary_payload(
        incidents,
        station_metrics,
        recommended_stations,
        current_assignments,
        recommended_assignments,
        inertias,
    )
    (DATA_DIR / "fire-summary.json").write_text(
        json.dumps(summary_payload, indent=2),
        encoding="utf8",
    )


if __name__ == "__main__":
    main()
