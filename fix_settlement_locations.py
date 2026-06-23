#!/usr/bin/env python3
"""
Виправляє розташування об'єктів у GeoJSON згідно з їх назвою населеного пункту.

Алгоритм:
1. Зчитує data/Data.geojson
2. Розраховує центр кожного об'єкта (середню координату)
3. Групує об'єкти за назвою "Населений пункт"
4. Для кожної назви знаходить локальний центр і відсікає викиди
5. Викиди зсуває до центру групи, щоб всі точки були у своїй зоні
6. Зберігає виправлений файл data/Data_settlement_fixed.geojson
"""

import json
import math
import statistics
from pathlib import Path
from typing import Any, Dict, List, Tuple

INPUT_FILE = Path(__file__).parent / "data" / "Data.geojson"
OUTPUT_FILE = Path(__file__).parent / "data" / "Data_settlement_fixed.geojson"
REPORT_FILE = Path(__file__).parent / "data" / "settlement_fix_report.json"

EARTH_RADIUS_KM = 6371.0


def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2
    return 2 * EARTH_RADIUS_KM * math.asin(math.sqrt(a))


def compute_feature_centroid(geometry: Dict[str, Any]) -> Tuple[float, float]:
    coords: List[Tuple[float, float]] = []

    def extract(item: Any) -> None:
        if isinstance(item, list) and item and isinstance(item[0], (int, float)):
            coords.append((float(item[1]), float(item[0])))
        elif isinstance(item, list):
            for sub in item:
                extract(sub)

    extract(geometry.get("coordinates", []))
    if not coords:
        raise ValueError("Geometry contains no coordinates")

    avg_lat = sum(lat for lat, _ in coords) / len(coords)
    avg_lon = sum(lon for _, lon in coords) / len(coords)
    return avg_lat, avg_lon


def apply_shift_to_geometry(geometry: Dict[str, Any], shift_lat: float, shift_lon: float) -> Dict[str, Any]:
    def shift(item: Any) -> Any:
        if isinstance(item, list) and item and isinstance(item[0], (int, float)):
            return [float(item[0]) + shift_lon, float(item[1]) + shift_lat]
        elif isinstance(item, list):
            return [shift(sub) for sub in item]
        return item

    return {**geometry, "coordinates": shift(geometry.get("coordinates", []))}


def determine_outliers(distances: List[float], multiplier: float = 2.5) -> List[bool]:
    if not distances:
        return []
    median = statistics.median(distances)
    deviations = [abs(d - median) for d in distances]
    mad = statistics.median(deviations) if deviations else 0.0
    threshold = max(5.0, median + multiplier * (mad or 1.0))
    return [d > threshold for d in distances]


def main() -> None:
    if not INPUT_FILE.exists():
        print(f"❌ Файл не знайдено: {INPUT_FILE}")
        return

    with open(INPUT_FILE, encoding="utf-8") as f:
        geojson = json.load(f)

    features = geojson.get("features", [])
    settlement_groups: Dict[str, List[Dict[str, Any]]] = {}
    centroids: List[Tuple[float, float]] = []

    for feature in features:
        settlement = (feature.get("properties", {}).get("Населений пункт") or "").strip()
        if not settlement:
            settlement = "<unknown>"
        settlement_groups.setdefault(settlement, []).append(feature)

    report: Dict[str, Any] = {
        "settlements": {},
        "total_features": len(features),
        "total_shifted_features": 0,
        "total_shifted_points": 0,
    }

    for settlement, group in settlement_groups.items():
        if len(group) < 2:
            report["settlements"][settlement] = {
                "count": len(group),
                "skipped": True,
                "reason": "not enough features",
            }
            continue

        centroids = []
        for feature in group:
            try:
                centroid = compute_feature_centroid(feature["geometry"])
                centroids.append(centroid)
            except Exception:
                centroids.append((None, None))

        valid_items = [(feature, centroid) for feature, centroid in zip(group, centroids) if centroid[0] is not None]
        if len(valid_items) < 2:
            report["settlements"][settlement] = {
                "count": len(group),
                "skipped": True,
                "reason": "not enough valid centroids",
            }
            continue

        latitudes = [c[0] for _, c in valid_items]
        longitudes = [c[1] for _, c in valid_items]
        settlement_center = (statistics.median(latitudes), statistics.median(longitudes))

        distances = [haversine_distance(c[0], c[1], settlement_center[0], settlement_center[1]) for _, c in valid_items]
        flags = determine_outliers(distances)
        shifted_features = []

        for (feature, centroid), is_outlier, distance in zip(valid_items, flags, distances):
            if is_outlier:
                shift_lat = settlement_center[0] - centroid[0]
                shift_lon = settlement_center[1] - centroid[1]
                feature["geometry"] = apply_shift_to_geometry(feature["geometry"], shift_lat, shift_lon)
                shifted_features.append({
                    "id": feature.get("properties", {}).get("ID"),
                    "street": feature.get("properties", {}).get("Вулиця"),
                    "distance_km": round(distance, 3),
                    "shift_lat": round(shift_lat, 6),
                    "shift_lon": round(shift_lon, 6),
                })
                report["total_shifted_features"] += 1
                report["total_shifted_points"] += sum(1 for _ in feature["geometry"]["coordinates"]) if isinstance(feature["geometry"]["coordinates"], list) else 0

        report["settlements"][settlement] = {
            "count": len(group),
            "center": {
                "lat": round(settlement_center[0], 6),
                "lon": round(settlement_center[1], 6),
            },
            "shifted_features": shifted_features,
            "outlier_threshold_km": round(max(5.0, statistics.median(distances) + 2.5 * (statistics.median([abs(d - statistics.median(distances)) for d in distances]) or 1.0)), 3),
        }

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(geojson, f, ensure_ascii=False, indent=2)

    with open(REPORT_FILE, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

    print(f"✓ Збережено виправлений GeoJSON: {OUTPUT_FILE}")
    print(f"✓ Звіт з виправлень: {REPORT_FILE}")
    print(f"Всього об'єктів: {report['total_features']}")
    print(f"Виправлено об'єктів: {report['total_shifted_features']}")


if __name__ == "__main__":
    main()
