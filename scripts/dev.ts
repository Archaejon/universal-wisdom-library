export {};

process.env.NODE_ENV = process.env.NODE_ENV ?? "development";
await import("./build");
await import("./serve");
