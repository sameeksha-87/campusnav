// =========================
// MAP SETUP
// =========================
let map = L.map("map", { zoomControl: false }).setView([23.1765, 80.0211], 17);

L.control.zoom({ position: "bottomleft" }).addTo(map);

L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19
}).addTo(map);

// =========================
// LOAD GEOJSON LAYERS
// =========================
function loadLayer(file, color) {
    fetch(file)
        .then(res => res.json())
        .then(data => {
            L.geoJSON(data, {
                style: {
                    color: color,
                    weight: 2
                }
            }).addTo(map);
        })
        .catch(err => console.error(`Error loading ${file}:`, err));
}

loadLayer("roads.geojson", "blue");
loadLayer("footpaths.geojson", "green");
loadLayer("buildings.geojson", "brown");

// =========================
// GRAPH DATA
// =========================
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
    console.log("Graph loaded");
})
.catch(err => console.error("Error loading graph:", err));

// =========================
// DOORS DATA
// =========================
let doors = [];

fetch("doors.json")
    .then(r => r.json())
    .then(d => {
        doors = d;

        doors.forEach(door => {
            L.marker([door.lat, door.lon])
                .addTo(map)
                .bindTooltip(door.name, {
                    permanent: true,
                    direction: "top",
                    offset: [0, -10],
                    className: "door-label"
                });
        });
    });

// =========================
// HELPERS
// =========================
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

// =========================
// DIJKSTRA
// =========================
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

// =========================
// ROUTE DRAWING
// =========================
let routeLine = null;

function drawRoute(path) {

    let latlngs = path
        .map(id => getLatLngFromNodeId(id))
        .filter(Boolean);

    if (routeLine) {
        map.removeLayer(routeLine);
    }

    routeLine = L.polyline(latlngs, {
        color: "red",
        weight: 5
    }).addTo(map);
}

// =========================
// START/END
// =========================
let startNode = null;
let endNode = null;

let startMarker = null;
let endMarker = null;

// =========================
// LIVE GPS
// =========================
let userMarker = null;
let accuracyCircle = null;
let userLatLng = null;

function startLiveLocation() {

    if (!navigator.geolocation) {
        console.log("Geolocation not supported");
        return;
    }

    navigator.geolocation.watchPosition(

        function (pos) {

            let lat = pos.coords.latitude;
            let lon = pos.coords.longitude;
            let accuracy = pos.coords.accuracy;

            userLatLng = [lat, lon];

            // Create marker first time
            if (!userMarker) {

                // Blue dot
                userMarker = L.circleMarker([lat, lon], {
                    radius: 8,
                    color: "#136AEC",
                    fillColor: "#2A93EE",
                    fillOpacity: 1,
                    weight: 2
                }).addTo(map);

                // Accuracy circle
                accuracyCircle = L.circle([lat, lon], {
                    radius: accuracy,
                    color: "#136AEC",
                    fillColor: "#136AEC",
                    fillOpacity: 0.15,
                    weight: 1
                }).addTo(map);

            } 
            else {

                // Move marker
                userMarker.setLatLng([lat, lon]);

                // Update accuracy circle
                accuracyCircle.setLatLng([lat, lon]);
                accuracyCircle.setRadius(accuracy);
            }

            // Auto follow user (like Google Maps)
            map.setView([lat, lon], 19);

            // Live Navigation Route Update
            if (endNode && graphLoaded) {

                let liveStartNode =
                    getNearestNode([lon, lat]);

                let path = dijkstra(
                    liveStartNode,
                    endNode
                );

                drawRoute(path);
            }

        },

        function (err) {
            console.log("GPS error:", err);
        },

        {
            enableHighAccuracy: true,
            maximumAge: 0,
            timeout: 5000
        }
    );
}

// =========================
// MAP CLICK
// =========================
map.on("click", function (e) {

    if (!graphLoaded) {
        alert("Graph loading...");
        return;
    }

    let clickedCoord = [
        e.latlng.lng,
        e.latlng.lat
    ];

    let nearestNode =
        getNearestNode(clickedCoord);

    // START
    if (!startNode) {

        startNode = nearestNode;

        if (startMarker)
            map.removeLayer(startMarker);

        startMarker = L.circleMarker(
            e.latlng,
            {
                radius: 8,
                color: "green",
                fillColor: "green",
                fillOpacity: 1
            }
        ).addTo(map);

    }

    // END
    else if (!endNode) {

        endNode = nearestNode;

        if (endMarker)
            map.removeLayer(endMarker);

        endMarker = L.circleMarker(
            e.latlng,
            {
                radius: 8,
                color: "blue",
                fillColor: "blue",
                fillOpacity: 1
            }
        ).addTo(map);

        let path =
            dijkstra(startNode, endNode);

        drawRoute(path);

    }

    // RESET
    else {

        startNode = null;
        endNode = null;

        if (startMarker)
            map.removeLayer(startMarker);

        if (endMarker)
            map.removeLayer(endMarker);

        if (routeLine)
            map.removeLayer(routeLine);

    }

});

// =========================
// START LIVE GPS
// =========================
startLiveLocation();

// ==========================================================================
// RAG INTELLECTUAL CAMPUS ASSISTANT
// ==========================================================================
// Assistant Databases and Location mapping are loaded in the RAG block below.

