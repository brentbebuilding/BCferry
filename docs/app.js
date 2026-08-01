// State management
let allRoutes = [];
let filteredRoutes = [];

// DOM elements
const routesContainer = document.getElementById('routesContainer');
const loadingIndicator = document.getElementById('loadingIndicator');
const errorMessage = document.getElementById('errorMessage');
const lastUpdated = document.getElementById('lastUpdated');
const dayFilter = document.getElementById('dayFilter');
const routeFilter = document.getElementById('routeFilter');
const refreshBtn = document.getElementById('refreshBtn');

// BC Ferries API endpoints - calling directly from browser (v2)
// capacity has fill %, noncapacity has the full route list. We merge both.
const BC_FERRIES_API_CAPACITY = 'https://bcferriesapi.ca/v2/capacity/';
const BC_FERRIES_API_NONCAPACITY = 'https://bcferriesapi.ca/v2/noncapacity/';

// Terminal name mapping
const terminalNames = {
    'TSA': 'Tsawwassen',
    'SWB': 'Swartz Bay',
    'SGI': 'Southern Gulf Islands',
    'DUK': 'Duke Point',
    'FUL': 'Fulford Harbour',
    'HSB': 'Horseshoe Bay',
    'NAN': 'Nanaimo (Departure Bay)',
    'LNG': 'Langdale',
    'BOW': 'Bowen Island',
    'SNY': 'Snug Cove',
    'HBR': 'Horseshoe Bay',
    'VBL': 'Village Bay',
    'OBY': 'Otter Bay',
    'BEL': 'Bellingham',
    'STN': 'Sturdies Bay'
};

// Get terminal display name
function getTerminalName(code) {
    return terminalNames[code] || code;
}

// Tag each sailing as 'today' or 'tomorrow'.
// The API returns sailings in chronological order, so the schedule rolls over to
// tomorrow at the point where the clock time stops increasing.
function annotateSailingDays(sailings) {
    let day = 'today';
    let previousMinutes = null;

    return sailings.map(sailing => {
        const minutes = parseTimeToMinutes(sailing.time);
        const hasDatePrefix = sailing.vesselName && sailing.vesselName.trim().startsWith('(');

        if (hasDatePrefix) {
            day = 'tomorrow';
        } else if (previousMinutes !== null && minutes !== null && minutes < previousMinutes) {
            day = 'tomorrow';
        }

        if (minutes !== null) previousMinutes = minutes;
        return { ...sailing, day };
    });
}

// Current wall-clock time in BC, in minutes since midnight. Sailing times in the
// API are always local BC time, so this has to match regardless of the viewer's
// own timezone.
function pacificNowMinutes() {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Vancouver',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    }).formatToParts(new Date());

    const hour = parseInt(parts.find(p => p.type === 'hour').value) % 24;
    const minute = parseInt(parts.find(p => p.type === 'minute').value);
    return hour * 60 + minute;
}

// A sailing counts as departed once its scheduled time is more than this many
// minutes behind now - a short grace period so a boat still boarding doesn't
// disappear the instant the clock ticks past its departure time.
const DEPARTED_GRACE_MINUTES = 20;

// Filter sailings by the selected day. Departed sailings are dropped everywhere -
// this is a live tracker, not a log of what already left. Departure is computed
// from the scheduled time rather than the API's sailingStatus field, which can be
// stale or missing on sailings that came from the capacity feed.
function filterSailingsByStatus(sailings, dayFilter) {
    const nowMinutes = pacificNowMinutes();

    const timed = annotateSailingDays(sailings.filter(s => s.time))
        .filter(sailing => {
            if (sailing.day !== 'today') return true;
            const minutes = parseTimeToMinutes(sailing.time);
            if (minutes === null) return true;
            return nowMinutes - minutes < DEPARTED_GRACE_MINUTES;
        });

    if (dayFilter === 'all') return timed;
    return timed.filter(s => s.day === dayFilter);
}

// Get capacity level
function getCapacityLevel(percent) {
    const capacity = parseInt(percent);
    if (capacity >= 50) return 'high';
    if (capacity >= 25) return 'medium';
    return 'low';
}

