//! Git for the island's Git module, through the `git` command line (Git for
//! Windows). Pushing to GitHub signs in with Git Credential Manager, which
//! comes with Git for Windows and opens its own login window the first time.
//!
//! Errors are short codes the UI translates (`noGit`, `notRepo`, `identity`,
//! `nothingToCommit`, `noUpstream`, `rejected`, `auth`), or git's own last
//! lines when nothing more specific fits.

use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Serialize;
use serde_json::{Value, json};

pub fn action(action: &str, payload: &Value) -> Result<Value, String> {
    let repo = || -> Result<PathBuf, String> {
        let path = payload["repo"].as_str().ok_or("repo missing")?;
        let path = PathBuf::from(path);
        if !path.is_dir() {
            return Err("notFound".into());
        }
        Ok(path)
    };
    match action {
        "available" => Ok(json!({ "version": version() })),
        "pick" => Ok(json!(pick()?)),
        "status" => Ok(serde_json::to_value(status(&repo()?)?).unwrap_or_default()),
        "add" => {
            git(&repo()?, &["add", "--all"])?;
            Ok(Value::Null)
        }
        "commit" => {
            let message = payload["message"].as_str().unwrap_or_default().trim();
            if message.is_empty() {
                return Err("noMessage".into());
            }
            commit(&repo()?, message, payload["all"].as_bool().unwrap_or(false))?;
            Ok(Value::Null)
        }
        "push" => {
            push(&repo()?)?;
            Ok(Value::Null)
        }
        "pull" => {
            git(&repo()?, &["pull", "--ff-only"])?;
            Ok(Value::Null)
        }
        "clone" => {
            let url = payload["url"].as_str().unwrap_or_default().trim();
            let parent = PathBuf::from(payload["parent"].as_str().ok_or("parent missing")?);
            Ok(json!(clone(url, &parent)?))
        }
        "identity" => {
            let name = payload["name"].as_str().unwrap_or_default().trim();
            let email = payload["email"].as_str().unwrap_or_default().trim();
            if name.is_empty() || email.is_empty() {
                return Err("identityMissing".into());
            }
            run(None, &["config", "--global", "user.name", name])?;
            run(None, &["config", "--global", "user.email", email])?;
            Ok(Value::Null)
        }
        other => Err(format!("git: unsupported action '{other}'")),
    }
}

/// `git version 2.47.1.windows.1` → `2.47.1.windows.1`; `None` without Git.
fn version() -> Option<String> {
    let out = run(None, &["--version"]).ok()?;
    Some(out.trim().trim_start_matches("git version ").to_owned())
}

fn command(dir: Option<&Path>) -> Command {
    let mut cmd = Command::new("git");
    if let Some(dir) = dir {
        cmd.current_dir(dir);
    }
    // Never wait on a terminal prompt nobody can see; the credential manager's
    // own login window still appears.
    cmd.env("GIT_TERMINAL_PROMPT", "0").env("LC_ALL", "C");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(super::CREATE_NO_WINDOW);
    }
    cmd
}

/// Runs git and returns stdout, or a short error code / git's message.
fn run(dir: Option<&Path>, args: &[&str]) -> Result<String, String> {
    let out = command(dir).args(args).output().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            "noGit".to_owned()
        } else {
            e.to_string()
        }
    })?;
    if out.status.success() {
        return Ok(String::from_utf8_lossy(&out.stdout).into_owned());
    }
    let stderr = String::from_utf8_lossy(&out.stderr);
    let stdout = String::from_utf8_lossy(&out.stdout);
    Err(classify(&format!("{stderr}\n{stdout}")))
}

fn git(repo: &Path, args: &[&str]) -> Result<String, String> {
    run(Some(repo), args)
}

