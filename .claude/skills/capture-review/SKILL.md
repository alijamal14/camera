---
name: capture-review
description: Review captured 480x640 JPEGs from the harness against the framing, segmentation and quality targets. Use when the user asks to review captured photos.
---

# Capture review

Captures live only in browser memory. Ask the user to click "Download JPEG" (default name
`photo-480x640.jpg`, usually in Downloads) or paste images; ask for the audit table too.

For each image:

1. File: `image/jpeg`, exactly 480x640, <= 30,000 bytes (`ls -l`, or read dimensions).
2. Framing (Class B targets, advisory in this profile): head chin-to-crown 70-80% of height,
   eye midpoint 35-45% from top and 47.5-52.5% across, roll <= 3 degrees.
3. Segmentation: hair halos or clipped hair, missing ears/shoulders, white clothing merging into
   the background, background left between arm and body, chair parts.
4. Lighting: one-sided shadow, under-jaw shadow, clipped highlights, glare on glasses, colour cast.
5. Expression: eyes open, mouth closed, neutral; no headwear or occlusion.
6. Compression: blocking or smearing around eyes and hair from the byte cap.

Report per image: pass / advisory issues / hard failures, with the fix (lighting, distance,
pose) or the code area to change (`src/browser/compositor.js` threshold, `src/geometry.js`
framing, `src/browser/encoder.js` quality floor). Do not call any result NADRA-compliant.