// Get capacity text
function getCapacityText(percent) {
    const capacity = parseInt(percent);
    if (capacity >= 75) return 'Good Availability';
    if (capacity >= 50) return 'Moderate Availability';
    if (capacity >= 25) return 'Limited Availability';
    if (capacity >= 10) return 'Low Availability';
    return 'Very Limited';
}

// Helper function to parse time string to minutes since midnight
function parseTimeToMinutes(timeStr) {
    if (!timeStr) return null;
    const match = timeStr.match(/(\d+):(\d+)\s*(am|pm)/i);
    if (!match) return null;
    let hours = parseInt(match[1]);
    const minutes = parseInt(match[2]);
    const isPM = match[3].toLowerCase() === 'pm';
    if (isPM && hours !== 12) hours += 12;
    if (!isPM && hours === 12) hours = 0;
    return hours * 60 + minutes;
}

// Strip date prefixes like "(Oct 24, 2025) " and delay notes from a vessel name
function normalizeVesselName(name) {
    if (!name) return '';
    return name.replace(/\([^)]*\)/g, '').replace(/delayed.*$/i, '').trim().toLowerCase();
}

// Merge sailings from the capacity and noncapacity feeds.
// The noncapacity feed is the complete schedule, so it defines the ordering; capacity
// data is layered onto it. Never re-sort by clock time: the list spans past midnight
// into tomorrow, so ordering by time-of-day would interleave the two days.
function mergeSailings(capacitySailings, nonCapacitySailings) {
    const base = (nonCapacitySailings || []).map(s => ({ ...s, fill: s.fill || 0 }));
    const capacity = capacitySailings || [];

    if (base.length === 0) return capacity.map(s => ({ ...s }));
    if (capacity.length === 0) return base;

    const claimed = new Set();
    const unmatched = [];

    capacity.forEach(cap => {
        const capTime = parseTimeToMinutes(cap.time);
        const capVessel = normalizeVesselName(cap.vesselName);

        const matchIndex = base.findIndex((sailing, index) => {
            if (claimed.has(index)) return false;
            const time = parseTimeToMinutes(sailing.time);
            if (capTime === null || time === null) return false;
            if (Math.abs(time - capTime) > 2) return false;

            const vessel = normalizeVesselName(sailing.vesselName);
            return !capVessel || !vessel || capVessel === vessel;
        });

        if (matchIndex === -1) {
            unmatched.push({ ...cap });
            return;
        }

        claimed.add(matchIndex);
        base[matchIndex] = { ...base[matchIndex], ...cap, fill: cap.fill || base[matchIndex].fill };
    });

    return base.concat(unmatched);
}

// Merge routes from both APIs
function mergeRoutes(capacityRoutes, nonCapacityRoutes) {
    const routeMap = new Map();

    // Add capacity routes
    if (capacityRoutes) {
        capacityRoutes.forEach(route => {
            const key = `${route.fromTerminalCode}-${route.toTerminalCode}`;
            routeMap.set(key, route);
        });
    }

    // Merge or add noncapacity routes
    if (nonCapacityRoutes) {
        nonCapacityRoutes.forEach(route => {
            const key = `${route.fromTerminalCode}-${route.toTerminalCode}`;
            if (routeMap.has(key)) {
                // Merge sailings
                const existingRoute = routeMap.get(key);
                existingRoute.sailings = mergeSailings(existingRoute.sailings, route.sailings);
            } else {
                // New route, add it (sailings won't have capacity data)
                routeMap.set(key, {
                    ...route,
                    sailings: route.sailings.map(s => ({ ...s, fill: 0 }))
                });
            }
        });
    }

    return Array.from(routeMap.values());
}

