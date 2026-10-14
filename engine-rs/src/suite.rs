//! The conformance suite as the harness finds it on disk. Part of the
//! `conformance` feature (tier 2 in API.md), beside the scenario runner and
//! the `.TDT` referee that read through it.
use std::path::{Component, Path, PathBuf};

/// Where a fixture that a scenario or a `.TDT` case names lives in the
/// suite. Both engines' runners name a fixture from the repository root
/// (`conformance/fixtures/x.vctower`), so the leading `conformance/` stands
/// for the suite directory itself, whatever it is called on disk: a suite
/// packaged under another name still finds its saved towers. A name that
/// leaves the suite (another prefix, a `..` step, an absolute path) is
/// refused, so a scenario names nothing outside it. The check reads the name
/// only; a symbolic link inside the suite is followed like any file.
///
/// A repository root passed where the suite belongs (the runners took the
/// root before #980's stage 4) is refused with a message that says so.
pub fn fixture_path(suite: &Path, fixture: &str) -> Result<PathBuf, String> {
    if suite.join("conformance").is_dir() && !suite.join("scenarios").is_dir() {
        return Err(format!(
            "{}: pass the conformance directory itself, which holds scenarios/; this looks like the directory above it",
            suite.display()
        ));
    }
    fixture
        .strip_prefix("conformance/")
        // The text first: `components()` drops a `.` or an empty step in the
        // middle of a name, and the rule is that a name has none. A step of
        // dots alone (empty, `.`, `..`) is refused.
        .filter(|rest| {
            rest.split(['/', '\\'])
                .all(|step| !step.chars().all(|c| c == '.'))
        })
        .map(Path::new)
        .filter(|rest| rest.components().all(|c| matches!(c, Component::Normal(_))))
        .map(|rest| suite.join(rest))
        .ok_or_else(|| {
            format!("{fixture}: a fixture is named conformance/<a path inside the suite>")
        })
}

#[cfg(test)]
mod tests {
    use super::fixture_path;
    use std::path::Path;

    #[test]
    fn a_fixture_resolves_inside_the_suite_whatever_it_is_called() {
        let suite = Path::new("/packaged/suite-1.2");
        assert_eq!(
            fixture_path(suite, "conformance/fixtures/a.vctower").unwrap(),
            suite.join("fixtures").join("a.vctower")
        );
    }

    #[test]
    fn a_fixture_outside_the_suite_is_refused() {
        let suite = Path::new("suite");
        for name in [
            "src/tests/fixtures/a.vctower",
            "fixtures/a.vctower",
            "conformance/",
            "conformance",
            "conformance/../src/a.vctower",
            "conformance/fixtures/../../a.vctower",
            "conformance/./fixtures/a.vctower",
            "conformance/fixtures/./a.vctower",
            "conformance/fixtures//a.vctower",
            "conformance/fixtures/",
            "conformance//etc/passwd",
            "/conformance/fixtures/a.vctower",
        ] {
            let err = fixture_path(suite, name).unwrap_err();
            assert!(err.starts_with(name), "{name}: {err}");
        }
    }

    #[test]
    fn a_repository_root_passed_as_the_suite_is_named() {
        // A root of its own: the suite under it, and no scenarios/ beside.
        let root = std::env::temp_dir().join(format!("vc-suite-root-{}", std::process::id()));
        std::fs::create_dir_all(root.join("conformance/scenarios")).unwrap();
        let err = fixture_path(&root, "conformance/fixtures/a.vctower").unwrap_err();
        let inside = fixture_path(&root.join("conformance"), "conformance/fixtures/a.vctower");
        std::fs::remove_dir_all(&root).unwrap();
        assert!(
            err.contains("pass the conformance directory itself"),
            "{err}"
        );
        assert!(inside.is_ok());
    }

    /// Every fixture the lock's scenarios and `.TDT` cases name resolves and
    /// exists, so the referee reads them from the suite alone.
    #[test]
    fn every_fixture_the_lock_names_is_in_the_suite() {
        let suite = Path::new(env!("CARGO_MANIFEST_DIR")).join("../conformance");
        // Every string-valued `fixture` field, wherever it sits in a file.
        fn fixtures(v: &serde_json::Value, out: &mut Vec<String>) {
            match v {
                serde_json::Value::Object(map) => {
                    for (key, value) in map {
                        match (key.as_str(), value) {
                            ("fixture", serde_json::Value::String(name)) => out.push(name.clone()),
                            _ => fixtures(value, out),
                        }
                    }
                }
                serde_json::Value::Array(items) => items.iter().for_each(|i| fixtures(i, out)),
                _ => {}
            }
        }
        let mut names = Vec::new();
        let mut files = vec![suite.join("tdt-cases.json")];
        for entry in std::fs::read_dir(suite.join("scenarios")).unwrap() {
            let path = entry.unwrap().path();
            if path.extension().is_some_and(|e| e == "json") {
                files.push(path);
            }
        }
        for file in files {
            let text = std::fs::read_to_string(&file).unwrap();
            fixtures(&serde_json::from_str(&text).unwrap(), &mut names);
        }
        assert!(names.len() >= 15, "found only {names:?}");
        for name in names {
            let path = fixture_path(&suite, &name).unwrap();
            assert!(path.is_file(), "{name} is not in the suite");
        }
    }
}