fn classify(text: &str) -> String {
    let lower = text.to_lowercase();
    let code = if lower.contains("not a git repository") {
        "notRepo"
    } else if lower.contains("please tell me who you are") || lower.contains("user.email") {
        "identity"
    } else if lower.contains("nothing to commit") || lower.contains("no changes added to commit") {
        "nothingToCommit"
    } else if lower.contains("has no upstream branch")
        || lower.contains("no configured push destination")
    {
        "noUpstream"
    } else if lower.contains("[rejected]")
        || lower.contains("non-fast-forward")
        || lower.contains("fetch first")
    {
        "rejected"
    } else if lower.contains("authentication failed")
        || lower.contains("could not read username")
        || lower.contains("permission denied")
        || lower.contains("terminal prompts disabled")
    {
        "auth"
    } else if lower.contains("not possible to fast-forward") || lower.contains("diverging") {
        "diverged"
    } else if lower.contains("could not resolve host") || lower.contains("unable to access") {
        "network"
    } else {
        ""
    };
    if !code.is_empty() {
        return code.to_owned();
    }
    // Git's last few meaningful lines, for anything else.
    let lines: Vec<&str> = text
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty() && !l.starts_with("hint:"))
        .collect();
    let tail = &lines[lines.len().saturating_sub(2)..];
    let message = tail.join(" ");
    if message.is_empty() {
        "failed".into()
    } else {
        message.chars().take(240).collect()
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    root: String,
    branch: Option<String>,
    upstream: Option<String>,
    ahead: u32,
    behind: u32,
    /// `owner/repo` when `origin` points at GitHub.
    github: Option<String>,
    files: Vec<FileChange>,
    staged: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FileChange {
    path: String,
    /// `added`, `modified`, `deleted`, `renamed`, `untracked`, `conflict`.
    kind: &'static str,
    staged: bool,
}

fn status(repo: &Path) -> Result<Status, String> {
    let root = git(repo, &["rev-parse", "--show-toplevel"])?
        .trim()
        .to_owned();
    let out = git(
        repo,
        &[
            "status",
            "--porcelain=v2",
            "--branch",
            "--untracked-files=all",
        ],
    )?;
    let mut status = Status {
        root,
        branch: None,
        upstream: None,
        ahead: 0,
        behind: 0,
        github: None,
        files: Vec::new(),
        staged: 0,
    };
    for line in out.lines() {
        if let Some(head) = line.strip_prefix("# branch.head ") {
            status.branch = (head != "(detached)").then(|| head.to_owned());
        } else if let Some(up) = line.strip_prefix("# branch.upstream ") {
            status.upstream = Some(up.to_owned());
        } else if let Some(ab) = line.strip_prefix("# branch.ab ") {
            for part in ab.split_whitespace() {
                if let Some(n) = part.strip_prefix('+') {
                    status.ahead = n.parse().unwrap_or(0);
                } else if let Some(n) = part.strip_prefix('-') {
                    status.behind = n.parse().unwrap_or(0);
                }
            }
        } else if let Some(path) = line.strip_prefix("? ") {
            status.files.push(FileChange {
                path: path.to_owned(),
                kind: "untracked",
                staged: false,
            });
        } else if line.starts_with("1 ") || line.starts_with("2 ") || line.starts_with("u ") {
            let mut parts = line.splitn(
                if line.starts_with("1 ") {
                    9
                } else if line.starts_with("2 ") {
                    10
                } else {
                    11
                },
                ' ',
            );
            let tag = parts.next().unwrap_or_default();
            let xy = parts.next().unwrap_or("..");
            let rest: Vec<&str> = parts.collect();
            let path = rest.last().copied().unwrap_or_default();
            // Renames carry "new\told".
            let path = path.split('\t').next().unwrap_or(path).to_owned();
            let (x, y) = (
                xy.chars().next().unwrap_or('.'),
                xy.chars().nth(1).unwrap_or('.'),
            );
            let staged = x != '.';
            let code = if staged { x } else { y };
            let kind = if tag == "u" {
                "conflict"
            } else {
                match code {
                    'A' => "added",
                    'D' => "deleted",
                    'R' | 'C' => "renamed",
                    _ => "modified",
                }
            };
            if staged {
                status.staged += 1;
            }
            status.files.push(FileChange { path, kind, staged });
        }
    }
    status.github = git(repo, &["remote", "get-url", "origin"])
        .ok()
        .and_then(|url| github_slug(url.trim()));
    Ok(status)
}

/// `https://github.com/owner/repo(.git)` or `git@github.com:owner/repo.git` → `owner/repo`.
fn github_slug(url: &str) -> Option<String> {
    let rest = url
        .strip_prefix("https://github.com/")
        .or_else(|| url.strip_prefix("http://github.com/"))
        .or_else(|| url.strip_prefix("git@github.com:"))
        .or_else(|| url.strip_prefix("ssh://git@github.com/"))?;
    let slug = rest.trim_end_matches('/').trim_end_matches(".git");
    (slug.split('/').count() == 2).then(|| slug.to_owned())
}

fn commit(repo: &Path, message: &str, all: bool) -> Result<(), String> {
    if all {
        git(repo, &["add", "--all"])?;
    }
    git(repo, &["commit", "-m", message]).map(|_| ())
}

/// Pushes the current branch, setting its upstream on the first push.
fn push(repo: &Path) -> Result<(), String> {
    match git(repo, &["push"]) {
        Err(code) if code == "noUpstream" => {
            let branch = git(repo, &["rev-parse", "--abbrev-ref", "HEAD"])?
                .trim()
                .to_owned();
            git(repo, &["push", "--set-upstream", "origin", &branch]).map(|_| ())
        }
        other => other.map(|_| ()),
    }
}

/// Clones into `parent` and returns the new folder.
fn clone(url: &str, parent: &Path) -> Result<String, String> {
    let url = if url.contains("://") || url.starts_with("git@") {
        url.to_owned()
    } else {
        // `owner/repo` shorthand.
        let slug = url.trim_matches('/');
        if slug.split('/').count() != 2 || slug.contains(' ') {
            return Err("badUrl".into());
        }
        format!("https://github.com/{slug}.git")
    };
    let name = url
        .trim_end_matches('/')
        .trim_end_matches(".git")
        .rsplit(['/', ':'])
        .next()
        .filter(|n| !n.is_empty())
        .ok_or("badUrl")?
        .to_owned();
    let target = parent.join(&name);
    if target.exists() {
        return Err("exists".into());
    }
    run(Some(parent), &["clone", "--", &url, &name])?;
    Ok(target.to_string_lossy().into_owned())
}

fn pick() -> Result<Option<String>, String> {
    Ok(crate::dialog::pick_folder())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn github_slugs() {
        assert_eq!(
            github_slug("https://github.com/a/b.git").as_deref(),
            Some("a/b")
        );
        assert_eq!(
            github_slug("git@github.com:a/b.git").as_deref(),
            Some("a/b")
        );
        assert_eq!(github_slug("https://gitlab.com/a/b.git"), None);
    }

    #[test]
    fn classifies_errors() {
        assert_eq!(
            classify("fatal: The current branch main has no upstream branch."),
            "noUpstream"
        );
        assert_eq!(classify("*** Please tell me who you are."), "identity");
        assert_eq!(
            classify("nothing to commit, working tree clean"),
            "nothingToCommit"
        );
    }
}
