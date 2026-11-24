// `import file from "./x.png" with { type: "file" }` yields a path to the file
// (inside the executable, once compiled).
declare module "*.png" {
  const path: string;
  export default path;
}
