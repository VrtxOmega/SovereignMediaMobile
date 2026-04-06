import os
from PIL import Image

src_img_path = r"C:\Users\rlope\.gemini\antigravity\brain\cb3223a2-341c-485f-8bc8-72c340a67c68\sovereign_audio_premium_icon_1775184815506.png"
base_res_path = r"C:\Veritas_Lab\SovereignAudio\android\app\src\main\res"

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
