# PLN Fonts

The PLN UI uses **Inter** as its primary typeface.

**Building with the PL Design System (preferred)?** The Inter variable font is
already self-hosted in `pl-design-system/public/fonts/` and wired up by
`pl-design-system/styles/globals.scss` — see `pl-design-system/USAGE.md`. You
don't need anything here.

**Plain-HTML / non-React app** using `styles/pln-theme.css`? Load Inter from the
CDN in your `<head>`:

```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
```

Then rely on the `--pln-font-sans` variable from `pln-theme.css`.