// UI Elements references
const chatToggleBtn = document.getElementById("chat-toggle-btn");
const chatPanel = document.getElementById("chat-panel");
const chatCloseBtn = document.getElementById("chat-close-btn");
const chatMessages = document.getElementById("chat-messages");
const chatInput = document.getElementById("chat-input");
const chatSendBtn = document.getElementById("chat-send-btn");
const chatSuggestions = document.getElementById("chat-suggestions");
const settingsToggleBtn = document.getElementById("settings-toggle-btn");
const settingsModal = document.getElementById("settings-modal");
const modalCloseBtn = document.getElementById("modal-close-btn");
const apiKeyInput = document.getElementById("api-key-input");
const apiKeySaveBtn = document.getElementById("api-key-save-btn");
const apiKeyClearBtn = document.getElementById("api-key-clear-btn");
const apiStatusMsg = document.getElementById("api-status-msg");

// Toggle Chat Panel
chatToggleBtn.addEventListener("click", () => {
    chatPanel.classList.toggle("collapsed");
});

chatCloseBtn.addEventListener("click", () => {
    chatPanel.classList.add("collapsed");
});

// Toggle Settings Modal
settingsToggleBtn.addEventListener("click", () => {
    settingsModal.classList.remove("hidden");
    let savedKey = localStorage.getItem("gemini_api_key");
    if (savedKey) {
        apiKeyInput.value = savedKey;
        apiStatusMsg.textContent = "API Key is saved.";
        apiStatusMsg.className = "api-status-msg success";
    } else {
        apiKeyInput.value = "";
        apiStatusMsg.textContent = "No key configured. Running in local fallback mode.";
        apiStatusMsg.className = "api-status-msg error";
    }
});

modalCloseBtn.addEventListener("click", () => {
    settingsModal.classList.add("hidden");
});

// Save / Clear API Key
apiKeySaveBtn.addEventListener("click", () => {
    let key = apiKeyInput.value.trim();
    if (key) {
        localStorage.setItem("gemini_api_key", key);
        apiStatusMsg.textContent = "API Key saved successfully!";
        apiStatusMsg.className = "api-status-msg success";
        setTimeout(() => settingsModal.classList.add("hidden"), 1000);
    } else {
        apiStatusMsg.textContent = "Please enter a key before saving.";
        apiStatusMsg.className = "api-status-msg error";
    }
});

apiKeyClearBtn.addEventListener("click", () => {
    localStorage.removeItem("gemini_api_key");
    apiKeyInput.value = "";
    apiStatusMsg.textContent = "API Key cleared. Running in local fallback mode.";
    apiStatusMsg.className = "api-status-msg error";
});

// Suggestion Chip Clicks
document.querySelectorAll(".suggestion-chip").forEach(chip => {
    chip.addEventListener("click", () => {
        let query = chip.getAttribute("data-query");
        chatInput.value = query;
        handleUserMessage();
    });
});

// Send Message Handlers
chatSendBtn.addEventListener("click", handleUserMessage);
chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
        handleUserMessage();
    }
});

