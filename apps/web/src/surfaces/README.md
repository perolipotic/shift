# `surfaces/`

One snapshot loader per surface (AD-13). Each surface fetches a single composite
payload — configuration plus the exception layer for its window — under a single
TanStack Query key, and every figure on the screen is derived from that one
snapshot. Two figures on a screen may never come from two reads.

Surfaces narrow one canonical organization-snapshot type by selection; they do
not define parallel shapes of their own.
