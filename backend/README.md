# BC Ferry AIS Tracker - Backend

This is the backend proxy server for the BC Ferry tracker. It connects to AISStream.io and serves vessel position data to the frontend.

## Deployment to Render (Free!)

### Prerequisites
- GitHub account
- Render account (sign up at https://render.com - it's free!)
- AISStream.io API key

### Quick Deploy Steps

1. **Push this code to GitHub** (already done!)

2. **Go to Render Dashboard**
   - Visit https://dashboard.render.com/
   - Click "New +" → "Web Service"

3. **Connect Your Repository**
   - Connect your GitHub account
   - Select the `BCferry` repository
   - Render will detect the backend folder

4. **Configure the Service**
   - **Name**: `bcferry-ais-tracker` (or whatever you want)
   - **Region**: Oregon (closest to BC)
   - **Branch**: `claude/bc-ferry-tracker-011CUPM3szWoeRrwuXesgHwB` (or your branch name)
   - **Root Directory**: `backend`
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Plan**: Free

5. **Add Environment Variable**
   - Scroll to "Environment Variables"
   - Click "Add Environment Variable"
   - Key: `AISSTREAM_API_KEY`
   - Value: `68340377beb0c1e2693b994286f9e2f8d8763af3`

6. **Deploy!**
   - Click "Create Web Service"
   - Wait 2-3 minutes for deployment

7. **Get Your URL**
   - After deployment, you'll see your URL like: `https://bcferry-ais-tracker.onrender.com`
   - Copy this URL!

8. **Update Frontend**
   - Edit `docs/app.js` line 564
   - Change `BACKEND_URL` to your Render URL
   - Commit and push to GitHub

### Alternative: Deploy Button (Even Easier!)

You can also deploy with one click using Render's deploy button. Just make sure to set the `AISSTREAM_API_KEY` environment variable after deployment.

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

## Important Notes

⚠️ **Free Tier Limitations:**
- Service spins down after 15 minutes of inactivity
- Takes 30-60 seconds to wake up on first request
- Perfect for personal projects!

✅ **For Always-On Service:**
- Upgrade to Render's paid plan ($7/month)
- Or use a cron job to ping the service every 10 minutes

## Monitoring

View logs in Render Dashboard:
- Click your service
- Click "Logs" tab
- See real-time logs

## Troubleshooting

**Service won't start?**
- Check that `AISSTREAM_API_KEY` environment variable is set
- Check logs for errors

**No ferries showing up?**
- Check `/api/status` endpoint - should show connected
- Check `/api/vessels` - should show vessel data
- Ferries may not be broadcasting if they're docked or it's late at night

**WebSocket connection failing from frontend?**
- Make sure frontend has correct backend URL
- Check CORS settings (should allow your GitHub Pages domain)
