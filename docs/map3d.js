// Self-contained 3D live map — a stylized "radar ocean" scene rendered with
// Three.js. app.js never touches WebGL directly: it only ever calls the
// functions attached to window.Map3D at the bottom of this file, so the
// live-tracking data flow (WebSocket -> updateVessel) is unchanged from the
// old Leaflet map, only the rendering underneath it.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { COASTLINE_RINGS } from './coastline.js';

// ---- Geography ----------------------------------------------------------
// Same terminals and coordinates the backend uses, so vessel.to strings from
// the WebSocket feed resolve directly to a position here.
const TERMINALS = {
    'Tsawwassen': { lat: 49.0074, lon: -123.1299 },
    'Swartz Bay': { lat: 48.6884, lon: -123.4113 },
    'Duke Point': { lat: 49.1631, lon: -123.8792 },
    'Departure Bay': { lat: 49.1947, lon: -123.9543 },
    'Horseshoe Bay': { lat: 49.3736, lon: -123.2719 },
    'Langdale': { lat: 49.4611, lon: -123.4803 },
    'Bowen Island': { lat: 49.3833, lon: -123.3333 }
};

const ORIGIN = { lat: 49.05, lon: -123.55 };
const METERS_PER_DEG_LAT = 111320;
const METERS_PER_DEG_LON = METERS_PER_DEG_LAT * Math.cos(ORIGIN.lat * Math.PI / 180);
const UNITS_PER_METER = 0.0016;

// Project lat/lon onto the scene's flat XZ plane. Ships are rendered as
// fixed-size icons rather than to true scale - at true scale a 130m ferry
// would be an invisible speck at this zoom.
function project(lat, lon) {
    return {
        x: (lon - ORIGIN.lon) * METERS_PER_DEG_LON * UNITS_PER_METER,
        z: -(lat - ORIGIN.lat) * METERS_PER_DEG_LAT * UNITS_PER_METER
    };
}

// Local +Z is a ship's bow. North is -Z and east is +X in this projection,
// so a compass heading needs converting to a rotation around Y.
function headingToRotationY(headingDegrees) {
    return Math.PI - ((headingDegrees || 0) * Math.PI / 180);
}

function shortestAngleDelta(from, to) {
    let diff = (to - from) % (Math.PI * 2);
    if (diff > Math.PI) diff -= Math.PI * 2;
    if (diff < -Math.PI) diff += Math.PI * 2;
    return diff;
}

// Terminal label height as a fraction of camera distance, so labels keep a
// constant on-screen size at any zoom level.
const LABEL_SCREEN_SCALE = 0.028;

const SHIP_COLORS = [0x2dd4ff, 0xff8a3d, 0xb388ff, 0x7cff6b, 0xffd166, 0xff6bcb];
function colorForMmsi(mmsi) {
    let hash = 0;
    const key = String(mmsi);
    for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
    return SHIP_COLORS[hash % SHIP_COLORS.length];
}

// ---- Texture helpers (canvas-generated, no external image assets) -------

function createGlowTexture() {
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.4, 'rgba(255,255,255,0.35)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    return new THREE.CanvasTexture(canvas);
}

let glowTexture = null;
function getGlowTexture() {
    if (!glowTexture) glowTexture = createGlowTexture();
    return glowTexture;
}

