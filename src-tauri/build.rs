use image::{imageops::FilterType, DynamicImage, ImageFormat};
use std::{fs, path::{Path, PathBuf}};

fn main() {
    generate_icons();
    tauri_build::build()
}

fn generate_icons() {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let designs_dir = manifest_dir.parent().unwrap().join("designs");
    let icons_dir = manifest_dir.join("icons");

    let spritesheet_path = designs_dir.join("E.png");
    let json_path = designs_dir.join("E.json");

    // Tell cargo to rerun if source files change
    println!("cargo:rerun-if-changed={}", spritesheet_path.display());
    println!("cargo:rerun-if-changed={}", json_path.display());

    let sheet = image::open(&spritesheet_path).expect("Failed to open E.png spritesheet");
    let json_str = fs::read_to_string(&json_path).expect("Failed to read E.json");
    let json: serde_json::Value = serde_json::from_str(&json_str).expect("Failed to parse E.json");

    // Find the last frame
    let frames = json["frames"].as_object().expect("frames must be an object");
    let last_frame = frames
        .values()
        .last()
        .expect("No frames in spritesheet");
    let f = &last_frame["frame"];
    let (x, y, w, h) = (
        f["x"].as_u64().unwrap() as u32,
        f["y"].as_u64().unwrap() as u32,
        f["w"].as_u64().unwrap() as u32,
        f["h"].as_u64().unwrap() as u32,
    );

    let frame = sheet.crop_imm(x, y, w, h);

    fs::create_dir_all(&icons_dir).expect("Failed to create icons dir");

    // PNG sizes required by tauri.conf.json
    save_png(&frame, &icons_dir.join("32x32.png"), 32, FilterType::Nearest);
    save_png(&frame, &icons_dir.join("64x64.png"), 64, FilterType::Nearest);
    save_png(&frame, &icons_dir.join("128x128.png"), 128, FilterType::Nearest);
    save_png(&frame, &icons_dir.join("128x128@2x.png"), 256, FilterType::Nearest);
    save_png(&frame, &icons_dir.join("icon.png"), 512, FilterType::Nearest);

    // ICO (Windows) — embed multiple sizes
    save_ico(&frame, &icons_dir.join("icon.ico"));

    // Windows Appx icons
    let appx_dir = &icons_dir;
    save_png(&frame, &appx_dir.join("StoreLogo.png"), 50, FilterType::Nearest);
    save_png(&frame, &appx_dir.join("Square30x30Logo.png"), 30, FilterType::Nearest);
    save_png(&frame, &appx_dir.join("Square44x44Logo.png"), 44, FilterType::Nearest);
    save_png(&frame, &appx_dir.join("Square71x71Logo.png"), 71, FilterType::Nearest);
    save_png(&frame, &appx_dir.join("Square89x89Logo.png"), 89, FilterType::Nearest);
    save_png(&frame, &appx_dir.join("Square107x107Logo.png"), 107, FilterType::Nearest);
    save_png(&frame, &appx_dir.join("Square142x142Logo.png"), 142, FilterType::Nearest);
    save_png(&frame, &appx_dir.join("Square150x150Logo.png"), 150, FilterType::Nearest);
    save_png(&frame, &appx_dir.join("Square284x284Logo.png"), 284, FilterType::Nearest);
    save_png(&frame, &appx_dir.join("Square310x310Logo.png"), 310, FilterType::Nearest);

    // iOS icons
    let ios_dir = icons_dir.join("ios");
    fs::create_dir_all(&ios_dir).unwrap();
    for (name, size) in [
        ("AppIcon-20x20@1x.png", 20u32),
        ("AppIcon-20x20@2x-1.png", 40),
        ("AppIcon-20x20@2x.png", 40),
        ("AppIcon-20x20@3x.png", 60),
        ("AppIcon-29x29@1x.png", 29),
        ("AppIcon-29x29@2x-1.png", 58),
        ("AppIcon-29x29@2x.png", 58),
        ("AppIcon-29x29@3x.png", 87),
        ("AppIcon-40x40@1x.png", 40),
        ("AppIcon-40x40@2x-1.png", 80),
        ("AppIcon-40x40@2x.png", 80),
        ("AppIcon-40x40@3x.png", 120),
        ("AppIcon-60x60@2x.png", 120),
        ("AppIcon-60x60@3x.png", 180),
        ("AppIcon-76x76@1x.png", 76),
        ("AppIcon-76x76@2x.png", 152),
        ("AppIcon-83.5x83.5@2x.png", 167),
        ("AppIcon-512@2x.png", 1024),
    ] {
        save_png(&frame, &ios_dir.join(name), size, FilterType::Nearest);
    }

    // Android icons
    for (density, size_launcher, size_fg) in [
        ("mipmap-mdpi", 48u32, 108u32),
        ("mipmap-hdpi", 72, 162),
        ("mipmap-xhdpi", 96, 216),
        ("mipmap-xxhdpi", 144, 324),
        ("mipmap-xxxhdpi", 192, 432),
    ] {
        let dir = icons_dir.join("android").join(density);
        fs::create_dir_all(&dir).unwrap();
        save_png(&frame, &dir.join("ic_launcher.png"), size_launcher, FilterType::Nearest);
        save_png(&frame, &dir.join("ic_launcher_round.png"), size_launcher, FilterType::Nearest);
        save_png(&frame, &dir.join("ic_launcher_foreground.png"), size_fg, FilterType::Nearest);
    }

    // .icns is macOS-only and requires platform tooling; skip on non-mac builds.
    // cargo tauri build on macOS will handle it via the icon.png fallback.
}

fn save_png(src: &DynamicImage, path: &Path, size: u32, filter: FilterType) {
    let resized = src.resize_exact(size, size, filter);
    resized.save_with_format(path, ImageFormat::Png).unwrap_or_else(|e| {
        panic!("Failed to save {}: {}", path.display(), e)
    });
}

fn save_ico(src: &DynamicImage, path: &Path) {
    // ICO with multiple embedded sizes
    let sizes = [16u32, 24, 32, 48, 64, 128, 256];
    let mut ico_dir = ico::IconDir::new(ico::ResourceType::Icon);
    for size in sizes {
        let resized = src.resize_exact(size, size, FilterType::Nearest);
        let rgba = resized.to_rgba8();
        let entry = ico::IconImage::from_rgba_data(size, size, rgba.into_raw());
        ico_dir.add_entry(ico::IconDirEntry::encode(&entry).expect("ico encode failed"));
    }
    let file = fs::File::create(path).expect("Failed to create icon.ico");
    ico_dir.write(file).expect("Failed to write icon.ico");
}
