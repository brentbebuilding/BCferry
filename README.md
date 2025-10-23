# BC Ferry Tracker

A simple web application that displays real-time BC Ferry schedules and vessel capacity information.

## Live Demo

View the live application on GitHub Pages: **[BC Ferry Tracker](https://brentbebuilding.github.io/BCferry/)**

## Deployment Options

This project offers two deployment options:

1. **GitHub Pages (Static)** - The `docs/` folder contains a static version that runs entirely in the browser. Perfect for quick deployment without a server.
2. **Node.js Server** - The root folder contains a full Express server version with API proxy capabilities.

## Features

- Real-time ferry schedule data from BC Ferries
- Live capacity/fill percentage for each sailing
- Filter routes by terminal pairs
- Auto-refresh every 5 minutes
- Clean, responsive user interface
- Mobile-friendly design

## Technology Stack

- **Backend**: Node.js + Express (optional)
- **Frontend**: Vanilla JavaScript, HTML5, CSS3
- **Data Source**: [BC Ferries API](https://www.bcferriesapi.ca)

## Quick Start - GitHub Pages (Recommended)

The easiest way to use this application is through GitHub Pages:

1. Fork this repository
2. Go to your repository Settings > Pages
3. Under "Source", select "Deploy from a branch"
4. Select branch: `main` (or your default branch)
5. Select folder: `/docs`
6. Click Save
7. Your site will be published at `https://[your-username].github.io/BCferry/`

The static version in the `docs/` folder runs entirely in the browser and requires no server setup.

## Installation - Node.js Server Version

1. Clone the repository:
```bash
git clone <repository-url>
cd BCferry
```

2. Install dependencies:
```bash
npm install
```

3. Start the server:
```bash
npm start
```

4. Open your browser and navigate to:
```
http://localhost:3000
```

## Development

To run the application in development mode with auto-restart on file changes:

```bash
npm run dev
```

This requires `nodemon` which is included in the dev dependencies.

## API Endpoints

The application provides the following API endpoints:

- `GET /api/capacity` - Returns all ferry routes and sailing data
- `GET /api/route/:from/:to` - Returns data for a specific route (e.g., /api/route/TSA/SWB)
- `GET /api/health` - Health check endpoint

## Terminal Codes

Common BC Ferries terminal codes:

- **TSA** - Tsawwassen
- **SWB** - Swartz Bay
- **HSB** - Horseshoe Bay
- **NAN** - Nanaimo (Departure Bay)
- **DUK** - Duke Point
- **LNG** - Langdale
- **BOW** - Bowen Island
- **FUL** - Fulford Harbour
- **SGI** - Southern Gulf Islands

## Usage

1. The main page displays all available ferry routes with their current sailings
2. Use the dropdown filter to view a specific route
3. Click "Refresh Data" to manually update the information
4. Capacity is color-coded:
   - **Green**: Good availability (50%+)
   - **Yellow**: Moderate availability (25-49%)
   - **Red**: Limited availability (<25%)

## Configuration

You can configure the application using environment variables:

- `PORT` - Server port (default: 3000)

Create a `.env` file in the root directory:

```
PORT=3000
```

## Data Source

This application uses the unofficial [BC Ferries API](https://www.bcferriesapi.ca) which scrapes data from the official BC Ferries website.

**Note**: This application is not affiliated with BC Ferries. For official information, please visit [bcferries.com](https://www.bcferries.com).

## Project Structure

```
BCferry/
├── docs/                   # Static version for GitHub Pages
│   ├── index.html          # Main HTML file
│   ├── styles.css          # Stylesheet
│   ├── app.js              # Frontend JavaScript (calls API directly)
│   ├── _config.yml         # GitHub Pages config
│   └── .nojekyll          # Disable Jekyll processing
├── public/                 # Frontend for Node.js server version
│   ├── index.html          # Main HTML file
│   ├── styles.css          # Stylesheet
│   └── app.js              # Frontend JavaScript (calls local API)
├── server.js               # Express server (Node.js version)
├── package.json            # Dependencies and scripts
├── .gitignore             # Git ignore rules
└── README.md              # This file
```

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Troubleshooting

### Port already in use

If port 3000 is already in use, you can change it:

```bash
PORT=3001 npm start
```

### API data not loading

- Check your internet connection
- Verify the BC Ferries API is operational at https://www.bcferriesapi.ca
- Check the browser console for error messages

## Future Enhancements

Potential features for future versions:

- Route favoriting/bookmarking
- Push notifications for capacity changes
- Historical capacity data and trends
- Vessel tracking on map
- Schedule comparisons
- Mobile app version
