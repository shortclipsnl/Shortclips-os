-- Finance uitsluitend voor de eigenaar: verwijder alle finance-rechten
-- (finance:read, finance:write, finance:read_costs) bij de rollen 'admin' en
-- 'finance'. De eigenaar (owner) heeft deze rechten via zijn volledige set en
-- behoudt ze. Idempotent: opnieuw draaien verwijdert niets extra's.
DELETE FROM "role_permissions"
WHERE "role_id" IN (SELECT "id" FROM "roles" WHERE "key" IN ('admin','finance'))
  AND "permission_id" IN (SELECT "id" FROM "permissions" WHERE "key" LIKE 'finance:%');
