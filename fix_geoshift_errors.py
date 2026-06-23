#!/usr/bin/env python3
"""
Скрипт для автоматичного виправлення географічних помилок (геошифтів) у GeoJSON.
Читає errors.json, розраховує вектор зсуву, і виправляє координати у Data.geojson.

Процес:
1. Завантажує errors.json для аналізу помилок
2. Розраховує середній вектор зсуву на основі всіх помилкових точок
3. Застосовує цей вектор до координат об'єктів з Торецька, що потрапляють у Горлівку
4. Зберігає виправлений GeoJSON у Data_fixed.geojson
"""

import json
from pathlib import Path
from typing import Dict, List, Tuple, Any
import statistics

# Bounding boxes для старокупованих територій
OCCUPIED_AREAS = {
    "Горлівка": {
        "lon": (37.95, 38.15),
        "lat": (48.25, 48.40),
    },
    "Донецьк": {
        "lon": (37.70, 37.95),
        "lat": (47.90, 48.10),
    },
    "Макіївка": {
        "lon": (37.40, 37.75),
        "lat": (48.00, 48.20),
    },
}

# Bounding boxes для контрольованих міст
CONTROLLED_AREAS = {
    "Торецьк": {
        "lon": (37.78, 37.90),
        "lat": (48.32, 48.45),
    },
    "Бахмут": {
        "lon": (37.88, 38.00),
        "lat": (48.50, 48.62),
    },
}


def point_in_bbox(lat: float, lon: float, bbox: Dict[str, Tuple]) -> bool:
    """Перевіряє, чи знаходиться точка у межах bounding box."""
    lon_min, lon_max = bbox["lon"]
    lat_min, lat_max = bbox["lat"]
    return lon_min <= lon <= lon_max and lat_min <= lat <= lat_max


def calculate_shift_vector(errors_file: str) -> Tuple[float, float]:
    """
    Розраховує середній вектор зсуву на основі помилкових координат.
    
    Args:
        errors_file: шлях до errors.json
    
    Returns:
        Кортеж (shift_lon, shift_lat)
    """
    print("📊 Розраховуємо вектор зсуву...")
    
    with open(errors_file, "r", encoding="utf-8") as f:
        data = json.load(f)
    
    errors = data.get("errors", [])
    
    # Витягуємо помилкові координати (в Горлівці) та теоретичні (де вони мають бути)
    lon_shifts = []
    lat_shifts = []
    
    # Використовуємо середину bounding box'ів як еталонні точки
    gorlixka_lon = (OCCUPIED_AREAS["Горлівка"]["lon"][0] + OCCUPIED_AREAS["Горлівка"]["lon"][1]) / 2
    gorlixka_lat = (OCCUPIED_AREAS["Горлівка"]["lat"][0] + OCCUPIED_AREAS["Горлівка"]["lat"][1]) / 2
    
    torecjk_lon = (CONTROLLED_AREAS["Торецьк"]["lon"][0] + CONTROLLED_AREAS["Торецьк"]["lon"][1]) / 2
    torecjk_lat = (CONTROLLED_AREAS["Торецьк"]["lat"][0] + CONTROLLED_AREAS["Торецьк"]["lat"][1]) / 2
    
    # Розраховуємо сдвіги для кожної помилкової координати
    for error in errors:
        if error.get("знайдено") == "Горлівка (окупована територія)":
            lon_error, lat_error = error["координата"]
            
            # Вектор від помилкової координати до центру Торецька
            # (це не ідеально, але дає добру оцінку)
            shift_lon = torecjk_lon - lon_error
            shift_lat = torecjk_lat - lat_error
            
            lon_shifts.append(shift_lon)
            lat_shifts.append(shift_lat)
    
    if not lon_shifts:
        print("❌ Не знайдено помилкових координат в errors.json")
        return (0.0, 0.0)
    
    # Розраховуємо медіану (більш стійка до викидів)
    shift_lon_median = statistics.median(lon_shifts)
    shift_lat_median = statistics.median(lat_shifts)
    
    # Розраховуємо середнє значення
    shift_lon_mean = statistics.mean(lon_shifts)
    shift_lat_mean = statistics.mean(lat_shifts)
    
    print(f"✓ Розраховані зсуви:")
    print(f"  lon (медіана): {shift_lon_median:.5f}")
    print(f"  lat (медіана): {shift_lat_median:.5f}")
    print(f"  lon (середнє): {shift_lon_mean:.5f}")
    print(f"  lat (середнє): {shift_lat_mean:.5f}")
    
    # Використовуємо медіану як основний вектор
    return (shift_lon_median, shift_lat_median)


