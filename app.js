// MAP SETUP
let map = L.map("map").setView([23.1765, 80.0211], 17);

L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
}).addTo(map);

// LOAD GEOJSON LAYERS
function loadLayer(file, color) {
  fetch(file)
    .then((res) => res.json())
    .then((data) => {
      L.geoJSON(data, {
        style: {
          color: color,
          weight: 2,
        },
      }).addTo(map);
    })
    .catch((err) => console.error(`Error loading ${file}:`, err));
}

loadLayer("roads.geojson", "blue");
loadLayer("footpaths.geojson", "green");
loadLayer("buildings.geojson", "brown");

// GRAPH DATA
let nodes = {};
let edges = [];
let weights = [];
let graphLoaded = false;

Promise.all([
  fetch("nodes.json").then((r) => r.json()),
  fetch("edges.json").then((r) => r.json()),
  fetch("weights.json").then((r) => r.json()),
])
  .then(([n, e, w]) => {
    nodes = n;
    edges = e;
    weights = w;
    graphLoaded = true;
    console.log("Graph loaded");
  })
  .catch((err) => console.error("Error loading graph:", err));

// DOORS DATA
let doors = [];

fetch("doors.json")
  .then((r) => r.json())
  .then((d) => {
    doors = d;

    doors.forEach((door) => {
      L.marker([door.lat, door.lon])
        .addTo(map)
        .bindTooltip(door.name, {
          permanent: true,
          direction: "top",
          offset: [0, -10],
          className: "door-label",
        });
    });
  });

// HELPERS
function getNearestNode(coord) {
  let nearest = null;
  let minDist = Infinity;

  for (let key in nodes) {
    let id = nodes[key];
    let [lon, lat] = key.split(",").map(Number);

    let d = Math.hypot(coord[0] - lon, coord[1] - lat);

    if (d < minDist) {
      minDist = d;
      nearest = id;
    }
  }

  return nearest;
}

function getLatLngFromNodeId(id) {
  for (let key in nodes) {
    if (nodes[key] == id) {
      let [lon, lat] = key.split(",").map(Number);
      return [lat, lon];
    }
  }
  return null;
}

// DIJKSTRA
function dijkstra(start, end) {
  let dist = {};
  let prev = {};
  let visited = new Set();

  Object.values(nodes).forEach((id) => {
    dist[id] = Infinity;
    prev[id] = null;
  });

  dist[start] = 0;

  while (true) {
    let curr = null;
    let best = Infinity;

    for (let node in dist) {
      if (!visited.has(node) && dist[node] < best) {
        best = dist[node];
        curr = node;
      }
    }

    if (curr === null || curr == end) break;

    visited.add(curr);

    edges.forEach((edge, i) => {
      let [a, b] = edge;

      if (a == curr || b == curr) {
        let nxt = a == curr ? b : a;
        let alt = dist[curr] + weights[i];

        if (alt < dist[nxt]) {
          dist[nxt] = alt;
          prev[nxt] = curr;
        }
      }
    });
  }

  let path = [];
  let u = end;

  while (u != null) {
    path.unshift(u);
    u = prev[u];
  }

  return path;
}

// ROUTE DRAWING
let routeLine = null;

function drawRoute(path) {
  let latlngs = path.map((id) => getLatLngFromNodeId(id)).filter(Boolean);

  if (routeLine) {
    map.removeLayer(routeLine);
  }

  routeLine = L.polyline(latlngs, {
    color: "red",
    weight: 5,
  }).addTo(map);
}

// START/END
let startNode = null;
let endNode = null;

let startMarker = null;
let endMarker = null;

// LIVE GPS
let userMarker = null;
let accuracyCircle = null;
let watchId = null;

function startLiveLocation() {
  if (!navigator.geolocation) {
    alert("Geolocation not supported");
    return;
  }

  watchId = navigator.geolocation.watchPosition(
    function (position) {
      const lat = position.coords.latitude;
      const lng = position.coords.longitude;
      const accuracy = position.coords.accuracy;

      console.log("Live:", lat, lng);

      // Snap to nearest path node
      let nearestNode = getNearestNode([lng, lat]);
      let snapped = getLatLngFromNodeId(nearestNode);

      if (!userMarker) {
        userMarker = L.circleMarker(snapped || [lat, lng], {
          radius: 8,
          color: "#136AEC",
          fillColor: "#2A93EE",
          fillOpacity: 1,
        }).addTo(map);

        accuracyCircle = L.circle([lat, lng], {
          radius: accuracy,
          color: "#136AEC",
          fillOpacity: 0.15,
        }).addTo(map);
      } else {
        if (snapped) {
          let dist = map.distance([lat, lng], snapped);

          if (dist < 20) {
            // 20 meters threshold
            userMarker.setLatLng(snapped);
          } else {
            userMarker.setLatLng([lat, lng]);
          }
        }

        accuracyCircle.setLatLng([lat, lng]);
        accuracyCircle.setRadius(accuracy);
      }

      // Follow user like Google Maps
      map.flyTo(snapped || [lat, lng], 19);
    },

    function (error) {
      alert("GPS Error: " + error.message);
      console.error("GPS error:", error);
    },

    {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 15000,
    },
  );
}

// MAP CLICK
map.on("click", function (e) {
  if (!userMarker) {
    startLiveLocation();
  }

  if (!graphLoaded) {
    alert("Graph loading...");
    return;
  }

  let clickedCoord = [e.latlng.lng, e.latlng.lat];

  let nearestNode = getNearestNode(clickedCoord);

  // START
  if (!startNode) {
    startNode = nearestNode;

    if (startMarker) map.removeLayer(startMarker);

    startMarker = L.circleMarker(e.latlng, {
      radius: 8,
      color: "green",
      fillColor: "green",
      fillOpacity: 1,
    }).addTo(map);
  }

  // END
  else if (!endNode) {
    endNode = nearestNode;

    if (endMarker) map.removeLayer(endMarker);

    endMarker = L.circleMarker(e.latlng, {
      radius: 8,
      color: "blue",
      fillColor: "blue",
      fillOpacity: 1,
    }).addTo(map);

    let path = dijkstra(startNode, endNode);

    drawRoute(path);
  }

  // RESET
  else {
    startNode = null;
    endNode = null;

    if (startMarker) map.removeLayer(startMarker);

    if (endMarker) map.removeLayer(endMarker);

    if (routeLine) map.removeLayer(routeLine);
  }
});

map.whenReady(() => {
  startLiveLocation();
  console.log("GPS Started");
});
