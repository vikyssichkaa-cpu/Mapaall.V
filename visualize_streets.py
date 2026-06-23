#!/usr/bin/env python3
"""
Visualization of Donetsk streets by claim count (COUNTA of Тип заяви).
Higher count = brighter/more saturated color.
Lower count = faded/washed-out color.
"""

import pandas as pd
import matplotlib.pyplot as plt
import matplotlib.colors as mcolors
import numpy as np
from pathlib import Path

# Configure for Cyrillic text
plt.rcParams['font.sans-serif'] = ['DejaVu Sans', 'Arial']

# CSV file path
csv_file = Path(__file__).parent / "Зведна табличка проєкт - Зведена таблиця.csv"

# Read the CSV
df = pd.read_csv(csv_file, encoding='utf-8')

# Extract street and claim count columns
# The column is "COUNTA of Тип заяви" and street column is "Вулиця"
street_col = "Вулиця"
count_col = "COUNTA of Тип заяви"

# Group by street and sum the counts (in case there are duplicates)
street_counts = df.groupby(street_col)[count_col].sum().sort_values()

print(f"Total streets: {len(street_counts)}")
print(f"Min count: {street_counts.min()}, Max count: {street_counts.max()}")

# Normalize values to 0-1 range for color mapping
min_count = street_counts.min()
max_count = street_counts.max()
normalized_counts = (street_counts - min_count) / (max_count - min_count) if max_count > min_count else np.ones_like(street_counts)

# Create figure with larger size for readability
fig, ax = plt.subplots(figsize=(14, max(10, len(street_counts) * 0.15)))

# Use "YlOrRd" colormap (Yellow-Orange-Red): dim (yellow) to bright (red)
# or "Reds" for red gradient (light to dark red)
cmap = plt.cm.YlOrRd
colors = cmap(normalized_counts.values)

# Create horizontal bar chart
bars = ax.barh(range(len(street_counts)), street_counts.values, color=colors, edgecolor='darkred', linewidth=0.5)

# Set Y-axis labels to street names
ax.set_yticks(range(len(street_counts)))
ax.set_yticklabels(street_counts.index, fontsize=8)

# Labels and title
ax.set_xlabel("COUNTA of Тип заяви (Claim Count)", fontsize=12, fontweight='bold')
ax.set_ylabel("Вулиця (Street)", fontsize=12, fontweight='bold')
ax.set_title("Donetsk Streets by Claim Count\n(Color intensity: dim (low count) → bright (high count))", 
             fontsize=14, fontweight='bold', pad=20)

# Add grid for readability
ax.grid(axis='x', alpha=0.3, linestyle='--')

# Add a colorbar as legend
sm = plt.cm.ScalarMappable(cmap=cmap, norm=plt.Normalize(vmin=min_count, vmax=max_count))
sm.set_array([])
cbar = plt.colorbar(sm, ax=ax, pad=0.02)
cbar.set_label('Claim Count', fontsize=11, fontweight='bold')

# Tight layout
plt.tight_layout()

# Save the figure
output_file = Path(__file__).parent / "street_visualization.png"
plt.savefig(output_file, dpi=150, bbox_inches='tight')
print(f"✓ Visualization saved to: {output_file}")

# Also create a top 20 streets version for clearer view
fig2, ax2 = plt.subplots(figsize=(12, 8))
top_20 = street_counts.tail(20)
normalized_top = (top_20 - min_count) / (max_count - min_count)
colors_top = cmap(normalized_top.values)

bars2 = ax2.barh(range(len(top_20)), top_20.values, color=colors_top, edgecolor='darkred', linewidth=0.8)
ax2.set_yticks(range(len(top_20)))
ax2.set_yticklabels(top_20.index, fontsize=10)

ax2.set_xlabel("COUNTA of Тип заяви (Claim Count)", fontsize=12, fontweight='bold')
ax2.set_ylabel("Вулиця (Street)", fontsize=12, fontweight='bold')
ax2.set_title("Top 20 Streets by Claim Count", fontsize=14, fontweight='bold', pad=20)
ax2.grid(axis='x', alpha=0.3, linestyle='--')

sm2 = plt.cm.ScalarMappable(cmap=cmap, norm=plt.Normalize(vmin=min_count, vmax=max_count))
sm2.set_array([])
cbar2 = plt.colorbar(sm2, ax=ax2, pad=0.02)
cbar2.set_label('Claim Count', fontsize=11, fontweight='bold')

plt.tight_layout()
output_file_top20 = Path(__file__).parent / "street_visualization_top20.png"
plt.savefig(output_file_top20, dpi=150, bbox_inches='tight')
print(f"✓ Top 20 visualization saved to: {output_file_top20}")

# Print summary statistics
print("\n" + "="*60)
print("STREET CLAIM COUNT SUMMARY")
print("="*60)
print(f"\nLowest 5 streets:")
for i, (street, count) in enumerate(street_counts.head(5).items(), 1):
    print(f"  {i}. {street}: {int(count)} claims")

print(f"\nHighest 5 streets:")
for i, (street, count) in enumerate(street_counts.tail(5).iloc[::-1].items(), 1):
    print(f"  {i}. {street}: {int(count)} claims")

print(f"\nStatistics:")
print(f"  Total streets: {len(street_counts)}")
print(f"  Total claims: {street_counts.sum()}")
print(f"  Average per street: {street_counts.mean():.1f}")
print(f"  Median: {street_counts.median():.1f}")
print(f"  Min: {street_counts.min()}")
print(f"  Max: {street_counts.max()}")
print("="*60)

plt.show()
