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
/// refused, so a scenario reads nothing outside it.
pub fn fixture_path(suite: &Path, fixture: &str) -> Result<PathBuf, String> {
    fixture
        .strip_prefix("conformance/")
        .map(Path::new)
        .filter(|rest| {
            rest.components().next().is_some()
                && rest.components().all(|c| matches!(c, Component::Normal(_)))
        })
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
            "conformance//etc/passwd",
            "/conformance/fixtures/a.vctower",
        ] {
            let err = fixture_path(suite, name).unwrap_err();
            assert!(err.starts_with(name), "{name}: {err}");
        }
    }

    /// Every fixture the lock's scenarios and `.TDT` cases name resolves and
    /// exists, so the referee reads them from the suite alone.
    #[test]
    fn every_fixture_the_lock_names_is_in_the_suite() {
        let suite = Path::new(env!("CARGO_MANIFEST_DIR")).join("../conformance");
        let mut names = Vec::new();
        let mut texts = vec![std::fs::read_to_string(suite.join("tdt-cases.json")).unwrap()];
        for entry in std::fs::read_dir(suite.join("scenarios")).unwrap() {
            texts.push(std::fs::read_to_string(entry.unwrap().path()).unwrap());
        }
        for text in &texts {
            for part in text.split("\"fixture\"").skip(1) {
                let name = part.split('"').nth(1).unwrap();
                names.push(name.to_string());
            }
        }
        assert!(names.len() >= 15, "found only {names:?}");
        for name in names {
            let path = fixture_path(&suite, &name).unwrap();
            assert!(path.is_file(), "{name} is not in the suite");
        }
    }
}
