import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The admin dashboard for the island's access management (see docs/licensing).
export default defineConfig({
	plugins: [react(), tailwindcss()],
	server: { port: 5174, strictPort: true },
	preview: { port: 5174, strictPort: true },
	build: { target: "es2022" },
});
