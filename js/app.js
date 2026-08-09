// ==========================================
// 1. MAP SETUP & GEOGRAPHY LAYERS
// ==========================================
const map = L.map("map", { zoomControl: false }).setView([23.1765, 80.0211], 17);

const lightTileLayer = L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap &copy; CARTO'
});

const darkTileLayer = L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap &copy; CARTO'
});

let currentTheme = "dark";
darkTileLayer.addTo(map);

function loadLayer(file, layerType) {
    fetch(file)
        .then(res => res.json())
        .then(data => {
            let styleOptions = {};
            if (layerType === "roads") {
                styleOptions = {
                    color: "#64748b",
                    weight: 3,
                    opacity: 0.45,
                    stroke: true
                };
            } else if (layerType === "footpaths") {
                styleOptions = {
                    color: "#10b981",
                    weight: 1.5,
                    opacity: 0.5,
                    dashArray: "3, 6",
                    stroke: true
                };
            } else if (layerType === "buildings") {
                styleOptions = {
                    fillColor: "#f43f5e",
                    fillOpacity: 0.16,
                    stroke: false
                };
            }
            L.geoJSON(data, {
                style: styleOptions
            }).addTo(map);
        })
        .catch(err => console.error(`Error loading ${file}:`, err));
}

loadLayer("roads.geojson", "roads");
loadLayer("footpaths.geojson", "footpaths");
loadLayer("buildings.geojson", "buildings");

// ==========================================
// 2. GRAPH DATA INITIALIZATION
// ==========================================
let nodes = {};
let edges = [];
let weights = [];
let graphLoaded = false;

Promise.all([
    fetch("nodes.json").then(r => r.json()),
    fetch("edges.json").then(r => r.json()),
    fetch("weights.json").then(r => r.json())
])
.then(([n, e, w]) => {
    nodes = n;
    edges = e;
    weights = w;
    graphLoaded = true;
    console.log("Map graph loaded.");
})
.catch(err => console.error("Error loading map graph:", err));

// ==========================================
// 3. DOORS DATA LOADING
// ==========================================
let doors = [];

fetch("doors.json")
    .then(r => r.json())
    .then(d => {
        doors = d;
        // Make sure Xerox Shop door is added if missing
        if (!doors.some(door => door.name === "Xerox Shop")) {
            doors.push({ "name": "Xerox Shop", "lat": 23.17688182618637, "lon": 80.024450 });
        }
        function getCustomMarkerIcon(doorName) {
            let icon = "fa-location-dot";
            let color = "#3b82f6";
            let clean = doorName.toLowerCase();
            
            if (clean.includes("hostel") || clean.startsWith("h1") || clean.startsWith("h3") || clean.startsWith("h4") || clean.includes("residency")) {
                icon = "fa-bed";
                color = "#1e40af";
            } else if (clean === "nescafe" || clean === "hex" || clean === "cm" || clean === "amul") {
                icon = "fa-utensils";
                color = "#ea580c";
            } else if (clean === "library" || clean === "lhtc" || clean === "corelabcomplex" || clean === "academic office") {
                icon = "fa-graduation-cap";
                color = "#7c3aed";
            } else if (clean === "bank") {
                icon = "fa-building-columns";
                color = "#0d9488";
            } else if (clean === "phc") {
                icon = "fa-house-medical";
                color = "#dc2626";
            } else if (clean.includes("court") || clean.includes("ground")) {
                icon = "fa-volleyball";
                color = "#16a34a";
            } else if (clean.includes("sac")) {
                icon = "fa-people-group";
                color = "#db2777";
            }
            
            return L.divIcon({
                html: `<div class="custom-map-marker" style="background-color: ${color};"><i class="fa-solid ${icon}"></i></div>`,
                className: "custom-marker-container",
                iconSize: [32, 32],
                iconAnchor: [16, 16],
                popupAnchor: [0, -16]
            });
        }

        doors.forEach(door => {
            let marker = L.marker([door.lat, door.lon], { icon: getCustomMarkerIcon(door.name) })
                .addTo(map)
                .bindTooltip(door.name, {
                    permanent: true,
                    direction: "top",
                    offset: [0, -15],
                    className: "door-label"
                });
                
            marker.on("click", () => {
                let matchedItem = campusData.find(item => resolveRouteToDoorName(item.route_to).toLowerCase() === door.name.toLowerCase());
                if (matchedItem) {
                    selectSuggestion(destInput, destSuggestions, matchedItem);
                } else {
                    let virtualItem = {
                        name: door.name,
                        category: "Map Location",
                        description: "Physical coordinate marker displayed on the map.",
                        location: door.name,
                        nearby: [],
                        route_to: door.name,
                        timings: "Open 24/7"
                    };
                    selectSuggestion(destInput, destSuggestions, virtualItem);
                }
            });
        });
    })
    .catch(err => console.error("Error loading doors:", err));

// ==========================================
// 4. DIJKSTRA ROUTING UTILITIES
// ==========================================
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

