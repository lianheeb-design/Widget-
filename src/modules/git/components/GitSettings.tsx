import { FolderPlusIcon, Trash2Icon } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { Button } from "../../../components/ui/button";
import { Block, Desc, Divider, Row } from "../../../components/ui/card";
import { Input } from "../../../components/ui/form";
import { useT } from "../../../core/i18n";
import { setSetting, useSetting } from "../../../core/settings";
import { git, gitError } from "../api";
import { gitCurrent, gitRepos, repoName } from "../settings";

/** Repositories (add, clone, remove) and the name Git signs commits with. */
export function GitSettings() {
	const t = useT();
	const repos = useSetting(gitRepos);
	const [version, setVersion] = useState<string | null | undefined>(undefined);
	const [error, setError] = useState<string | null>(null);
	const [url, setUrl] = useState("");
	const [cloning, setCloning] = useState(false);
	const [name, setName] = useState("");
	const [email, setEmail] = useState("");
	const [identity, setIdentity] = useState<string | null>(null);

	useEffect(() => {
		git<{ version: string | null }>("available")
			.then((r) => setVersion(r.version))
			.catch(() => setVersion(null));
	}, []);

	const add = (path: string) => {
		if (repos.includes(path)) {
			setError(t("git.repos.duplicate"));
			return;
		}
		setSetting(gitRepos, [...repos, path]);
		setSetting(gitCurrent, path);
		setError(null);
	};

	const pick = async () => {
		const path = await git<string | null>("pick").catch(() => null);
		if (path) add(path);
	};

	const remove = (path: string) =>
		setSetting(
			gitRepos,
			repos.filter((r) => r !== path),
		);

	const clone = async (e: FormEvent) => {
		e.preventDefault();
		if (!url.trim()) return;
		const parent = await git<string | null>("pick").catch(() => null);
		if (!parent) return;
		setCloning(true);
		setError(null);
		try {
			const path = await git<string>("clone", { url, parent });
			add(path);
			setUrl("");
		} catch (err) {
			setError(gitError(t, err));
		} finally {
			setCloning(false);
		}
	};

	const saveIdentity = async (e: FormEvent) => {
		e.preventDefault();
		try {
			await git("identity", { name, email });
			setIdentity(t("git.identity.saved"));
		} catch (err) {
			setIdentity(gitError(t, err));
		}
	};

	return (
		<>
			<Block>
				<Row
					label={t("git.repos.title")}
					desc={version === null ? t("git.noGit") : t("git.repos.desc")}
					descTone={version === null ? "error" : undefined}
				>
					<Button onClick={pick} disabled={version === null}>
						<FolderPlusIcon size={13} />
						{t("git.repos.add")}
					</Button>
				</Row>
				{repos.map((path) => (
					<div key={path} className="flex items-center gap-2 text-[13px]">
						<span className="font-[650]">{repoName(path)}</span>
						<span className="min-w-0 flex-1 truncate text-text-faint" title={path}>
							{path}
						</span>
						<button
							type="button"
							className="grid size-7 place-items-center rounded-full text-text-faint hover:bg-white/10 hover:text-text"
							title={t("git.repos.remove")}
							onClick={() => remove(path)}
						>
							<Trash2Icon size={13} />
						</button>
					</div>
				))}
				{version && <Desc>{t("git.found", { version })}</Desc>}
			</Block>
			<Divider />
			<Block>
				<Row label={t("git.clone.title")} desc={t("git.clone.desc")} />
				<form className="flex gap-2" onSubmit={clone}>
					<Input
						className="flex-1"
						value={url}
						placeholder={t("git.clone.placeholder")}
						spellCheck={false}
						onChange={(e) => setUrl(e.target.value)}
					/>
					<Button type="submit" variant="primary" disabled={cloning || !url.trim() || version === null}>
						{cloning ? t("git.clone.busy") : t("git.clone.action")}
					</Button>
				</form>
				{error && <Desc tone="error">{error}</Desc>}
			</Block>
			<Divider />
			<Block>
				<Row label={t("git.identity.title")} desc={t("git.identity.desc")} />
				<form className="flex gap-2" onSubmit={saveIdentity}>
					<Input
						className="flex-1"
						value={name}
						placeholder={t("git.identity.name")}
						onChange={(e) => setName(e.target.value)}
					/>
					<Input
						className="flex-1"
						type="email"
						value={email}
						placeholder={t("git.identity.email")}
						onChange={(e) => setEmail(e.target.value)}
					/>
					<Button type="submit" disabled={!name.trim() || !email.trim() || version === null}>
						{t("git.identity.save")}
					</Button>
				</form>
				{identity && <Desc>{identity}</Desc>}
			</Block>
		</>
	);
}