// Fetch ferry data - BOTH endpoints (capacity + noncapacity merged)
async function fetchFerryData() {
    try {
        showLoading();
        hideError();

        // Fetch both endpoints in parallel
        const [capacityResponse, noncapacityResponse] = await Promise.all([
            fetch(BC_FERRIES_API_CAPACITY),
            fetch(BC_FERRIES_API_NONCAPACITY)
        ]);

        if (!capacityResponse.ok || !noncapacityResponse.ok) {
            throw new Error(`HTTP error! capacity: ${capacityResponse.status}, noncapacity: ${noncapacityResponse.status}`);
        }

        const capacityData = await capacityResponse.json();
        const noncapacityData = await noncapacityResponse.json();

        // Merge the two datasets - capacity data takes priority, noncapacity fills in gaps
        allRoutes = mergeRoutes(capacityData.routes, noncapacityData.routes);

        updateRouteFilter();
        filterAndDisplayRoutes();
        updateLastUpdated();

    } catch (error) {
        showError(`Failed to fetch ferry data: ${error.message}`);
        console.error('Error fetching ferry data:', error);
    } finally {
        hideLoading();
    }
}

// The main sailings - everything else (Gulf Islands, Bellingham, etc.) is noise
// for most users and is excluded from both the dropdown and the "All Routes" view.
const MAJOR_ROUTES = [
    'TSA-SWB', 'SWB-TSA', // Tsawwassen ↔ Swartz Bay
    'TSA-DUK', 'DUK-TSA', // Tsawwassen ↔ Duke Point
    'HSB-NAN', 'NAN-HSB', // Horseshoe Bay ↔ Nanaimo
    'HSB-LNG', 'LNG-HSB', // Horseshoe Bay ↔ Langdale
    'HSB-BOW', 'BOW-HSB'  // Horseshoe Bay ↔ Bowen Island
];

// Update route filter dropdown
function updateRouteFilter() {
    const currentValue = routeFilter.value;

    // Clear existing options
    routeFilter.innerHTML = '<option value="all">All Routes</option>';

    // Add route options - clean labels
    allRoutes.forEach(route => {
        const routeCode = `${route.fromTerminalCode}-${route.toTerminalCode}`;

        if (MAJOR_ROUTES.includes(routeCode)) {
            const fromName = getTerminalName(route.fromTerminalCode);
            const toName = getTerminalName(route.toTerminalCode);
            const option = document.createElement('option');
            option.value = routeCode;
            option.textContent = `${fromName} → ${toName}`;
            routeFilter.appendChild(option);
        }
    });

    // Restore previous selection if it still exists
    if (currentValue !== 'all') {
        const optionExists = Array.from(routeFilter.options).some(opt => opt.value === currentValue);
        if (optionExists) {
            routeFilter.value = currentValue;
        }
    }
}

// Filter and display routes
function filterAndDisplayRoutes() {
    const selectedRoute = routeFilter.value;

    if (selectedRoute === 'all') {
        filteredRoutes = allRoutes.filter(route =>
            MAJOR_ROUTES.includes(`${route.fromTerminalCode}-${route.toTerminalCode}`)
        );
    } else {
        const [from, to] = selectedRoute.split('-');
        filteredRoutes = allRoutes.filter(route =>
            route.fromTerminalCode === from && route.toTerminalCode === to
        );
    }

    displayRoutes();
}

// Display routes
function displayRoutes() {
    if (filteredRoutes.length === 0) {
        routesContainer.innerHTML = '<div class="no-sailings">No ferry data available at this time.</div>';
        return;
    }

    // Filter out routes with no sailings after applying day filter
    const selectedDay = dayFilter.value;

    const routesWithSailings = filteredRoutes.filter(route => {
        const filteredSailings = route.sailings && route.sailings.length > 0
            ? filterSailingsByStatus(route.sailings, selectedDay)
            : [];
        return filteredSailings.length > 0;
    });

    // If no routes have sailings, show a message
    if (routesWithSailings.length === 0) {
        routesContainer.innerHTML = '<div class="no-sailings">No sailings scheduled for the selected time period.</div>';
        return;
    }

    routesContainer.innerHTML = routesWithSailings.map(route => createRouteCard(route)).join('');
}

// Create route card HTML
function createRouteCard(route) {
    const fromName = getTerminalName(route.fromTerminalCode);
    const toName = getTerminalName(route.toTerminalCode);

    // Filter sailings by selected day filter
    const selectedDay = dayFilter.value;
    const filteredSailings = route.sailings && route.sailings.length > 0
        ? filterSailingsByStatus(route.sailings, selectedDay)
        : [];

    const sailingsHTML = filteredSailings.length > 0
        ? filteredSailings.map(sailing => createSailingCard(sailing)).join('')
        : '<div class="no-sailings">No sailings scheduled</div>';

    return `
        <div class="route-card">
            <div class="route-header">
                <div>
                    <div class="route-title">${fromName} → ${toName}</div>
                    <div class="route-direction">${route.fromTerminalCode} to ${route.toTerminalCode}</div>
                </div>
            </div>
            <div class="sailings-grid">
                ${sailingsHTML}
            </div>
        </div>
    `;
}