function dijkstra(start, end) {
    let dist = {};
    let prev = {};
    let visited = new Set();

    Object.values(nodes).forEach(id => {
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
                let nxt = (a == curr) ? b : a;
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

let routeLine = null;
function drawRoute(path) {
    let latlngs = path
        .map(id => getLatLngFromNodeId(id))
        .filter(Boolean);

    if (routeLine) {
        map.removeLayer(routeLine);
    }

    routeLine = L.polyline(latlngs, {
        color: "#7c3aed",
        weight: 6,
        opacity: 0.9
    }).addTo(map);
    
    // Zoom and pan the map to fit the calculated route path bounds
    let bounds = L.latLngBounds(latlngs);
    map.fitBounds(bounds, { padding: [50, 50] });
}

// Haversine distance calculator
function haversineDistance([lat1, lon1], [lat2, lon2]) {
    const R = 6371000;
    const toRad = deg => deg * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
              Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function calculatePathDistance(path) {
    let total = 0;
    for (let i = 0; i < path.length - 1; i++) {
        let a = getLatLngFromNodeId(path[i]);
        let b = getLatLngFromNodeId(path[i + 1]);
        if (!a || !b) continue;
        total += haversineDistance(a, b);
    }
    return Math.round(total);
}

// ==========================================
// 5. DATA SEARCH AND RESOLUTION (FUSE.JS)
// ==========================================
let campusData = [];
let fuseInstance = null;

// Loaded targets
let startLocationNodeId = null;
let startLocationName = null;
let destinationItem = null;
let destinationDoorName = null;

let activeStartMarker = null;
let activeEndMarker = null;
let highlightMarker = null;

let gpsWatchId = null;
let userMarker = null;
let accuracyCircle = null;
let userLatLng = null;
let isLiveStartActive = false;

let activeNavPath = [];
let activeDirections = [];
let currentPathIndex = 0;

fetch("data.json")
    .then(r => r.json())
    .then(data => {
        campusData = data;
        buildSearchIndex();
    })
    .catch(err => console.error("Error loading data.json file:", err));

function buildSearchIndex() {
    fuseInstance = new Fuse(campusData, {
        includeScore: true,
        threshold: 0.3,
        keys: [
            {
                name: "search_terms",
                weight: 1.0
            }
        ]
    });
}

const LOCATION_MAPPINGS = {
    "library": "Library",
    "central library": "Library",
    "sac": "SAC",
    "phc": "PHC",
    "health center": "PHC",
    "health centre": "PHC",
    "primary health centre": "PHC",
    "oat": "OAT",
    "open air theatre": "OAT",
    "open air theater": "OAT",
    "h1": "H1",
    "hostel 1": "H1",
    "vasishta hostel": "H1",
    "vasishta": "H1",
    "hex": "HEX",
    "hexagon": "HEX",
    "food court": "HEX",
    "maa saraswati": "Maa Saraswati",
    "msh": "Maa Saraswati",
    "girls hostel": "Maa Saraswati",
    "saraswati hostel": "Maa Saraswati",
    "nagarjuna": "Nagarjuna Hostel",
    "nagarjuna hostel": "Nagarjuna Hostel",
    "visitors hostel": "Visitors Hostel",
    "visitors' hostel": "Visitors Hostel",
    "vh": "Visitors Hostel",
    "nescafe": "Nescafe",
    "cafe": "Nescafe",
    "canteen": "Nescafe",
    "h4": "H4",
    "hostel 4": "H4",
    "h3": "H3",
    "hostel 3": "H3",
    "newsac": "newSac",
    "new sac": "newSac",
    "corelabcomplex": "CoreLabComplex",
    "core lab complex": "CoreLabComplex",
    "core lab": "CoreLabComplex",
    "clc": "CoreLabComplex",
    "powerhouse": "PowerHouse",
    "power house": "PowerHouse",
    "academic office": "Academic Office",
    "faculty residence": "faculty residence",
    "faculty": "faculty residence",
    "professors": "faculty residence",
    "professor": "faculty residence",
    "teachers": "faculty residence",
    "narmada": "narmada residency",
    "narmada residency": "narmada residency",
    "rewa": "rewa residency",
    "rewa residency": "rewa residency",
    "panini": "panini hostel",
    "panini hostel": "panini hostel",
    "lhtc": "LHTC",
    "lecture hall": "LHTC",
    "academic block": "LHTC",
    "academic area": "CoreLabComplex",
    "auditorium": "OAT",
    "bank": "Bank",
    "basketball": "BasketBallCourt",
    "basketball court": "BasketBallCourt",
    "cricket": "CricketGround",
    "cricket ground": "CricketGround",
    "cm": "CM",
    "central mess": "CM",
    "mess": "CM",
    "xerox shop": "Xerox Shop",
    "xerox": "Xerox Shop",
    "zerox": "Xerox Shop",
    "photocopy": "Xerox Shop",
    "printing": "Xerox Shop",
    "print shop": "Xerox Shop"
};

function resolveRouteToDoorName(routeTo) {
    if (!routeTo) return null;
    let clean = routeTo.toLowerCase().trim();
    
    // Explicit overrides
    if (clean === "computercomplex" || clean === "computer complex" || clean === "computer complexes") {
        return "CM";
    }
    if (clean === "academic office" || clean === "academic_office") {
        return "Academic Office";
    }
    if (clean === "panini hostel" || clean === "panini") {
        return "panini hostel";
    }
    if (clean === "maa saraswati" || clean === "girls hostel" || clean === "msh") {
        return "Maa Saraswati";
    }
    if (clean === "corelabcomplex" || clean === "core lab complex" || clean === "core lab") {
        return "CoreLabComplex";
    }
    if (clean === "lhtc" || clean === "lecture hall") {
        return "LHTC";
    }
    if (clean === "nescafe" || clean === "cafe" || clean === "canteen") {
        return "Nescafe";
    }
    if (clean === "library" || clean === "central library") {
        return "Library";
    }
    if (clean === "visitors hostel" || clean === "vh") {
        return "Visitors Hostel";
    }
    if (clean === "amul" || clean === "amul parlour") {
        return "HEX";
    }
    
    // Bus stops routing mappings to nearest doors
    if (clean.includes("bus stop - rewa") || clean === "bus stop - rewa") {
        return "rewa residency";
    }
    if (clean.includes("bus stop - panini") || clean === "bus stop - panini") {
        return "panini hostel";
    }
    if (clean.includes("bus stop - nescafe") || clean === "bus stop - nescafe") {
        return "Nescafe";
    }
    if (clean.includes("bus stop - msh") || clean === "bus stop - msh") {
        return "Maa Saraswati";
    }
    
    if (LOCATION_MAPPINGS[clean]) {
        return LOCATION_MAPPINGS[clean];
    }
    
    let match = doors.find(d => d.name.toLowerCase() === clean);
    if (match) return match.name;
    
    match = doors.find(d => clean.includes(d.name.toLowerCase()) || d.name.toLowerCase().includes(clean));
    if (match) return match.name;
    
    return routeTo;
}

// Category keyword filter logic & displayed locations search
function searchLocations(query) {
    if (!query) return [];
    let cleanQuery = query.toLowerCase().trim();
    
    const categories = {
        "hostel": ["hostel", "residence", "hall"],
        "bus stop": ["bus", "stop"],
        "canteen": ["canteen", "cafe", "food", "mess", "eatery", "amul", "nescafe", "hexagon"],
        "office": ["office", "cell", "admin", "director", "dean", "placement", "dsa"],
        "department": ["department", "discipline", "cse", "ece", "mechanical", "design", "smart manufacturing"]
    };
    
    let matchedCategory = null;
    for (let key in categories) {
        if (cleanQuery.includes(key) || categories[key].some(alias => cleanQuery.includes(alias))) {
            matchedCategory = key;
            break;
        }
    }
    
    let results = [];
    if (matchedCategory) {
        let categoryKeywords = categories[matchedCategory];
        results = campusData.filter(item => {
            let text = [item.name, item.category, ...(item.search_terms || [])].join(" ").toLowerCase();
            return categoryKeywords.some(kw => text.includes(kw));
        });
    } else {
        let fuseResults = fuseInstance ? fuseInstance.search(query) : [];
        results = fuseResults.map(r => r.item);
    }
    
    // Search matching doors from doors.json (displayed map locations)
    let matchingDoors = doors.filter(door => {
        let nameLower = door.name.toLowerCase();
        if (nameLower.includes(cleanQuery)) return true;
        for (let mapKey in LOCATION_MAPPINGS) {
            if (mapKey.includes(cleanQuery) && LOCATION_MAPPINGS[mapKey].toLowerCase() === nameLower) {
                return true;
            }
        }
        return false;
    });
    
    matchingDoors.forEach(door => {
        if (results.some(r => r.name.toLowerCase() === door.name.toLowerCase())) {
            return;
        }
        results.push({
            id: "DOOR_" + door.name.replace(/\s+/g, "_"),
            name: door.name,
            category: "Map Location",
            description: "Physical coordinate marker displayed on the map.",
            location: door.name,
            nearby: [],
            route_to: door.name,
            timings: "Open 24/7"
        });
    });
    
    return results;
}

// ==========================================
// 6. UI INTERFACES ELEMENTS & EVENTS
// ==========================================
const startInput = document.getElementById("start-input");
const destInput = document.getElementById("dest-input");
const startSuggestions = document.getElementById("start-suggestions");
const destSuggestions = document.getElementById("dest-suggestions");
const navigateBtn = document.getElementById("navigate-btn");
const swapBtn = document.getElementById("swap-btn");
const gpsBtn = document.getElementById("gps-btn");

const placeInfoCard = document.getElementById("place-info-card");
const closeInfoBtn = document.getElementById("close-info-btn");
const infoName = document.getElementById("info-name");
const infoCategory = document.getElementById("info-category");
const infoDesc = document.getElementById("info-desc");
const infoLocation = document.getElementById("info-location");
const infoTimings = document.getElementById("info-timings");
const infoNearby = document.getElementById("info-nearby");
const navigationDetails = document.getElementById("navigation-details");
const navDistance = document.getElementById("nav-distance");
const navTime = document.getElementById("nav-time");
const infoNavigateBtn = document.getElementById("info-navigate-btn");

const mapGpsBtn = document.getElementById("map-gps-btn");
const centerMapBtn = document.getElementById("center-map-btn");
const clearRouteBtn = document.getElementById("clear-route-btn");

// Autocomplete suggestions handlers
startInput.addEventListener("input", () => {
    let query = startInput.value;
    showSuggestions(startInput, startSuggestions, query);
});

destInput.addEventListener("input", () => {
    let query = destInput.value;
    showSuggestions(destInput, destSuggestions, query);
});

function showSuggestions(inputEl, suggestionsEl, query) {
    if (!query) {
        suggestionsEl.innerHTML = "";
        suggestionsEl.classList.add("hidden");
        return;
    }
    
    let matches = searchLocations(query);
    if (matches.length === 0) {
        suggestionsEl.innerHTML = "";
        suggestionsEl.classList.add("hidden");
        return;
    }
    
    suggestionsEl.innerHTML = "";
    matches.forEach(item => {
        let li = document.createElement("div");
        li.className = "autocomplete-item";
        li.innerHTML = `
            <div class="item-left">
                <i class="fa-solid fa-location-dot"></i>
                <span class="item-name">${item.name}</span>
            </div>
            <span class="item-category">${item.category || "Place"}</span>
        `;
        li.addEventListener("click", () => {
            selectSuggestion(inputEl, suggestionsEl, item);
        });
        suggestionsEl.appendChild(li);
    });
    suggestionsEl.classList.remove("hidden");
}

function selectSuggestion(inputEl, suggestionsEl, item) {
    inputEl.value = item.name;
    suggestionsEl.classList.add("hidden");
    
    let resolvedDoorName = resolveRouteToDoorName(item.route_to);
    let door = doors.find(d => d.name.toLowerCase() === resolvedDoorName.toLowerCase());
    
    if (inputEl === startInput) {
        isLiveStartActive = false;
        if (door) {
            startLocationNodeId = getNearestNode([door.lon, door.lat]);
            startLocationName = item.route_to;
            
            // Draw marker
            if (activeStartMarker) map.removeLayer(activeStartMarker);
            activeStartMarker = L.circleMarker([door.lat, door.lon], {
                radius: 8,
                color: "green",
                fillColor: "green",
                fillOpacity: 1
            }).addTo(map);
            
            map.setView([door.lat, door.lon], 18);
        }
    } else {
        destinationItem = item;
        destinationDoorName = resolvedDoorName;
        
        // Show info card
        displayPlaceInfo(item);
        
        if (door) {
            highlightMapLocation(door.name);
        }
    }
}

// Display place details on info card
function displayPlaceInfo(item) {
    infoName.textContent = `🏢 ${item.name}`;
    infoCategory.textContent = item.category || "General";
    infoDesc.textContent = item.description || "";
    infoLocation.textContent = item.location || "N/A";
    infoTimings.textContent = item.timings || "N/A";
    infoNearby.textContent = (item.nearby || []).join(", ") || "None";
    
    navigationDetails.classList.add("hidden");
    placeInfoCard.classList.remove("hidden");
}

closeInfoBtn.addEventListener("click", () => {
    placeInfoCard.classList.add("hidden");
});

// Clear lists clicking outside
document.addEventListener("click", (e) => {
    if (!e.target.closest(".input-group")) {
        startSuggestions.classList.add("hidden");
        destSuggestions.classList.add("hidden");
    }
});

// ==========================================
// 7. ROUTING TRIGGERS
// ==========================================
function performRouting() {
    if (!startLocationNodeId) {
        alert("Please select or acquire a start location first.");
        return;
    }
    
    if (!destinationDoorName) {
        alert("Please select a destination location first.");
        return;
    }
    
    let endDoor = doors.find(d => d.name.toLowerCase() === destinationDoorName.toLowerCase());
    if (!endDoor) {
        alert("Could not locate entry door for this destination.");
        return;
    }
    
    let endNodeId = getNearestNode([endDoor.lon, endDoor.lat]);
    if (startLocationNodeId === endNodeId) {
        alert("Start and destination are at the same location.");
        return;
    }
    
    let path = dijkstra(startLocationNodeId, endNodeId);
    if (!path || path.length < 2 || path[0] != startLocationNodeId) {
        alert(`No walking route could be found from your start point to the destination.`);
        return;
    }
    
    // Draw route and fit bounds
    drawRoute(path);
    
    // Draw markers
    let startLatLng = getLatLngFromNodeId(startLocationNodeId);
    if (activeStartMarker) map.removeLayer(activeStartMarker);
    activeStartMarker = L.circleMarker(startLatLng, {
        radius: 8,
        color: "green",
        fillColor: "green",
        fillOpacity: 1
    }).addTo(map);
    
    if (activeEndMarker) map.removeLayer(activeEndMarker);
    activeEndMarker = L.circleMarker([endDoor.lat, endDoor.lon], {
        radius: 8,
        color: "red",
        fillColor: "red",
        fillOpacity: 1
    }).addTo(map);
    
    // Display stats
    let distance = calculatePathDistance(path);
    let walkingTimeMin = Math.round(distance / 80);
    let timeStr = walkingTimeMin < 1 ? "less than a minute" : `~${walkingTimeMin} min`;
    
    navDistance.textContent = `~${distance} meters`;
    navTime.textContent = timeStr;
    navigationDetails.classList.remove("hidden");
    placeInfoCard.classList.remove("hidden");
    
    // Initialize turn-by-turn navigation banner
    activeNavPath = path;
    activeDirections = generateNavigationDirections(path);
    currentPathIndex = 0;
    
    let startLoc = userLatLng || getLatLngFromNodeId(startLocationNodeId);
    if (startLoc) {
        updateNavigationBanner(startLoc);
    }
}

navigateBtn.addEventListener("click", () => {
    if (activeNavigationMode === "direct") {
        performRouting();
    } else {
        performItineraryRouting();
    }
});
infoNavigateBtn.addEventListener("click", performRouting);

// Swap button
swapBtn.addEventListener("click", () => {
    isLiveStartActive = false;
    let startVal = startInput.value;
    startInput.value = destInput.value;
    destInput.value = startVal;
    
    // Swap internal states
    let tempNodeId = startLocationNodeId;
    let tempName = startLocationName;
    
    if (destinationItem) {
        let door = doors.find(d => d.name.toLowerCase() === destinationDoorName.toLowerCase());
        if (door) {
            startLocationNodeId = getNearestNode([door.lon, door.lat]);
            startLocationName = destinationItem.route_to;
        }
    } else {
        startLocationNodeId = null;
        startLocationName = null;
    }
    
    if (tempName) {
        destinationDoorName = resolveRouteToDoorName(tempName);
        let matchItem = campusData.find(d => d.route_to === tempName);
        if (matchItem) {
            destinationItem = matchItem;
            displayPlaceInfo(matchItem);
        }
    } else {
        destinationItem = null;
        destinationDoorName = null;
        placeInfoCard.classList.add("hidden");
    }
    
    // Redraw markers if they exist
    if (startLocationNodeId) {
        let latlng = getLatLngFromNodeId(startLocationNodeId);
        if (activeStartMarker) map.removeLayer(activeStartMarker);
        activeStartMarker = L.circleMarker(latlng, {
            radius: 8,
            color: "green",
            fillColor: "green",
            fillOpacity: 1
        }).addTo(map);
    } else {
        if (activeStartMarker) map.removeLayer(activeStartMarker);
    }
    
    if (destinationDoorName) {
        let endDoor = doors.find(d => d.name.toLowerCase() === destinationDoorName.toLowerCase());
        if (endDoor) {
            if (activeEndMarker) map.removeLayer(activeEndMarker);
            activeEndMarker = L.circleMarker([endDoor.lat, endDoor.lon], {
                radius: 8,
                color: "red",
                fillColor: "red",
                fillOpacity: 1
            }).addTo(map);
            highlightMapLocation(endDoor.name);
        }
    } else {
        if (activeEndMarker) map.removeLayer(activeEndMarker);
    }
    
    if (startLocationNodeId && destinationDoorName) {
        performRouting();
    } else {
        if (routeLine) map.removeLayer(routeLine);
        routeLine = null;
    }
});

// GPS Locate
function handleGpsLocate() {
    isLiveStartActive = true;
    startInput.value = "📍 Current Location";
    if (userLatLng) {
        let nearestNodeId = getNearestNode([userLatLng[1], userLatLng[0]]);
        if (nearestNodeId !== null) {
            startLocationNodeId = nearestNodeId;
            startLocationName = "GPS Position";
            
            let latlng = getLatLngFromNodeId(nearestNodeId);
            if (activeStartMarker) map.removeLayer(activeStartMarker);
            activeStartMarker = L.circleMarker(latlng, {
                radius: 8,
                color: "green",
                fillColor: "green",
                fillOpacity: 1
            }).addTo(map);
            
            map.setView(latlng, 18);
            if (destinationDoorName) {
                performRouting();
            }
        }
    } else {
        navigator.geolocation.getCurrentPosition(
            (position) => {
                let lat = position.coords.latitude;
                let lon = position.coords.longitude;
                userLatLng = [lat, lon];
                
                let nearestNodeId = getNearestNode([lon, lat]);
                if (nearestNodeId !== null) {
                    startLocationNodeId = nearestNodeId;
                    startLocationName = "GPS Position";
                    
                    let latlng = getLatLngFromNodeId(nearestNodeId);
                    if (activeStartMarker) map.removeLayer(activeStartMarker);
                    activeStartMarker = L.circleMarker(latlng, {
                        radius: 8,
                        color: "green",
                        fillColor: "green",
                        fillOpacity: 1
                    }).addTo(map);
                    
                    map.setView(latlng, 18);
                    if (destinationDoorName) {
                        performRouting();
                    }
                }
            },
            (error) => {
                alert("GPS permission denied or coordinates unavailable.");
            },
            { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
        );
    }
}

function startLiveGpsTracking() {
    if (!navigator.geolocation) {
        console.warn("Geolocation is not supported by this browser.");
        return;
    }
    
    gpsWatchId = navigator.geolocation.watchPosition(
        (position) => {
            let lat = position.coords.latitude;
            let lon = position.coords.longitude;
            let accuracy = position.coords.accuracy;
            userLatLng = [lat, lon];
            
            if (!userMarker) {
                userMarker = L.circleMarker([lat, lon], {
                    radius: 8,
                    color: "#136AEC",
                    fillColor: "#2A93EE",
                    fillOpacity: 1,
                    weight: 2
                }).addTo(map);
                
                accuracyCircle = L.circle([lat, lon], {
                    radius: accuracy,
                    color: "#136AEC",
                    fillColor: "#136AEC",
                    fillOpacity: 0.15,
                    weight: 1
                }).addTo(map);
            } else {
                userMarker.setLatLng([lat, lon]);
                accuracyCircle.setLatLng([lat, lon]);
                accuracyCircle.setRadius(accuracy);
            }
            
            if (activeNavPath && activeNavPath.length > 0) {
                updateNavigationBanner([lat, lon]);
            }
            
            if (isLiveStartActive) {
                let nearestNodeId = getNearestNode([lon, lat]);
                if (nearestNodeId !== null) {
                    startLocationNodeId = nearestNodeId;
                    startLocationName = "GPS Position";
                    
                    if (activeStartMarker) map.removeLayer(activeStartMarker);
                    activeStartMarker = L.circleMarker([lat, lon], {
                        radius: 8,
                        color: "green",
                        fillColor: "green",
                        fillOpacity: 1
                    }).addTo(map);
                    
                    if (destinationDoorName) {
                        let endDoor = doors.find(d => d.name.toLowerCase() === destinationDoorName.toLowerCase());
                        if (endDoor) {
                            let endNodeId = getNearestNode([endDoor.lon, endDoor.lat]);
                            if (startLocationNodeId !== endNodeId) {
                                let path = dijkstra(startLocationNodeId, endNodeId);
                                if (path && path.length >= 2 && path[0] == startLocationNodeId) {
                                    if (routeLine) map.removeLayer(routeLine);
                                    routeLine = L.polyline(path.map(id => getLatLngFromNodeId(id)).filter(Boolean), {
                                        color: "#7c3aed",
                                        weight: 6,
                                        opacity: 0.9
                                    }).addTo(map);
                                    
                                    if (activeEndMarker) map.removeLayer(activeEndMarker);
                                    activeEndMarker = L.circleMarker([endDoor.lat, endDoor.lon], {
                                        radius: 8,
                                        color: "red",
                                        fillColor: "red",
                                        fillOpacity: 1
                                    }).addTo(map);
                                    
                                    let distance = calculatePathDistance(path);
                                    let walkingTimeMin = Math.round(distance / 80);
                                    let timeStr = walkingTimeMin < 1 ? "less than a minute" : `~${walkingTimeMin} min`;
                                    
                                    navDistance.textContent = `~${distance} meters`;
                                    navTime.textContent = timeStr;
                                    navigationDetails.classList.remove("hidden");
                                    
                                    activeNavPath = path;
                                    activeDirections = generateNavigationDirections(path);
                                    currentPathIndex = 0;
                                }
                            }
                        }
                    }
                }
            }
        },
        (error) => {
            console.warn("watchPosition error:", error);
        },
        {
            enableHighAccuracy: true,
            maximumAge: 0,
            timeout: 10000
        }
    );
}

// Start watching on load
startLiveGpsTracking();

// Theme Toggle Button
const themeToggleBtn = document.getElementById("theme-toggle-btn");
themeToggleBtn.addEventListener("click", () => {
    if (currentTheme === "dark") {
        map.removeLayer(darkTileLayer);
        lightTileLayer.addTo(map);
        document.body.classList.add("light-theme");
        themeToggleBtn.innerHTML = `<i class="fa-solid fa-sun"></i>`;
        currentTheme = "light";
    } else {
        map.removeLayer(lightTileLayer);
        darkTileLayer.addTo(map);
        document.body.classList.remove("light-theme");
        themeToggleBtn.innerHTML = `<i class="fa-solid fa-moon"></i>`;
        currentTheme = "dark";
    }
});

gpsBtn.addEventListener("click", handleGpsLocate);
mapGpsBtn.addEventListener("click", handleGpsLocate);

// Recenter Map
centerMapBtn.addEventListener("click", () => {
    map.setView([23.1765, 80.0211], 17);
});

// Clear Route
clearRouteBtn.addEventListener("click", () => {
    clearActiveRoute();
});

function highlightMapLocation(doorName) {
    let door = doors.find(d => d.name === doorName);
    if (!door) return false;
    
    if (highlightMarker) map.removeLayer(highlightMarker);
    
    highlightMarker = L.circleMarker([door.lat, door.lon], {
        radius: 12,
        color: "#7c3aed",
        fillColor: "#a78bfa",
        fillOpacity: 0.7,
        weight: 3
    }).addTo(map);
    
    highlightMarker.bindTooltip(door.name, {
        permanent: true,
        direction: "top",
        offset: [0, -12],
        className: "door-label"
    }).openTooltip();
    
    map.setView([door.lat, door.lon], 18);
    return true;
}

// ==========================================
// 8. BUS TIMETABLE & MESS MENU DATASETS
// ==========================================
const BUS_TIMETABLE = {
    mon_fri_bus1: [
        { from: "Institute", to: "Sadar", time: "03:40 PM", purpose: "Staff/Student" },
        { from: "Sadar", to: "Institute", time: "04:30 PM", purpose: "Staff/Student" },
        { from: "Institute", to: "Sadar", time: "05:15 PM", purpose: "Staff/Student" },
        { from: "Sadar", to: "Institute", time: "06:00 PM", purpose: "Staff/Student" },
        { from: "Institute", to: "Sadar", time: "07:00 PM", purpose: "Staff/Student" },
        { from: "Sadar", to: "Institute", time: "07:40 PM", purpose: "Staff/Student" },
        { from: "Institute", to: "Sadar", time: "08:20 PM", purpose: "Staff/Student" },
        { from: "Sadar", to: "Institute", time: "09:00 PM", purpose: "Last Bus 1", highlight: true }
    ],
    mon_fri_bus2: [
        { from: "Institute", to: "Sadar", time: "03:00 PM", purpose: "Staff/Student" },
        { from: "Sadar", to: "Institute", time: "03:45 PM", purpose: "Staff/Student" },
        { from: "Institute", to: "Kakartala-Gadheri", time: "04:30 PM", purpose: "Jagriti (Out: 04:30 - 05:40 PM)" },
        { from: "Kakartala-Gadheri", to: "Institute", time: "05:40 PM", purpose: "Jagriti (In: 04:30 - 05:40 PM)" },
        { from: "Institute", to: "Sadar", time: "06:00 PM", purpose: "Staff/Student" },
        { from: "Sadar", to: "Institute", time: "06:30 PM", purpose: "Staff/Student" },
        { from: "Institute", to: "Kakartala-Gadheri", time: "07:10 PM", purpose: "Jagriti (Out: 07:10 - 08:10 PM)" },
        { from: "Kakartala-Gadheri", to: "Institute", time: "08:10 PM", purpose: "Jagriti (In: 07:10 - 08:10 PM)" },
        { from: "Institute", to: "Sadar", time: "08:50 PM", purpose: "Staff/Student" },
        { from: "Sadar", to: "Institute", time: "09:30 PM", purpose: "Last Bus 2", highlight: true }
    ],
    sat_sun: [
        { time: "03:00 PM", bus: "Bus 2", route: "Institute to Sadar (Via Russel Chowk)" },
        { time: "03:30 PM", bus: "Bus 1", route: "Institute to Sadar (Via Russel Chowk)" },
        { time: "04:30 PM", bus: "Bus 2", route: "Sadar to Institute" },
        { time: "05:20 PM", bus: "Bus 1", route: "Sadar to Institute" },
        { time: "05:30 PM", bus: "Bus 2", route: "Institute to Sadar" },
        { time: "06:00 PM", bus: "Bus 1", route: "Institute to Sadar" },
        { time: "06:30 PM", bus: "Bus 1", route: "Sadar to Institute" },
        { time: "07:00 PM", bus: "Bus 1", route: "Institute to Sadar" },
        { time: "07:30 PM", bus: "Bus 2", route: "Sadar to Institute (Via Russel Chowk)" },
        { time: "08:50 PM", bus: "Bus 2", route: "Institute to Sadar" },
        { time: "09:15 PM", bus: "Bus 1", route: "Sadar to Institute (Via Russel Chowk) - Last Bus 1", highlight: true },
        { time: "09:30 PM", bus: "Bus 2", route: "Sadar to Institute - Last Bus 2", highlight: true }
    ],
    school_bus: [
        { bus: "Bus 1 (MP20 ZL1297)", route: "Rewa/NR3/NR2 -> School", time: "06:45 AM", conductor: "Mr. Ranjeet Gurung (9907477807)" },
        { bus: "Bus 1 (MP20 ZL1297)", route: "School -> Rewa/NR3/NR2", time: "02:30 PM", conductor: "Mr. Ranjeet Gurung (9907477807)" },
        { bus: "Bus 2 (MP20 ZV9297)", route: "Rewa/NR3/NR2 -> School", time: "06:45 AM", conductor: "Mr. Rakesh Singh (8516872142)" },
        { bus: "Bus 2 (MP20 ZV9297)", route: "School -> Rewa/NR3/NR2", time: "02:30 PM", conductor: "Mr. Rakesh Singh (8516872142)" },
        { bus: "Bus 3 (MP20 PA2097)", route: "Rewa/NR3/NR2 -> School", time: "07:30 AM", conductor: "Mr. Ganesh Kashyap (9425155203)" },
        { bus: "Bus 3 (MP20 PA2097)", route: "School -> Rewa/NR3/NR2", time: "01:00 PM", conductor: "Mr. Ganesh Kashyap (9425155203)" }
    ]
};

const MESS_MENU = {
    veg: {
        Monday: {
            breakfast: "Poha Sev Mix, Tarri, Jalebi, Chopped Onion, Lemon, Sprouts, Fruits",
            lunch: "Plain Rice, Plain Paratha, Aalu Matar, Rajma, Curd, Papad",
            dinner: "Plain Rice, Chapati, Mix Veg, Dry Manchurian (3pc), Urad Dal, Ice Cream"
        },
        Tuesday: {
            breakfast: "Medu Vada, Tomato Chutney, Sambhar, Sprouts, Fruits",
            lunch: "Veg Masala pulao, Chapati, Soya Gravy/Mutter, Masoor Dal, Fryums, Curd",
            dinner: "Pulihora, Chapati, Safed Matar Masala, Noodles, Dal Makhani, Lemon Coriander Soup, Fruit Custard/Rasgulla"
        },
        Wednesday: {
            breakfast: "Besan Chilla / Uttapam, (Garlic Chutney/Tomato Sauce), Sprouts, Fruits",
            lunch: "Jeera Rice, Chapati, Sev Tamatar/ Sev Bhaji, Arhar Dal, Curd, Fryums.",
            dinner: "Plain Rice, Chapati, Paneer Bhurji/Butter Paneer, Masoor Dal, Besan Barfi"
        },
        Thursday: {
            breakfast: "Idli, Sambhar, Nariyal chutney, Sprouts, Fruits",
            lunch: "Jeera Rice, Chapati, Bhindi Aloo Masala(25% aloo), Moth Dal, Boondi Raita, Papad",
            dinner: "Plain Rice, Chapati, Mix Veg, Rasum, Tuar Dal, Sweet Corn Soup, Gulab Jamun"
        },
        Friday: {
            breakfast: "Aloo puri/Masala Seviyaan, Tomato Sauce, Sprouts, Fruits",
            lunch: "Plain rice, Chapati, Veg Kofta/Brinjal Masala, Panchmel Dal, Curd, Fryums",
            dinner: "Jeera Rice, Chapati, Paneer-Do-Pyaza, Arhar dal, Kheer."
        },
        Saturday: {
            breakfast: "Masala dosa, Sambhar, Chutney, Sprouts, Fruits",
            lunch: "Plain Rice, Chole Puri/Palak Puri, Sambhar/Rasum, Curd, Papad",
            dinner: "Jeera Rice, Chapati, Capsicum Aloo Masala (max 25% Aloo), Lobia, Moong daal Halwa, Tomato Soup, Fryums"
        },
        Sunday: {
            breakfast: "Aloo paratha, Tomato Chutney, Curd, Sprouts, Fruits",
            lunch: "Plain Rice, Chapati, Cabbage Masala/ Gobi Aloo(max 25% aloo), Kadhi Pakoda/Masala, Fryums",
            dinner: "Paneer Lababdar, Chapati, Raita, Tava Veg, Veg Biryani, Shahi Tukda (2pc)"
        }
    },
    non_veg: {
        Monday: {
            breakfast: "Poha, Sev, Tarri, Jalebi, Chopped Onion, Lemon",
            lunch: "Plain Rice, Plain Paratha, Aalu-Matar, Rajma, Curd, Papad.",
            dinner: "Plain Rice, Chapati, Safed Matar Masala, Dry Manchurian (3pc), Urad Dal, Ice Cream."
        },
        Tuesday: {
            breakfast: "Idli, Sambhar, Nariyal chutney",
            lunch: "Veg Masala pulao, Chapati, Soya Gravy/Mutter, Masoor Dal, Fryums, Curd.",
            dinner: "Plain Rice, Chapati, Mix Veg, Mah Chana Dal, Sambar, Lemon Coriander Soup, Moong dal halwa"
        },
        Wednesday: {
            breakfast: "Pasta/Masala Seviyan, Tomato Sauce",
            lunch: "Jeera Rice, Chapati, Sev Tamatar, Arhar Dal, Curd, Fryums.",
            dinner: "Chicken Curry (3 pcs), Plain Rice, Chapati, Rasam, Besan Barfi/Fruit custard"
        },
        Thursday: {
            breakfast: "Medu Vada, Tomato Chutney, Sambhar",
            lunch: "Jeera Rice, Chapati, Bhindi Aloo/ Bhindi Masala, Moth Dal, Boondi Raita, Papad.",
            dinner: "Plain Rice, Chapati, Sev Tamatar/Lauki Channa, Rasam, Tuar Dal, Sweet Corn Soup, Gulab Jamun"
        },
        Friday: {
            breakfast: "Uttapam/Veg Cutlet, Garlic Chutney, Nariyal Chutney",
            lunch: "Plain Rice, Chapati, Veg Kofta/Baigan Masala, Daal-Makhni, Curd, Fryums.",
            dinner: "Jeera Rice, Chapati, Chicken masala Curry(3pcs), Arhar Daal, Rasgulla"
        },
        Saturday: {
            breakfast: "Masala Dosa, Coconut Chutney, Sambar",
            lunch: "Plain Rice, Chole Puri/Palak Puri, Rasam, Curd, Papad.",
            dinner: "Pulihora, Chapati, Noodles, Capsicum Aloo/Gaajar Aloo Matar, Lobia, Tomato Soup, Fryums"
        },
        Sunday: {
            breakfast: "Aloo Paratha/Mix Veg Paratha, Tomato Chutney, Curd",
            lunch: "Plain Rice, Chapati, Cabbage Masala/Gobi Aloo, Patodi sabji, Sambhar",
            dinner: "Chicken (3 pcs), Biryani, Raita, Shahi Tukda (2 pcs)"
        }
    }
};

// ==========================================
// 9. DYNAMIC RENDERING & INTERACTIVE MODALS
// ==========================================
function renderMonFriBusTab() {
    const el = document.getElementById("bus-mon-fri");
    el.innerHTML = `
        <div style="margin-bottom:15px; font-weight:600; font-size:14px; color:var(--accent);">Bus No. 1 (MP20 ZL1297)</div>
        <div class="time-table-grid" style="margin-bottom:20px;">
            <div class="time-table-row header">
                <div>From</div>
                <div>To</div>
                <div>Time</div>
                <div>Purpose</div>
            </div>
            ${BUS_TIMETABLE.mon_fri_bus1.map(row => `
                <div class="time-table-row ${row.highlight ? 'highlight' : ''}">
                    <div>${row.from}</div>
                    <div>${row.to}</div>
                    <div>${row.time}</div>
                    <div>${row.purpose}</div>
                </div>
            `).join('')}
        </div>
        
        <div style="margin-bottom:15px; font-weight:600; font-size:14px; color:var(--accent);">Bus No. 2 (MP20 ZV9297)</div>
        <div class="time-table-grid">
            <div class="time-table-row header">
                <div>From</div>
                <div>To</div>
                <div>Time</div>
                <div>Purpose</div>
            </div>
            ${BUS_TIMETABLE.mon_fri_bus2.map(row => `
                <div class="time-table-row ${row.highlight ? 'highlight' : ''}">
                    <div>${row.from}</div>
                    <div>${row.to}</div>
                    <div>${row.time}</div>
                    <div>${row.purpose}</div>
                </div>
            `).join('')}
        </div>
        
        <div class="bus-footer-info">
            <p><strong><i class="fa-solid fa-phone"></i> Bus Conductor:</strong> <a href="tel:9826346178">9826346178</a> (Mr. Tilak Singh)</p>
            <p><strong><i class="fa-solid fa-phone"></i> Queries:</strong> <a href="tel:9425155203">9425155203</a> (Mr. Ganesh Kashyap)</p>
        </div>
    `;
}

function renderSatSunBusTab() {
    const el = document.getElementById("bus-sat-sun");
    el.innerHTML = `
        <div class="time-table-grid">
            <div class="time-table-row header">
                <div>Time</div>
                <div>Bus</div>
                <div style="grid-column: span 2;">Route</div>
            </div>
            ${BUS_TIMETABLE.sat_sun.map(row => `
                <div class="time-table-row ${row.highlight ? 'highlight' : ''}">
                    <div>${row.time}</div>
                    <div>${row.bus}</div>
                    <div style="grid-column: span 2;">${row.route}</div>
                </div>
            `).join('')}
        </div>
        
        <div class="bus-footer-info">
            <p><strong>Guidelines:</strong> Tickets distributed 01:30 PM - 03:00 PM at Admin Block (2 tickets max, Cash only).</p>
        </div>
    `;
}

function renderSchoolBusTab() {
    const el = document.getElementById("bus-school");
    el.innerHTML = `
        <div class="time-table-grid">
            <div class="time-table-row header">
                <div>Bus</div>
                <div>Route</div>
                <div>Time</div>
                <div>Conductor Contact</div>
            </div>
            ${BUS_TIMETABLE.school_bus.map(row => `
                <div class="time-table-row">
                    <div>${row.bus}</div>
                    <div>${row.route}</div>
                    <div>${row.time}</div>
                    <div>${row.conductor}</div>
                </div>
            `).join('')}
        </div>
        
        <div class="bus-footer-info">
            <p>Runs Monday to Saturday. Limited seats available for IIIT students (must book tickets one day prior).</p>
        </div>
    `;
}

let selectedMessType = "veg";
let selectedMessDay = "Monday";

function renderMessMenu() {
    const el = document.querySelector(".mess-content-display");
    const dayData = MESS_MENU[selectedMessType][selectedMessDay];
    
    if (!dayData) return;
    
    el.innerHTML = `
        <div class="meal-cards">
            <div class="meal-card breakfast">
                <h4><i class="fa-solid fa-mug-saucer"></i> Breakfast</h4>
                <span class="meal-time">7:30 AM - 9:30 AM (8-10 AM Weekends)</span>
                <p class="meal-items">${dayData.breakfast}</p>
            </div>
            <div class="meal-card lunch">
                <h4><i class="fa-solid fa-bowl-food"></i> Lunch</h4>
                <span class="meal-time">12:00 PM - 2:30 PM (12:30-3 PM Weekends)</span>
                <p class="meal-items">${dayData.lunch}</p>
            </div>
            <div class="meal-card dinner">
                <h4><i class="fa-solid fa-plate-wheat"></i> Dinner</h4>
                <span class="meal-time">7:30 PM - 9:30 PM</span>
                <p class="meal-items">${dayData.dinner}</p>
            </div>
        </div>
        
        <div class="mess-meta-info">
            <h5>📌 Common & Sick Diet Items:</h5>
            <ul>
                <li><strong>Breakfast:</strong> Bread, Amul Butter (20g), Jam (20g), Tea/Coffee, Milk (200ml), Sprouts, Chana. ${selectedMessType === 'non-veg' ? 'Plus 2 Boiled Eggs.' : ''}</li>
                <li><strong>Lunch & Dinner:</strong> Salad (Onion, Radish, Beetroot, Cucumber, Carrot), Pickle, Lemon, Fried Chili. Everyday fresh fruits.</li>
                <li><strong>Sick Diet / Fasting:</strong> Available on demand with valid reasons.</li>
            </ul>
        </div>
    `;
}

// Toggle unified Info Modal
const infoModal = document.getElementById("info-modal");
const infoBanner = document.getElementById("info-banner");
const closeInfoModalBtn = document.getElementById("close-info-modal-btn");

infoBanner.addEventListener("click", () => {
    renderMonFriBusTab();
    renderSatSunBusTab();
    renderSchoolBusTab();
    renderMessMenu();
    infoModal.classList.remove("hidden");
});

closeInfoModalBtn.addEventListener("click", () => {
    infoModal.classList.add("hidden");
});

// Close modal clicking backdrop
window.addEventListener("click", (e) => {
    if (e.target === infoModal) {
        infoModal.classList.add("hidden");
    }
});

// Main Hub Tabs switching (Bus vs Mess)
document.querySelectorAll(".main-tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
        document.querySelectorAll(".main-tab-btn").forEach(b => b.classList.remove("active"));
        document.querySelectorAll(".main-tab-content").forEach(c => c.classList.remove("active"));
        
        btn.classList.add("active");
        const tabId = btn.getAttribute("data-main-tab");
        document.getElementById(tabId).classList.add("active");
    });
});

// Bus Sub-Tabs switching
document.querySelectorAll("#bus-hub-tab .tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
        document.querySelectorAll("#bus-hub-tab .tab-btn").forEach(b => b.classList.remove("active"));
        document.querySelectorAll("#bus-hub-tab .tab-content").forEach(c => c.classList.remove("active"));
        
        btn.classList.add("active");
        const tabId = btn.getAttribute("data-tab");
        document.getElementById(tabId).classList.add("active");
    });
});