function createGlowSprite(colorHex, size) {
    const material = new THREE.SpriteMaterial({
        map: getGlowTexture(),
        color: colorHex,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(size, size, 1);
    return sprite;
}

function createLabelSprite(text, color) {
    const fontSize = 48;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    ctx.font = `600 ${fontSize}px -apple-system, sans-serif`;
    const width = Math.ceil(ctx.measureText(text).width) + 40;
    canvas.width = width;
    canvas.height = fontSize * 1.8;

    ctx.font = `600 ${fontSize}px -apple-system, sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(4, 12, 18, 0.72)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = color;
    ctx.fillText(text, 20, canvas.height / 2);

    const material = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), depthWrite: false, transparent: true });
    const sprite = new THREE.Sprite(material);
    // Sprites scale with distance, which makes labels balloon when the camera
    // flies in close. Store the aspect so the render loop can hold them at a
    // constant on-screen size instead.
    sprite.userData.aspect = canvas.width / canvas.height;
    return sprite;
}

// ---- Scene building blocks ------------------------------------------------

function createOcean() {
    const geometry = new THREE.PlaneGeometry(500, 500, 140, 140);
    const material = new THREE.ShaderMaterial({
        uniforms: {
            uTime: { value: 0 },
            uColorDeep: { value: new THREE.Color(0x02060c) },
            uColorGrid: { value: new THREE.Color(0x0a4f5e) }
        },
        vertexShader: `
            varying vec2 vUv;
            uniform float uTime;
            void main() {
                vUv = uv;
                vec3 pos = position;
                pos.z += sin(pos.x * 0.12 + uTime * 0.6) * 0.5
                       + sin(pos.y * 0.18 + uTime * 0.9) * 0.35;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
            }
        `,
        fragmentShader: `
            varying vec2 vUv;
            uniform vec3 uColorDeep;
            uniform vec3 uColorGrid;
            void main() {
                vec2 g = fract(vUv * 48.0);
                vec2 distToLine = min(g, 1.0 - g);
                float lineMask = 1.0 - smoothstep(0.0, 0.035, min(distToLine.x, distToLine.y));
                vec3 color = mix(uColorDeep, uColorGrid, lineMask * 0.5);
                gl_FragColor = vec4(color, 1.0);
            }
        `
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    return { mesh, material };
}

// Build the land as extruded shapes rising out of the water, plus a bright
// outline along the shoreline. ExtrudeGeometry accepts an array of shapes and
// returns a single geometry, so all 70-odd islands cost one draw call.
const LAND_HEIGHT = 3;
const LAND_BASE_Y = -0.5;

function createLand() {
    const group = new THREE.Group();
    const shapes = [];
    const outlinePositions = [];

    COASTLINE_RINGS.forEach(flat => {
        const points = [];
        for (let i = 0; i < flat.length; i += 2) {
            const { x, z } = project(flat[i + 1], flat[i]);
            // Shapes are built in XY and extruded along +Z; the mesh is then
            // rotated so shape-Y maps to world -Z and the extrusion points up.
            points.push(new THREE.Vector2(x, -z));
        }
        if (points.length < 3) return;
        shapes.push(new THREE.Shape(points));

        for (let i = 0; i < points.length; i++) {
            const a = points[i];
            const b = points[(i + 1) % points.length];
            outlinePositions.push(a.x, LAND_BASE_Y + LAND_HEIGHT, -a.y);
            outlinePositions.push(b.x, LAND_BASE_Y + LAND_HEIGHT, -b.y);
        }
    });

    const geometry = new THREE.ExtrudeGeometry(shapes, { depth: LAND_HEIGHT, bevelEnabled: false });
    const material = new THREE.MeshStandardMaterial({
        color: 0x24404c,
        emissive: 0x11333a,
        emissiveIntensity: 0.9,
        roughness: 0.85,
        metalness: 0.0
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = LAND_BASE_Y;
    group.add(mesh);

    const outlineGeometry = new THREE.BufferGeometry();
    outlineGeometry.setAttribute('position', new THREE.Float32BufferAttribute(outlinePositions, 3));
    const outline = new THREE.LineSegments(
        outlineGeometry,
        new THREE.LineBasicMaterial({ color: 0x5cffe4, transparent: true, opacity: 0.95 })
    );
    group.add(outline);

    return group;
}

function createStarfield() {
    const count = 600;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
        const radius = 400 + Math.random() * 400;
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(Math.random() * 2 - 1) * 0.6;
        positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
        positions[i * 3 + 1] = Math.abs(radius * Math.cos(phi)) + 20;
        positions[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({ color: 0xbfe3ff, size: 1.4, sizeAttenuation: true, transparent: true, opacity: 0.7 });
    return new THREE.Points(geometry, material);
}

function createTerminal(name, coords) {
    const { x, z } = project(coords.lat, coords.lon);
    const group = new THREE.Group();
    group.position.set(x, 0, z);

    const pylonMat = new THREE.MeshStandardMaterial({ color: 0xffb703, emissive: 0xffb703, emissiveIntensity: 0.8 });
    const pylon = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 12, 8), pylonMat);
    pylon.position.y = 6;
    group.add(pylon);

    const ring = new THREE.Mesh(
        new THREE.RingGeometry(2.4, 3.1, 32),
        new THREE.MeshBasicMaterial({ color: 0xffb703, transparent: true, opacity: 0.5, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.05;
    group.add(ring);

    const glow = createGlowSprite(0xffb703, 14);
    glow.position.y = 0.3;
    group.add(glow);

    const label = createLabelSprite(name, '#ffd166');
    label.position.set(0, 15, 0);
    group.add(label);

    group.userData.ring = ring;
    group.userData.label = label;
    return group;
}

// The ship's visual parts live in an inner group so the whole vessel can bob as
// one rigid body - bobbing individual meshes would drift the bow and cabin away
// from the hull.
function createShipMesh(colorHex) {
    const group = new THREE.Group();
    const body = new THREE.Group();
    group.add(body);

    const hullMat = new THREE.MeshStandardMaterial({ color: 0x0e2430, emissive: colorHex, emissiveIntensity: 0.35, roughness: 0.5, metalness: 0.2 });
    const hull = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.34, 3.2), hullMat);
    hull.position.y = 0.17;
    body.add(hull);

    // Four-sided cone makes a wedge bow; the z-roll lines its flat faces up
    // with the hull sides instead of presenting a corner forward.
    const bow = new THREE.Mesh(new THREE.ConeGeometry(0.64, 1.4, 4), hullMat);
    bow.rotation.set(Math.PI / 2, 0, Math.PI / 4);
    bow.scale.set(1, 1, 0.75);
    bow.position.set(0, 0.17, 2.2);
    body.add(bow);

    const cabinMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: colorHex, emissiveIntensity: 0.6, roughness: 0.4 });
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.42, 1.5), cabinMat);
    cabin.position.set(0, 0.55, -0.25);
    body.add(cabin);

    const funnel = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.14, 0.5, 8), cabinMat);
    funnel.position.set(0, 0.95, -0.7);
    body.add(funnel);

    const glow = createGlowSprite(colorHex, 3.2);
    glow.position.y = 0.4;
    body.add(glow);

    // Ships are icons, not scale models - at true scale a 130m ferry would be
    // roughly a third of a scene unit and invisible next to a 140-unit strait.
    group.scale.setScalar(2.6);

    return { group, body };
}

const WAKE_LENGTH = 24;
function createWake(colorHex) {
    const positions = new Float32Array(WAKE_LENGTH * 3);
    const colors = new Float32Array(WAKE_LENGTH * 3);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const material = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.7 });
    const line = new THREE.Line(geometry, material);
    return { line, geometry, positions, colors, baseColor: new THREE.Color(colorHex), points: [] };
}

function pushWakePoint(wake, position) {
    wake.points.unshift(position.clone());
    if (wake.points.length > WAKE_LENGTH) wake.points.length = WAKE_LENGTH;

    for (let i = 0; i < WAKE_LENGTH; i++) {
        const p = wake.points[i] || wake.points[wake.points.length - 1];
        wake.positions[i * 3] = p.x;
        wake.positions[i * 3 + 1] = 0.05;
        wake.positions[i * 3 + 2] = p.z;

        const t = 1 - i / WAKE_LENGTH;
        wake.colors[i * 3] = wake.baseColor.r * t;
        wake.colors[i * 3 + 1] = wake.baseColor.g * t;
        wake.colors[i * 3 + 2] = wake.baseColor.b * t;
    }
    wake.geometry.attributes.position.needsUpdate = true;
    wake.geometry.attributes.color.needsUpdate = true;
}

// ---- Module state -----------------------------------------------------

let container, renderer, scene, camera, controls, clock;
let ocean, raycaster, pointer, hud;
let animationHandle = null;
let active = false;
let requestedActive = false;
let sceneReady = false;

const ships = new Map();
const terminalGroups = [];
const terminalPositions = new Map();

let selectedMmsi = null;
let destinationBeacon = null;
let destinationLine = null;
let flight = null;

function showFallback(el, message) {
    const div = document.createElement('div');
    div.className = 'map3d-fallback';
    div.textContent = message;
    el.appendChild(div);
}

function createHud(el) {
    const div = document.createElement('div');
    div.className = 'map3d-hud';
    div.innerHTML = `
        <button class="map3d-hud-close" aria-label="Close">×</button>
        <div class="map3d-hud-name"></div>
        <div class="map3d-hud-row"><span>Route</span><strong class="map3d-hud-route"></strong></div>
        <div class="map3d-hud-row"><span>ETA</span><strong class="map3d-hud-eta"></strong></div>
        <div class="map3d-hud-row"><span>Speed</span><strong class="map3d-hud-speed"></strong></div>
        <div class="map3d-hud-row"><span>Heading</span><strong class="map3d-hud-heading"></strong></div>
    `;
    el.appendChild(div);
    div.querySelector('.map3d-hud-close').addEventListener('click', deselect);
    return div;
}

function updateHud(vessel) {
    if (!hud) return;
    hud.classList.add('visible');
    hud.querySelector('.map3d-hud-name').textContent = vessel.name || 'Unknown vessel';
    hud.querySelector('.map3d-hud-route').textContent = vessel.route || 'Unknown route';
    hud.querySelector('.map3d-hud-eta').textContent = vessel.eta || 'Unknown';
    hud.querySelector('.map3d-hud-speed').textContent = `${(vessel.speed || 0).toFixed(1)} kn`;
    hud.querySelector('.map3d-hud-heading').textContent = `${Math.round(vessel.heading || 0)}°`;
}

// Rebuilding the arc is only worth doing once the ship has actually moved -
// doing it every frame would churn geometry 60 times a second.
const ARC_REBUILD_DISTANCE = 0.5;
let destinationArcAnchor = null;

function showDestinationBeacon(destinationName, shipGroup) {
    hideDestinationBeacon();
    const pos = terminalPositions.get(destinationName);
    if (!pos) return;

    destinationBeacon = createGlowSprite(0x37ff8b, 10);
    destinationBeacon.position.set(pos.x, 4, pos.z);
    scene.add(destinationBeacon);

    if (shipGroup) buildDestinationArc(shipGroup.position, pos);
}

function buildDestinationArc(shipPosition, terminalPosition) {
    const start = shipPosition.clone();
    const end = new THREE.Vector3(terminalPosition.x, 0.3, terminalPosition.z);
    const mid = start.clone().add(end).multiplyScalar(0.5);
    mid.y += start.distanceTo(end) * 0.15 + 3;

    const curve = new THREE.QuadraticBezierCurve3(start, mid, end);
    const geometry = new THREE.BufferGeometry().setFromPoints(curve.getPoints(48));
    const material = new THREE.LineBasicMaterial({ color: 0x37ff8b, transparent: true, opacity: 0.85 });

    destinationLine = new THREE.Line(geometry, material);
    scene.add(destinationLine);
    destinationArcAnchor = start.clone();
}

function hideDestinationBeacon() {
    if (destinationBeacon) {
        scene.remove(destinationBeacon);
        destinationBeacon.material.dispose();
        destinationBeacon = null;
    }
    disposeDestinationLine();
    destinationArcAnchor = null;
}

function disposeDestinationLine() {
    if (!destinationLine) return;
    scene.remove(destinationLine);
    destinationLine.geometry.dispose();
    destinationLine.material.dispose();
    destinationLine = null;
}

// Tapping empty water clears the selection and pulls back to the whole strait
function deselect() {
    const wasSelected = selectedMmsi !== null;
    selectedMmsi = null;
    if (hud) hud.classList.remove('visible');
    hideDestinationBeacon();
    if (wasSelected) flyTo(overviewCameraPosition(), new THREE.Vector3(0, 0, 0));
}

function selectShip(mmsi) {
    const ship = ships.get(mmsi);
    if (!ship) return;

    selectedMmsi = mmsi;
    updateHud(ship.data);
    showDestinationBeacon(ship.data.to, ship.group);

    const targetPos = ship.group.position.clone();
    flyTo(targetPos.clone().add(new THREE.Vector3(30, 26, 30)), targetPos);
    controls.autoRotate = false;
}

function updateFlight(elapsed) {
    const t = Math.min(1, (elapsed - flight.startTime) / flight.duration);
    const eased = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    camera.position.lerpVectors(flight.startCam, flight.endCam, eased);
    controls.target.lerpVectors(flight.startTarget, flight.endTarget, eased);
    if (t >= 1) flight = null;
}

function onPointerDown(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);

    const hitMeshes = Array.from(ships.values()).map(s => s.hitMesh);
    const hits = raycaster.intersectObjects(hitMeshes);
    if (hits.length > 0) {
        selectShip(hits[0].object.userData.mmsi);
    } else {
        deselect();
    }
}

// Half-extent to frame: wide enough to show the coastline around the routes
const SCENE_HALF_X = 78;
const SCENE_HALF_Z = 95;
const CAMERA_DIRECTION = new THREE.Vector3(0, 125, 105).normalize();
const CAMERA_TILT_SIN = Math.sin(Math.atan2(125, 105));

// Pull the camera back far enough that the whole strait fits the viewport. A
// portrait phone has a much narrower horizontal field of view than a desktop
// window, so a single fixed distance would crop terminals off the sides.
function overviewCameraPosition() {
    const vFov = camera.fov * Math.PI / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);

    const distanceForWidth = SCENE_HALF_X / Math.tan(hFov / 2);
    const distanceForDepth = (SCENE_HALF_Z * CAMERA_TILT_SIN) / Math.tan(vFov / 2);

    // A portrait phone is narrow enough that fitting the full width would zoom
    // way out and leave dead space above the coast, so cap how far the width
    // constraint may pull back and let the land crop off the sides instead.
    const distance = Math.max(
        distanceForDepth,
        Math.min(distanceForWidth, distanceForDepth * 1.25)
    );

    controls.maxDistance = Math.max(260, distance * 1.6);
    return CAMERA_DIRECTION.clone().multiplyScalar(distance);
}

function frameOverview() {
    camera.position.copy(overviewCameraPosition());
    controls.target.set(0, 0, 0);
    controls.update();
}

function flyTo(endCam, endTarget) {
    flight = {
        startCam: camera.position.clone(),
        startTarget: controls.target.clone(),
        endCam,
        endTarget,
        startTime: clock.getElapsedTime(),
        duration: 0.9
    };
}

function onResize() {
    if (!renderer || !container) return;
    const width = container.clientWidth || 1;
    const height = container.clientHeight || 1;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);

    // Only re-frame while nothing is selected, so a resize never yanks the
    // camera away from a ship the user is watching.
    if (!selectedMmsi && !flight) frameOverview();
}

function animate() {
    if (!active) return;
    animationHandle = requestAnimationFrame(animate);

    const elapsed = clock.getElapsedTime();
    const delta = Math.min(clock.getDelta(), 0.1);

    ocean.material.uniforms.uTime.value = elapsed;

    ships.forEach(ship => {
        ship.group.position.lerp(ship.target, Math.min(1, delta * 1.5));
        ship.group.rotation.y += shortestAngleDelta(ship.group.rotation.y, ship.targetRotY) * Math.min(1, delta * 2);
        ship.body.position.y = Math.sin(elapsed * 1.4 + ship.bobPhase) * 0.08;
        ship.body.rotation.z = Math.sin(elapsed * 0.9 + ship.bobPhase) * 0.04;
        pushWakePoint(ship.wake, ship.group.position);

        // Redraw the selected ship's arc only once it has actually travelled
        if (ship.mmsi === selectedMmsi && destinationArcAnchor) {
            if (ship.group.position.distanceTo(destinationArcAnchor) > ARC_REBUILD_DISTANCE) {
                const terminalPos = terminalPositions.get(ship.data.to);
                if (terminalPos) {
                    disposeDestinationLine();
                    buildDestinationArc(ship.group.position, terminalPos);
                }
            }
        }
    });

    terminalGroups.forEach(t => {
        const pulse = 1 + Math.sin(elapsed * 1.5) * 0.15;
        t.userData.ring.scale.set(pulse, pulse, 1);

        // Hold labels at a constant apparent size regardless of camera distance
        const label = t.userData.label;
        const height = LABEL_SCREEN_SCALE * camera.position.distanceTo(t.position);
        label.scale.set(height * label.userData.aspect, height, 1);
    });

    if (flight) updateFlight(elapsed);
    if (destinationLine) destinationLine.material.opacity = 0.55 + Math.sin(elapsed * 3) * 0.3;
    if (destinationBeacon) {
        const pulse = 10 + Math.sin(elapsed * 3) * 2.5;
        destinationBeacon.scale.set(pulse, pulse, 1);
    }

    controls.update();
    renderer.render(scene, camera);
}

// ---- Public API ---------------------------------------------------------

export function init(el) {
    if (sceneReady || !el) return;
    container = el;

    try {
        renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch (err) {
        showFallback(container, "This browser can't render the 3D map (WebGL unavailable).");
        return;
    }

    const width = container.clientWidth || 600;
    const height = container.clientHeight || 600;
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    container.appendChild(renderer.domElement);

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x040810);
    scene.fog = new THREE.FogExp2(0x040810, 0.0035);

    // The terminals span roughly 100 x 140 scene units, so the camera sits high
    // enough to frame all of them at a ~50 degree look-down rather than grazing
    // the water plane.
    camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 2000);
    camera.position.set(0, 125, 105);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0, 0);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 15;
    controls.maxDistance = 260;
    controls.maxPolarAngle = Math.PI / 2 - 0.02;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.35;
    controls.addEventListener('start', () => { controls.autoRotate = false; });
    frameOverview();

    scene.add(new THREE.AmbientLight(0x3a5a66, 0.9));
    const moon = new THREE.DirectionalLight(0xbfe3ff, 0.6);
    moon.position.set(60, 90, 30);
    scene.add(moon);

    ocean = createOcean();
    scene.add(ocean.mesh);
    scene.add(createLand());
    scene.add(createStarfield());

    Object.entries(TERMINALS).forEach(([name, coords]) => {
        const group = createTerminal(name, coords);
        scene.add(group);
        terminalGroups.push(group);
        terminalPositions.set(name, group.position.clone());
    });

    hud = createHud(container);

    raycaster = new THREE.Raycaster();
    pointer = new THREE.Vector2();
    renderer.domElement.addEventListener('pointerdown', onPointerDown);

    clock = new THREE.Clock();
    sceneReady = true;

    new ResizeObserver(onResize).observe(container);
    document.addEventListener('visibilitychange', () => {
        setActive(requestedActive && !document.hidden);
    });

    setActive(true);
}

export function updateVessel(vessel) {
    if (!sceneReady) return;
    const { mmsi, latitude, longitude } = vessel;
    if (typeof latitude !== 'number' || typeof longitude !== 'number') return;

    const { x, z } = project(latitude, longitude);
    let ship = ships.get(mmsi);

    if (!ship) {
        const colorHex = colorForMmsi(mmsi);
        const { group, body } = createShipMesh(colorHex);
        group.position.set(x, 0, z);
        scene.add(group);

        const hitMesh = new THREE.Mesh(new THREE.SphereGeometry(1.6, 8, 8), new THREE.MeshBasicMaterial({ visible: false }));
        hitMesh.userData.mmsi = mmsi;
        group.add(hitMesh);

        const wake = createWake(colorHex);
        scene.add(wake.line);

        ship = {
            mmsi,
            group,
            hitMesh,
            body,
            wake,
            target: new THREE.Vector3(x, 0, z),
            targetRotY: headingToRotationY(vessel.heading),
            bobPhase: Math.random() * Math.PI * 2,
            data: vessel
        };
        ships.set(mmsi, ship);
    }

    ship.target.set(x, 0, z);
    ship.targetRotY = headingToRotationY(vessel.heading);
    ship.data = vessel;

    if (selectedMmsi === mmsi) updateHud(vessel);
}

export function setActive(value) {
    requestedActive = value;
    const shouldRun = value && !document.hidden && sceneReady;
    if (shouldRun && !active) {
        active = true;
        animate();
    } else if (!shouldRun && active) {
        active = false;
        if (animationHandle) cancelAnimationFrame(animationHandle);
    }
}

window.Map3D = { init, updateVessel, setActive };
