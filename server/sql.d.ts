// `import schema from "./schema.sql" with { type: "text" }` yields the file's text.
declare module "*.sql" {
  const text: string;
  export default text;
}
