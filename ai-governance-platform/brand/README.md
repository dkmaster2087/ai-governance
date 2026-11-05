# Probaline brand

The mark is a plumb line: a bar, one true line and a brass plumb bob. A plumb line proves a wall is straight; Probaline proves AI goes through a control.

## Files

| File | Use |
|---|---|
| `probaline-mark.svg` | Mark on light backgrounds (ink line, brass bob) |
| `probaline-mark-reversed.svg` | Mark on navy or dark backgrounds (white line, light brass bob) |
| `probaline-mark-mono.svg` | One color (`currentColor`), for stamps, print and single-color uses |
| `probaline-icon.svg` | App icon: navy tile with the reversed mark |
| `probaline-icon-small.svg` | Same tile, mark drawn larger for 16–32 px; used as every app's `favicon.svg` |
| `probaline-lockup.svg`, `probaline-lockup-reversed.svg` | Mark + name. The name is live text in Archivo Bold, so it needs Archivo installed; outline it before sending to print or partners |
| `icon-16.png` … `icon-512.png` | Raster icons (extension, touch icon, store listings, social) |

## Wordmark

"Probaline" in Archivo Bold, title case, letter spacing −1.5%. Leave clear space around the lockup equal to the height of the bob.

## Colors (Ink & Brass)

| Token | Light | Dark | Use |
|---|---|---|---|
| `ink` | `#14213D` | `#E6EAF2` | Text, logo line, primary buttons |
| `brass` | `#B07D2B` | `#D9AE5F` (`brass-on-dark`) | Logo bob, focus rings, one highlight per screen. Never a status |
| `brass-text` | `#8A5F18` | `#D9AE5F` | Brass used as text (meets 4.5:1) |
| `ink-muted` | `#5A6478` | `#9AA6BA` | Secondary text |
| `canvas` | `#F6F7F9` | `#0B1222` | Page background |
| surface | `#FFFFFF` | `#121B2E` | Cards, tables |
| `line` | `#E3E6EC` | `#24304A` | Borders |
| `allowed` | `#1F7A5A` | `#5CC49A` | Gateway outcome: passed every rule |
| `masked` | `#2F5DA8` | `#8FB0F0` | Gateway outcome: personal data hidden, request sent |
| `stop` | `#C8322A` | `#F0776E` | Gateway outcome: stopped. The only red anywhere |

Every text color meets WCAG AA (4.5:1) on canvas and surface in both themes. Brass on white is 3.6:1, so use `brass` for shapes and `brass-text` for words.

The tokens live in each app's `tailwind.config.js` (website, dashboard, docs).
