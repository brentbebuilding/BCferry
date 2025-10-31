const express = require('express');
const WebSocket = require('ws');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 8080;

// Enable CORS for GitHub Pages
app.use(cors({
    origin: ['https://brentbebuilding.github.io', 'http://localhost:3000'],
    credentials: true
}));

app.use(express.json());

// BC Ferries MMSI numbers
const BC_FERRIES_VESSELS = {
    '316001268': 'Spirit of British Columbia',
    '316011408': 'Coastal Inspiration',
    '316011409': 'Coastal Celebration',
    '316011407': 'Coastal Renaissance',
    '316002980': 'Queen of Alberni',
    '316003008': 'Queen of Cowichan',
    '316003020': 'Queen of Oak Bay',
    '316001249': 'Queen of Coquitlam',  // FIXED: Was 316003032 (fishing boat)
    '316001256': 'Spirit of Vancouver Island',
    '316011406': 'Coastal Renaissance',
    '316002992': 'Queen of Cumberland',
    '316011410': 'Coastal Inspiration',
    '316003044': 'Queen of Nanaimo',
    '316001262': 'Queen of Surrey',  // NAN-HSB route
};

// BC Ferry Terminal Locations (lat, lon)
const TERMINALS = {
    'TSA': { name: 'Tsawwassen', lat: 49.0074, lon: -123.1299, code: 'TSA' },
    'SWB': { name: 'Swartz Bay', lat: 48.6884, lon: -123.4113, code: 'SWB' },
    'DUK': { name: 'Duke Point', lat: 49.1631, lon: -123.8792, code: 'DUK' },
    'NAN': { name: 'Departure Bay', lat: 49.1947, lon: -123.9543, code: 'NAN' },
    'HSB': { name: 'Horseshoe Bay', lat: 49.3736, lon: -123.2719, code: 'HSB' },
    'LNG': { name: 'Langdale', lat: 49.4611, lon: -123.4803, code: 'LNG' },
    'BOW': { name: 'Bowen Island', lat: 49.3833, lon: -123.3333, code: 'BOW' },
};

// Major BC Ferry Routes
const ROUTES = [
    { from: 'TSA', to: 'SWB', name: 'Tsawwassen - Swartz Bay' },
    { from: 'SWB', to: 'TSA', name: 'Swartz Bay - Tsawwassen' },
    { from: 'TSA', to: 'DUK', name: 'Tsawwassen - Duke Point' },
    { from: 'DUK', to: 'TSA', name: 'Duke Point - Tsawwassen' },
    { from: 'HSB', to: 'NAN', name: 'Horseshoe Bay - Departure Bay' },
    { from: 'NAN', to: 'HSB', name: 'Departure Bay - Horseshoe Bay' },
    { from: 'HSB', to: 'LNG', name: 'Horseshoe Bay - Langdale' },
    { from: 'LNG', to: 'HSB', name: 'Langdale - Horseshoe Bay' },
    { from: 'HSB', to: 'BOW', name: 'Horseshoe Bay - Bowen Island' },
    { from: 'BOW', to: 'HSB', name: 'Bowen Island - Horseshoe Bay' },
];

// Calculate distance between two points (Haversine formula)
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth's radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c; // Distance in km
}

// Calculate bearing from point 1 to point 2
function calculateBearing(lat1, lon1, lat2, lon2) {
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const y = Math.sin(dLon) * Math.cos(lat2 * Math.PI / 180);
    const x = Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180) -
              Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos(dLon);
    let bearing = Math.atan2(y, x) * 180 / Math.PI;
    return (bearing + 360) % 360; // Normalize to 0-360
}

