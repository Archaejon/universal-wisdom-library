import { getDb } from "../server/db";

const email = process.argv[2]?.trim();
const role = process.argv[3]?.trim() || "editor";
if (!email) {
  console.error("Usage: bun run scripts/make-editor.ts you@example.com [editor|admin|reader]");
  process.exit(1);
}
if (!["reader", "editor", "admin"].includes(role)) {
  console.error("Role must be reader, editor or admin.");
  process.exit(1);
}
const row = getDb().query("SELECT id, email, role FROM users WHERE email = ?").get(email) as
  | { id: number; email: string; role: string }
  | null;
if (!row) {
  console.error(`No account found for ${email}. Create the account in the app first.`);
  process.exit(1);
}
getDb().query("UPDATE users SET role = ? WHERE id = ?").run(role, row.id);
console.log(`Set ${row.email} to ${role}.`);
