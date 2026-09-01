// Doljer konsolfonstret i den byggda appen (men inte under utveckling,
// dar vi vill se panics och loggar).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    mdash_lib::run()
}