// Determine which route the ferry is on based on position and heading
function determineRoute(lat, lon, heading) {
    let closestTerminals = [];

    // Find distances to all terminals
    for (const [code, terminal] of Object.entries(TERMINALS)) {
        const distance = calculateDistance(lat, lon, terminal.lat, terminal.lon);
        closestTerminals.push({ code, terminal, distance });
    }

    // Sort by distance
    closestTerminals.sort((a, b) => a.distance - b.distance);

    // Get closest terminal (most likely destination)
    const closest = closestTerminals[0];

    // Calculate bearing to closest terminal
    const bearingToClosest = calculateBearing(lat, lon, closest.terminal.lat, closest.terminal.lon);
    const diffToClosest = Math.abs(((heading - bearingToClosest + 180) % 360) - 180);

    // If heading toward closest terminal (within 45 degrees), find the origin
    if (diffToClosest < 45) {
        // Check known routes to this destination
        const possibleRoutes = ROUTES.filter(r => r.to === closest.code);

        if (possibleRoutes.length > 0) {
            // Find which origin makes most sense - prefer the FARTHEST origin
            // (vessel came from far away and is now close to destination)
            let bestRoute = possibleRoutes[0];
            let bestScore = -Infinity; // Changed: now we want HIGHEST score (farthest origin)

            console.log(`\n🔍 Determining route for vessel heading to ${closest.terminal.name}`);
            console.log(`   Vessel position: ${lat.toFixed(4)}, ${lon.toFixed(4)}`);
            console.log(`   Distance to ${closest.terminal.name}: ${closest.distance.toFixed(2)} km`);

            for (const route of possibleRoutes) {
                const originTerminal = TERMINALS[route.from];
                const distanceFromOrigin = calculateDistance(lat, lon, originTerminal.lat, originTerminal.lon);
                const routeLength = calculateDistance(originTerminal.lat, originTerminal.lon, closest.terminal.lat, closest.terminal.lon);

                // Score: prefer routes where vessel is far from origin (came from there)
                // and the route length makes sense
                const score = distanceFromOrigin;

                console.log(`   Route ${route.from} → ${route.to}: dist from ${route.from}=${distanceFromOrigin.toFixed(2)}km, route length=${routeLength.toFixed(2)}km, score=${score.toFixed(2)}`);

                if (score > bestScore) {
                    bestScore = score;
                    bestRoute = route;
                }
            }

            const originTerminal = TERMINALS[bestRoute.from];
            console.log(`   ✅ Selected: ${bestRoute.from} → ${bestRoute.to}`);

            return {
                from: bestRoute.from,
                to: closest.code,
                fromName: originTerminal.name,
                toName: closest.terminal.name,
                destination: closest.terminal,
                distanceToDestination: closest.distance,
                route: `${originTerminal.name} → ${closest.terminal.name}`
            };
        }
    }

    // Fallback to second closest terminal
    const secondClosest = closestTerminals[1];
    const bearingToSecond = calculateBearing(lat, lon, secondClosest.terminal.lat, secondClosest.terminal.lon);
    const diffToSecond = Math.abs(((heading - bearingToSecond + 180) % 360) - 180);

    // If heading toward second closest (within 45 degrees), that's the destination
    if (diffToSecond < 45 && secondClosest.distance < 50) {
        return {
            from: closest.code,
            to: secondClosest.code,
            fromName: closest.terminal.name,
            toName: secondClosest.terminal.name,
            destination: secondClosest.terminal,
            distanceToDestination: secondClosest.distance,
            route: `${closest.terminal.name} → ${secondClosest.terminal.name}`
        };
    }

    // If can't determine, return closest two terminals
    return {
        from: secondClosest.code,
        to: closest.code,
        fromName: secondClosest.terminal.name,
        toName: closest.terminal.name,
        destination: closest.terminal,
        distanceToDestination: closest.distance,
        route: `${secondClosest.terminal.name} → ${closest.terminal.name}`
    };
}

// Calculate ETA based on distance and speed
function calculateETA(distanceKm, speedKnots) {
    if (speedKnots < 1) return 'Stationary';

    const distanceNm = distanceKm * 0.539957; // Convert km to nautical miles
    const hoursToDestination = distanceNm / speedKnots;
    const minutesToDestination = Math.round(hoursToDestination * 60);

    if (minutesToDestination < 60) {
        return `${minutesToDestination} min`;
    } else {
        const hours = Math.floor(minutesToDestination / 60);
        const minutes = minutesToDestination % 60;
        return `${hours}h ${minutes}m`;
    }
}

// Store current vessel positions in memory
const vesselPositions = {};
let aisSocket = null;
let reconnectTimeout = null;
let connectionStatus = 'disconnected';

// Store current BC Ferries schedule
let currentSchedule = [];
let scheduleLastUpdated = null;

// Track which vessels we've logged debug info for (to avoid spam)
const vesselDebugLogged = new Set();

// AISStream API key from environment variable
const AISSTREAM_API_KEY = process.env.AISSTREAM_API_KEY;

if (!AISSTREAM_API_KEY) {
    console.error('❌ AISSTREAM_API_KEY environment variable is required!');
    process.exit(1);
}

console.log('🔑 API Key loaded:', AISSTREAM_API_KEY.substring(0, 8) + '...');

