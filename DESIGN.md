# Design Direction — Astro CMS

## What this is

Internal editor UI for a self-hosted, single-repo Astro CMS. Used daily by a small team to write/edit Markdown/MDX, manage frontmatter, browse media, and publish via GitHub PRs. Not a marketing site — no landing page, no public-facing chrome.

## Identity & personality

Confident, modern SaaS: Stripe/Vercel register. Polished and has visual presence, but stays restrained — the tool disappears behind the writing, it doesn't compete with it.

## Palette

- Neutral base: slate/grey scale, both light and dark, since editors write for long stretches.
- One accent: **terracotta/amber** (`#C2653A`-family), not the default AI blue-purple. Reason: distinguishes this tool from generic SaaS-blue defaults and echoes an "editorial/ink" warmth appropriate to a writing tool, without becoming decorative.
- Max palette: neutral scale + 1 accent (per R-29). Status colors (success/error/warning) are separate, functional, and used only for state, never decoration.

## Typography

- UI chrome (nav, buttons, forms, frontmatter panel): a grotesk sans, reason: needs to be quiet and functional so it doesn't compete with document content.
- Editor content area (the Tiptap surface itself): a serif or humanist reading face, reason: the editor is where people spend their time reading/writing prose — it should feel like writing, not like filling out a form. This is a deliberate contrast with the UI chrome, not an accident.
- Exact families to be chosen at implementation time against this reasoning (not defaulted to Inter/Geist because they're the model's habit).

## Theme

Light/dark toggle, both fully styled and verified (per R-21/R-34). No theme forced by default.

## Dials

ENERGY 2 / RHYTHM 2 / MOTION 2 — Balanced. Some visual presence and section variation (frontmatter panel, editor canvas, media grid, publish flow all look distinct from each other), motion limited to purposeful transitions (autosave state, publish status, drag states) — no scroll choreography, this is a tool not a showcase.

## Explicit non-goals

- No marketing patterns: no hero/feature-grid/testimonials/pricing — none of that applies to an internal tool.
- No fabricated stats, badges, or trust signals.
- No glassmorphism-as-default, no glow, no AI-default icon set without relevance check.
