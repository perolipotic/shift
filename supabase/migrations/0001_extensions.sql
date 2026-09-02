-- 0001_extensions.sql
--
-- Forward-only. Once this file has been promoted past local it is never edited;
-- a correction is a new migration with a higher number.
--
-- btree_gist is required to combine an equality column with a range column in
-- `exclude using gist`, which AD-3's leave-overlap exclusion constraint needs
-- once leave_records lands. Enabling it here means the constraint that makes
-- overlapping leave unrepresentable can be written as pure schema shape.

create extension if not exists btree_gist;
