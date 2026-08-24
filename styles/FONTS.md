# PLN Fonts

The PLN UI uses **Inter** as its primary typeface (weights 400 / 500 / 600).

**Building with the PL Design System (preferred)?** No font files are bundled.
Load Inter in the Next.js app via `next/font/google` (see
`pl-design-system/USAGE.md`), or from the CDN below.

**Plain-HTML / non-React app** using `styles/pln-theme.css`? Load Inter from the
CDN in your `<head>`:

```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet" />
```

Then rely on the `--pln-font-sans` variable from `pln-theme.css`.
