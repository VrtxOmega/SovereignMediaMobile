import os
from PIL import Image

# Update these paths to point to your local icon source and Android res directory
src_img_path = os.path.expanduser(os.path.join("~", "sovereign_audio_icon.png"))
base_res_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "android", "app", "src", "main", "res")

sizes = {
    "mipmap-mdpi": 48,
    "mipmap-hdpi": 72,
    "mipmap-xhdpi": 96,
    "mipmap-xxhdpi": 144,
    "mipmap-xxxhdpi": 192
}

try:
    img = Image.open(src_img_path)
    
    for folder, size in sizes.items():
        folder_path = os.path.join(base_res_path, folder)
        if not os.path.exists(folder_path):
            os.makedirs(folder_path)
        
        resized_img = img.resize((size, size), Image.Resampling.LANCZOS)
        
        # Save as ic_launcher.png and ic_launcher_round.png
        resized_img.save(os.path.join(folder_path, "ic_launcher.png"))
        resized_img.save(os.path.join(folder_path, "ic_launcher_round.png"))
        print(f"Saved {size}x{size} to {folder}")
        
    print("Icons successfully injected!")
except Exception as e:
    print(f"Error: {e}")
