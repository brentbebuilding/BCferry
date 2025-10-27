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
                    vesselPositions[mmsi] = {
                        mmsi,
                        name: vesselName,
                        latitude: position.Latitude,
                        longitude: position.Longitude,
                        speed: position.Sog || 0,
                        heading: position.TrueHeading || 0,
                        course: position.Cog || 0,
                        timestamp: new Date().toISOString()
                    };

                    console.log(`🚢 ${vesselName}: [${position.Latitude.toFixed(4)}, ${position.Longitude.toFixed(4)}] @ ${position.Sog} knots`);

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
