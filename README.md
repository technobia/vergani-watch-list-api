# Vergani Watch List API

A lightweight serverless API for managing product watch lists in Shopify Company Location metafields, deployed on Cloudflare Workers.

## Features

- ✅ Add products to watch list
- ✅ Remove products from watch list
- ✅ Ultra-lightweight (Hono framework)
- ✅ Deployed on Cloudflare Workers (edge computing)
- ✅ Environment-based configuration

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure Wrangler:**
   
   The `wrangler.toml` file is already configured. You need to set your secrets:

   ```bash
   # Set Shopify store URL
   npx wrangler secret put SHOPIFY_STORE_URL
   # Enter: your-store.myshopify.com

   # Set Shopify access token
   npx wrangler secret put SHOPIFY_ACCESS_TOKEN
   # Enter: your_admin_api_access_token

   # Set company location ID
   npx wrangler secret put COMPANY_LOCATION_ID
   # Enter: gid://shopify/CompanyLocation/your_location_id
   ```

3. **Run locally:**
   ```bash
   npm run dev
   ```

4. **Deploy to Cloudflare Workers:**
   ```bash
   npm run deploy
   ```

## API Endpoints

### Add Product to Watch List
```bash
POST /api/watchlist/add
Content-Type: application/json

{
  "productId": "gid://shopify/Product/123456789"
}
```

**Response:**
```json
{
  "message": "Product added to watch list",
  "watchList": ["gid://shopify/Product/123456789", ...]
}
```

### Remove Product from Watch List
```bash
DELETE /api/watchlist/remove
Content-Type: application/json

{
  "productId": "gid://shopify/Product/123456789"
}
```

**Response:**
```json
{
  "message": "Product removed from watch list",
  "watchList": [...]
}
```

### Get Watch List (Optional)
```bash
GET /api/watchlist
```

**Response:**
```json
{
  "watchList": ["gid://shopify/Product/123456789", ...]
}
```

### Health Check
```bash
GET /health
```

**Response:**
```json
{
  "status": "ok"
}
```

## Local Development

Use `.env.example` as reference for local testing with Wrangler:

```bash
cp .env.example .dev.vars
# Edit .dev.vars with your actual values
```

Then run:
```bash
npm run dev
```

## Deployment

### First Time Setup
1. Login to Cloudflare:
   ```bash
   npx wrangler login
   ```

2. Set your secrets (as shown in Setup section above)

3. Deploy:
   ```bash
   npm run deploy
   ```

### Subsequent Deployments
Just run:
```bash
npm run deploy
```

Your API will be available at: `https://vergani-watch-list-api.<your-subdomain>.workers.dev`

## Tech Stack

- **Hono** - Ultra-lightweight web framework (3KB)
- **Cloudflare Workers** - Edge serverless platform
- **Wrangler** - Cloudflare Workers CLI
- **Shopify Admin API** - GraphQL metafields API

## Environment Variables

| Variable | Description | Set via |
|----------|-------------|---------|
| `SHOPIFY_STORE_URL` | Your Shopify store URL | `wrangler secret` |
| `SHOPIFY_ACCESS_TOKEN` | Admin API access token | `wrangler secret` |
| `COMPANY_LOCATION_ID` | Company location GID | `wrangler secret` |
| `SHOPIFY_API_VERSION` | API version (default: 2024-10) | `wrangler.toml` |

## Monitoring

View real-time logs:
```bash
npm run tail
```

## License

ISC

