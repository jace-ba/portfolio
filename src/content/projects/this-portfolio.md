---
title: This portfolio
summary: A small Astro design system of tactile isometric buttons, theme splashes, and page swaps that never interrupt the header.
accent: tangerine
year: 2026
order: 4
---

## Isometric buttons

I wanted buttons that feel like tactile keys: they have depth, they have a responsive tilt based on cursor position, and they snap down when you press them.

### How it works

Each button is three layers:

- **The hole** reserves space for the button's depth, so pressing it never shifts the layout.
- **The tilt layer** follows the cursor. Its transform is written every animation frame with no transition, so it never lags behind the mouse.
- **The face** only animates press and release: a quick 70ms snap down and a springy 220ms pop back up.

The side face is drawn with stacked `box-shadow` layers along the tilt angle, and the edge color is a CSS variable, so it follows theme changes automatically.

### The tricky part

A pressed button should stay perfectly still. While it's seated, the tilt layer and the face move by equal and opposite amounts. Any transition on the face makes it trail the tilt layer by a few frames, which reads as wobble. The fix is to drop the face's transition once the press animation finishes, so both layers update in the same frame.

### Result

The buttons are used across this site: the navigation tiles, the theme toggle, and every call to action.

## Theme toggle

Of course, light and dark theme options are great for any computer. But the instant transition can be a little harsh for eyes, so I built and optimized a smooth splash that propagates through the screen and fades each on-screen element it touches to the target color.