// Functions to create chat bubbles
function appendMessage(text, sender) {
    let msgDiv = document.createElement("div");
    msgDiv.className = `message ${sender}`;
    
    let contentDiv = document.createElement("div");
    contentDiv.className = "message-content";
    
    if (sender === "assistant" && window.marked) {
        contentDiv.innerHTML = window.marked.parse(text);
    } else {
        // Plain text with line breaks for user (or if marked is missing)
        contentDiv.textContent = text;
        contentDiv.innerHTML = contentDiv.innerHTML.replace(/\n/g, "<br>");
    }
    
    msgDiv.appendChild(contentDiv);
    chatMessages.appendChild(msgDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    return msgDiv;
}

// Typing Indicator Manager
let typingIndicator = null;
function showTypingIndicator() {
    if (typingIndicator) return;
    
    typingIndicator = document.createElement("div");
    typingIndicator.className = "message assistant typing-msg";
    
    let content = document.createElement("div");
    content.className = "message-content";
    
    let indicator = document.createElement("div");
    indicator.className = "typing-indicator";
    
    for (let i = 0; i < 3; i++) {
        let dot = document.createElement("div");
        dot.className = "typing-dot";
        indicator.appendChild(dot);
    }
    
    content.appendChild(indicator);
    typingIndicator.appendChild(content);
    chatMessages.appendChild(typingIndicator);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function removeTypingIndicator() {
    if (typingIndicator) {
        typingIndicator.remove();
        typingIndicator = null;
    }
}

// Client-side local RAG search
let academicsData = [];
let facilitiesData = [];

// Load Assistant Databases
Promise.all([
    fetch("academics_with_faqs.json").then(r => r.json()),
    fetch("campusfacilities.json").then(r => r.json())
])
.then(([academics, facilities]) => {
    academicsData = academics.academic_administrative || [];
    facilitiesData = facilities || [];
    
    // Add Xerox Shop entry dynamically
    if (!facilitiesData.some(f => f.id === "xerox_shop")) {
        facilitiesData.push({
            "id": "xerox_shop",
            "name": "Xerox Shop",
            "aliases": [
                "xerox",
                "zerox",
                "photocopy shop",
                "photocopy",
                "printing shop",
                "print shop",
                "stationery shop"
            ],
            "category": "facility",
            "description": "Campus photocopy and printing facility.",
            "location": "Beside LHTC",
            "location_description": "Located near the Academic Area, beside LHTC.",
            "services": [
                "photocopying",
                "printing",
                "scanning"
            ],
            "keywords": [
                "xerox",
                "print",
                "photocopy",
                "documents",
                "stationery"
            ],
            "operating_hours": {
                "daily": { "open": "9:00 AM", "close": "8:00 PM" }
            },
            "faqs": [
                "Q: Where is the Xerox Shop? A: It is located near the Academic Area, beside LHTC.",
                "Q: What services are available at the Xerox Shop? A: Photocopying, printing, and scanning."
            ]
        });
    }
    
    console.log("Assistant databases loaded. Academic records:", academicsData.length, "Facility records:", facilitiesData.length);
})
.catch(err => console.error("Error loading assistant databases:", err));

// Location Keyword-to-Door mapping for routing
const LOCATION_MAPPINGS = {
    "library": "Library",
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

// Conversational routing states
let pendingSource = null;
let pendingDestination = null;

// Stop Words for filtering
const STOP_WORDS = new Set([
    "where", "what", "which", "who", "whom", "how", "why", "when", 
    "located", "situated", "is", "are", "was", "were", "do", "does", "did",
    "can", "could", "would", "should", "will", "shall", "the", "a", "an", "and", "or",
    "of", "to", "from", "in", "on", "at", "by", "for", "with", "about", "here", "there",
    "please", "tell", "me", "show", "find", "get", "give", "us", "info", "information"
]);

// 1. Query Normalization
function normalizeQuery(query) {
    if (!query) return "";
    let clean = query.toLowerCase();
    clean = clean.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g, " ");
    clean = clean.replace(/\s+/g, " ").trim();
    return clean;
}

// 2. Intent Detection
function detectIntent(query) {
    let clean = query.toLowerCase();
    let hasFrom = /\bfrom\b/i.test(clean);
    let hasTo = /\bto\b/i.test(clean);
    let isExplicitRoute = /\b(reach|go to|navigate|directions|way to|route|path|go from)\b/i.test(clean) || (hasFrom && hasTo);
    
    if (isExplicitRoute) {
        return "ROUTE";
    }
    
    let isLocation = /\b(where|location|located|situated|address|find)\b/i.test(clean);
    if (isLocation) {
        return "LOCATION_INFO";
    }
    
    let isAcademic = /\b(cse|ece|mech|department|academic office|placement|calendar|office|faculty|professor|professors|teachers|reside|residence|residency)\b/i.test(clean);
    if (isAcademic) {
        return "ACADEMIC_INFO";
    }
    
    let isFacility = /\b(timings|hours|services|menu|facilities|what is|tell me about|about|canteen|cafe|mess|xerox|photocopy|shop|library|sac|oat)\b/i.test(clean);
    if (isFacility) {
        return "FACILITY_INFO";
    }
    
    return "GENERAL";
}

// 3. Entity Extraction
function extractEntities(query) {
    let clean = query.toLowerCase();
    
    let fromToMatch = clean.match(/from\s+(.+?)\s+to\s+(.+)/);
    if (fromToMatch) {
        return {
            source: fromToMatch[1].trim(),
            destination: fromToMatch[2].trim()
        };
    }
    
    let reachFromMatch = clean.match(/reach\s+(.+?)\s+from\s+(.+)/);
    if (reachFromMatch) {
        return {
            source: reachFromMatch[2].trim(),
            destination: reachFromMatch[1].trim()
        };
    }
    
    let goToFromMatch = clean.match(/go\s+to\s+(.+?)\s+from\s+(.+)/);
    if (goToFromMatch) {
        return {
            source: goToFromMatch[2].trim(),
            destination: goToFromMatch[1].trim()
        };
    }
    
    let destinationOnly = clean.match(/(reach|go to|to|navigate to)\s+(.+)/);
    if (destinationOnly) {
        return {
            source: null,
            destination: destinationOnly[2].trim()
        };
    }
    
    let locations = findLocationsInQuery(query);
    if (locations.length >= 2) {
        let fromIndex = clean.indexOf("from");
        if (fromIndex !== -1 && fromIndex > locations[0].start && fromIndex < locations[1].start) {
            return {
                source: locations[1].name,
                destination: locations[0].name
            };
        }
        return {
            source: locations[0].name,
            destination: locations[1].name
        };
    } else if (locations.length === 1) {
        return {
            source: null,
            destination: locations[0].name
        };
    }
    
    return {
        source: null,
        destination: null
    };
}

// Levenshtein similarity
function levenshteinDistance(s1, s2) {
    let m = s1.length, n = s2.length;
    let dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            if (s1[i - 1] === s2[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1];
            } else {
                dp[i][j] = Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]) + 1;
            }
        }
    }
    return dp[m][n];
}

function stringSimilarity(s1, s2) {
    let dist = levenshteinDistance(s1.toLowerCase(), s2.toLowerCase());
    let maxLen = Math.max(s1.length, s2.length);
    if (maxLen === 0) return 1.0;
    return 1.0 - (dist / maxLen);
}