// Mess Type switching
document.querySelectorAll(".mess-selector .tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
        document.querySelectorAll(".mess-selector .tab-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        selectedMessType = btn.getAttribute("data-mess");
        renderMessMenu();
    });
});

// Mess Day switching
document.querySelectorAll(".day-selector .day-btn").forEach(btn => {
    btn.addEventListener("click", () => {
        document.querySelectorAll(".day-selector .day-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        selectedMessDay = btn.getAttribute("data-day");
        renderMessMenu();
    });
});

// ==========================================
// 10. REAL-TIME NAVIGATION DIRECTIONS (GMAPS STYLE)
// ==========================================
function generateNavigationDirections(path) {
    if (!path || path.length < 2) return [];
    
    let directions = [];
    
    for (let i = 0; i < path.length - 1; i++) {
        let p1 = getLatLngFromNodeId(path[i]);
        let p2 = getLatLngFromNodeId(path[i + 1]);
        if (!p1 || !p2) continue;
        
        let dist = Math.round(haversineDistance(p1, p2));
        
        let turn = "straight";
        if (i < path.length - 2) {
            let p3 = getLatLngFromNodeId(path[i + 2]);
            if (p3) {
                let b1 = getBearing(p1[0], p1[1], p2[0], p2[1]);
                let b2 = getBearing(p2[0], p2[1], p3[0], p3[1]);
                let diff = b2 - b1;
                if (diff > 180) diff -= 360;
                if (diff < -180) diff += 360;
                
                if (diff > 20 && diff <= 60) turn = "slight-right";
                else if (diff > 60 && diff <= 120) turn = "right";
                else if (diff > 120) turn = "sharp-right";
                else if (diff < -20 && diff >= -60) turn = "slight-left";
                else if (diff < -60 && diff >= -120) turn = "left";
                else if (diff < -120) turn = "sharp-left";
            }
        } else {
            turn = "destination";
        }
        
        directions.push({
            fromNode: path[i],
            toNode: path[i + 1],
            distance: dist,
            turnType: turn
        });
    }
    
    return directions;
}

function getBearing(lat1, lon1, lat2, lon2) {
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const lat1Rad = lat1 * Math.PI / 180;
    const lat2Rad = lat2 * Math.PI / 180;
    const y = Math.sin(dLon) * Math.cos(lat2Rad);
    const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) - Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon);
    const brng = Math.atan2(y, x) * 180 / Math.PI;
    return (brng + 360) % 360;
}

