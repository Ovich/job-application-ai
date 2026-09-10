/**
 * The package's public face: the schema, and the row aliases the API reads it through.
 *
 * There are no aliases yet because there are no tables yet (SL10). When the first one
 * lands, its `typeof <table>.$inferSelect` and `.$inferInsert` are named here rather
 * than in each caller (rule 2), so a row shape has one name in the repository.
 */
export * from "./schema";
