// `sqlx::migrate!` embeds the migrations at compile time but doesn't notice new files on its own:
// rebuild this crate whenever the folder changes, or a binary could ship without a new migration.
fn main() {
    println!("cargo:rerun-if-changed=../../migrations");
}