function updateNavigationBanner(userCoords) {
    if (!activeNavPath || activeNavPath.length < 2 || !activeDirections || activeDirections.length === 0) {
        document.getElementById("nav-banner").classList.add("hidden");
        return;
    }
    
    let closestIndex = 0;
    let minDist = Infinity;
    for (let i = currentPathIndex; i < activeNavPath.length; i++) {
        let nodeLatLng = getLatLngFromNodeId(activeNavPath[i]);
        if (!nodeLatLng) continue;
        let dist = haversineDistance(userCoords, nodeLatLng);
        if (dist < minDist) {
            minDist = dist;
            closestIndex = i;
        }
    }
    
    if (closestIndex > currentPathIndex) {
        currentPathIndex = closestIndex;
    }
    
    if (currentPathIndex >= activeNavPath.length - 1) {
        document.getElementById("nav-instruction-dist").textContent = "Arrived";
        document.getElementById("nav-instruction-action").textContent = "You have reached your destination";
        document.getElementById("nav-instruction-icon").className = "fa-solid fa-location-dot";
        document.getElementById("nav-instruction-icon").style.transform = "";
        setTimeout(() => {
            document.getElementById("nav-banner").classList.add("hidden");
            activeNavPath = [];
            activeDirections = [];
        }, 5000);
        return;
    }
    
    let nextNodeLatLng = getLatLngFromNodeId(activeNavPath[currentPathIndex + 1]);
    let distToNext = Math.round(haversineDistance(userCoords, nextNodeLatLng));
    
    let dir = activeDirections[currentPathIndex];
    if (!dir) return;
    
    let turnAction = "Go straight";
    let iconClass = "fa-arrow-up";
    
    switch (dir.turnType) {
        case "slight-right":
            turnAction = "Slight right turn ahead";
            iconClass = "fa-arrow-trend-up";
            break;
        case "right":
        case "sharp-right":
            turnAction = "Turn right";
            iconClass = "fa-arrow-right";
            break;
        case "slight-left":
            turnAction = "Slight left turn ahead";
            iconClass = "fa-arrow-trend-up";
            break;
        case "left":
        case "sharp-left":
            turnAction = "Turn left";
            iconClass = "fa-arrow-left";
            break;
        case "destination":
            turnAction = "Destination is ahead";
            iconClass = "fa-location-dot";
            break;
    }
    
    document.getElementById("nav-instruction-dist").textContent = `In ${distToNext} meters`;
    document.getElementById("nav-instruction-action").textContent = turnAction;
    document.getElementById("nav-instruction-icon").className = `fa-solid ${iconClass}`;
    
    if (dir.turnType === "slight-left") {
        document.getElementById("nav-instruction-icon").style.transform = "scaleX(-1)";
    } else {
        document.getElementById("nav-instruction-icon").style.transform = "";
    }
    
    document.getElementById("nav-banner").classList.remove("hidden");
}

