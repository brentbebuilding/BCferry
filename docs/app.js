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

// Format date
function formatDate(timeString) {
    if (!timeString) return '';
    const date = new Date(timeString);
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Compare just the date part
    const dateStr = date.toDateString();
    const todayStr = today.toDateString();
    const tomorrowStr = tomorrow.toDateString();

    if (dateStr === todayStr) return 'Today';
    if (dateStr === tomorrowStr) return 'Tomorrow';

    return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
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

// Filter sailings by day
function filterSailingsByDay(sailings, dayFilter) {
    if (dayFilter === 'all') {
        return sailings;
    }

    // Debug logging
    console.log(`Filtering for: ${dayFilter}`);
    console.log('Total sailings:', sailings.length);

    const filtered = sailings.filter(sailing => {
        const day = getSailingDay(sailing.time);
        console.log(`Sailing time: ${sailing.time}, detected as: ${day}`);
        return day === dayFilter;
    });

    console.log(`Filtered sailings (${dayFilter}):`, filtered.length);
    return filtered;
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

        // Debug: log API response structure
        console.log('API Response:', data);
        if (data.routes && data.routes.length > 0) {
            console.log('First route:', data.routes[0]);
            if (data.routes[0].sailings && data.routes[0].sailings.length > 0) {
                console.log('First sailing:', data.routes[0].sailings[0]);
            }
        }

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
        const fromName = getTerminalName(route.fromTerminal);
        const toName = getTerminalName(route.toTerminal);
        const option = document.createElement('option');
        option.value = `${route.fromTerminal}-${route.toTerminal}`;
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
            route.fromTerminal === from && route.toTerminal === to
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
    const fromName = getTerminalName(route.fromTerminal);
    const toName = getTerminalName(route.toTerminal);

    // Filter sailings by selected day
    const selectedDay = dayFilter.value;
    const filteredSailings = route.sailings && route.sailings.length > 0
        ? filterSailingsByDay(route.sailings, selectedDay)
        : [];

    const sailingsHTML = filteredSailings.length > 0
        ? filteredSailings.map(sailing => createSailingCard(sailing)).join('')
        : '<div class="no-sailings">No sailings scheduled</div>';

    return `
        <div class="route-card">
            <div class="route-header">
                <div>
                    <div class="route-title">${fromName} → ${toName}</div>
                    <div class="route-direction">${route.fromTerminal} to ${route.toTerminal}</div>
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
    const time = formatTime(sailing.time);
    const date = formatDate(sailing.time);
    const capacityPercent = sailing.fill || '0';
    const capacityLevel = getCapacityLevel(capacityPercent);
    const capacityText = getCapacityText(capacityPercent);

    // Determine status
    let statusBadge = '';
    if (sailing.isCancelled) {
        statusBadge = '<span class="status-badge status-cancelled">Cancelled</span>';
    } else if (sailing.status && sailing.status.toLowerCase().includes('delay')) {
        statusBadge = '<span class="status-badge status-delayed">Delayed</span>';
    } else {
        statusBadge = '<span class="status-badge status-on-time">On Time</span>';
    }

    return `
        <div class="sailing-card">
            <div class="sailing-time">${time} ${date ? `<span style="font-size: 0.9rem; color: #666; font-weight: normal;">- ${date}</span>` : ''}</div>
            <div class="sailing-info">
                <div class="info-row">
                    <span class="info-label">Status:</span>
                    ${statusBadge}
                </div>
                <div class="info-row">
                    <span class="info-label">Capacity:</span>
                    <span class="capacity-badge capacity-${capacityLevel}">${capacityPercent}%</span>
                </div>
                <div class="info-row">
                    <span class="info-label"></span>
                    <span style="font-size: 0.85rem; color: #666;">${capacityText}</span>
                </div>
                ${sailing.vesselName ? `
                <div class="info-row">
                    <span class="info-label">Vessel:</span>
                    <span>${sailing.vesselName}</span>
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
