# Queryable Intelligence Engine API

Production-ready profile API for Insighta Labs with:

- profile creation from external APIs
- strict database structure
- advanced filtering with combined conditions
- sorting and pagination
- rule-based natural language search
- idempotent seed process for 2026 records

## Base URL

- Local: `http://localhost:3000`
- Live: `https://<your-live-domain>`

## Tech Stack

- Node.js + Express
- MongoDB + Mongoose
- UUID v7 (`id`)

## Database Schema

Each profile follows this structure:

- `id` (UUID v7, primary key)
- `name` (string, unique)
- `gender` (`male` | `female`)
- `gender_probability` (float)
- `age` (int)
- `age_group` (`child` | `teenager` | `adult` | `senior`)
- `country_id` (2-letter ISO code)
- `country_name` (full country name)
- `country_probability` (float)
- `created_at` (timestamp)

All timestamps are returned in UTC ISO 8601.

## Environment Variables

Required:

- `MONGODB_URI`

Optional:

- `PORT` (default: `3000`)
- `UPSTREAM_TIMEOUT_MS` (default: `4000`)
- `SEED_FILE` (default: `./seed_profiles.json`)

## Setup and Run

```bash
npm install
npm run seed
npm start
```

## Seeding (2026 profiles)

Seed source file: `seed_profiles.json`

Script:

```bash
npm run seed
```

Behavior:

- validates expected profile count (`2026`)
- validates required fields per record
- upserts by unique `name` so reruns do not create duplicates
- creates UUID v7 only for new records

## Endpoints

### POST `/api/profiles`

Creates a profile by calling:

- Genderize
- Agify
- Nationalize

Request body:

```json
{ "name": "ella" }
```

Responses:

- `201` profile created
- `200` profile already exists
- `400` missing/empty `name`
- `422` invalid type
- `502` upstream response invalid

### GET `/api/profiles/:id`

Fetches a single profile by UUID.

Responses:

- `200` found
- `404` not found

### DELETE `/api/profiles/:id`

Deletes profile by UUID.

Responses:

- `204` deleted
- `404` not found

### GET `/api/profiles`

Advanced query endpoint with combined filters, sorting, and pagination.

Supported filters (combinable with AND):

- `gender`
- `age_group`
- `country_id`
- `min_age`
- `max_age`
- `min_gender_probability`
- `min_country_probability`

Sorting:

- `sort_by`: `age` | `created_at` | `gender_probability`
- `order`: `asc` | `desc`

Pagination:

- `page` default: `1`
- `limit` default: `10`, max: `50`

Example:

`GET /api/profiles?gender=male&country_id=NG&min_age=25&sort_by=age&order=desc&page=1&limit=10`

Response format:

```json
{
  "status": "success",
  "page": 1,
  "limit": 10,
  "total": 2026,
  "data": []
}
```

### GET `/api/profiles/search`

Rule-based natural language query endpoint.

Query params:

- `q` (required)
- `page` (optional, default `1`)
- `limit` (optional, default `10`, max `50`)

Example:

`GET /api/profiles/search?q=young males from nigeria&page=1&limit=10`

Supported mapping examples:

- `"young males"` -> `gender=male`, `min_age=16`, `max_age=24`
- `"females above 30"` -> `gender=female`, `min_age=30`
- `"people from angola"` -> country filter by country name/code match
- `"adult males from kenya"` -> `age_group=adult`, `gender=male`, country filter
- `"male and female teenagers above 17"` -> `age_group=teenager`, `min_age=17`

Rules:

- parser is deterministic and rule-based (no AI/LLMs)
- `"young"` maps to age `16-24` for parsing only
- if query cannot be interpreted:

```json
{
  "status": "error",
  "message": "Unable to interpret query"
}
```

## Validation Rules

Invalid query parameters return:

```json
{
  "status": "error",
  "message": "Invalid query parameters"
}
```

Status code behavior:

- `400` missing/empty required parameter
- `422` invalid type/value/query parameter
- `404` profile not found
- `500` internal server error
- `502` upstream provider failure

## Global Error Format

All errors use:

```json
{
  "status": "error",
  "message": "<error message>"
}
```

## CORS

CORS is enabled globally:

- `Access-Control-Allow-Origin: *`

## Test Commands

```bash
npm test
```

This runs syntax checks for `server.js` and `seed.js`.