// ==========================================
// 11. PROGRESSIVE WEB APP (PWA) OFFLINE UTILITIES
// ==========================================
if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
        navigator.serviceWorker
            .register("./service-worker.js")
            .then((reg) => console.log("Service Worker registered successfully with scope:", reg.scope))
            .catch((err) => console.error("Service Worker registration failed:", err));
    });
}

// Online/Offline Status Indicator
const connectionStatus = document.getElementById("connection-status");
if (connectionStatus) {
    const updateOnlineStatus = () => {
        if (navigator.onLine) {
            connectionStatus.className = "connection-status online";
            connectionStatus.querySelector(".status-text").textContent = "Online";
        } else {
            connectionStatus.className = "connection-status offline";
            connectionStatus.querySelector(".status-text").textContent = "Offline Mode: Using cached campus data.";
        }
    };
    window.addEventListener("online", updateOnlineStatus);
    window.addEventListener("offline", updateOnlineStatus);
    updateOnlineStatus(); // run check on start
}

// ==========================================
// 12. VOICE SEARCH & TEXT-TO-SPEECH (TTS)
// ==========================================
let ttsEnabled = true;

// Init TTS Voice response preference
if (localStorage.getItem("campusnav_tts") !== null) {
    ttsEnabled = localStorage.getItem("campusnav_tts") === "true";
} else {
    ttsEnabled = true;
}

