---
name: pl-design-system
description: Use whenever building or editing UI for a PLN (or PL) AI App. Covers the bundled PL Design System — instantiate React components from pl-design-system/components, use semantic Tailwind tokens only, page recipes, and the LabOS consume steps in USAGE.md. Load before writing any JSX/TSX/CSS for the app.
---

# PL Design System

Companion to `AGENTS.md`. Source of truth for on-brand UI in this kit.

## Before you write UI

1. Read `pl-design-system/guidelines.md` (hard rules).
2. Read `pl-design-system/USAGE.md` (how to wire it into `app/`).
3. Check `pl-design-system/components/index.ts` for the component you need.
4. For page shape, use the recipes in `pl-design-system/README.md` (list / detail / campaign).

## Hard rules

- **Instantiate, never recreate.** Import from `pl-design-system/components` (barrel)
  or `pl-design-system/components/<Name>`. Do not hand-roll Button, Input, Badge,
  Table, Tabs, Menu, PageShell, cards, etc.
- **Semantic tokens only.** Layout glue uses Tailwind utilities backed by the
  theme bridge (`bg-surface`, `text-secondary`, `border-border`, `shadow-card`,
  `rounded-lg`, `gap-4`). Never hardcode hex, palette utilities (`slate-*`,
  `bg-white`), or `--pl-*` primitives in app styles.
- Prefer **`EntityCard`** for listings. **Tag** = category; **Badge** = fact about
  an entity.
- Aesthetic: **structured · calm · technical · minimal**. No loud gradients, glow,
  heavy decorative shadows, or random accents.

## Consume in `app/` (Next.js + Tailwind v4)

Only `app/` is deployed. Copy the kit's `pl-design-system/` into `app/pl-design-system/`,
install peer deps listed in `USAGE.md` (`tailwindcss@^4`, `@tailwindcss/postcss`,
`tailwind-merge`, React, Next), and in root CSS:

```css
@import "tailwindcss";
@source "../pl-design-system/components";
@import "../pl-design-system/tokens/tokens.css";
@import "../pl-design-system/tokens/tailwind-theme.css";
```

`@source` is required so utilities inside vendored components are generated.
Load Inter via `next/font/google` (no font files are bundled). Import from the
barrel: `import { Button, EntityCard, PageShell } from '../pl-design-system/components'`.

Start script must honor `PORT` and bind `0.0.0.0`:
`"start": "next start -p ${PORT:-3000} -H 0.0.0.0"`.

## Which component?

| Need | Reach for |
|---|---|
| Actions | `Button`, `IconButton` |
| Text entry | `Input`, `TextArea`, `SearchInput`, `Field` |
| Choice / toggle | `Checkbox`, `Toggle`, `Select` / `Menu*`, `Tabs` |
| Status / meta | `Badge`, `StatusDot`, `Tag` / `TagList`, `Alert`, `Tooltip`, `EmptyState` |
| People / orgs | `Avatar` / `AvatarStack`, `MemberCard`, `EntityCard` (listings) |
| Data | `Table*`, `Pagination`, `ProgressBar`, `ProgressCircle`, `Sparkline`, `Trend` |
| Shell | `PageShell`, `PageHeader`, `ListGrid`, `Navbar`, `FilterPanel` |
| Overlay | `Modal`, `Drawer` |
| Detail page | `Card`, `MetaRow`, `DetailSection`, `Breadcrumbs`, `ContactList` |

**Surfaces:** page `bg-canvas`, cards `bg-surface` + `shadow-card` (hover `shadow-raised`).

## Missing component

Prefer composing existing components + semantic tokens. If you would have to invent
a new primitive, stop and tell the member: `Missing canonical component: [name]`.

## Sanity check

- Every interactive control is an import from `pl-design-system/components`
- At most one primary `Button` per section
- No hardcoded colors/spacing; no palette utilities; no `X-Frame-Options` on the app