// Fetch BC Ferries schedule data
async function fetchBCFerriesSchedule() {
    try {
        console.log('📅 Fetching BC Ferries schedule...');

        const [capacityRes, nonCapacityRes] = await Promise.all([
            fetch('https://bcferriesapi.ca/v2/capacity/'),
            fetch('https://bcferriesapi.ca/v2/noncapacity/')
        ]);

        const capacityData = await capacityRes.json();
        const nonCapacityData = await nonCapacityRes.json();

        // Merge both datasets
        const allSailings = [];

        // Process capacity data
        if (capacityData) {
            for (const [routeKey, routeData] of Object.entries(capacityData)) {
                // Each route has fromTerminalCode, toTerminalCode, and sailings array
                if (routeData && routeData.sailings && Array.isArray(routeData.sailings)) {
                    routeData.sailings.forEach(sailing => {
                        allSailings.push({
                            ...sailing,
                            fromTerminalCode: routeData.fromTerminalCode,
                            toTerminalCode: routeData.toTerminalCode,
                            routeCode: routeKey
                        });
                    });
                }
            }
        }

        // Process non-capacity data
        if (nonCapacityData) {
            for (const [routeKey, routeData] of Object.entries(nonCapacityData)) {
                if (routeData && routeData.sailings && Array.isArray(routeData.sailings)) {
                    routeData.sailings.forEach(sailing => {
                        // Only add if not already in capacity data
                        // Normalize time to lowercase for case-insensitive comparison
                        const sailingTime = sailing.time ? sailing.time.toLowerCase() : sailing.time;
                        const exists = allSailings.some(s =>
                            s.time && s.time.toLowerCase() === sailingTime &&
                            s.fromTerminalCode === routeData.fromTerminalCode &&
                            s.toTerminalCode === routeData.toTerminalCode
                        );
                        if (!exists) {
                            allSailings.push({
                                ...sailing,
                                fromTerminalCode: routeData.fromTerminalCode,
                                toTerminalCode: routeData.toTerminalCode,
                                routeCode: routeKey,
                                sailingStatus: sailing.sailingStatus || 'future',
                                fill: sailing.fill || 0
                            });
                        }
                    });
                }
            }
        }

        currentSchedule = allSailings;
        scheduleLastUpdated = new Date();
        console.log(`✅ Schedule updated: ${allSailings.length} sailings loaded`);

        // Clear debug cache when schedule refreshes
        vesselDebugLogged.clear();

        // Debug: Show sample sailing to see what fields are available
        if (allSailings.length > 0) {
            console.log('📋 Sample sailing data:', JSON.stringify(allSailings[0], null, 2));
        }

        // Log current sailings
        const currentSailings = allSailings.filter(s => s.sailingStatus === 'current');
        console.log(`🚢 Currently sailing: ${currentSailings.length}`);
        currentSailings.forEach(sailing => {
            console.log(`   ${sailing.vesselName || 'NO NAME'}: ${sailing.fromTerminalCode} → ${sailing.toTerminalCode}`);
        });

        // Count how many have vessel names
        const withNames = allSailings.filter(s => s.vesselName).length;
        console.log(`📊 Sailings with vessel names: ${withNames}/${allSailings.length}`);

    } catch (err) {
        console.error('❌ Error fetching BC Ferries schedule:', err.message);
    }
}

