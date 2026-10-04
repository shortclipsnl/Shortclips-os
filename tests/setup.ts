/**
 * Tests draaien op een aparte PGlite-database in `.data/test-pglite`.
 * Daardoor kunnen ze naast de ontwikkelserver draaien zonder elkaar te
 * blokkeren, en beginnen ze altijd met een voorspelbare toestand.
 */
// NODE_ENV staat in de Node-types als alleen-lezen; hier zetten we hem bewust.
(process.env as Record<string, string>).NODE_ENV = "test";
process.env.DATABASE_DRIVER = "pglite";
process.env.PGLITE_DATA_DIR = ".data/test-pglite";
process.env.SESSION_SECRET =
  process.env.SESSION_SECRET ?? "test-secret-that-is-long-enough-to-pass-validation";
delete process.env.DATABASE_URL;
