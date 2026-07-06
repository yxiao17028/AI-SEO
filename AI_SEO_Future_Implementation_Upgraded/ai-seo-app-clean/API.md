# Internal API Summary

## GET /api/providers
Returns provider labels, adapter type, default model and availability note. Base URLs are intentionally not exposed.

## POST /api/ai/test-connection
Authenticated endpoint.

Request:
```json
{"provider":"demo","model":"local-demo","api_key":""}
```

Response:
```json
{"success":true,"message":"Demo Mode is ready."}
```

## Main form routes
- `POST /register`
- `POST /login`
- `POST /websites`
- `POST /websites/<id>/delete`
- `POST /analyze/<website_id>`
- `POST /ai`

The MVP uses server-rendered forms for reliability and simpler assessment. The provider connection test is asynchronous JSON.
