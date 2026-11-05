# Safira Frontend

The React-based frontend for Safira, a women-first safety and wellness platform.

## 🚀 Getting Started

### Prerequisites
- Node.js (v18+)
- npm or yarn

### Installation
```bash
npm install
```

### Development
```bash
npm run dev
```

### Build for Production
```bash
npm run build
```

---

## 🛠️ Technology Stack

- **Framework**: [React 19](https://react.dev/)
- **Build Tool**: [Vite 8](https://vitejs.dev/)
- **Styling**: [Tailwind CSS 4](https://tailwindcss.com/)
- **Navigation**: [React Router 7](https://reactrouter.com/)
- **Maps**: [Leaflet](https://leafletjs.org/) & [React Leaflet](https://react-leaflet.js.org/)
- **Icons**: [Lucide React](https://lucide.dev/)
- **Data Fetching**: [Axios](https://axios-http.com/)
- **Real-time**: Socket.IO client with one shared authenticated connection.

Set `VITE_API_URL` to the backend API URL (including `/api`). Socket.IO uses that
backend host by default; set `VITE_SOCKET_URL` only when the socket server uses a
different origin. The shared safety-tracking context owns location state and starts
one `watchPosition()` watcher only after `startTracking()` is requested. Its
`useSafetyTracking()` hook shares tracking state, start/stop actions, authorized
contact subscription actions, and received contact locations across pages.

### Safe Route Navigation

The Map page uses the public OSRM driving router for up to three route alternatives
and Nominatim for user-submitted destination searches. Route corridors are evaluated
with one backend Overpass request and cached for 10 minutes. No API key is required.
`VITE_ROUTING_URL` can point to a compatible OSRM instance; the default public
router is intended for modest/demo use and may be rate-limited. Consider a
self-hosted or contracted routing service for production traffic. The public
Nominatim service is queried only after the user submits a search (not as autocomplete).

---

## 📁 Key Directories

- `src/assets`: Brand images, backgrounds, and hero illustrations.
- `src/components`: UI components organized by feature (Landing, Dashboard, SOS, Map).
- `src/hooks`: Custom hooks for Auth logic and Geolocation streaming.
- `src/pages`: Full-screen views (Map, SOS, Wellness, Pricing).
- `src/router`: Route definitions and protected route wrappers.
- `src/utils`: Centralized API configuration and constants.

---

## ✨ Design Principles
- **Clarity**: High-contrast SOS buttons and navigation.
- **Calmness**: Earthy color palette to reduce user anxiety during emergencies.
- **Responsiveness**: Optimized for mobile-first usage in real-world scenarios.