// Create sailing card HTML - Normal display with capacity
function createSailingCard(sailing) {
    const time = sailing.time || 'N/A';
    const capacityPercent = sailing.fill || '0';
    const capacityLevel = getCapacityLevel(capacityPercent);
    const capacityText = getCapacityText(capacityPercent);

    // Clean vessel name
    let vesselName = sailing.vesselName || '';
    if (vesselName.includes('(')) {
        vesselName = vesselName.replace(/\([^)]+\)\s*/, '').trim();
    }

    // Determine status badge
    let statusBadge = '';
    if (sailing.sailingStatus === 'current') {
        statusBadge = '<span class="status-badge status-on-time">Departing Now</span>';
    } else if (sailing.sailingStatus === 'past') {
        statusBadge = '<span class="status-badge">Departed</span>';
    } else if (sailing.sailingStatus === 'future') {
        statusBadge = '<span class="status-badge status-on-time">Upcoming</span>';
    }

    return `
        <div class="sailing-card">
            <div class="sailing-time">${time}</div>
            <div class="sailing-info">
                ${statusBadge ? `
                <div class="info-row">
                    <span class="info-label">Status:</span>
                    ${statusBadge}
                </div>
                ` : ''}
                <div class="info-row">
                    <span class="info-label">Capacity:</span>
                    <span class="capacity-badge capacity-${capacityLevel}">${capacityPercent}%</span>
                </div>
                <div class="info-row">
                    <span class="info-label"></span>
                    <span style="font-size: 0.85rem; color: #666;">${capacityText}</span>
                </div>
                ${vesselName ? `
                <div class="info-row">
                    <span class="info-label">Vessel:</span>
                    <span>${vesselName}</span>
                </div>
                ` : ''}
            </div>
        </div>
    `;
}

// Show loading indicator
function showLoading() {
    loadingIndicator.style.display = 'block';
    routesContainer.style.display = 'none';
}

// Hide loading indicator
function hideLoading() {
    loadingIndicator.style.display = 'none';
    routesContainer.style.display = 'block';
}

// Show error message
function showError(message) {
    errorMessage.textContent = message;
    errorMessage.style.display = 'block';
}

// Hide error message
function hideError() {
    errorMessage.style.display = 'none';
}

// Update last updated timestamp
function updateLastUpdated() {
    const now = new Date();
    lastUpdated.textContent = `Last updated: ${now.toLocaleTimeString()}`;
}

// Event listeners
refreshBtn.addEventListener('click', fetchFerryData);
dayFilter.addEventListener('change', filterAndDisplayRoutes);
routeFilter.addEventListener('change', filterAndDisplayRoutes);

// Auto-refresh every 5 minutes
setInterval(fetchFerryData, 5 * 60 * 1000);

// Initial load
fetchFerryData();

// ============================================
// LIVE FERRY TRACKING
// ============================================

// View toggle elements
const scheduleViewBtn = document.getElementById('scheduleViewBtn');
const mapViewBtn = document.getElementById('mapViewBtn');
const scheduleControls = document.getElementById('scheduleControls');
const routesContainer2 = document.getElementById('routesContainer');
const mapContainer = document.getElementById('mapContainer');
const loadingIndicator2 = document.getElementById('loadingIndicator');

// Map instance
let map = null;
let vesselMarkers = {};
let destinationMarker = null; // Track the destination marker

// Terminal coordinates for destination markers
const TERMINAL_COORDS = {
    'Tsawwassen': { lat: 49.0074, lon: -123.1299 },
    'Swartz Bay': { lat: 48.6884, lon: -123.4113 },
    'Duke Point': { lat: 49.1631, lon: -123.8792 },
    'Departure Bay': { lat: 49.1947, lon: -123.9543 },
    'Horseshoe Bay': { lat: 49.3736, lon: -123.2719 },
    'Langdale': { lat: 49.4611, lon: -123.4803 },
    'Bowen Island': { lat: 49.3833, lon: -123.3333 }
};

