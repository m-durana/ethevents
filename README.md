# Sick Food Finder

Small Node/Express app that finds ETH-related events with likely free food and shows them in a filterable web UI.

Runs on `https://akuta.xyz/food`

## Run locally

Requires Node.js 18+.

```bash
npm install
npm start
```

Open `http://127.0.0.1:2096/food`.

## Scripts

```bash
npm run check   # syntax-check server and browser modules
npm test        # run unit tests
npm run audit   # audit production dependencies
```

## Configuration

Useful environment variables:

- `PORT`: server port, default `2096`
- `HOST`: bind host, default `127.0.0.1`
- `CLIENT_ROOT`: directory served at `/food`, default repo root
- `FETCH_TIMEOUT_MS`: upstream fetch timeout, default `15000`
- `RATE_LIMIT_PER_MINUTE`: API rate limit, default `120`
- `CORS_ORIGIN`: comma-separated allowed origins; unset allows all origins

The frontend calls the API at `/api/food/` by default. Override it before loading `index.js` with:

```html
<script>
  window.FOOD_FINDER_API_BASE = "https://example.com/api/food/";
</script>
```
