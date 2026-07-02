# Accessibility Guide

## Goals

The experience should be simple, readable, and usable by a broad public event audience.

## Requirements

- Large touch targets.
- High-contrast UI.
- Clear permission prompts.
- Simple navigation.
- Safe-area support on modern mobile devices.
- No hidden critical controls.
- Plain-language error messages.

## Touch Targets

Interactive controls should be at least 44x44 CSS pixels, with sufficient spacing to avoid accidental taps.

## Visual Design

- Use high contrast for text and controls.
- Avoid relying on color alone to communicate state.
- Keep in-session controls minimal.
- Ensure text does not overlap controls on small screens.

## Motion And AR Considerations

- Avoid unnecessary flashing or rapid UI animation.
- Keep mascot idle animation gentle.
- Provide a clear way to exit the AR session.
- Keep fallback instructions concise.

## Screen Reader Scope

The AR canvas itself will have limited screen reader value. Non-AR UI must still use semantic buttons, labels, headings, and accessible error messages.

