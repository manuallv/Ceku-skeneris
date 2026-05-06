# Manual QA Checklist: iPhone Safari

Use a real iPhone on Safari where possible.

## Camera And Upload

- Camera permission prompt appears.
- Camera opens with rear camera.
- Safe-area/notch layout is respected.
- Capture button is reachable one-handed.
- Gallery upload works.
- Unsupported formats show a clear error.
- Large files are rejected safely.

## Crop And Image Processing

- Auto crop detects receipt edges.
- Low-confidence edge detection shows a warning.
- Manual corner handles are draggable.
- `Iztaisnot čeku` straightens the receipt.
- Processed image is readable.
- Dark, blurry, cut-off, or overexposed images show warnings.
- `Uzņemt vēlreiz` returns to camera.

## Backend Flow

- Original image is saved.
- Processed image is saved.
- PDF is generated.
- PDF opens in Safari.
- Extraction starts after processing.
- Slow extraction keeps visible progress states.
- Failed extraction shows a safe error and status `failed`.

## Data Extraction

- Merchant is extracted.
- Date and time are extracted.
- Total is extracted.
- VAT breakdown is extracted when visible.
- Payment data is extracted when visible.
- Line items are extracted.
- Unclear line items keep `raw_line_text` and low confidence.

## Validation

- Good receipt becomes `verified` only when all checks pass.
- Missing merchant/date/total becomes `needs_review`.
- VAT mismatch becomes `needs_review`.
- Payment mismatch becomes `needs_review`.
- Line item total mismatch becomes `needs_review`.
- Duplicate upload becomes `needs_review`.
- Blurry/cut-off images become `needs_review`.

## Review And Corrections

- Review screen shows receipt first on mobile.
- Fields can be edited.
- Line item names and totals can be edited.
- Manual correction saves.
- Validation reruns after correction.
- Audit log records correction.
- `Apstiprināt` is blocked when validation cannot verify.
- `Saglabāt kā jāpārbauda` works.

## List And Detail

- Receipt list loads.
- Search by merchant works.
- Status filter works.
- Status pills are readable in light and dark mode.
- Detail screen shows original image.
- Detail screen shows processed image.
- Detail screen links PDF.
- Raw JSON viewer is available for admin/debug.
- Audit log is visible.

## Accessibility And Visual QA

- Text is readable without zooming.
- Focus states are visible with keyboard/external keyboard.
- Touch targets are not tiny.
- No text overlaps on small iPhone screens.
- Dark mode is polished.
- Reduced motion setting does not break loading states.
