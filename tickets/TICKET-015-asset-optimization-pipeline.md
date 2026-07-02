# TICKET-015: Asset Optimization Pipeline

## Purpose

Create repeatable tooling and documentation for preparing DOST mascot assets.

## Dependencies

- TICKET-006

## Implementation Notes

- Add scripts or documented commands for GLB optimization.
- Apply Draco compression.
- Apply KTX2/BasisU texture compression.
- Validate triangle count and texture size.
- Validate required animation clips.
- Generate or update asset manifest metadata.

## Acceptance Criteria

- Placeholder assets can be processed.
- Asset validation fails when budgets are exceeded.
- Generated metadata includes size, triangle count, texture info, and animations.
- Pipeline instructions are documented.

## Testing Requirements

- Run pipeline on placeholder model.
- Add validation fixture if feasible.

## Risks And Pitfalls

- Over-compression can harm visual quality.
- Decoder paths must match deployed static asset paths.

## Complexity

Medium

