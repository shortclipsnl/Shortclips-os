-- Offertes: afspraken die betrouwbaar uit de PandaDoc-offerte zijn gelezen
-- (pakket, video's per maand, looptijd, maandbedrag) voor "Omzetten naar klant".
-- Idempotent (IF NOT EXISTS), zodat de migratie veilig is bij parallelle branches.
ALTER TABLE "quotes" ADD COLUMN IF NOT EXISTS "deal_terms" jsonb;
