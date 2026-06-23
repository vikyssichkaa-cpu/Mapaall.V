#!/usr/bin/env python3
"""
Скрипт для пошуку географічних помилок (геошифтів) у GeoJSON.
Шукає вулиці з контрольованих міст, координати яких потрапляють у межі старокупованих територій.

Приклад: Вулиця в Торецьку, але координати за межами Торецька (наприклад, в Горлівці).
"""

import json
from pathlib import Path
from typing import Dict, List, Tuple

# Bounding boxes для старокупованих територій (lon_min, lon_max, lat_min, lat_max)
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

# Список міст, які були під контролем до 2022 року (ЧИ мають бути там)
CONTROLLED_CITIES = [
    "Торецьк",
    "Бахмут",
    "Костянтинівка",
    "Слов'янськ",
    "Краматорськ",
    "Сєвєродонецьк",
    "Лисичанськ",
    "Рубіжне",
]

def point_in_bbox(lat: float, lon: float, bbox: Dict[str, Tuple]) -> bool:
    """
    Перевіряє, чи знаходиться точка у межах bounding box.
    
    Args:
        lat: широта
        lon: довгота
        bbox: словник з ключами "lon" і "lat", де значення - кортежі (min, max)
    
    Returns:
        True якщо точка у межах bbox
    """
    lon_min, lon_max = bbox["lon"]
    lat_min, lat_max = bbox["lat"]
    return lon_min <= lon <= lon_max and lat_min <= lat <= lat_max


def get_bbox_description(lat: float, lon: float) -> str:
    """Визначає, в якій окупованій території знаходиться точка."""
    for area, bbox in OCCUPIED_AREAS.items():
        if point_in_bbox(lat, lon, bbox):
            return area
    return "невідома територія"


def extract_coordinates(geometry) -> List[Tuple[float, float]]:
    """
    Витягує всі координати з геометрії.
    Повертає список (lon, lat) кортежів.
    """
    coords = []
    geom_type = geometry.get("type")
    geom_coords = geometry.get("coordinates", [])
    
    if geom_type == "Point":
        coords.append(tuple(geom_coords))
    elif geom_type == "LineString":
        coords.extend(geom_coords)
    elif geom_type == "MultiLineString":
        for line in geom_coords:
            coords.extend(line)
    elif geom_type == "Polygon":
        for ring in geom_coords:
            coords.extend(ring)
    elif geom_type == "MultiPolygon":
        for polygon in geom_coords:
            for ring in polygon:
                coords.extend(ring)
    
    return coords


def find_geoshift_errors(geojson_file: str) -> List[Dict]:
    """
    Шукає географічні помилки (геошифти) у GeoJSON.
    
    Args:
        geojson_file: шлях до GeoJSON файлу
    
    Returns:
        Список об'єктів з помилками
    """
    errors = []
    
    print(f"📂 Завантажуємо GeoJSON: {geojson_file}")
    with open(geojson_file, "r", encoding="utf-8") as f:
        data = json.load(f)
    
    features = data.get("features", [])
    print(f"✓ Завантажено {len(features)} об'єктів")
    print(f"🔍 Шукаємо помилки...\n")
    
    checked_count = 0
    
    for feature in features:
        props = feature.get("properties", {})
        geometry = feature.get("geometry", {})
        
        settlement = props.get("Населений пункт", "")
        street = props.get("Вулиця", "")
        feature_id = props.get("ID", "unknown")
        
        # Перевіряємо, чи це вулиця з контрольованого міста
        is_controlled_city = any(city.lower() in settlement.lower() for city in CONTROLLED_CITIES)
        
        if not is_controlled_city:
            continue
        
        checked_count += 1
        
        # Витягуємо координати
        coords = extract_coordinates(geometry)
        
        if not coords:
            continue
        
        # Перевіряємо кожну координату
        for lon, lat in coords:
            # Для кожної окупованої території перевіряємо, чи координата не потрапляє туди
            for area, bbox in OCCUPIED_AREAS.items():
                if point_in_bbox(lat, lon, bbox):
                    error_obj = {
                        "ID": feature_id,
                        "Населений пункт": settlement,
                        "Вулиця": street,
                        "Область": props.get("Область", ""),
                        "Громада": props.get("Громада", ""),
                        "координата": [lon, lat],
                        "шукалось": f"{settlement} (контрольовано)",
                        "знайдено": f"{area} (окупована територія)",
                        "properties": props,
                        "geometry": geometry,
                    }
                    errors.append(error_obj)
                    
                    # Виводимо помилку в консоль
                    print(f"⚠️  ПОМИЛКА ЗНАЙДЕНА:")
                    print(f"   Населений пункт: {settlement} (контрольовано до 2022)")
                    print(f"   Вулиця: {street}")
                    print(f"   ID: {feature_id}")
                    print(f"   Координати: lon={lon:.5f}, lat={lat:.5f}")
                    print(f"   Але ЦЕ в межах: {area} (окупована територія)")
                    print(f"   Bounding Box {area}: lon({bbox['lon'][0]}-{bbox['lon'][1]}), lat({bbox['lat'][0]}-{bbox['lat'][1]})")
                    print()
    
    print(f"📊 Статистика:")
    print(f"   Перевірено об'єктів з контрольованих міст: {checked_count}")
    print(f"   Знайдено помилок (геошифтів): {len(errors)}")
    
    return errors


def main():
    """Основна функція."""
    base_dir = Path(__file__).parent
    geojson_file = base_dir / "data" / "Data.geojson"
    errors_file = base_dir / "errors.json"
    
    if not geojson_file.exists():
        print(f"❌ Файл не знайдений: {geojson_file}")
        return
    
    # Пошук помилок
    errors = find_geoshift_errors(str(geojson_file))
    
    # Збереження результатів
    if errors:
        print(f"\n💾 Збереження помилок у {errors_file}...")
        with open(errors_file, "w", encoding="utf-8") as f:
            json.dump({
                "total_errors": len(errors),
                "errors": errors
            }, f, ensure_ascii=False, indent=2)
        print(f"✓ Файл збережено!")
    else:
        print(f"\n✓ Помилок не знайдено!")


if __name__ == "__main__":
    main()
