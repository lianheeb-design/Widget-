/**
 * Creates the Ed25519 key pair for the license tokens.
 *
 *   bun scripts/license-keygen.ts [--write] [--secret-file <path>]
 *
 * - The private key goes to Supabase only, as the `LICENSE_SIGNING_KEY` secret
 *   of the `license` Edge Function. Never commit it or put it in the app.
 * - The public key goes into `src-tauri/license.json` (`publicKeys`), where the
 *   app uses it to check that a token really comes from the server.
 *
 * `--write` adds the public key to `src-tauri/license.json` directly.
 * `--secret-file <path>` writes the private key to that file, in the format of
 * `npx supabase secrets set --env-file <path>`, instead of printing it; delete
 * the file once the secret is set.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const secretFile = args.includes("--secret-file") ? args[args.indexOf("--secret-file") + 1] : undefined;
if (args.includes("--secret-file") && !secretFile) throw new Error("--secret-file needs a path");

const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
const privateKey = Buffer.from(await crypto.subtle.exportKey("pkcs8", pair.privateKey)).toString("base64");
const publicKey = Buffer.from(await crypto.subtle.exportKey("raw", pair.publicKey)).toString("base64");

if (secretFile) {
	writeFileSync(secretFile, `LICENSE_SIGNING_KEY=${privateKey}\n`, { mode: 0o600 });
	console.log(
		`Private key written to ${secretFile} (set it with \`npx supabase secrets set --env-file\`, then delete the file).`,
	);
} else {
	console.log("Private key (Supabase secret LICENSE_SIGNING_KEY, keep it secret):");
	console.log(privateKey);
}
console.log();
console.log("Public key (src-tauri/license.json → publicKeys):");
console.log(publicKey);

if (args.includes("--write")) {
	const file = resolve(import.meta.dirname, "../src-tauri/license.json");
	const config = JSON.parse(readFileSync(file, "utf8")) as { publicKeys?: string[] };
	config.publicKeys = [...(config.publicKeys ?? []), publicKey];
	writeFileSync(file, `${JSON.stringify(config, null, "\t")}\n`);
	console.log();
	console.log(`Added the public key to ${file}`);
}