// Find current sailing for a vessel by name
function findCurrentSailing(vesselName) {
    if (!vesselName || currentSchedule.length === 0) {
        return null;
    }

    // Clean vessel name for matching
    const cleanName = vesselName.trim().toLowerCase();

    // Only log debug once per vessel (unless schedule refreshes)
    const shouldDebug = !vesselDebugLogged.has(cleanName);
    if (shouldDebug) {
        console.log(`🔍 Looking for vessel: "${cleanName}"`);
    }

    // Find sailings with matching vessel name that are "current" (actively sailing)
    const currentSailing = currentSchedule.find(sailing => {
        if (!sailing.vesselName) return false;

        // Clean the schedule vessel name - it might have prefixes like "Delayed approx. 20m"
        let sailingVesselName = sailing.vesselName.trim().toLowerCase();

        // Remove common prefixes
        sailingVesselName = sailingVesselName
            .replace(/^delayed.*?(?=queen|coastal|spirit|salish)/i, '')
            .trim();

        // Check exact match or if AIS name is contained in schedule name
        return (sailingVesselName === cleanName || sailingVesselName.includes(cleanName))
            && sailing.sailingStatus === 'current';
    });

    if (currentSailing) {
        if (shouldDebug) {
            console.log(`✅ Found in schedule: ${currentSailing.fromTerminalCode} → ${currentSailing.toTerminalCode} [current]`);
            vesselDebugLogged.add(cleanName);
        }
        return {
            from: currentSailing.fromTerminalCode,
            to: currentSailing.toTerminalCode,
            fromName: getTerminalName(currentSailing.fromTerminalCode),
            toName: getTerminalName(currentSailing.toTerminalCode),
            route: `${getTerminalName(currentSailing.fromTerminalCode)} → ${getTerminalName(currentSailing.toTerminalCode)}`,
            scheduledDeparture: currentSailing.time,
            destination: TERMINALS[currentSailing.toTerminalCode]
        };
    }

    // Debug: show all sailings for this vessel (any status) - only once
    if (shouldDebug) {
        const allForVessel = currentSchedule.filter(sailing => {
            if (!sailing.vesselName) return false;
            const sailingVesselName = sailing.vesselName.trim().toLowerCase();
            return sailingVesselName === cleanName;
        });

        if (allForVessel.length > 0) {
            console.log(`⚠️ Found vessel in schedule but not "current": ${allForVessel.length} sailings`);
            allForVessel.slice(0, 3).forEach(s => {
                console.log(`   - ${s.fromTerminalCode} → ${s.toTerminalCode} at ${s.time} [${s.sailingStatus}]`);
            });
        } else {
            console.log(`❌ Vessel "${cleanName}" not found in schedule at all`);
            // Show some example vessel names from schedule
            const exampleNames = currentSchedule
                .filter(s => s.vesselName)
                .slice(0, 5)
                .map(s => s.vesselName);
            console.log(`   Example names in schedule: ${exampleNames.join(', ')}`);
        }
        vesselDebugLogged.add(cleanName);
    }

    // If no current sailing, check for recent departures (might be in between status updates)
    const recentDeparture = currentSchedule.find(sailing => {
        if (!sailing.vesselName) return false;
        const sailingVesselName = sailing.vesselName.trim().toLowerCase();
        return sailingVesselName === cleanName && sailing.sailingStatus === 'past';
    });

    if (recentDeparture) {
        return {
            from: recentDeparture.fromTerminalCode,
            to: recentDeparture.toTerminalCode,
            fromName: getTerminalName(recentDeparture.fromTerminalCode),
            toName: getTerminalName(recentDeparture.toTerminalCode),
            route: `${getTerminalName(recentDeparture.fromTerminalCode)} → ${getTerminalName(recentDeparture.toTerminalCode)}`,
            scheduledDeparture: recentDeparture.time,
            destination: TERMINALS[recentDeparture.toTerminalCode]
        };
    }

    return null;
}

// Get full terminal name from code
function getTerminalName(code) {
    const terminal = TERMINALS[code];
    return terminal ? terminal.name : code;
}