// 4. Resolve Location using name, alias, or fuzzy lookup
function resolveLocation(name) {
    if (!name) return null;
    let clean = normalizeQuery(name);
    if (!clean) return null;
    
    // Check exact or substring in mappings.
    // Sort keys longest-first so a specific phrase like "academic office"
    // always wins over a shorter, more generic substring like "office".
    let resolvedDoorName = null;
    let bestKeyLength = 0;
    let exactMatch = false;
    
    Object.keys(LOCATION_MAPPINGS)
        .sort((a, b) => b.length - a.length)
        .forEach(key => {
            if (exactMatch) return;
            if (key === clean) {
                resolvedDoorName = LOCATION_MAPPINGS[key];
                bestKeyLength = key.length;
                exactMatch = true;
            } else if (clean.includes(key) && key.length > bestKeyLength) {
                resolvedDoorName = LOCATION_MAPPINGS[key];
                bestKeyLength = key.length;
            }
        });
    
    if (resolvedDoorName) {
        let door = doors.find(d => d.name.toLowerCase() === resolvedDoorName.toLowerCase());
        if (door) return { type: "door", name: door.name, lat: door.lat, lon: door.lon };
    }
    
    // Fuzzy match door name, aliases, or database entries
    let bestMatch = null;
    let highestSim = 0;
    
    doors.forEach(door => {
        let sim = stringSimilarity(clean, door.name);
        if (sim > highestSim) {
            highestSim = sim;
            bestMatch = { type: "door", name: door.name, lat: door.lat, lon: door.lon };
        }
    });
    
    Object.keys(LOCATION_MAPPINGS).forEach(key => {
        let sim = stringSimilarity(clean, key);
        if (sim > highestSim) {
            highestSim = sim;
            let door = doors.find(d => d.name.toLowerCase() === LOCATION_MAPPINGS[key].toLowerCase());
            if (door) {
                bestMatch = { type: "door", name: door.name, lat: door.lat, lon: door.lon };
            }
        }
    });
    
    academicsData.forEach(item => {
        let sim = stringSimilarity(clean, item.name);
        if (sim > highestSim) {
            highestSim = sim;
            let door = doors.find(d => d.name.toLowerCase() === item.name.toLowerCase() || 
                (item.aliases || []).some(a => d.name.toLowerCase() === a.toLowerCase()));
            bestMatch = { 
                type: "academic", 
                name: item.name, 
                item: item, 
                lat: door ? door.lat : null, 
                lon: door ? door.lon : null 
            };
        }
        (item.aliases || []).forEach(alias => {
            let sim = stringSimilarity(clean, alias);
            if (sim > highestSim) {
                highestSim = sim;
                let door = doors.find(d => d.name.toLowerCase() === item.name.toLowerCase() || 
                    (item.aliases || []).some(a => d.name.toLowerCase() === a.toLowerCase()));
                bestMatch = { 
                    type: "academic", 
                    name: item.name, 
                    item: item, 
                    lat: door ? door.lat : null, 
                    lon: door ? door.lon : null 
                };
            }
        });
    });
    
    facilitiesData.forEach(item => {
        let sim = stringSimilarity(clean, item.name);
        if (sim > highestSim) {
            highestSim = sim;
            let door = doors.find(d => d.name.toLowerCase() === item.name.toLowerCase() || 
                (item.aliases || []).some(a => d.name.toLowerCase() === a.toLowerCase()));
            bestMatch = { 
                type: "facility", 
                name: item.name, 
                item: item, 
                lat: door ? door.lat : null, 
                lon: door ? door.lon : null 
            };
        }
        (item.aliases || []).forEach(alias => {
            let sim = stringSimilarity(clean, alias);
            if (sim > highestSim) {
                highestSim = sim;
                let door = doors.find(d => d.name.toLowerCase() === item.name.toLowerCase() || 
                    (item.aliases || []).some(a => d.name.toLowerCase() === a.toLowerCase()));
                bestMatch = { 
                    type: "facility", 
                    name: item.name, 
                    item: item, 
                    lat: door ? door.lat : null, 
                    lon: door ? door.lon : null 
                };
            }
        });
    });
    
    if (highestSim >= 0.65) {
        return bestMatch;
    }
    
    return null;
}

// 5. Fuzzy Search Helper
function fuzzySearch(query, docs) {
    let cleanQuery = normalizeQuery(query);
    let results = [];
    docs.forEach(doc => {
        let sim = stringSimilarity(cleanQuery, doc.name);
        doc.aliases.forEach(alias => {
            let aSim = stringSimilarity(cleanQuery, alias);
            if (aSim > sim) sim = aSim;
        });
        if (sim > 0.5) {
            results.push({ doc, score: sim });
        }
    });
    results.sort((a, b) => b.score - a.score);
    return results;
}

// Semantic similarity score based on Jaccard overlap of content words
function semanticSimilarity(queryTokens, docText) {
    let docTokens = docText.toLowerCase().replace(/[^\w\s]/g, "").split(/\s+/).filter(t => t.length > 2 && !STOP_WORDS.has(t));
    let docSet = new Set(docTokens);
    let intersection = queryTokens.filter(t => docSet.has(t));
    let union = new Set([...queryTokens, ...docTokens]);
    if (union.size === 0) return 0;
    return intersection.length / union.size;
}

