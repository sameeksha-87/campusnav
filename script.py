import json
import math


# Load GeoJSON
with open("map.geojson", "r") as f:
    data = json.load(f)

roads = []
footpaths = []
buildings = []
others = []

nodes = {}      
edges = []     
weights = []    

def add_node(coord):
    """Store node and return its ID."""
    key = tuple(coord)
    if key not in nodes:
        nodes[key] = len(nodes)
    return nodes[key]

# -------------------------
# Split Features + Build Graph
# -------------------------
for feature in data["features"]:
    props = feature.get("properties", {})
    geom = feature.get("geometry", {})

    if "coordinates" not in geom:
        continue

    #Roads & Footpaths
    if "highway" in props:
        h = props["highway"]

        if h in ["primary", "secondary", "tertiary", "residential"]:
            roads.append(feature)
        elif h in ["footway", "path", "steps", "pedestrian"]:
            footpaths.append(feature)
        else:
            others.append(feature)

        # Build graph from LineString ways
        if geom["type"] == "LineString":
            coords = geom["coordinates"]

            for i in range(len(coords) - 1):
                a = add_node(coords[i])
                b = add_node(coords[i + 1])

                dist = math.dist(coords[i], coords[i + 1])
                edges.append((a, b))
                weights.append(dist)

    #Buildings
    elif "building" in props:
        buildings.append(feature)

    # Else
    else:
        others.append(feature)


# Save GeoJSON Layers
def save_geojson(file, features):
    with open(file, "w") as f:
        json.dump({"type": "FeatureCollection", "features": features}, f, indent=2)

save_geojson("roads.geojson", roads)
save_geojson("footpaths.geojson", footpaths)
save_geojson("buildings.geojson", buildings)
save_geojson("others.geojson", others)


# Save Node/Edge/Weight Graph
nodes_str_keys = {f"{k[0]},{k[1]}": v for k, v in nodes.items()}

with open("nodes.json", "w") as f:
    json.dump(nodes_str_keys, f, indent=2)

with open("edges.json", "w") as f:
    json.dump(edges, f, indent=2)

with open("weights.json", "w") as f:
    json.dump(weights, f, indent=2)

print("DONE: Files created successfully.")