const voiceTtsToggleBtn = document.getElementById("voice-tts-toggle-btn");
function updateTtsButtonUI() {
    if (voiceTtsToggleBtn) {
        if (ttsEnabled) {
            voiceTtsToggleBtn.classList.remove("muted");
            voiceTtsToggleBtn.classList.add("active");
            voiceTtsToggleBtn.innerHTML = '<i class="fa-solid fa-volume-high"></i>';
            voiceTtsToggleBtn.title = "Voice Feedback: Enabled";
        } else {
            voiceTtsToggleBtn.classList.remove("active");
            voiceTtsToggleBtn.classList.add("muted");
            voiceTtsToggleBtn.innerHTML = '<i class="fa-solid fa-volume-xmark"></i>';
            voiceTtsToggleBtn.title = "Voice Feedback: Disabled";
        }
    }
}
updateTtsButtonUI();

if (voiceTtsToggleBtn) {
    voiceTtsToggleBtn.addEventListener("click", () => {
        ttsEnabled = !ttsEnabled;
        localStorage.setItem("campusnav_tts", ttsEnabled);
        updateTtsButtonUI();
        if (ttsEnabled) {
            speakResponse("Voice feedback enabled");
        } else {
            if (window.speechSynthesis) window.speechSynthesis.cancel();
        }
    });
}

