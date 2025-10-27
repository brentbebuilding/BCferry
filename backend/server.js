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
    '316003032': 'Queen of Coquitlam',
    '316001256': 'Spirit of Vancouver Island',
    '316011406': 'Coastal Renaissance',
    '316002992': 'Queen of Cumberland',
    '316011410': 'Coastal Inspiration',
    '316003044': 'Queen of Nanaimo',
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

    // Get two closest terminals
    const closest = closestTerminals[0];
    const secondClosest = closestTerminals[1];

    // Calculate bearing to each terminal
    const bearingToClosest = calculateBearing(lat, lon, closest.terminal.lat, closest.terminal.lon);
    const bearingToSecond = calculateBearing(lat, lon, secondClosest.terminal.lat, secondClosest.terminal.lon);

    // Calculate heading difference (how much the ferry's heading differs from bearing to terminal)
    const diffToClosest = Math.abs(((heading - bearingToClosest + 180) % 360) - 180);
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

    // If heading toward closest terminal
    if (diffToClosest < 45) {
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

    // If can't determine, return closest two terminals
    return {
        from: closest.code,
        to: secondClosest.code,
        fromName: closest.terminal.name,
        toName: secondClosest.terminal.name,
        destination: secondClosest.terminal,
        distanceToDestination: secondClosest.distance,
        route: `Between ${closest.terminal.name} and ${secondClosest.terminal.name}`
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

// AISStream API key from environment variable
const AISSTREAM_API_KEY = process.env.AISSTREAM_API_KEY;

if (!AISSTREAM_API_KEY) {
    console.error('❌ AISSTREAM_API_KEY environment variable is required!');
    process.exit(1);
}

console.log('🔑 API Key loaded:', AISSTREAM_API_KEY.substring(0, 8) + '...');

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
                    // Determine route based on position and heading
                    const routeInfo = determineRoute(
                        position.Latitude,
                        position.Longitude,
                        position.TrueHeading || position.Cog || 0
                    );

                    // Calculate ETA
                    const eta = calculateETA(routeInfo.distanceToDestination, position.Sog || 0);

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
                        timestamp: new Date().toISOString()
                    };

                    console.log(`🚢 ${vesselName}: ${routeInfo.route} - ETA: ${eta} @ ${position.Sog} knots`);

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
const server = app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📍 Health check: http://localhost:${PORT}`);
    console.log(`📡 API endpoint: http://localhost:${PORT}/api/vessels`);

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