// Client-side local RAG search index
let RAGIndex = [];
function buildRAGIndex() {
    RAGIndex = [];
    
    academicsData.forEach(item => {
        let contentText = [
            item.name || "",
            item.type || "",
            item.location || "",
            item.details || "",
            item.extra_information || "",
            (item.nearby_landmarks || []).join(" ")
        ].join(" ").toLowerCase();
        
        let faqsText = "";
        if (item.faqs && Array.isArray(item.faqs)) {
            item.faqs.forEach(faq => {
                faqsText += " " + (faq.question || "") + " " + (faq.answer || "");
            });
        }
        contentText += faqsText.toLowerCase();
        
        RAGIndex.push({
            id: item.id,
            name: item.name,
            aliases: item.aliases || [],
            text: contentText,
            type: "academic",
            original: item
        });
    });
    
    facilitiesData.forEach(item => {
        let contentText = [
            item.name || "",
            item.category || "",
            item.location || "",
            item.description || "",
            item.location_description || "",
            (item.services || []).join(" "),
            (item.keywords || []).join(" "),
            (item.additional_information || []).join(" "),
            (item.nearby_landmarks || []).join(" ")
        ].join(" ").toLowerCase();
        
        let faqsText = "";
        if (item.faqs && Array.isArray(item.faqs)) {
            faqsText += " " + item.faqs.join(" ");
        }
        contentText += faqsText.toLowerCase();
        
        RAGIndex.push({
            id: item.id,
            name: item.name,
            aliases: item.aliases || [],
            text: contentText,
            type: "facility",
            original: item
        });
    });
    
    if (typeof doors !== "undefined" && Array.isArray(doors)) {
        doors.forEach(door => {
            let doorSearchText = door.name.toLowerCase();
            let aliases = [];
            
            if (door.name === "CM") aliases = ["computer complex", "computer complex building", "central mess", "mess"];
            else if (door.name === "HEX") aliases = ["hexagon", "food court", "hexagon food court"];
            else if (door.name === "LHTC") aliases = ["lecture hall", "tutorial complex", "classes", "academic block"];
            else if (door.name === "PHC") aliases = ["health center", "health centre", "primary health centre", "hospital", "clinic"];
            else if (door.name === "OAT") aliases = ["open air theatre", "open air theater", "auditorium"];
            else if (door.name === "SAC") aliases = ["student activity centre", "gym", "sports"];
            else if (door.name === "H1") aliases = ["hostel 1", "vasishta hostel", "vasishta"];
            else if (door.name === "H3") aliases = ["hostel 3", "hostel 3 building"];
            else if (door.name === "H4") aliases = ["hostel 4", "hostel 4 building"];
            else if (door.name === "Maa Saraswati") aliases = ["girls hostel", "msh", "saraswati hostel"];
            else if (door.name === "Nagarjuna Hostel") aliases = ["girls hostel 2", "nagarjuna"];
            else if (door.name === "Visitors Hostel") aliases = ["vh", "visitors' hostel", "guest house"];
            else if (door.name === "faculty residence") aliases = ["professors residence", "professors", "faculty", "teachers", "reside", "live"];
            else if (door.name === "narmada residency") aliases = ["narmada", "hostel narmada", "residency"];
            else if (door.name === "rewa residency") aliases = ["rewa", "hostel rewa", "residency"];
            else if (door.name === "panini hostel") aliases = ["panini"];
            
            RAGIndex.push({
                id: "DOOR_" + door.name.replace(/\s+/g, "_"),
                name: door.name,
                aliases: aliases,
                text: doorSearchText + " " + aliases.join(" ") + " map coordinate location door entry",
                type: "door",
                original: door
            });
        });
    }
    
    console.log("RAG Index built successfully. Total documents:", RAGIndex.length);
}

let indexBuildAttempts = 0;
function checkAndBuildIndex() {
    if (academicsData.length > 0 && facilitiesData.length > 0 && typeof doors !== "undefined" && doors.length > 0) {
        if (!doors.some(d => d.name === "Xerox Shop")) {
            doors.push({ "name": "Xerox Shop", "lat": 23.17688182618637, "lon": 80.024450 });
        }
        buildRAGIndex();
    } else {
        indexBuildAttempts++;
        if (indexBuildAttempts > 100) {
            console.error(
                "RAG index build aborted after 10s: one or more data files never loaded.",
                { academics: academicsData.length, facilities: facilitiesData.length, doors: doors.length }
            );
            return;
        }
        setTimeout(checkAndBuildIndex, 100);
    }
}
checkAndBuildIndex();

// 6. Retrieve Relevant Documents with Hybrid Scores
function retrieveDocuments(query) {
    if (RAGIndex.length === 0) return [];
    
    let normalized = normalizeQuery(query);
    let tokens = normalized.split(" ").filter(t => t.length > 2 && !STOP_WORDS.has(t));
    if (tokens.length === 0) {
        tokens = normalized.split(" ").filter(t => t.length > 0);
    }
    
    let candidates = [];
    let N = RAGIndex.length;
    
    RAGIndex.forEach(doc => {
        let score = 0;
        let isNameMatch = doc.name.toLowerCase() === normalized;
        let isAliasMatch = doc.aliases.some(alias => alias.toLowerCase() === normalized);
        
        // Exact matching
        if (isNameMatch) score += 100;
        else if (isAliasMatch) score += 80;
        
        // Fuzzy matching
        let nameSim = stringSimilarity(normalized, doc.name);
        let bestAliasSim = 0;
        doc.aliases.forEach(alias => {
            let sim = stringSimilarity(normalized, alias);
            if (sim > bestAliasSim) bestAliasSim = sim;
        });
        let fuzzyScore = Math.max(nameSim, bestAliasSim);
        if (fuzzyScore >= 0.7) {
            score += fuzzyScore * 60;
        }
        
        // Keyword/Service matching
        let matchCount = 0;
        let keywordsArray = doc.original.keywords || [];
        let servicesArray = doc.original.services || [];
        
        tokens.forEach(token => {
            let regex = new RegExp("\\b" + token + "\\b", "i");
            let inKeywords = keywordsArray.some(k => regex.test(k));
            let inServices = servicesArray.some(s => regex.test(s));
            if (inKeywords || inServices) {
                matchCount++;
            }
        });
        score += Math.min(matchCount * 20, 40);
        
        // Description/FAQ matching
        let hasDescMatch = false;
        let descText = (doc.original.description || doc.original.details || doc.original.location_description || doc.original.location || "").toLowerCase();
        tokens.forEach(token => {
            if (descText.includes(token)) hasDescMatch = true;
        });
        if (hasDescMatch) score += 10;
        
        // Semantic similarity
        let jaccard = semanticSimilarity(tokens, doc.text);
        score += jaccard * 50;
        
        if (score > 5.0) {
            candidates.push({ doc, score });
        }
    });
    
    return candidates;
}