function speakResponse(text) {
    if (!ttsEnabled || !window.speechSynthesis) return;
    window.speechSynthesis.cancel(); // stop current utterance
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-IN"; // Indian English pronunciation format
    window.speechSynthesis.speak(utterance);
}

// Hook routing voice confirmation in performRouting
const originalPerformRouting = performRouting;
performRouting = function() {
    originalPerformRouting();
    // After performRouting updates placeInfoCard, read out confirmation if navigation succeeded
    if (destinationItem && navTime.textContent) {
        let cleanTime = navTime.textContent.replace("~", "").trim();
        speakResponse(`Navigating to ${destinationItem.name}. The estimated walking time is ${cleanTime}.`);
    }
};

// Speech Recognition Initialization
let recognition = null;
const voiceSearchBtn = document.getElementById("voice-search-btn");
const voiceStatus = document.getElementById("voice-status");
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

if (!SpeechRecognition) {
    if (voiceSearchBtn) voiceSearchBtn.style.display = "none";
} else {
    recognition = new SpeechRecognition();
    recognition.lang = "en-IN";
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onstart = () => {
        voiceSearchBtn.classList.remove("processing");
        voiceSearchBtn.classList.add("listening");
        voiceSearchBtn.innerHTML = '<i class="fa-solid fa-microphone-lines"></i>';
        showVoiceStatus("🎙️ Listening...", "listening");
    };

    recognition.onresult = (event) => {
        voiceSearchBtn.classList.remove("listening");
        voiceSearchBtn.classList.add("processing");
        voiceSearchBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
        showVoiceStatus("✔️ Processing...", "success");

        const transcript = event.results[0][0].transcript;
        processVoiceSearch(transcript);
    };

    recognition.onerror = (event) => {
        voiceSearchBtn.classList.remove("listening");
        voiceSearchBtn.classList.remove("processing");
        voiceSearchBtn.innerHTML = '<i class="fa-solid fa-microphone"></i>';

        let errorMsg = "Speech recognition error.";
        if (event.error === "no-speech") {
            errorMsg = "No speech detected. Please try again.";
        } else if (event.error === "not-allowed") {
            errorMsg = "Microphone access denied. Please enable microphone permissions.";
        } else if (event.error === "network") {
            errorMsg = "Network interruption occurred. Try again.";
        }
        showVoiceStatus(`❌ ${errorMsg}`, "error");
        speakResponse(errorMsg);
    };

    recognition.onend = () => {
        if (!voiceSearchBtn.classList.contains("processing")) {
            voiceSearchBtn.classList.remove("listening");
            voiceSearchBtn.innerHTML = '<i class="fa-solid fa-microphone"></i>';
        }
    };

    voiceSearchBtn.addEventListener("click", () => {
        if (voiceSearchBtn.classList.contains("listening")) {
            recognition.stop();
        } else {
            if (window.speechSynthesis) window.speechSynthesis.cancel();
            try {
                recognition.start();
            } catch (e) {
                console.error("Speech Recognition start error:", e);
            }
        }
    });
}

function showVoiceStatus(text, type) {
    if (!voiceStatus) return;
    voiceStatus.className = `voice-status ${type}`;
    voiceStatus.textContent = text;
    voiceStatus.classList.remove("hidden");

    if (type !== "listening") {
        setTimeout(() => {
            if (voiceStatus.textContent === text) {
                voiceStatus.classList.add("hidden");
            }
        }, 5000);
    }
}

function normalizeVoiceQuery(query) {
    let q = query.toLowerCase().trim();
    q = q.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g, "");

    const prefixes = [
        "take me to the", "take me to",
        "navigate to the", "navigate to",
        "how do i reach the", "how do i reach",
        "how to reach the", "how to reach",
        "how to get to the", "how to get to",
        "guide me to the", "guide me to",
        "i want to go to the", "i want to go to",
        "where is the", "where is",
        "show me the", "show me",
        "where can i find the", "where can i find",
        "where can i", "i want to find the",
        "find the", "find"
    ];

    for (let prefix of prefixes) {
        if (q.startsWith(prefix + " ")) {
            q = q.substring(prefix.length).trim();
            break;
        }
    }

    // Natural mapping overrides
    if (q === "print documents" || q === "print" || q.includes("printing") || q.includes("print paper")) {
        q = "xerox shop";
    }
    if (q.includes("doctor") || q.includes("medical") || q.includes("clinic") || q.includes("hospital")) {
        q = "phc";
    }
    if (q.includes("coffee") || q.includes("cafe")) {
        q = "nescafe";
    }
    if (q.includes("first year boys") || q.includes("1st year boys")) {
        q = "panini hostel";
    }
    if (q.startsWith("the ")) {
        q = q.substring(4).trim();
    }
    return q;
}

function processVoiceSearch(transcript) {
    if (!transcript) return;
    showVoiceStatus(`You said: "${transcript}"`, "success");
    const normalizedQuery = normalizeVoiceQuery(transcript);
    
    // Update text field
    destInput.value = normalizedQuery;

    let matches = searchLocations(normalizedQuery);
    if (matches && matches.length > 0) {
        let bestMatch = matches[0];
        selectSuggestion(destInput, destSuggestions, bestMatch);

        const lowercaseTranscript = transcript.toLowerCase();
        const wantsNavigation = ["navigate", "take me", "go to", "reach", "guide", "route"].some(kw => 
            lowercaseTranscript.includes(kw)
        );

        if (wantsNavigation) {
            if (!startLocationNodeId) {
                showVoiceStatus(`Finding route to ${bestMatch.name}...`, "success");
                handleGpsLocate(); // Will auto-navigate once GPS locks
            } else {
                performRouting();
            }
        } else {
            speakResponse(`Showing details for ${bestMatch.name}.`);
        }
    } else {
        showVoiceStatus(`❌ No match found for "${normalizedQuery}"`, "error");
        speakResponse(`Could not find a match for ${normalizedQuery}.`);
    }
}

// ==========================================
// 13. PLAN MY VISIT (ITINERARY MODE) LOGIC
// ==========================================
let activeNavigationMode = "direct";
let selectedWaypoints = [];
let itineraryStartNodeId = null;
let itineraryStartName = null;

const modeDirectBtn = document.getElementById("mode-direct-btn");
const modeItineraryBtn = document.getElementById("mode-itinerary-btn");
const directInputs = document.getElementById("direct-inputs");
const itineraryInputs = document.getElementById("itinerary-inputs");

const itineraryStartInput = document.getElementById("itinerary-start-input");
const itineraryStartSuggestions = document.getElementById("itinerary-start-suggestions");
const itineraryGpsBtn = document.getElementById("itinerary-gps-btn");
const waypointList = document.getElementById("waypoint-list");
const addStopBtn = document.getElementById("add-stop-btn");

if (modeDirectBtn && modeItineraryBtn) {
    modeDirectBtn.addEventListener("click", () => {
        activeNavigationMode = "direct";
        modeDirectBtn.classList.add("active");
        modeItineraryBtn.classList.remove("active");
        directInputs.classList.remove("hidden");
        itineraryInputs.classList.add("hidden");
        clearActiveRoute();
    });

    modeItineraryBtn.addEventListener("click", () => {
        activeNavigationMode = "itinerary";
        modeItineraryBtn.classList.add("active");
        modeDirectBtn.classList.remove("active");
        itineraryInputs.classList.remove("hidden");
        directInputs.classList.add("hidden");
        clearActiveRoute();
        
        if (selectedWaypoints.length === 0) {
            addWaypointInput();
        }
    });
}

function addWaypointInput() {
    let index = selectedWaypoints.length;
    if (index >= 5) {
        alert("Maximum of 5 stops allowed.");
        return;
    }

    selectedWaypoints.push(null);

    let group = document.createElement("div");
    group.className = "input-group waypoint-group";
    group.id = `waypoint-group-${index}`;
    group.innerHTML = `
        <div class="input-label">
            <span class="waypoint-number">Stop ${index + 1}</span>
        </div>
        <div class="input-wrapper">
            <input type="text" class="waypoint-input" placeholder="Search stop location..." autocomplete="off" data-index="${index}">
            <button class="remove-stop-btn" title="Remove Stop" data-index="${index}">
                <i class="fa-solid fa-xmark"></i>
            </button>
        </div>
        <div class="autocomplete-list hidden waypoint-suggestions" id="waypoint-suggestions-${index}"></div>
    `;

    waypointList.appendChild(group);

    const input = group.querySelector(".waypoint-input");
    const suggestions = group.querySelector(".waypoint-suggestions");
    const removeBtn = group.querySelector(".remove-stop-btn");

    input.addEventListener("input", () => {
        let query = input.value;
        showItinerarySuggestions(input, suggestions, query, index);
    });

    removeBtn.addEventListener("click", () => {
        removeWaypointInput(index);
    });
}

