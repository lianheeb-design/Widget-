import { describe, expect, test } from "bun:test";
import { formatSize } from "./format";

describe("formatSize", () => {
	test("bytes stay whole", () => {
		expect(formatSize(0, "en")).toBe("0 B");
		expect(formatSize(512, "en")).toBe("512 B");
		expect(formatSize(1023, "en")).toBe("1023 B");
	});

	test("one decimal below 10, none above", () => {
		expect(formatSize(1536, "en")).toBe("1.5 KB");
		expect(formatSize(10 * 1024, "en")).toBe("10 KB");
		expect(formatSize(5.5 * 1024 * 1024, "en")).toBe("5.5 MB");
		expect(formatSize(48_000_000, "en")).toBe("46 MB");
		expect(formatSize(3 * 1024 ** 3, "en")).toBe("3.0 GB");
	});

	test("never shows 10.0 or a thousands separator", () => {
		expect(formatSize(9.99 * 1024, "en")).toBe("10 KB");
		expect(formatSize(1023.9 * 1024, "en")).toBe("1024 KB");
	});

	test("uses the language's decimal comma", () => {
		expect(formatSize(1536, "de")).toBe("1,5 KB");
	});

	test("a negative size counts as empty", () => {
		expect(formatSize(-5, "en")).toBe("0 B");
	});
});
