// Rust Test File
// Tests syntax highlighting for Rust

use std::collections::HashMap;
use std::fmt;

#[derive(Debug, Clone)]
pub struct Config {
    pub name: String,
    pub version: u32,
    pub debug: bool,
}

impl Config {
    pub fn new(name: &str) -> Self {
        Self {
            name: name.to_string(),
            version: 1,
            debug: false,
        }
    }

    pub fn with_debug(mut self, debug: bool) -> Self {
        self.debug = debug;
        self
    }
}

impl fmt::Display for Config {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{} v{}", self.name, self.version)
    }
}

// Generic function with trait bounds
fn find_max<T: Ord>(items: &[T]) -> Option<&T> {
    items.iter().max()
}

// Enum with variants
enum Status {
    Active,
    Inactive,
    Pending { reason: String },
}

fn main() {
    let config = Config::new("ultra")
        .with_debug(true);

    println!("Config: {}", config);

    // Pattern matching
    let status = Status::Pending {
        reason: "Awaiting review".to_string(),
    };

    match status {
        Status::Active => println!("Active"),
        Status::Inactive => println!("Inactive"),
        Status::Pending { reason } => println!("Pending: {}", reason),
    }

    // Collections
    let mut scores: HashMap<&str, i32> = HashMap::new();
    scores.insert("Alice", 100);
    scores.insert("Bob", 85);

    // Iterators and closures
    let high_scores: Vec<_> = scores
        .iter()
        .filter(|(_, &score)| score >= 90)
        .map(|(name, score)| format!("{}: {}", name, score))
        .collect();

    // Option handling
    let numbers = vec![1, 2, 3, 4, 5];
    if let Some(max) = find_max(&numbers) {
        println!("Max: {}", max);
    }
}