// Connect to AISStream
function connectToAISStream() {
    console.log('🔌 Connecting to AISStream...');
    connectionStatus = 'connecting';

    aisSocket = new WebSocket('wss://stream.aisstream.io/v0/stream');

    aisSocket.on('open', () => {
        console.log('✅ Connected to AISStream');
        connectionStatus = 'connected';

        const subscription = {
            Apikey: AISSTREAM_API_KEY,
            BoundingBoxes: [
                [[47, -125], [55, -122]]  // BC coastal waters
            ],
            FiltersShipMMSI: Object.keys(BC_FERRIES_VESSELS),
            FilterMessageTypes: ['PositionReport']
        };

        aisSocket.send(JSON.stringify(subscription));
        console.log('📡 Subscribed to', Object.keys(BC_FERRIES_VESSELS).length, 'BC Ferries vessels');
    });

    aisSocket.on('message', (data) => {
        try {
            const message = JSON.parse(data);

            if (message.MessageType === 'PositionReport') {
                const mmsi = message.MetaData?.MMSI?.toString();
                const vesselName = BC_FERRIES_VESSELS[mmsi] || message.MetaData?.ShipName || 'Unknown';
                const position = message.Message?.PositionReport;

                if (position && position.Latitude && position.Longitude) {
                    // Try to find current sailing from BC Ferries schedule
                    let routeInfo = findCurrentSailing(vesselName);
                    let eta = 'Unknown';
                    let routeSource = 'schedule';

                    if (routeInfo && routeInfo.destination) {
                        // Got route from schedule - calculate distance to destination
                        const distanceToDestination = calculateDistance(
                            position.Latitude,
                            position.Longitude,
                            routeInfo.destination.lat,
                            routeInfo.destination.lon
                        );
                        eta = calculateETA(distanceToDestination, position.Sog || 0);
                    } else {
                        // Fallback: guess route based on position and heading
                        routeInfo = determineRoute(
                            position.Latitude,
                            position.Longitude,
                            position.TrueHeading || position.Cog || 0
                        );
                        eta = calculateETA(routeInfo.distanceToDestination, position.Sog || 0);
                        routeSource = 'estimated';
                    }

                    vesselPositions[mmsi] = {
                        mmsi,
                        name: vesselName,
                        latitude: position.Latitude,
                        longitude: position.Longitude,
                        speed: position.Sog || 0,
                        heading: position.TrueHeading || 0,
                        course: position.Cog || 0,
                        route: routeInfo.route,
                        from: routeInfo.fromName,
                        to: routeInfo.toName,
                        eta: eta,
                        routeSource: routeSource, // 'schedule' or 'estimated'
                        timestamp: new Date().toISOString()
                    };

                    console.log(`🚢 ${vesselName}: ${routeInfo.route} - ETA: ${eta} [${routeSource}]`);

                    // Broadcast to all connected WebSocket clients
                    broadcastToClients(vesselPositions[mmsi]);
                }
            }
        } catch (err) {
            console.error('❌ Error processing message:', err);
        }
    });

    aisSocket.on('error', (error) => {
        console.error('❌ AISStream WebSocket error:', error.message);
        connectionStatus = 'error';
    });

    aisSocket.on('close', (code, reason) => {
        console.log(`⚠️ AISStream connection closed. Code: ${code}, Reason: ${reason || 'none'}`);
        connectionStatus = 'disconnected';

        // Reconnect after 5 seconds
        console.log('⏱️ Reconnecting in 5 seconds...');
        reconnectTimeout = setTimeout(connectToAISStream, 5000);
    });
}

// WebSocket server for frontend clients
const wss = new WebSocket.Server({ noServer: true });

wss.on('connection', (ws) => {
    console.log('👤 Client connected');

    // Send current positions immediately
    ws.send(JSON.stringify({
        type: 'initial',
        vessels: Object.values(vesselPositions)
    }));

    ws.on('close', () => {
        console.log('👋 Client disconnected');
    });
});

function broadcastToClients(vessel) {
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({
                type: 'update',
                vessel
            }));
        }
    });
}

// HTTP API endpoints
app.get('/', (req, res) => {
    res.json({
        service: 'BC Ferry AIS Tracker Backend',
        status: connectionStatus,
        vessels: Object.keys(vesselPositions).length,
        endpoints: {
            '/api/vessels': 'Get all current vessel positions',
            '/api/status': 'Get service status',
            '/ws': 'WebSocket for real-time updates'
        }
    });
});

app.get('/api/vessels', (req, res) => {
    res.json({
        status: connectionStatus,
        count: Object.keys(vesselPositions).length,
        vessels: Object.values(vesselPositions),
        timestamp: new Date().toISOString()
    });
});

app.get('/api/status', (req, res) => {
    res.json({
        status: connectionStatus,
        vesselCount: Object.keys(vesselPositions).length,
        timestamp: new Date().toISOString()
    });
});

// Start HTTP server
const server = app.listen(PORT, async () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📍 Health check: http://localhost:${PORT}`);
    console.log(`📡 API endpoint: http://localhost:${PORT}/api/vessels`);

    // Fetch BC Ferries schedule on startup
    await fetchBCFerriesSchedule();

    // Update schedule every 5 minutes
    setInterval(fetchBCFerriesSchedule, 5 * 60 * 1000);

    // Connect to AISStream
    connectToAISStream();
});

// Handle WebSocket upgrade
server.on('upgrade', (request, socket, head) => {
    if (request.url === '/ws') {
        wss.handleUpgrade(request, socket, head, (ws) => {
            wss.emit('connection', ws, request);
        });
    } else {
        socket.destroy();
    }
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('⚠️ SIGTERM received, shutting down gracefully...');
    if (reconnectTimeout) clearTimeout(reconnectTimeout);
    if (aisSocket) aisSocket.close();
    server.close(() => {
        console.log('✅ Server closed');
        process.exit(0);
    });
});