// 7. Rank Documents
function rankDocuments(candidates) {
    candidates.sort((a, b) => b.score - a.score);
    return candidates.slice(0, 3).map(s => {
        return {
            item: s.doc.original,
            score: s.score,
            type: s.doc.type
        };
    });
}

// 8. Build Verified Context for prompt
function buildRAGContext(documents, routeInfo) {
    let contextText = documents.map(c => {
        if (c.type === "door") {
            return `Name: ${c.item.name}\nCoordinates: Latitude ${c.item.lat}, Longitude ${c.item.lon}\nDetails: Physical location marked on map.`;
        }
        
        let timingsStr = "";
        if (c.item.timings) {
            let open = c.item.timings.open;
            let close = c.item.timings.close;
            if (open && close) timingsStr = `${open} to ${close}`;
            else if (typeof c.item.timings === "string") timingsStr = c.item.timings;
        } else if (c.item.operating_hours) {
            let daily = c.item.operating_hours.daily;
            if (daily && daily.open && daily.close) timingsStr = `${daily.open} to ${daily.close}`;
        }
        
        return `Name: ${c.item.name}\nCategory: ${c.item.category || ""}\nDetails: ${c.item.description || c.item.details || ""}\nLocation: ${c.item.location_description || c.item.location || ""}\nTimings: ${timingsStr}\nServices: ${JSON.stringify(c.item.services || [])}\nKeywords: ${JSON.stringify(c.item.keywords || [])}\nFAQs: ${JSON.stringify(c.item.faqs || [])}`;
    }).join("\n---\n");
    
    return contextText;
}

// Haversine distance between two [lat, lon] points, in meters
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

// Sum the distance of a full node-id path returned by dijkstra()
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

// Resolve two door names to graph nodes, run Dijkstra, draw the route on
// the map (reusing the same state/drawing used by manual click-routing),
// and return route info for the chat response / Gemini context.
function triggerRoutingFromAssistant(startDoorName, endDoorName) {
    if (!graphLoaded) {
        return { success: false, msg: "Map graph is still loading. Please try again in a moment." };
    }

    let startDoor = doors.find(d => d.name === startDoorName);
    let endDoor = doors.find(d => d.name === endDoorName);

    if (!startDoor || !endDoor) {
        return { success: false, msg: `Could not locate "${startDoorName}" or "${endDoorName}" on the map.` };
    }

    if (startDoorName === endDoorName) {
        return { success: false, msg: "Source and destination are the same location." };
    }

    let startNodeId = getNearestNode([startDoor.lon, startDoor.lat]);
    let endNodeId = getNearestNode([endDoor.lon, endDoor.lat]);

    if (startNodeId == null || endNodeId == null) {
        return { success: false, msg: "Could not find nearby navigation nodes for those locations." };
    }

    let path = dijkstra(startNodeId, endNodeId);

    if (!path || path.length < 2 || path[0] != startNodeId) {
        return { success: false, msg: `No route could be found between ${startDoorName} and ${endDoorName}.` };
    }

    // Keep manual click-routing state in sync and draw it on the map
    startNode = startNodeId;
    endNode = endNodeId;
    drawRoute(path);

    return {
        success: true,
        start: startDoorName,
        end: endDoorName,
        distance: calculatePathDistance(path),
        path: path
    };
}

// 9. Handle Navigation Dijkstra Execution
function handleNavigation(source, destination) {
    let resolvedStart = resolveLocation(source);
    let resolvedEnd = resolveLocation(destination);
    
    if (!resolvedStart || !resolvedEnd) {
        return {
            success: false,
            msg: `Could not resolve starting point (${source}) or destination (${destination}).`
        };
    }
    
    return triggerRoutingFromAssistant(resolvedStart.name, resolvedEnd.name);
}

// Highlight Map Location Marker
let highlightMarker = null;
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