function removeWaypointInput(index) {
    const group = document.getElementById(`waypoint-group-${index}`);
    if (group) group.remove();

    selectedWaypoints.splice(index, 1);

    // Re-index
    const groups = document.querySelectorAll(".waypoint-group");
    groups.forEach((g, idx) => {
        g.id = `waypoint-group-${idx}`;
        g.querySelector(".waypoint-number").textContent = `Stop ${idx + 1}`;
        g.querySelector(".waypoint-input").setAttribute("data-index", idx);
        g.querySelector(".remove-stop-btn").setAttribute("data-index", idx);
        g.querySelector(".waypoint-suggestions").id = `waypoint-suggestions-${idx}`;
    });
}

function showItinerarySuggestions(inputEl, suggestionsEl, query, index) {
    if (!query) {
        suggestionsEl.innerHTML = "";
        suggestionsEl.classList.add("hidden");
        return;
    }

    let matches = searchLocations(query);
    if (matches.length === 0) {
        suggestionsEl.innerHTML = "";
        suggestionsEl.classList.add("hidden");
        return;
    }

    suggestionsEl.innerHTML = "";
    matches.forEach(item => {
        let li = document.createElement("div");
        li.className = "autocomplete-item";
        li.innerHTML = `
            <div class="item-left">
                <i class="fa-solid fa-location-dot"></i>
                <span class="item-name">${item.name}</span>
            </div>
            <span class="item-category">${item.category || "Place"}</span>
        `;
        li.addEventListener("click", () => {
            inputEl.value = item.name;
            suggestionsEl.classList.add("hidden");
            selectedWaypoints[index] = resolveRouteToDoorName(item.route_to);
        });
        suggestionsEl.appendChild(li);
    });
    suggestionsEl.classList.remove("hidden");
}

if (addStopBtn) {
    addStopBtn.addEventListener("click", addWaypointInput);
}

if (itineraryStartInput) {
    itineraryStartInput.addEventListener("input", () => {
        let query = itineraryStartInput.value;
        showItineraryStartSuggestions(query);
    });
}

function showItineraryStartSuggestions(query) {
    if (!query) {
        itineraryStartSuggestions.innerHTML = "";
        itineraryStartSuggestions.classList.add("hidden");
        return;
    }

    let matches = searchLocations(query);
    if (matches.length === 0) {
        itineraryStartSuggestions.innerHTML = "";
        itineraryStartSuggestions.classList.add("hidden");
        return;
    }

    itineraryStartSuggestions.innerHTML = "";
    matches.forEach(item => {
        let li = document.createElement("div");
        li.className = "autocomplete-item";
        li.innerHTML = `
            <div class="item-left">
                <i class="fa-solid fa-location-dot"></i>
                <span class="item-name">${item.name}</span>
            </div>
            <span class="item-category">${item.category || "Place"}</span>
        `;
        li.addEventListener("click", () => {
            itineraryStartInput.value = item.name;
            itineraryStartSuggestions.classList.add("hidden");
            
            let resolvedDoorName = resolveRouteToDoorName(item.route_to);
            let door = doors.find(d => d.name.toLowerCase() === resolvedDoorName.toLowerCase());
            if (door) {
                itineraryStartNodeId = getNearestNode([door.lon, door.lat]);
                itineraryStartName = item.route_to;
                
                if (activeStartMarker) map.removeLayer(activeStartMarker);
                activeStartMarker = L.circleMarker([door.lat, door.lon], {
                    radius: 8,
                    color: "green",
                    fillColor: "green",
                    fillOpacity: 1
                }).addTo(map);
                map.setView([door.lat, door.lon], 18);
            }
        });
        itineraryStartSuggestions.appendChild(li);
    });
    itineraryStartSuggestions.classList.remove("hidden");
}

if (itineraryGpsBtn) {
    itineraryGpsBtn.addEventListener("click", handleItineraryGpsLocate);
}

function handleItineraryGpsLocate() {
    itineraryStartInput.value = "📍 Current Location";
    if (userLatLng) {
        let nearestNodeId = getNearestNode([userLatLng[1], userLatLng[0]]);
        if (nearestNodeId !== null) {
            itineraryStartNodeId = nearestNodeId;
            itineraryStartName = "GPS Position";
            
            let latlng = getLatLngFromNodeId(nearestNodeId);
            if (activeStartMarker) map.removeLayer(activeStartMarker);
            activeStartMarker = L.circleMarker(latlng, {
                radius: 8,
                color: "green",
                fillColor: "green",
                fillOpacity: 1
            }).addTo(map);
            map.setView(latlng, 18);
        }
    } else {
        navigator.geolocation.getCurrentPosition(
            (position) => {
                let lat = position.coords.latitude;
                let lon = position.coords.longitude;
                userLatLng = [lat, lon];
                
                let nearestNodeId = getNearestNode([lon, lat]);
                if (nearestNodeId !== null) {
                    itineraryStartNodeId = nearestNodeId;
                    itineraryStartName = "GPS Position";
                    
                    let latlng = getLatLngFromNodeId(nearestNodeId);
                    if (activeStartMarker) map.removeLayer(activeStartMarker);
                    activeStartMarker = L.circleMarker(latlng, {
                        radius: 8,
                        color: "green",
                        fillColor: "green",
                        fillOpacity: 1
                    }).addTo(map);
                    map.setView(latlng, 18);
                }
            },
            (error) => {
                alert("GPS permission denied or coordinates unavailable.");
            },
            { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
        );
    }
}

function performItineraryRouting() {
    if (!itineraryStartNodeId) {
        alert("Please select or acquire a start location first.");
        return;
    }

    let stops = [];
    const inputs = document.querySelectorAll(".waypoint-input");
    for (let input of inputs) {
        let idx = input.getAttribute("data-index");
        let doorName = selectedWaypoints[idx];
        if (!doorName) {
            alert(`Please select a location for Stop ${parseInt(idx) + 1}.`);
            return;
        }
        stops.push(doorName);
    }

    if (stops.length === 0) {
        alert("Please add at least one stop destination.");
        return;
    }

    let combinedPath = [];
    let currentNodeId = itineraryStartNodeId;

    for (let i = 0; i < stops.length; i++) {
        let endDoor = doors.find(d => d.name.toLowerCase() === stops[i].toLowerCase());
        if (!endDoor) {
            alert(`Could not find coordinates for Stop ${i + 1}: ${stops[i]}`);
            return;
        }
        let endNodeId = getNearestNode([endDoor.lon, endDoor.lat]);
        let path = dijkstra(currentNodeId, endNodeId);
        
        if (!path || path.length < 2 || path[0] != currentNodeId) {
            alert(`No walking route could be found to: ${stops[i]}`);
            return;
        }

        if (combinedPath.length === 0) {
            combinedPath = path;
        } else {
            combinedPath = combinedPath.concat(path.slice(1));
        }
        currentNodeId = endNodeId;
    }

    drawRoute(combinedPath);

    let distance = calculatePathDistance(combinedPath);
    let walkingTimeMin = Math.round(distance / 80);
    let timeStr = walkingTimeMin < 1 ? "less than a minute" : `~${walkingTimeMin} min`;

    // Draw End Marker
    let lastStop = stops[stops.length - 1];
    let endDoor = doors.find(d => d.name.toLowerCase() === lastStop.toLowerCase());
    if (activeEndMarker) map.removeLayer(activeEndMarker);
    if (endDoor) {
        activeEndMarker = L.circleMarker([endDoor.lat, endDoor.lon], {
            radius: 8,
            color: "red",
            fillColor: "red",
            fillOpacity: 1
        }).addTo(map);
    }

    // Populate summary in place info card
    infoName.textContent = "🗺️ Campus Visit Itinerary";
    infoCategory.textContent = "ITINERARY";
    infoDesc.textContent = "Route sequence: " + itineraryStartName + " → " + stops.join(" → ");

    navDistance.textContent = `~${distance} meters`;
    navTime.textContent = timeStr;
    navigationDetails.classList.remove("hidden");
    
    // Hide details actions for custom multi-stop
    const actions = document.querySelector(".info-card-actions");
    if (actions) actions.style.display = "none";
    
    placeInfoCard.classList.remove("hidden");

    speakResponse(`Itinerary generated. Total distance is ${distance} meters. Estimated walking time is ${walkingTimeMin} minutes.`);
}

function clearActiveRoute() {
    isLiveStartActive = false;
    startInput.value = "";
    destInput.value = "";
    startLocationNodeId = null;
    startLocationName = null;
    destinationItem = null;
    destinationDoorName = null;
    
    // Clear itinerary variables
    itineraryStartInput.value = "";
    itineraryStartNodeId = null;
    itineraryStartName = null;
    selectedWaypoints = [];
    waypointList.innerHTML = "";
    
    if (routeLine) map.removeLayer(routeLine);
    if (activeStartMarker) map.removeLayer(activeStartMarker);
    if (activeEndMarker) map.removeLayer(activeEndMarker);
    if (highlightMarker) map.removeLayer(highlightMarker);
    
    routeLine = null;
    activeStartMarker = null;
    activeEndMarker = null;
    highlightMarker = null;
    
    activeNavPath = [];
    activeDirections = [];
    currentPathIndex = 0;
    document.getElementById("nav-banner").classList.add("hidden");
    placeInfoCard.classList.add("hidden");
}