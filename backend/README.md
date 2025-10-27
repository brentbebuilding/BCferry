# BC Ferry AIS Tracker - Backend

This is the backend proxy server for the BC Ferry tracker. It connects to AISStream.io and serves vessel position data to the frontend.

## Deployment to Fly.io

### Prerequisites
- Fly.io account and CLI installed
- AISStream.io API key

### Steps

1. **Login to Fly.io**
   ```bash
   fly auth login
   ```

2. **Launch the app (first time only)**
   ```bash
   cd backend
   fly launch --no-deploy
   ```

   When prompted:
   - Choose app name (or accept suggested)
   - Select region (Seattle/sea recommended - closest to BC)
   - Don't deploy yet

3. **Set the API key as a secret**
   ```bash
   fly secrets set AISSTREAM_API_KEY=68340377beb0c1e2693b994286f9e2f8d8763af3
   ```

4. **Deploy the app**
   ```bash
   fly deploy
   ```

5. **Check status**
   ```bash
   fly status
   fly logs
   ```

6. **Get your app URL**
   ```bash
   fly info
   ```

   Your backend will be at: `https://your-app-name.fly.dev`

## API Endpoints

- `GET /` - Service info
- `GET /api/vessels` - Get all current vessel positions (JSON)
- `GET /api/status` - Get service status
- `WS /ws` - WebSocket for real-time updates

## Testing Locally

```bash
cd backend
npm install
export AISSTREAM_API_KEY=your_api_key_here
npm start
```

Visit http://localhost:8080 to see if it's working.

## Updating

To deploy updates:
```bash
fly deploy
```

## Monitoring

View logs:
```bash
fly logs
```

Check app status:
```bash
fly status
```