// AISStream WebSocket
let aisSocket = null;

// Backend API URL - Connected to Render
const BACKEND_URL = 'https://bcferry.onrender.com';

// Update the on-screen tracking status (the user is usually on mobile, no console)
function setTrackingStatus(html) {
    const statusText = document.getElementById('statusText');
    if (statusText) statusText.innerHTML = html;
}

// Describe how many ferries are currently on the map
function describeTrackedVessels() {
    const names = Object.values(vesselMarkers).map(m => m.vesselName).filter(Boolean);
    if (names.length === 0) {
        return '✅ Connected<br><small>No ferries are broadcasting right now</small>';
    }
    return `✅ Tracking ${names.length} ferr${names.length === 1 ? 'y' : 'ies'}<br><small>${names.join(', ')}</small>`;
}

// Load current positions over HTTP. This also wakes the backend, which sleeps when
// idle on Render's free tier and can take up to a minute to boot.
async function loadVesselsOverHttp() {
    try {
        const response = await fetch(`${BACKEND_URL}/api/vessels`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const data = await response.json();
        (data.vessels || []).forEach(updateVesselPosition);
        setTrackingStatus(describeTrackedVessels());
        return true;
    } catch (err) {
        setTrackingStatus(`❌ Can't reach the ferry tracker<br><small>${err.message}</small>`);
        return false;
    }
}

// Guards against stacking connections while a cold start is still in flight
let connecting = false;

// Connect to backend WebSocket
async function connectToBackend() {
    const setupMessage = document.getElementById('mapSetupMessage');
    const mapElement = document.getElementById('map');
    const statusDiv = document.getElementById('connectionStatus');

    // Hide setup message and show map
    setupMessage.style.display = 'none';
    mapElement.style.display = 'block';
    statusDiv.style.display = 'block';

    if (connecting) return;

    if (aisSocket && aisSocket.readyState === WebSocket.OPEN) {
        setTrackingStatus(describeTrackedVessels());
        return;
    }

    connecting = true;
    setTrackingStatus('⏳ Waking the ferry tracker...<br><small>This can take up to a minute</small>');

    // Warm the backend and paint whatever it already knows before opening the socket.
    // Still try the socket if this fails - it may succeed where the fetch didn't.
    await loadVesselsOverHttp();
    connecting = false;

    // The user may have switched back to the schedule while the backend was waking
    if (mapContainer.style.display === 'none') return;

    const wsUrl = BACKEND_URL.replace(/^http/, 'ws') + '/ws';

    try {
        aisSocket = new WebSocket(wsUrl);
    } catch (err) {
        setTrackingStatus(`❌ Connection failed<br><small>${err.message}</small>`);
        scheduleReconnect();
        return;
    }

    aisSocket.onmessage = function(event) {
        try {
            const data = JSON.parse(event.data);

            if (data.type === 'initial') {
                (data.vessels || []).forEach(updateVesselPosition);
            } else if (data.type === 'update') {
                updateVesselPosition(data.vessel);
            }

            setTrackingStatus(describeTrackedVessels());
        } catch (err) {
            console.error('Error processing message from backend:', err);
        }
    };

    aisSocket.onerror = function() {
        setTrackingStatus('❌ Connection error<br><small>Retrying...</small>');
    };

    aisSocket.onclose = function() {
        aisSocket = null;
        setTrackingStatus('⚠️ Disconnected<br><small>Reconnecting...</small>');
        scheduleReconnect();
    };
}

function scheduleReconnect() {
    setTimeout(() => {
        if (mapContainer.style.display !== 'none') {
            connectToBackend();
        }
    }, 5000);
}

// Show a green dot at the terminal a vessel is heading for
function showDestinationMarker(destinationName) {
    if (destinationMarker) {
        map.removeLayer(destinationMarker);
        destinationMarker = null;
    }

    const terminalCoords = TERMINAL_COORDS[destinationName];
    if (!terminalCoords) return;

    const greenIcon = L.divIcon({
        className: 'destination-marker',
        html: '<div style="background-color: #00ff00; width: 20px; height: 20px; border-radius: 50%; border: 3px solid #fff; box-shadow: 0 0 10px rgba(0,255,0,0.8);"></div>',
        iconSize: [20, 20],
        iconAnchor: [10, 10]
    });

    destinationMarker = L.marker([terminalCoords.lat, terminalCoords.lon], { icon: greenIcon })
        .addTo(map)
        .bindPopup(`<strong>Destination:</strong> ${destinationName}`);
}

// Update vessel position on map - adapted for backend data format
function updateVesselPosition(vessel) {
    const mmsi = vessel.mmsi;
    const lat = vessel.latitude;
    const lon = vessel.longitude;

    if (!map || typeof lat !== 'number' || typeof lon !== 'number') return;

    const speed = vessel.speed || 0;
    const heading = vessel.heading || 0;
    const route = vessel.route || 'Unknown route';
    const eta = vessel.eta || 'Unknown';
    const destinationName = vessel.to || 'Unknown';

    // Create popup content with route and ETA
    const popupContent = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; min-width: 200px;">
            <div style="font-weight: bold; font-size: 1.1em; margin-bottom: 8px; color: #2d9b91;">
                ${vessel.name}
            </div>
            <div style="border-top: 1px solid #444; padding-top: 8px; margin-top: 8px;">
                <div style="margin-bottom: 6px;">
                    <span style="color: #888;">Route:</span><br>
                    <strong>${route}</strong>
                </div>
                <div style="margin-bottom: 6px;">
                    <span style="color: #888;">ETA:</span> <strong>${eta}</strong>
                </div>
                <div style="margin-bottom: 4px;">
                    <span style="color: #888;">Speed:</span> ${speed.toFixed(1)} knots
                </div>
                <div style="margin-bottom: 4px;">
                    <span style="color: #888;">Heading:</span> ${heading}°
                </div>
            </div>
        </div>
    `;

    if (vesselMarkers[mmsi]) {
        const marker = vesselMarkers[mmsi];
        marker.setLatLng([lat, lon]);
        marker.setPopupContent(popupContent);
        marker.vesselName = vessel.name;
        marker.destinationName = destinationName;
        return;
    }

    const ferryIcon = L.divIcon({
        className: 'ferry-marker',
        html: '🚢',
        iconSize: [30, 30],
        iconAnchor: [15, 15]
    });

    const marker = L.marker([lat, lon], { icon: ferryIcon })
        .addTo(map)
        .bindPopup(popupContent);

    marker.vesselName = vessel.name;
    marker.destinationName = destinationName;

    marker.on('click', function() {
        showDestinationMarker(this.destinationName);
    });

    vesselMarkers[mmsi] = marker;
}

// View toggle functionality
scheduleViewBtn.addEventListener('click', () => {
    scheduleViewBtn.classList.add('active');
    mapViewBtn.classList.remove('active');

    scheduleControls.style.display = 'flex';
    routesContainer2.style.display = 'flex';
    loadingIndicator2.style.display = routesContainer2.children.length === 0 ? 'block' : 'none';
    mapContainer.style.display = 'none';

    // Disconnect WebSocket when leaving map view
    if (aisSocket) {
        aisSocket.close();
        aisSocket = null;
    }

    // Remove destination marker
    if (destinationMarker) {
        map.removeLayer(destinationMarker);
        destinationMarker = null;
    }
});

mapViewBtn.addEventListener('click', () => {
    mapViewBtn.classList.add('active');
    scheduleViewBtn.classList.remove('active');

    scheduleControls.style.display = 'none';
    routesContainer2.style.display = 'none';
    loadingIndicator2.style.display = 'none';
    mapContainer.style.display = 'block';

    // Initialize map if not already done
    if (!map) {
        initializeMap();
    }

    // Connect to backend
    connectToBackend();
});

// Initialize Leaflet map
function initializeMap() {
    // Center on BC coastal waters
    map = L.map('map').setView([49.2827, -123.1207], 9);

    // Add dark mode tile layer
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 20
    }).addTo(map);
}

