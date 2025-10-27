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
// Using correct endpoints WITHOUT www subdomain
const BC_FERRIES_API_ROOT = 'https://bcferriesapi.ca/v2/';
const BC_FERRIES_API_CAPACITY = 'https://bcferriesapi.ca/v2/capacity/';
const BC_FERRIES_API_NONCAPACITY = 'https://bcferriesapi.ca/v2/noncapacity/';

// Using BOTH endpoints: capacity (has fill %) + noncapacity (has all routes)

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

// Format time
function formatTime(timeString) {
    if (!timeString) return 'N/A';
    const time = new Date(timeString);
    return time.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
    });
}

// Get status label for sailing - SHOW ALL DATA
function getStatusLabel(sailing) {
    const parts = [];

    // Show sailing status
    if (sailing.sailingStatus) {
        parts.push(`Status: ${sailing.sailingStatus}`);
    }

    // Show if vessel name has a date
    if (sailing.vesselName && sailing.vesselName.includes('202')) {
        const match = sailing.vesselName.match(/\(([^)]+)\)/);
        if (match) {
            parts.push(`DATE: ${match[1]}`);
        }
    }

    // Show any date field
    if (sailing.date) {
        parts.push(`date field: ${sailing.date}`);
    }

    // Show departure date if exists
    if (sailing.departureDate) {
        parts.push(`departureDate: ${sailing.departureDate}`);
    }

    return parts.join(' | ');
}

// Check if a sailing is today, tomorrow, or another day
function getSailingDay(timeString) {
    if (!timeString) return null;

    const sailingDate = new Date(timeString);
    const now = new Date();

    // Reset time parts to compare dates only
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const sailingDay = new Date(sailingDate.getFullYear(), sailingDate.getMonth(), sailingDate.getDate());

    if (sailingDay.getTime() === today.getTime()) {
        return 'today';
    } else if (sailingDay.getTime() === tomorrow.getTime()) {
        return 'tomorrow';
    } else {
        return 'other';
    }
}

// Check if a future sailing is tomorrow based on time comparison
function isTomorrowSailing(sailing, allSailings) {
    // If vesselName starts with a date like "(Oct 24, 2025)", it's definitely tomorrow
    if (sailing.vesselName && sailing.vesselName.trim().startsWith('(')) {
        console.log(`    ✅ Has date prefix in vesselName`);
        return true;
    }

    // If it's not a future sailing, it can't be tomorrow
    if (sailing.sailingStatus !== 'future') {
        console.log(`    ❌ Not future status (${sailing.sailingStatus})`);
        return false;
    }

    // Find the last current or most recent past sailing
    const lastSailing = [...allSailings]
        .reverse()
        .find(s => s.sailingStatus === 'current' || s.sailingStatus === 'past');

    if (!lastSailing || !lastSailing.time) {
        // No current/past sailing found - this means all sailings are future
        // If it's late at night, ALL future sailings are tomorrow
        console.log(`    ⚠️ No current/past sailing found - assuming all future are tomorrow`);
        return true; // CHANGED FROM FALSE TO TRUE
    }

    console.log(`    Comparing against last sailing: ${lastSailing.time} (${lastSailing.sailingStatus})`);

    // Convert times to comparable format (24-hour)
    const parseTime = (timeStr) => {
        if (!timeStr) return null;
        const match = timeStr.match(/(\d+):(\d+)\s*(am|pm)/i);
        if (!match) return null;
        let hours = parseInt(match[1]);
        const minutes = parseInt(match[2]);
        const isPM = match[3].toLowerCase() === 'pm';

        if (isPM && hours !== 12) hours += 12;
        if (!isPM && hours === 12) hours = 0;

        return hours * 60 + minutes; // Minutes since midnight
    };

    const currentTimeMinutes = parseTime(lastSailing.time);
    const sailingTimeMinutes = parseTime(sailing.time);

    console.log(`    Current time minutes: ${currentTimeMinutes}, Sailing time minutes: ${sailingTimeMinutes}`);

    if (currentTimeMinutes === null || sailingTimeMinutes === null) {
        console.log(`    ❌ Could not parse times`);
        return false;
    }

    // If the future sailing time is less than current time, it must be tomorrow
    // Example: current is 7:26 PM (1166 mins), sailing is 6:15 AM (375 mins)
    const isTomorrow = sailingTimeMinutes < currentTimeMinutes;
    console.log(`    ${sailingTimeMinutes} < ${currentTimeMinutes} = ${isTomorrow}`);
    return isTomorrow;
}