// 11. Generate Gemini AI Prompt Response
async function generateGeminiResponse(query, contextText, routeInfo) {
    let apiKey = localStorage.getItem("gemini_api_key");
    if (!apiKey) return null;
    
    let routeContext = "None";
    if (routeInfo && routeInfo.success) {
        routeContext = `Path calculated on the map from ${routeInfo.start} to ${routeInfo.end}. Distance is ~${routeInfo.distance} meters. Route rendered on map.`;
    }
    
    let systemPrompt = `You are the IIITDM Jabalpur Campus Assistant.
Answer ONLY using the CAMPUS CONTEXT provided.
Do not invent campus locations, landmarks, timings, services, facilities, departments, or routes.
If the requested information is unavailable in the CAMPUS CONTEXT, clearly state that the information is not available in the campus database.
For navigation questions, only use the provided ROUTE DATA.
Never estimate or generate routes yourself.
Keep responses concise, clear, helpful and student-friendly.`;

    let prompt = `${systemPrompt}

CAMPUS CONTEXT:
${contextText || "No context found."}

ROUTE DATA:
${routeContext}

USER QUERY:
${query}

Answer:`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
    
    try {
        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }]
            })
        });
        
        if (!response.ok) {
            let errData = await response.json().catch(() => ({}));
            throw new Error(errData.error?.message || `HTTP error ${response.status}`);
        }
        
        const data = await response.json();
        return data.candidates?.[0]?.content?.parts?.[0]?.text || "Sorry, I couldn't generate a response.";
    } catch (e) {
        console.error("Gemini API Error:", e);
        throw e;
    }
}

// Find locations matching doors.json keys
function findLocationsInQuery(query) {
    let lowerQuery = query.toLowerCase();
    let sortedKeys = Object.keys(LOCATION_MAPPINGS).sort((a, b) => b.length - a.length);
    let matches = [];
    
    sortedKeys.forEach(key => {
        let index = lowerQuery.indexOf(key);
        if (index !== -1) {
            let overlapping = matches.some(m => {
                return (index >= m.start && index < m.end) || (index + key.length > m.start && index + key.length <= m.end);
            });
            if (!overlapping) {
                matches.push({
                    name: LOCATION_MAPPINGS[key],
                    start: index,
                    end: index + key.length
                });
            }
        }
    });
    return matches.sort((a, b) => a.start - b.start);
}

// 10. Generate Local Mode Rule-based Response
function generateLocalResponse(query, matchedCandidates, routeInfo, mapHighlightInfo, intent) {
    let responseText = "";
    
    if (intent === "ROUTE") {
        if (routeInfo && routeInfo.success) {
            responseText += `🗺️ **${routeInfo.start} → ${routeInfo.end}**\n\n`;
            responseText += `📍 Approximate distance: **~${routeInfo.distance}** meters.\n\n`;
            responseText += `I've highlighted the shortest route on the map.`;
            return responseText;
        } else {
            return `I'm sorry, I couldn't compute a route for that query. Make sure you entered valid campus locations.`;
        }
    }
    
    if (intent === "LOCATION_INFO") {
        if (mapHighlightInfo && mapHighlightInfo.success) {
            responseText += `📍 **${mapHighlightInfo.name}**\n\n`;
            
            if (matchedCandidates && matchedCandidates.length > 0) {
                let doc = matchedCandidates[0].item;
                let locDesc = doc.location_description || doc.location;
                if (locDesc) {
                    responseText += `The ${mapHighlightInfo.name} is located: ${locDesc}.\n\n`;
                } else {
                    responseText += `This location is marked on the campus map.\n\n`;
                }
            } else {
                responseText += `This location is marked on the campus map.\n\n`;
            }
            
            responseText += `I can also help you find a route there if you tell me where you're starting from.`;
            return responseText;
        }
    }
    
    if (matchedCandidates && matchedCandidates.length > 0) {
        let primaryMatch = matchedCandidates[0];
        let item = primaryMatch.item;
        let lowerQuery = query.toLowerCase();
        
        if (primaryMatch.type === "door") {
            return responseText; 
        }
        
        let timingsStr = "";
        if (item.timings) {
            let open = item.timings.open;
            let close = item.timings.close;
            if (open && close) timingsStr = `${open} to ${close}`;
            else if (typeof item.timings === "string") timingsStr = item.timings;
        } else if (item.operating_hours) {
            let daily = item.operating_hours.daily;
            if (daily && daily.open && daily.close) timingsStr = `${daily.open} to ${daily.close}`;
        }
        
        let isTimingQuery = /(tim|hour|open|close|when)/i.test(lowerQuery);
        let isLocationQuery = /(where|locat|situat|address)/i.test(lowerQuery);
        let isServicesQuery = /(service|services|serve|menu|food|item|items|sell|available|eat|drink|photocopy|print)/i.test(lowerQuery);
        
        if (isTimingQuery && !isLocationQuery && !isServicesQuery) {
            if (timingsStr) {
                return `🕒 The timings for **${item.name}** are **${timingsStr}**.`;
            }
        }
        
        if (isLocationQuery && !isTimingQuery && !isServicesQuery) {
            let locDesc = item.location_description || item.location;
            if (locDesc) {
                let landmarkText = (item.nearby_landmarks && item.nearby_landmarks.length > 0) 
                    ? ` (near ${item.nearby_landmarks.join(", ")})` 
                    : "";
                return `📍 **${item.name}** is located: **${locDesc}**${landmarkText}.`;
            }
        }
        
        if (isServicesQuery && !isTimingQuery && !isLocationQuery) {
            if (item.services && item.services.length > 0) {
                return `🍽️ **${item.name}** serves/provides: ${item.services.join(", ")}.`;
            }
        }
        
        responseText += `### 🏢 Information: ${item.name}\n`;
        if (item.category) responseText += `* **Category**: ${item.category}\n`;
        let locDesc = item.location_description || item.location;
        if (locDesc) responseText += `* **Location**: ${locDesc}\n`;
        if (timingsStr) responseText += `* **Timings**: ${timingsStr}\n`;
        
        if (item.description) responseText += `\n**About**: ${item.description}\n`;
        else if (item.details) responseText += `\n**About**: ${item.details}\n`;
        
        if (item.services && Array.isArray(item.services)) {
            responseText += `\n**Services Available**:\n` + item.services.map(s => `- ${s}`).join("\n") + `\n`;
        }
        
        if (item.nearby_landmarks && item.nearby_landmarks.length > 0) {
            responseText += `\n**Nearby Landmarks**: ${item.nearby_landmarks.join(", ")}\n`;
        }
        
        if (item.additional_information && Array.isArray(item.additional_information)) {
            responseText += `\n**Additional Info**:\n` + item.additional_information.map(info => `- ${info}`).join("\n") + `\n`;
        }
        
        if (item.faqs && item.faqs.length > 0) {
            responseText += `\n**Frequently Asked Questions**:\n`;
            item.faqs.forEach(faq => {
                if (typeof faq === "string") {
                    responseText += `* ${faq}\n`;
                } else if (faq.question && faq.answer) {
                    responseText += `* **Q**: _${faq.question}_\n  **A**: ${faq.answer}\n`;
                }
            });
        }
    } else {
        responseText += `I couldn't find reliable information in the campus database for your query. Try asking about canteens (Amul, Nescafe), academic departments (CSE, ECE), offices, or routing.`;
    }
    
    return responseText;
}

