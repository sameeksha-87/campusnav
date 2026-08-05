const CACHE_NAME = "campusnav-cache-v1";

const PRECACHE_ASSETS = [
    "./",
    "./index.html",
    "./style.css",
    "./js/app.js",
    "./manifest.json",
    "./data.json",
    "./dataset.json",
    "./nodes.json",
    "./edges.json",
    "./weights.json",
    "./doors.json",
    "./roads.geojson",
    "./footpaths.geojson",
    "./buildings.geojson",
    "./map.geojson",
    "./campusfacilities.json",
    "./academics_with_faqs.json",
    "./images/icon-72x72.png",
    "./images/icon-96x96.png",
    "./images/icon-128x128.png",
    "./images/icon-144x144.png",
    "./images/icon-152x152.png",
    "./images/icon-192x192.png",
    "./images/icon-384x384.png",
    "./images/icon-512x512.png"
];

// External library assets to precache
const EXTERNAL_ASSETS = [
    "https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap",
    "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css",
    "https://unpkg.com/leaflet/dist/leaflet.css",
    "https://unpkg.com/leaflet/dist/leaflet.js",
    "https://cdn.jsdelivr.net/npm/fuse.js@7.0.0/dist/fuse.min.js"
];

const ALL_PRECACHE_ASSETS = [...PRECACHE_ASSETS, ...EXTERNAL_ASSETS];

// Install Service Worker
self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log("[Service Worker] Pre-caching static assets");
            return cache.addAll(ALL_PRECACHE_ASSETS);
        }).then(() => self.skipWaiting())
    );
});

// Activate Service Worker
self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME) {
                        console.log("[Service Worker] Removing old cache:", cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

// Intercept fetch requests
self.addEventListener("fetch", (event) => {
    // Only handle GET requests
    if (event.request.method !== "GET") return;

    const url = new URL(event.request.url);

    // Check if the request is for a map tile
    const isMapTile = url.hostname.includes("basemaps.cartocdn.com") || url.pathname.includes("/tile/");

    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
            if (cachedResponse) {
                // If it is in cache, return it (Cache First)
                // For critical local assets, let's fetch in background (Stale While Revalidate) to stay fresh
                if (!isMapTile && url.origin === self.location.origin) {
                    fetch(event.request).then((networkResponse) => {
                        if (networkResponse.status === 200) {
                            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, networkResponse));
                        }
                    }).catch(() => {/* Ignore network update errors offline */});
                }
                return cachedResponse;
            }

            // Fallback to network
            return fetch(event.request).then((networkResponse) => {
                // Cache the newly fetched asset
                if (networkResponse && networkResponse.status === 200) {
                    const responseCopy = networkResponse.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, responseCopy);
                    });
                }
                return networkResponse;
            }).catch((err) => {
                console.error("[Service Worker] Fetch failed:", err);
                
                // If offline and request is an HTML page, return a friendly offline message (or layout)
                if (event.request.headers.get("accept").includes("text/html")) {
                    return new Response(
                        "<h1>CampusNav Offline Mode</h1><p>This resource is unavailable offline. Please check your connection.</p>",
                        {
                            headers: { "Content-Type": "text/html" }
                        }
                    );
                }
                
                // Otherwise return error
                throw err;
            });
        })
    );
});