def apply_shift_to_coordinates(coords: List, shift_lon: float, shift_lat: float) -> List:
    """
    Застосовує зсув до координат (рекурсивно для MultiLineString і т.д.).
    """
    if not coords:
        return coords
    
    # Перевіряємо, чи це координата (список [lon, lat])
    if isinstance(coords[0], (int, float)):
        # Це координата [lon, lat]
        return [coords[0] + shift_lon, coords[1] + shift_lat]
    else:
        # Це список координат або список списків (для MultiLineString, Polygon, тощо)
        return [apply_shift_to_coordinates(c, shift_lon, shift_lat) for c in coords]


def fix_geoshift_errors(geojson_file: str, errors_file: str, output_file: str):
    """
    Виправляє географічні помилки у GeoJSON файлі.
    """
    print(f"\n🔧 ВИПРАВЛЕННЯ ГЕОШИФТІВ\n")
    print(f"📂 Завантажуємо: {geojson_file}")
    
    # Зчитуємо оригінальний GeoJSON
    with open(geojson_file, "r", encoding="utf-8") as f:
        geojson_data = json.load(f)
    
    # Розраховуємо вектор зсуву
    shift_lon, shift_lat = calculate_shift_vector(errors_file)
    
    print(f"\n🎯 Застосовуємо зсув: lon={shift_lon:.5f}, lat={shift_lat:.5f}\n")
    
    features = geojson_data.get("features", [])
    fixed_count = 0
    point_count = 0
    
    # Проходимо по всіх об'єктам
    for feature in features:
        props = feature.get("properties", {})
        settlement = props.get("Населений пункт", "")
        street = props.get("Вулиця", "")
        
        # Перевіряємо, чи це Торецьк
        if "Торецьк" not in settlement:
            continue
        
        geometry = feature.get("geometry", {})
        coords = geometry.get("coordinates", [])
        
        if not coords:
            continue
        
        # Витягуємо всі координати для перевірки
        all_coords = []
        
        def extract_coords(c):
            if isinstance(c[0], (int, float)):
                all_coords.append(c)
            else:
                for sub in c:
                    extract_coords(sub)
        
        extract_coords(coords)
        
        # Перевіряємо, чи будь-яка координата потрапляє у Горлівку
        has_geoshift = False
        for lon, lat in all_coords:
            if point_in_bbox(lat, lon, OCCUPIED_AREAS["Горлівка"]):
                has_geoshift = True
                break
        
        # Якщо знайдено геошифт, виправляємо координати
        if has_geoshift:
            geometry["coordinates"] = apply_shift_to_coordinates(
                coords, shift_lon, shift_lat
            )
            
            fixed_count += 1
            point_count += len(all_coords)
            
            print(f"✓ Виправлено: {street} ({settlement})")
            print(f"  Точок змінено: {len(all_coords)}")
    
    # Зберігаємо виправлений файл
    print(f"\n💾 Збереження: {output_file}")
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(geojson_data, f, ensure_ascii=False, indent=2)
    
    print(f"\n✓ ГОТОВО!")
    print(f"  Виправлено об'єктів: {fixed_count}")
    print(f"  Всього точок змінено: {point_count}")


def main():
    """Основна функція."""
    base_dir = Path(__file__).parent
    geojson_file = base_dir / "data" / "Data.geojson"
    errors_file = base_dir / "errors.json"
    output_file = base_dir / "data" / "Data_fixed.geojson"
    
    if not geojson_file.exists():
        print(f"❌ Файл не знайдений: {geojson_file}")
        return
    
    if not errors_file.exists():
        print(f"❌ Файл помилок не знайдений: {errors_file}")
        print(f"   Спочатку запусти: python3 find_geoshift_errors.py")
        return
    
    # Виправляємо помилки
    fix_geoshift_errors(str(geojson_file), str(errors_file), str(output_file))


if __name__ == "__main__":
    main()
