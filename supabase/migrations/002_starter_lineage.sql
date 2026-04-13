-- Starter lineage: generation counter + retirement flag + recursive lookup RPC.
-- Generation 1 = root refresh (batch.parent_item_id IS NULL); each subsequent
-- refresh increments parent's generation by 1 (handled in useCreateBatch).

ALTER TABLE items ADD COLUMN IF NOT EXISTS generation integer NOT NULL DEFAULT 0;
ALTER TABLE items ADD COLUMN IF NOT EXISTS retired_at timestamptz DEFAULT NULL;

UPDATE items SET generation = 1
WHERE type = 'starter'
  AND batch_id IN (SELECT id FROM batches WHERE parent_item_id IS NULL);

CREATE OR REPLACE FUNCTION get_starter_lineage(p_root_starter_id uuid)
RETURNS TABLE(
  id uuid, short_id text, batch_id uuid, weight_g numeric,
  generation int, created_at timestamptz, retired_at timestamptz,
  container_type text, parent_item_id uuid,
  flour_g numeric, water_g numeric, starter_g numeric
) AS $$
  WITH RECURSIVE tree AS (
    SELECT i.id, i.short_id, i.batch_id, i.weight_g, i.generation,
      i.created_at, i.retired_at, i.container_type,
      b.parent_item_id, b.flour_g, b.water_g, b.starter_g
    FROM items i
    JOIN batches b ON b.id = i.batch_id
    WHERE b.root_starter_id = p_root_starter_id
      AND i.type = 'starter' AND b.parent_item_id IS NULL
    UNION ALL
    SELECT i.id, i.short_id, i.batch_id, i.weight_g, i.generation,
      i.created_at, i.retired_at, i.container_type,
      b.parent_item_id, b.flour_g, b.water_g, b.starter_g
    FROM items i
    JOIN batches b ON b.id = i.batch_id
    JOIN tree t ON b.parent_item_id = t.id
    WHERE i.type = 'starter'
  )
  SELECT * FROM tree ORDER BY generation, created_at;
$$ LANGUAGE sql STABLE;
