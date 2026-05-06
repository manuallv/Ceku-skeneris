# Čeku skeneris

Mobile-first Node.js/PWA receipt scanner for iPhone Safari and normal browser use. The app captures or uploads a receipt, detects/crops the document, straightens and enhances it, generates a clean PDF, extracts structured receipt data through a backend AI provider, validates the result strictly, and stores the receipt record for integration with an existing invoice/accounting database.

## Current Stack

- Frontend: React + Vite PWA
- Backend: Express on Node.js
- AI: backend-only OpenAI provider behind an extractor interface
- Database: existing MySQL-compatible accounting database when configured; local JSON repository only for development
- File storage: local controlled storage with an abstraction that can later move to S3/R2/MinIO
- PDF: deterministic server-side PDF generation with `pdf-lib`
- Deployment target: Hostinger Node.js Web App

The repository was empty when this project was initialized, so there was no existing framework, auth, DB library, schema, or deployment setup to preserve.

## Safety Rules

- Never commit `.env`.
- Never hardcode API keys, DB passwords, SSH keys, tokens, private URLs, or real credentials.
- `OPENAI_API_KEY` and DB credentials are backend-only.
- The browser never receives OpenAI or database credentials.
- Production migrations are opt-in and additive only.
- Do not run migrations against the existing accounting DB until the real schema has been inspected.
- Original receipt images are preserved as source evidence unless a future explicit delete/void workflow is approved.

## Local Setup

```bash
npm install
cp .env.example .env
npm run dev
```

Open the Vite dev URL, normally `http://localhost:5173`.

Backend API runs on `http://localhost:3000`; Vite proxies `/api` and `/files`.

## Environment Variables

See [.env.example](./.env.example).

Required for production:

- `PORT`: Hostinger-provided or configured app port
- `OPENAI_API_KEY`: backend-only OpenAI key
- `AI_MODEL`: image-capable model name; configurable for future replacement
- `DATABASE_URL` or `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`
- `LOCAL_STORAGE_DIR`: non-public upload storage directory
- `MAX_UPLOAD_BYTES`: upload limit, default 10 MB

Optional:

- `ALLOW_ADDITIVE_MIGRATIONS=true`: allows the app to create additive receipt tables. Keep this `false` in production until schema review is done.

## Database Integration

This project is designed to integrate with an existing invoice/accounting database. It does not assume production DB access.

Current behavior:

- If DB env vars are configured, the app uses the MySQL adapter.
- If DB env vars are missing, local development uses `storage/receipts.local.json`.
- Additive migration proposal is in [migrations/001_receipts_additive.mysql.sql](./migrations/001_receipts_additive.mysql.sql).
- Existing tables are not dropped, renamed, or rewritten.

Suggested receipt tables:

- `receipts`
- `receipt_files`
- `receipt_line_items`
- `receipt_vat_breakdown`
- `receipt_validation_results`
- `receipt_extraction_raw`
- `receipt_audit_log`

When your existing accounting DB schema is available, map receipt data to existing invoice/customer/company tables where appropriate and keep these receipt tables linked additively.

## Commands

```bash
npm run dev
npm run typecheck
npm test
npm run build
npm start
```

## Hostinger Deployment

Hostinger Node.js Web App should use:

- Node version: 22.x
- Install command: `npm install`
- Build command: `npm run build`
- Start command: `npm start`

Set all production env variables in Hostinger, not in GitHub. The app reads `process.env.PORT`, so it works with Hostinger’s assigned port.

Hostinger references:

- [Deploy Node.js application](https://www.hostinger.com/tutorials/deploy-node-js-application)
- [Node.js Web App deployment](https://www.hostinger.com/support/how-to-deploy-a-nodejs-website-in-hostinger/)
- [Environment variables](https://www.hostinger.com/support/how-to-add-environment-variables-during-node-js-application-deployment/)

## Receipt Flow

1. User opens the PWA on iPhone Safari.
2. User scans a receipt or uploads from gallery.
3. Original image is saved unchanged.
4. Browser detects receipt edges and shows draggable crop handles.
5. Browser straightens and enhances the receipt image.
6. Backend saves the processed image.
7. Backend generates and saves a clean PDF.
8. Backend sends the processed receipt image to the configured AI provider.
9. AI returns strict structured JSON.
10. Backend normalizes money to integer cents.
11. Validation decides `verified` or `needs_review`.
12. User can manually correct fields; audit log records edits.

## Receipt Statuses

- `uploaded`
- `image_processed`
- `extracted`
- `needs_review`
- `verified`
- `failed`

The app is intentionally conservative. A receipt becomes `verified` only when image quality, merchant, date, total, currency, line item math, VAT math, payment math, duplicate checks, processed image, PDF, and DB save all pass.

## Validation Rules

Validation checks include:

- required merchant/date/total/currency/files/raw extraction data
- line item sum vs totals
- VAT taxable amount + VAT = gross amount
- VAT total vs VAT rows
- payment total vs grand total and change
- date validity and future dates
- Latvian VAT number and registration number formats
- duplicate image hash and receipt identity hash
- image quality warnings
- malformed or missing AI output
- low confidence fields
- impossible numeric values

Any critical issue sets `needs_review`.

## File Storage

Files are saved outside public source folders under `LOCAL_STORAGE_DIR`.

Stored files include:

- original image
- processed image
- generated PDF
- optional raw AI JSON

Every stored file gets MIME type, byte size, safe filename, dimensions when available, and SHA-256 hash. `/files/:receiptId/:fileId` serves files through the backend route by receipt/file IDs. Real access control is intentionally postponed until the user and role system is added.

## AI Extraction

OpenAI calls happen only on the backend in `src/server/ai`.

The provider interface allows future replacement with:

- Azure Document Intelligence
- Veryfi
- Mindee
- Google Document AI
- other OCR/receipt providers

The current provider uses strict structured output and instructs the model to return `null` plus warnings instead of guessing. The model name is configured by `AI_MODEL`.

## Design Notes

The UI is iPhone-first and Latvian by default. It is inspired by Apple Human Interface Guidelines principles: clarity, deference to content, depth, accessible controls, safe-area support, large touch targets, light/dark mode, and restrained visual styling. It does not copy Apple apps, Apple icons, logos, trademarks, or protected visual identity.

## Security Checklist

- Upload MIME validation
- Upload size limit
- Backend-only AI and DB access
- Rate limiting for upload and API endpoints
- Safe error messages
- Secret redaction in logs
- Path traversal prevention
- No public upload directory listing
- Audit log for manual corrections and verification
- `.env` ignored by Git

## Known Limitations

- Production accounting DB schema has not been inspected yet because it was not provided.
- Local dev repository is JSON-file based and exists only to run the app before DB credentials are available.
- Browser-side document detection uses a lightweight Canvas heuristic to avoid native dependencies on shared hosting. It includes manual corner correction when confidence is low.
- HEIC upload is not accepted yet; iPhone camera capture through the browser normally produces JPEG.
- Real auth is intentionally not implemented yet; add users, roles, and file access control before opening this to untrusted public traffic.

## Manual QA

See [docs/manual-qa-iphone-safari.md](./docs/manual-qa-iphone-safari.md).