// Filter sailings by status (for day filter)
function filterSailingsByStatus(sailings, dayFilter) {
    if (dayFilter === 'all') {
        return sailings.filter(s => s.time);
    }

    if (dayFilter === 'today') {
        // Today's sailings: past, current, or future that are NOT tomorrow
        return sailings.filter(s => {
            if (!s.time) return false;
            if (s.sailingStatus === 'past' || s.sailingStatus === 'current') return true;
            return !isTomorrowSailing(s, sailings);
        });
    } else if (dayFilter === 'tomorrow') {
        // Tomorrow's sailings
        return sailings.filter(s => {
            if (!s.time) return false;
            return isTomorrowSailing(s, sailings);
        });
    }

    return sailings.filter(s => s.time);
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

// Merge sailings from capacity and noncapacity data
function mergeSailings(capacitySailings, nonCapacitySailings) {
    const merged = [];
    const sailingMap = new Map();

    // First, add all capacity sailings (they have fill data and sailingStatus)
    if (capacitySailings) {
        capacitySailings.forEach(sailing => {
            // Use just time as key since noncapacity doesn't have sailingStatus
            const key = sailing.time;
            sailingMap.set(key, sailing);
        });
    }

    // Then, add noncapacity sailings that aren't already in the map
    if (nonCapacitySailings) {
        nonCapacitySailings.forEach(sailing => {
            const key = sailing.time;
            if (!sailingMap.has(key)) {
                // Noncapacity sailings don't have fill or sailingStatus
                // Add defaults: fill=0, sailingStatus='future' (assume all future)
                sailingMap.set(key, {
                    ...sailing,
                    fill: 0,
                    sailingStatus: 'future' // Default to future for noncapacity
                });
            }
        });
    }

    // Convert map back to array and sort by time
    return Array.from(sailingMap.values()).sort((a, b) => {
        const parseTime = (timeStr) => {
            if (!timeStr) return 0;
            const match = timeStr.match(/(\d+):(\d+)\s*(am|pm)/i);
            if (!match) return 0;
            let hours = parseInt(match[1]);
            const minutes = parseInt(match[2]);
            const isPM = match[3].toLowerCase() === 'pm';
            if (isPM && hours !== 12) hours += 12;
            if (!isPM && hours === 12) hours = 0;
            return hours * 60 + minutes;
        };
        return parseTime(a.time) - parseTime(b.time);
    });
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

        console.log('Fetching from BOTH capacity and noncapacity endpoints...');

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

        console.log('Capacity routes:', capacityData.routes?.length || 0);
        console.log('Non-capacity routes:', noncapacityData.routes?.length || 0);

        // Merge the two datasets - capacity data takes priority, noncapacity fills in gaps
        allRoutes = mergeRoutes(capacityData.routes, noncapacityData.routes);

        console.log('Merged routes:', allRoutes.length);

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

// Update route filter dropdown
function updateRouteFilter() {
    const currentValue = routeFilter.value;

    // Clear existing options
    routeFilter.innerHTML = '<option value="all">All Routes</option>';

    // Major routes only - clean and simple
    const majorRoutes = [
        'TSA-SWB', 'SWB-TSA', // Tsawwassen ↔ Swartz Bay
        'TSA-DUK', 'DUK-TSA', // Tsawwassen ↔ Duke Point
        'HSB-NAN', 'NAN-HSB', // Horseshoe Bay ↔ Nanaimo
        'HSB-LNG', 'LNG-HSB', // Horseshoe Bay ↔ Langdale
        'HSB-BOW', 'BOW-HSB'  // Horseshoe Bay ↔ Bowen Island
    ];

    // Add route options - clean labels
    allRoutes.forEach(route => {
        const routeCode = `${route.fromTerminalCode}-${route.toTerminalCode}`;

        if (majorRoutes.includes(routeCode)) {
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
        filteredRoutes = allRoutes;
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

    // DEBUG: Log each route's sailings count
    filteredRoutes.forEach(route => {
        const selectedDay = dayFilter.value;
        const totalSailings = route.sailings?.length || 0;
        const filteredSailings = route.sailings ? filterSailingsByStatus(route.sailings, selectedDay).length : 0;
        console.log(`${route.fromTerminalCode}→${route.toTerminalCode}: ${totalSailings} total, ${filteredSailings} after ${selectedDay} filter`);
    });

    routesContainer.innerHTML = filteredRoutes.map(route => createRouteCard(route)).join('');
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

// AISStream WebSocket
let aisSocket = null;

// BC Ferries MMSI numbers (Maritime Mobile Service Identity)
const BC_FERRIES_VESSELS = {
    '316001268': 'Spirit of British Columbia',
    '316011408': 'Coastal Inspiration',
    '316011409': 'Coastal Celebration',
    '316011407': 'Coastal Renaissance',
    '316002980': 'Queen of Alberni',
    '316003008': 'Queen of Cowichan',
    '316003020': 'Queen of Oak Bay',
    '316003032': 'Queen of Coquitlam',
    '316001256': 'Spirit of Vancouver Island',
    '316011406': 'Coastal Renaissance',
    '316002992': 'Queen of Cumberland',
    '316011410': 'Coastal Inspiration',
    '316003044': 'Queen of Nanaimo',
    // Add more MMSI numbers as needed
};

// Your AISStream API key - GET FREE KEY AT: https://aisstream.io/
const AISSTREAM_API_KEY = '68340377beb0c1e2693b994286f9e2f8d8763af3';

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

    // Connect to AISStream
    connectToAISStream();
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

    console.log('Map initialized');
}

// Connect to AISStream WebSocket
function connectToAISStream() {
    const setupMessage = document.getElementById('mapSetupMessage');
    const mapElement = document.getElementById('map');

    if (AISSTREAM_API_KEY === 'YOUR_API_KEY_HERE') {
        console.log('AISStream API key not configured');
        setupMessage.style.display = 'block';
        mapElement.style.display = 'none';
        return;
    }

    // Hide setup message and show map
    setupMessage.style.display = 'none';
    mapElement.style.display = 'block';

    if (aisSocket && aisSocket.readyState === WebSocket.OPEN) {
        console.log('Already connected to AISStream');
        return;
    }

    console.log('Connecting to AISStream...');

    aisSocket = new WebSocket('wss://stream.aisstream.io/v0/stream');

    aisSocket.onopen = function() {
        console.log('Connected to AISStream');

        const subscription = {
            APIKey: AISSTREAM_API_KEY,
            BoundingBoxes: [
                [[47, -125], [55, -122]]  // BC coastal waters
            ],
            FiltersShipMMSI: Object.keys(BC_FERRIES_VESSELS),
            FilterMessageTypes: ['PositionReport']
        };

        aisSocket.send(JSON.stringify(subscription));
        console.log('Subscribed to BC Ferries vessels');
    };

    aisSocket.onmessage = function(event) {
        const data = JSON.parse(event.data);

        if (data.MessageType === 'PositionReport') {
            updateVesselPosition(data);
        }
    };

    aisSocket.onerror = function(error) {
        console.error('AISStream error:', error);
    };

    aisSocket.onclose = function() {
        console.log('Disconnected from AISStream');
    };
}

// Update vessel position on map
function updateVesselPosition(data) {
    const mmsi = data.MetaData.MMSI;
    const vesselName = BC_FERRIES_VESSELS[mmsi] || data.MetaData.ShipName || 'Unknown Vessel';
    const position = data.Message.PositionReport;

    const lat = position.Latitude;
    const lon = position.Longitude;
    const speed = position.Sog; // Speed over ground in knots
    const heading = position.TrueHeading;

    console.log(`${vesselName}: ${lat}, ${lon}, ${speed} knots`);

    // Create or update marker
    if (vesselMarkers[mmsi]) {
        // Update existing marker
        vesselMarkers[mmsi].setLatLng([lat, lon]);
        vesselMarkers[mmsi].setPopupContent(`
            <b>${vesselName}</b><br>
            Speed: ${speed} knots<br>
            Heading: ${heading}°
        `);
    } else {
        // Create new marker - ferry icon
        const ferryIcon = L.divIcon({
            className: 'ferry-marker',
            html: '🚢',
            iconSize: [30, 30],
            iconAnchor: [15, 15]
        });

        const marker = L.marker([lat, lon], { icon: ferryIcon })
            .addTo(map)
            .bindPopup(`
                <b>${vesselName}</b><br>
                Speed: ${speed} knots<br>
                Heading: ${heading}°
            `);

        vesselMarkers[mmsi] = marker;
    }
}