// 12. Master Controller Handler for User Messages
async function handleUserMessage() {
    let query = chatInput.value.trim();
    if (!query) return;
    
    appendMessage(query, "user");
    chatInput.value = "";
    showTypingIndicator();
    
    let intent = detectIntent(query);
    let entities = extractEntities(query);
    
    let resolvedSource = resolveLocation(entities.source);
    let resolvedDest = resolveLocation(entities.destination);
    
    // Handle conversational routing state
    if (pendingDestination) {
        resolvedSource = resolveLocation(query);
        resolvedDest = resolveLocation(pendingDestination);
        intent = "ROUTE";
        pendingDestination = null;
    } else if (pendingSource) {
        resolvedDest = resolveLocation(query);
        resolvedSource = resolveLocation(pendingSource);
        intent = "ROUTE";
        pendingSource = null;
    }
    
    let routeInfo = null;
    if (intent === "ROUTE") {
        if (!resolvedSource && resolvedDest) {
            pendingDestination = resolvedDest.name;
            removeTypingIndicator();
            appendMessage("Sure! Where are you starting from?", "assistant");
            return;
        } else if (resolvedSource && !resolvedDest) {
            pendingSource = resolvedSource.name;
            removeTypingIndicator();
            appendMessage("Sure! Where would you like to go?", "assistant");
            return;
        } else if (!resolvedSource && !resolvedDest) {
            removeTypingIndicator();
            appendMessage("I can calculate a route for you. Where would you like to start from and where are you going?", "assistant");
            return;
        } else {
            routeInfo = handleNavigation(resolvedSource.name, resolvedDest.name);
        }
    }
    
    // Map Highlighting for LOCATION_INFO
    let mapHighlightInfo = null;
    if (intent === "LOCATION_INFO" && resolvedDest) {
        let highlighted = highlightMapLocation(resolvedDest.name);
        if (highlighted) {
            mapHighlightInfo = { success: true, name: resolvedDest.name };
        }
    }
    
    // Retrieve context documents
    let retrieveCandidates = retrieveDocuments(query);
    
    // Auto-highlight if first candidate is a door and we haven't highlighted anything yet
    if (intent !== "ROUTE" && !mapHighlightInfo && retrieveCandidates.length > 0) {
        let topCand = retrieveCandidates[0];
        if (topCand.doc.type === "door") {
            let highlighted = highlightMapLocation(topCand.doc.name);
            if (highlighted) {
                mapHighlightInfo = { success: true, name: topCand.doc.name };
            }
        }
    }
    
    // Confident filtering
    let matchedCandidates = rankDocuments(retrieveCandidates);
    if (matchedCandidates.length > 0 && matchedCandidates[0].score < 15.0) {
        matchedCandidates = [];
    }
    
    let contextText = buildRAGContext(matchedCandidates, routeInfo);
    
    let hasKey = !!localStorage.getItem("gemini_api_key");
    let responseText = "";
    
    if (hasKey) {
        try {
            let res = await generateGeminiResponse(query, contextText, routeInfo);
            responseText = res;
        } catch (err) {
            console.warn("Failing back to local search due to API error:", err);
            responseText = `*(API Error: Could not reach Gemini. Falling back to local database search)*\n\n`;
            responseText += generateLocalResponse(query, matchedCandidates, routeInfo, mapHighlightInfo, intent);
        }
    } else {
        responseText = generateLocalResponse(query, matchedCandidates, routeInfo, mapHighlightInfo, intent);
        responseText += `\n\n*(Running in Local Mode. Add a Gemini API key in settings for dynamic AI answers)*`;
    }
    
    removeTypingIndicator();
    appendMessage(responseText, "assistant");
}