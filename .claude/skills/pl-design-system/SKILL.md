---
name: pl-design-system
description: Use whenever building or editing UI for a PLN AI App. Covers the bundled PL Design System — instantiate React components from pl-design-system/components, use design tokens only, layout patterns, and the LabOS consume steps in USAGE.md. Load before writing any JSX/TSX/SCSS for the app.
---

# PL Design System

Companion to `AGENTS.md`. Source of truth for on-brand UI in this kit.

## Before you write UI

1. Read `pl-design-system/guidelines.md` (hard rules).
2. Read `pl-design-system/USAGE.md` (how to wire it into `app/`).
3. Check `pl-design-system/components/component-catalog.md` for the component you need.

## Hard rules

- **Instantiate, never recreate.** Import from `pl-design-system/components/<Name>`.
  Do not hand-roll Button, Input, Badge, Table, Tabs, Dropdown, Sidebar, cards, etc.
- **Tokens only.** Colors / type / spacing / radius / shadows come from
  `pl-design-system/tokens/` as CSS variables (`var(--foreground-neutral-primary)`,
  `var(--background-brand-default)`, `var(--spacing-md)`, `var(--radius-md)`,
  `var(--shadow-xs)`). Never hardcode hex, raw px type sizes, or Tailwind color utilities.
- **Layer 3 only** in component/layout styles — never `var(--global-color-*)` or
  `var(--semantic-*)`.
- Aesthetic: **structured · calm · technical · minimal**. No loud gradients, glow,
  heavy decorative shadows, or random accents.

## Consume in `app/` (Next.js 14)

Only `app/` is deployed. Copy the kit's `pl-design-system/` into `app/pl-design-system/`,
exclude it from `tsconfig` checking, install peer deps listed in `USAGE.md`, import
`styles/globals.scss` once in the root layout, and copy `public/fonts` into the app's
`public/fonts`. Import components from their folder (not only the barrel).

Start script must honor `PORT` and bind `0.0.0.0`:
`"start": "next start -p ${PORT:-3000} -H 0.0.0.0"`.

## Which component?

| Need | Reach for |
|---|---|
| Actions | `Button` |
| Text entry | `Input`, `Textarea`, `SearchInput` |
| Choice / toggle | `Checkbox`, `Switch`, `Dropdown`, `Tabs` |
| Status / meta | `Badge`, `Alert`, `Tooltip`, `EmptyState` |
| People / orgs | `Avatar`, `MemberCard` (dense), `MemberProfileCard` (hero), `TeamCard` |
| Data | `Table`, `Pagination`, `Progress` |
| Shell | `NavBar`, `Sidebar`, `BottomNav` (mobile), `PageHeader` |
| Overlay | `Drawer` (modal / drawer / bottom-sheet patterns in `patterns/overlay-patterns.md`) |
| Product cards | `ForumPostCard`, `FocusAreaCard`, `OfficeHoursCard`, `CTACard`, `WelcomeCard`, … |

Specs: `components/primitives/*.md`, `components/product/*.md`.
Layouts: `patterns/`. Page structure reference only: `examples/`.

**MemberCard vs MemberProfileCard:** many in a list → MemberCard; single hero subject → MemberProfileCard.

**Surfaces:** cards use elevation (`--shadow-xs` / `--shadow-sm`), no border at rest. Form controls use `--border-*`.

## Missing component

Prefer composing existing components + tokens. If you would have to invent a new
primitive, stop and tell the member: `Missing canonical component: [name]`.

## Sanity check

- Every interactive control is an import from `pl-design-system/components/`
- At most one primary Fill+Brand `Button` per section
- No hardcoded colors/spacing; no `X-Frame-Options` on the app
