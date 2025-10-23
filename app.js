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

// BC Ferries API endpoint - calling directly from browser (v2)
const BC_FERRIES_API = 'https://www.bcferriesapi.ca/v2/capacity/';

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

// Get status label for sailing
function getStatusLabel(sailing) {
    if (!sailing.sailingStatus) return '';

    // Check if vessel name contains a date (tomorrow's sailings)
    if (sailing.vesselName && sailing.vesselName.includes('202')) {
        const match = sailing.vesselName.match(/\(([^)]+)\)/);
        if (match) {
            return match[1]; // Returns the date like "Oct 24, 2025"
        }
    }

    // Otherwise use sailing status
    if (sailing.sailingStatus === 'current') return 'Departing Now';
    if (sailing.sailingStatus === 'past') return 'Departed';
    if (sailing.sailingStatus === 'future') return 'Upcoming';

    return '';
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

// Filter sailings by status (for day filter)
function filterSailingsByStatus(sailings, dayFilter) {
    if (dayFilter === 'all') {
        return sailings.filter(s => s.time); // Only show sailings with a time
    }

    if (dayFilter === 'today') {
        // Today's sailings: current, past, or future WITHOUT a date in vesselName
        return sailings.filter(s => {
            if (!s.time) return false;
            // Exclude sailings that have a date prefix like "(Oct 24, 2025)"
            const hasFutureDate = s.vesselName && s.vesselName.trim().startsWith('(');
            return !hasFutureDate;
        });
    } else if (dayFilter === 'tomorrow') {
        // Tomorrow's sailings have the date at the start: "(Oct 24, 2025) Vessel Name"
        return sailings.filter(s => {
            if (!s.time) return false;
            // Check if vesselName starts with a date in parentheses
            const hasFutureDate = s.vesselName && s.vesselName.trim().startsWith('(');
            console.log(`Checking sailing ${s.time}: vesselName="${s.vesselName}", hasFutureDate=${hasFutureDate}`);
            return hasFutureDate;
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

// Fetch ferry data - directly from BC Ferries API
async function fetchFerryData() {
    try {
        showLoading();
        hideError();

        const response = await fetch(BC_FERRIES_API);

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();

        allRoutes = data.routes || [];
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

    // Clear existing options except "All Routes"
    routeFilter.innerHTML = '<option value="all">All Routes</option>';

    // Add route options
    allRoutes.forEach(route => {
        const fromName = getTerminalName(route.fromTerminalCode);
        const toName = getTerminalName(route.toTerminalCode);
        const option = document.createElement('option');
        option.value = `${route.fromTerminalCode}-${route.toTerminalCode}`;
        option.textContent = `${fromName} → ${toName}`;
        routeFilter.appendChild(option);
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

// Create sailing card HTML
function createSailingCard(sailing) {
    const time = sailing.time || 'N/A';
    const statusLabel = getStatusLabel(sailing);
    const capacityPercent = sailing.fill || '0';
    const capacityLevel = getCapacityLevel(capacityPercent);
    const capacityText = getCapacityText(capacityPercent);

    // Clean vessel name (remove date if present)
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
            <div class="sailing-time">${time} ${statusLabel ? `<span style="font-size: 0.85rem; color: #666; font-weight: normal;">- ${statusLabel}</span>` : ''}</div>
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
